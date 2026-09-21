/**
 * Uploads storage — bulletins xlsx / PDF élèves.
 * Les bulletins vont en priorité dans student-documents (bibliothèque élève).
 */
import { supabase } from "@/integrations/supabase/client";

export type UploadResult = { path: string; bucket: string };

async function uploadWithFallback(
  preferredBucket: string,
  fallbackBucket: string,
  path: string,
  blob: Blob,
  contentType: string,
): Promise<UploadResult> {
  const opts = { contentType, upsert: true as const };
  const first = await supabase.storage.from(preferredBucket).upload(path, blob, opts);
  if (!first.error) return { path, bucket: preferredBucket };

  const second = await supabase.storage.from(fallbackBucket).upload(path, blob, opts);
  if (!second.error) return { path, bucket: fallbackBucket };

  const msg =
    (first.error as { message?: string } | null)?.message ??
    (second.error as { message?: string } | null)?.message ??
    "Upload impossible";
  throw new Error(msg);
}

/** Bulletin .xlsx → student-documents d'abord (visible dans la bibliothèque). */
export async function uploadBulletinWorkbook(path: string, blob: Blob): Promise<UploadResult> {
  return uploadWithFallback(
    "student-documents",
    "report-templates",
    path,
    blob,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

/** PDF élève (aperçu / annuel) → student-documents. */
export async function uploadStudentPdf(path: string, blob: Blob): Promise<UploadResult> {
  const { error } = await supabase.storage.from("student-documents").upload(path, blob, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw error;
  return { path, bucket: "student-documents" };
}

/** Résout bucket + chemin stockés (préfixe report-templates:…). */
export function resolveStoredPath(filePath: string): { bucket: string; path: string } {
  if (filePath.includes(":") && !filePath.startsWith("http")) {
    const [b, ...rest] = filePath.split(":");
    if (b === "report-templates" || b === "student-documents") {
      return { bucket: b, path: rest.join(":") };
    }
  }
  return { bucket: "student-documents", path: filePath };
}
