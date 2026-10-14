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
  // Même règle que le bouton : tous les élèves de la liste doivent avoir un bulletin classé
  if (opts.students.length) {
    const byStudent = new Map(withDoc.map((c) => [c.student_id, c]));
    const missing = opts.students.filter((s) => !byStudent.has(s.id));
    if (missing.length) {
      throw new Error(
        `Bulletins incomplets : ${missing.length} élève(s) sans bulletin classé. Générez tous les bulletins avant le téléchargement de classe.`,
      );
    }
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


/**
 * ZIP des bulletins annuels classés (fichiers Excel intacts, 1 fichier par élève).
 * Exige un bulletin annuel pour chaque élève fourni.
 */
export async function downloadAnnualBulletinsZip(opts: {
  className: string;
  students: ZipStudentRef[];
  onProgress?: (done: number, total: number) => void;
}): Promise<number> {
  const studentIds = opts.students.map((s) => s.id);
  if (!studentIds.length) throw new Error("Aucun élève.");

  const { data: docs, error } = await supabase
    .from("student_documents")
    .select("id, student_id, name, file_path, file_type, created_at")
    .in("student_id", studentIds)
    .ilike("name", "Bulletin annuel%")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const latestByStudent = new Map<string, (typeof docs)[0]>();
  for (const d of docs ?? []) {
    if (!latestByStudent.has(d.student_id)) latestByStudent.set(d.student_id, d);
  }
  const missing = studentIds.filter((id) => !latestByStudent.has(id));
  if (missing.length) {
    throw new Error(
      `Bulletins annuels incomplets : ${missing.length} élève(s) sans fichier classé.`,
    );
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  let included = 0;
  const ordered = [...opts.students].sort((a, b) =>
    `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, "fr"),
  );

  for (const st of ordered) {
    opts.onProgress?.(included, ordered.length);
    const doc = latestByStudent.get(st.id)!;
    if (!doc.file_path?.trim()) {
      throw new Error(`Fichier manquant pour ${st.last_name} ${st.first_name}.`);
    }
    const access = await getStorageAccess(doc.file_path);
    let blob = access.blob;
    if (!blob && access.signedUrl) {
      const res = await fetch(access.signedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
    }
    if (!blob || blob.size === 0) {
      throw new Error(`Fichier vide pour ${st.last_name} ${st.first_name}.`);
    }
    const base = `${safeFilePart(st.last_name)}_${safeFilePart(st.first_name)}`;
    let entryName = `${base}_annuel.xlsx`;
    if (usedNames.has(entryName)) {
      entryName = `${base}_annuel_${st.id.slice(0, 6)}.xlsx`;
    }
    usedNames.add(entryName);
    zip.file(entryName, await blob.arrayBuffer());
    included += 1;
  }

  opts.onProgress?.(included, ordered.length);
  if (included === 0) {
    throw new Error("Aucun bulletin annuel récupérable.");
  }

  const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  downloadBlob(zipBlob, `bulletins_annuels_${safeFilePart(opts.className)}.zip`);
  return included;
}

/**
 * Télécharge un seul classeur Excel multi-feuilles :
 * une feuille = bulletin d'un élève (fichiers déjà classés en bibliothèque).
 * Nécessite que TOUS les élèves fournis aient un bulletin pour la période.
 */
export async function downloadPeriodBulletinsWorkbook(opts: {
  classId: string;
  periodId: string;
  periodNumber: number;
  className: string;
  students: ZipStudentRef[];
  onProgress?: (done: number, total: number) => void;
}): Promise<number> {
  const studentIds = opts.students.map((s) => s.id);
  const { data: cards, error } = await supabase
    .from("student_report_cards")
    .select("id, student_id, document_id")
    .eq("class_id", opts.classId)
    .eq("period_id", opts.periodId)
    .not("document_id", "is", null);

  if (error) throw error;
  const withDoc = (cards ?? []).filter((c) => !!c.document_id);
  const byStudent = new Map(withDoc.map((c) => [c.student_id, c]));
  const missing = studentIds.filter((id) => !byStudent.has(id));
  if (missing.length) {
    throw new Error(
      `Bulletins incomplets : ${missing.length} élève(s) sans bulletin classé. Générez tous les bulletins avant le téléchargement de classe.`,
    );
  }

  const docIds = studentIds.map((id) => byStudent.get(id)!.document_id as string);
  const { data: docs, error: docErr } = await supabase
    .from("student_documents")
    .select("id, name, file_path, file_type")
    .in("id", docIds);
  if (docErr) throw docErr;
  const docById = new Map((docs ?? []).map((d) => [d.id, d]));
  const studentById = new Map(opts.students.map((s) => [s.id, s]));

  const XLSX = await import("xlsx");
  const out = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();
  let included = 0;
  const total = studentIds.length;

  // Ordre alphabétique élève
  const ordered = [...opts.students].sort((a, b) =>
    `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, "fr"),
  );

  for (const st of ordered) {
    opts.onProgress?.(included, total);
    const card = byStudent.get(st.id);
    const doc = card ? docById.get(card.document_id as string) : undefined;
    if (!doc?.file_path?.trim()) {
      throw new Error(`Fichier manquant pour ${st.last_name} ${st.first_name}.`);
    }
    try {
      const access = await getStorageAccess(doc.file_path);
      let blob = access.blob;
      if (!blob && access.signedUrl) {
        const res = await fetch(access.signedUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        blob = await res.blob();
      }
      if (!blob || blob.size === 0) {
        throw new Error(`Fichier vide pour ${st.last_name} ${st.first_name}.`);
      }
      const buf = await blob.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellStyles: true });
      const sheetName0 = wb.SheetNames[0];
      if (!sheetName0) throw new Error("Feuille introuvable");
      const sheet = wb.Sheets[sheetName0]!;

      let sheetName = `${st.last_name} ${st.first_name}`.trim().slice(0, 31) || "Élève";
      sheetName = sheetName.replace(/[\\/*?:\[\]]/g, "_");
      let n = 1;
      const base = sheetName;
      while (usedSheetNames.has(sheetName)) {
        const suffix = `_${n++}`;
        sheetName = (base.slice(0, 31 - suffix.length) + suffix).slice(0, 31);
      }
      usedSheetNames.add(sheetName);
      XLSX.utils.book_append_sheet(out, sheet, sheetName);
      included += 1;
    } catch (e) {
      throw e instanceof Error
        ? e
        : new Error(`Impossible de lire le bulletin de ${st.last_name} ${st.first_name}.`);
    }
  }

  opts.onProgress?.(included, total);
  if (included === 0) {
    throw new Error("Aucun bulletin à assembler.");
  }

  const outBuf = XLSX.write(out, { type: "array", bookType: "xlsx" });
  const outBlob = new Blob([outBuf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const fileName = `bulletins_${safeFilePart(opts.className)}_P${opts.periodNumber}.xlsx`;
  downloadBlob(outBlob, fileName);
  return included;
}

/**
 * Même principe pour les bulletins annuels (documents nommés « Bulletin annuel… »).
 */
export async function downloadAnnualBulletinsWorkbook(opts: {
  className: string;
  students: ZipStudentRef[];
  onProgress?: (done: number, total: number) => void;
}): Promise<number> {
  const studentIds = opts.students.map((s) => s.id);
  if (!studentIds.length) throw new Error("Aucun élève.");

  const { data: docs, error } = await supabase
    .from("student_documents")
    .select("id, student_id, name, file_path, file_type, created_at")
    .in("student_id", studentIds)
    .ilike("name", "Bulletin annuel%")
    .order("created_at", { ascending: false });
  if (error) throw error;

  // Dernier bulletin annuel par élève
  const latestByStudent = new Map<string, (typeof docs)[0]>();
  for (const d of docs ?? []) {
    if (!latestByStudent.has(d.student_id)) latestByStudent.set(d.student_id, d);
  }
  const missing = studentIds.filter((id) => !latestByStudent.has(id));
  if (missing.length) {
    throw new Error(
      `Bulletins annuels incomplets : ${missing.length} élève(s) sans fichier classé.`,
    );
  }

  const XLSX = await import("xlsx");
  const out = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();
  let included = 0;
  const ordered = [...opts.students].sort((a, b) =>
    `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, "fr"),
  );

  for (const st of ordered) {
    opts.onProgress?.(included, ordered.length);
    const doc = latestByStudent.get(st.id)!;
    if (!doc.file_path?.trim()) {
      throw new Error(`Fichier manquant pour ${st.last_name} ${st.first_name}.`);
    }
    if (doc.file_type && !doc.file_type.includes("sheet") && !doc.file_path.endsWith(".xlsx")) {
      // Aperçu image : on ne peut pas fusionner en feuille Excel
      throw new Error(
        `Le bulletin annuel de ${st.last_name} ${st.first_name} n'est pas un fichier Excel.`,
      );
    }
    const access = await getStorageAccess(doc.file_path);
    let blob = access.blob;
    if (!blob && access.signedUrl) {
      const res = await fetch(access.signedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
    }
    if (!blob || blob.size === 0) {
      throw new Error(`Fichier vide pour ${st.last_name} ${st.first_name}.`);
    }
    const buf = await blob.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellStyles: true });
    const sheetName0 = wb.SheetNames[0];
    if (!sheetName0) throw new Error("Feuille introuvable");
    const sheet = wb.Sheets[sheetName0]!;
    let sheetName = `${st.last_name} ${st.first_name}`.trim().slice(0, 31) || "Élève";
    sheetName = sheetName.replace(/[\\/*?:\[\]]/g, "_");
    let n = 1;
    const base = sheetName;
    while (usedSheetNames.has(sheetName)) {
      const suffix = `_${n++}`;
      sheetName = (base.slice(0, 31 - suffix.length) + suffix).slice(0, 31);
    }
    usedSheetNames.add(sheetName);
    XLSX.utils.book_append_sheet(out, sheet, sheetName);
    included += 1;
  }

  opts.onProgress?.(included, ordered.length);
  const outBuf = XLSX.write(out, { type: "array", bookType: "xlsx" });
  downloadBlob(
    new Blob([outBuf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `bulletins_annuels_${safeFilePart(opts.className)}.xlsx`,
  );
  return included;
}
