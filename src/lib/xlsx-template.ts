/**
 * MODELES DE BULLETIN EXCEL — lecture, detection des zones, remplissage.
 *
 * Politique stricte (périodique) :
 * - Champs identité / stats : UNIQUEMENT balises [token] ou {token}
 *   ([prenom], [nom], [classe], [effectif], [rang], [date], [premier]…).
 *   Aucun libellé en texte libre (« Moyen Général », « Prénom : »…) n'est
 *   une cible d'écriture.
 * - Colonnes notes : balises [eval], [compo], [moy]… en priorité ;
 *   sinon détection par libellés d'en-tête (structure de grille uniquement).
 * - Toute valeur calculée (moyenne matière, MG, appréciation…) vient
 *   EXCLUSIVEMENT des formules Excel du modèle.
 */
import * as XLSX from "xlsx";
import { evaluateFormula, UnsupportedFormulaError, type CellValue } from "@/lib/xlsx-formula";

export type ColumnRole =
  | "ignore"
  | "subject"
  | "composition"
  | "evaluation"
  | "evaluation_average"
  | "subject_average"
  | "coefficient"
  | "subject_rank"
  | "appreciation"
  | "teacher";

export type FieldRole =
  | "ignore"
  | "student_name"
  | "student_first_name"
  | "student_last_name"
  | "class_name"
  | "establishment_name"
  | "period_label"
  | "headcount"
  | "general_average"
  | "first_average"
  | "last_average"
  | "class_average_evaluation"
  | "class_average_composition"
  | "rank"
  | "date";

export const COLUMN_ROLE_LABELS: Record<ColumnRole, string> = {
  ignore: "Ignorer",
  subject: "Matiere",
  composition: "Composition",
  evaluation: "Notes d'evaluation (note de classe)",
  evaluation_average: "Moyenne des evaluations (notes de classe)",
  subject_average: "Moyenne matiere",
  coefficient: "Coefficient",
  subject_rank: "Rang matiere",
  appreciation: "Appreciation",
  teacher: "Professeur",
};

export const FIELD_ROLE_LABELS: Record<FieldRole, string> = {
  ignore: "Ignorer",
  student_name: "Nom complet",
  student_first_name: "Prenom",
  student_last_name: "Nom",
  class_name: "Classe",
  establishment_name: "Etablissement",
  period_label: "Periode",
  headcount: "Effectif",
  general_average: "Moyenne generale (lecture seule — formule Excel)",
  first_average: "Moyenne generale du premier",
  last_average: "Moyenne generale du dernier",
  class_average_evaluation: "Moyenne de classe (evaluations)",
  class_average_composition: "Moyenne de classe (compositions)",
  rank: "Rang de l'eleve",
  date: "Date d'edition",
};

/** Aide affichable : balises de colonnes reconnues (période = 1-based). */
export const COLUMN_TAG_EXAMPLES = [
  "[matiere]",
  "[coef]",
  "[eval]",
  "[eval:1]",
  "[compo]",
  "[compo:1]",
  "[moy]",
  "[moy:1]",
  "[moy_eval]",
  "[moy_eval:1]",
  "[moyenne_annuelle]",
  "[appreciation]",
  "[prof]",
] as const;

export type TemplateCell = { v: CellValue; f?: string };

export type TemplateSheet = {
  sheetName: string;
  rows: number;
  cols: number;
  cells: Record<string, TemplateCell>;
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[];
  colWidths: number[];
};

export const colLetter = (index0: number) => XLSX.utils.encode_col(index0);
export const colIndex = (letter: string) => XLSX.utils.decode_col(letter);
export const ref = (row1: number, col0: number) => `${colLetter(col0)}${row1}`;

export function readTemplate(buffer: ArrayBuffer, sheetName?: string): TemplateSheet {
  const wb = XLSX.read(buffer, { type: "array", cellFormula: true, cellText: true });
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0]!;
  const sheet = wb.Sheets[name]!;
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  const cells: Record<string, TemplateCell> = {};
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[address];
      if (!cell) continue;
      const value: CellValue =
        cell.t === "n" ? Number(cell.v) : cell.v === undefined || cell.v === null ? null : String(cell.v);
      cells[address] = { v: value, ...(cell.f ? { f: String(cell.f) } : {}) };
    }
  }
  const colWidths: number[] = [];
  const cols = (sheet["!cols"] ?? []) as { wch?: number; width?: number }[];
  for (let c = 0; c <= range.e.c; c++) colWidths[c] = cols[c]?.wch ?? cols[c]?.width ?? 11;
  return {
    sheetName: name,
    rows: range.e.r + 1,
    cols: range.e.c + 1,
    cells,
    merges: (sheet["!merges"] ?? []) as TemplateSheet["merges"],
    colWidths,
  };
}

export const sheetNames = (buffer: ArrayBuffer) => XLSX.read(buffer, { type: "array", bookSheets: true }).SheetNames;

export type TemplateMapping = {
  version: 1;
  sheetName: string;
  headerRow: number;
  firstSubjectRow: number;
  lastSubjectRow: number;
  columns: Record<string, ColumnRole>;
  fields: Record<string, FieldRole>;
  columnLabels?: Record<string, string>;
  /** Colonne → index de période (0-based). Balises [compo:1] ou en-têtes multi-périodes. */
  periodColumns?: Record<string, number>;
  /** Libellés des groupes de périodes détectés (ex. « 1er trimestre »). */
  periodGroupLabels?: string[];
};

export const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const NON_SUBJECT_RE =
  /^(total|sous ?total|moyenne|moyenne general|moyenne generale|moyenne annuelle|rang|effectif|date|observation|observations|appreciation|appreciations|commentaire|commentaires|signature|visa|le directeur|le provis|provis|parent|tuteur|fait a|fait le)\b/;

export function isSubjectLabel(label: string): boolean {
  const t = normalize(label);
  if (!t || t.length < 2) return false;
  if (/^\d+([.,]\d+)?$/.test(t)) return false;
  if (NON_SUBJECT_RE.test(t)) return false;
  if (/\bobservation/.test(t)) return false;
  if (/\bappreciation/.test(t)) return false;
  if (t.includes("proviseur") || t.includes("directeur")) return false;
  if (t.startsWith("les observations") || t.startsWith("observation")) return false;
  if (t === "total" || t.startsWith("total ")) return false;
  return true;
}
