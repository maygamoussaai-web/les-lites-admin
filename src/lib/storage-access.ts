/**
 * Accès Storage unifié (signed URL + blob) pour student-documents / report-templates.
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveStoredPath } from "@/lib/storage-upload";

export type StorageAccess = {
  path: string;
  bucket: string;
  signedUrl: string | null;
  blob: Blob | null;
};

export async function getStorageAccess(filePath: string): Promise<StorageAccess> {
  const resolved = resolveStoredPath(filePath);
  let path = (resolved.path || "").replace(/^\/+/, "").trim();
  if (!path) throw new Error("Chemin de fichier invalide");

  if (path.startsWith("student-documents/")) path = path.slice("student-documents/".length);
  if (path.startsWith("report-templates/")) path = path.slice("report-templates/".length);

  const buckets = Array.from(
    new Set<string>([resolved.bucket, "student-documents", "report-templates"]),
  );
  const errors: string[] = [];
  let signedUrl: string | null = null;
  let blob: Blob | null = null;
  let usedBucket = resolved.bucket;

  for (const b of buckets) {
    const { data: signed, error } = await supabase.storage.from(b).createSignedUrl(path, 3600);
    if (!error && signed?.signedUrl) {
      signedUrl = signed.signedUrl;
      usedBucket = b;
      break;
    }
    if (error) errors.push(`${b}/sign: ${error.message}`);
  }

  for (const b of buckets) {
    const { data, error } = await supabase.storage.from(b).download(path);
    if (!error && data && data.size > 0) {
      blob = data;
      if (!signedUrl) usedBucket = b;
      break;
    }
    if (error) errors.push(`${b}/dl: ${error.message}`);
  }

  if (!signedUrl && !blob) {
    throw new Error(
      errors.length
        ? `Fichier introuvable (${path}). ${errors.slice(0, 2).join(" · ")}`
        : `Fichier introuvable (${path})`,
    );
  }

  return { path, bucket: usedBucket, signedUrl, blob };
}
