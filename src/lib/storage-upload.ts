import { supabase } from "@/integrations/supabase/client";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function isMimeRejected(error: unknown): boolean {
  const message = error && typeof error === "object" && "message" in error ? String((error as { message?: string }).message) : String(error ?? "");
  return /mime type|not supported|invalid.*type/i.test(message);
}

/**
 * Le bucket student-documents n'accepte souvent que JPEG/PNG/PDF.
 * On retente octet-stream puis le bucket des modeles Excel.
 */
export async function uploadBulletinWorkbook(
  path: string,
  bytes: Blob | Uint8Array | ArrayBuffer,
): Promise<{ path: string; bucket: string; contentType: string }> {
  const blob =
    bytes instanceof Blob
      ? bytes
      : new Blob([bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes], { type: XLSX_MIME });

  const attempts: { bucket: string; contentType: string }[] = [
    { bucket: "student-documents", contentType: XLSX_MIME },
    { bucket: "student-documents", contentType: "application/octet-stream" },
    { bucket: "report-templates", contentType: XLSX_MIME },
    { bucket: "report-templates", contentType: "application/octet-stream" },
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    const { error } = await supabase.storage.from(attempt.bucket).upload(path, blob, {
      contentType: attempt.contentType,
      upsert: false,
    });
    if (!error) return { path, bucket: attempt.bucket, contentType: attempt.contentType };
    lastError = error;
    if (!isMimeRejected(error)) throw error;
  }
  throw lastError ?? new Error("Envoi du fichier Excel impossible.");
}

export async function uploadStudentPdf(
  path: string,
  blob: Blob,
): Promise<{ path: string; bucket: string }> {
  const { error } = await supabase.storage.from("student-documents").upload(path, blob, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) throw error;
  return { path, bucket: "student-documents" };
}
