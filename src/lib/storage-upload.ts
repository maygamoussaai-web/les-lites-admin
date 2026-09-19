/**
 * Uploads storage — bulletins xlsx / PDF élèves.
 * Retente si le bucket principal refuse le type MIME.
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

  // Retry fallback bucket (souvent student-documents si report-templates refuse xlsx)
  const second = await supabase.storage.from(fallbackBucket).upload(path, blob, opts);
  if (!second.error) return { path, bucket: fallbackBucket };

  throw first.error ?? second.error ?? new Error("Upload impossible");
}

/** Bulletin .xlsx validé — préfère report-templates, sinon student-documents. */
export async function uploadBulletinWorkbook(path: string, blob: Blob): Promise<UploadResult> {
  return uploadWithFallback(
    "report-templates",
    "student-documents",
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
