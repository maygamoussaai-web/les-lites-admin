/**
 * Téléchargement groupé des bulletins d'une période (ZIP).
 */
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { getStorageAccess } from "@/lib/storage-access";
import { downloadBlob } from "@/lib/pdf-export";

export type ZipStudentRef = {
  id: string;
  first_name: string;
  last_name: string;
};

function safeFilePart(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

/**
 * Construit un ZIP avec tous les bulletins liés à la période (via student_report_cards).
 * @returns nombre de fichiers inclus
 */
export async function downloadPeriodBulletinsZip(opts: {
  classId: string;
  periodId: string;
  periodNumber: number;
  className: string;
  students: ZipStudentRef[];
  onProgress?: (done: number, total: number) => void;
}): Promise<number> {
  const { data: cards, error } = await supabase
    .from("student_report_cards")
    .select("id, student_id, document_id")
    .eq("class_id", opts.classId)
    .eq("period_id", opts.periodId)
    .not("document_id", "is", null);

  if (error) throw error;
  const withDoc = (cards ?? []).filter((c) => !!c.document_id);
  if (withDoc.length === 0) {
    throw new Error("Aucun bulletin généré pour cette période.");
  }

  const docIds = withDoc.map((c) => c.document_id as string);
  const { data: docs, error: docErr } = await supabase
    .from("student_documents")
    .select("id, name, file_path, file_type")
    .in("id", docIds);

  if (docErr) throw docErr;
  const docById = new Map((docs ?? []).map((d) => [d.id, d]));
  const studentById = new Map(opts.students.map((s) => [s.id, s]));

  const zip = new JSZip();
  let included = 0;
  const total = withDoc.length;
  const usedNames = new Set<string>();

  for (const card of withDoc) {
    const doc = docById.get(card.document_id as string);
    opts.onProgress?.(included, total);
    if (!doc?.file_path?.trim()) continue;

    try {
      const access = await getStorageAccess(doc.file_path);
      let blob = access.blob;
      if (!blob && access.signedUrl) {
        const res = await fetch(access.signedUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        blob = await res.blob();
      }
      if (!blob || blob.size === 0) continue;

      const st = studentById.get(card.student_id);
      const base =
        st != null
          ? `${safeFilePart(st.last_name)}_${safeFilePart(st.first_name)}`
          : safeFilePart(doc.name || card.student_id);
      let entryName = `${base}_P${opts.periodNumber}.xlsx`;
      if (usedNames.has(entryName)) {
        entryName = `${base}_P${opts.periodNumber}_${card.student_id.slice(0, 6)}.xlsx`;
      }
      usedNames.add(entryName);
      zip.file(entryName, await blob.arrayBuffer());
      included += 1;
    } catch {
      /* skip missing file, continue */
    }
  }

  opts.onProgress?.(included, total);
  if (included === 0) {
    throw new Error("Aucun fichier bulletin récupérable (fichiers manquants sur le stockage).");
  }

  const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const zipName = `bulletins_${safeFilePart(opts.className)}_P${opts.periodNumber}.zip`;
  downloadBlob(zipBlob, zipName);
  return included;
}
