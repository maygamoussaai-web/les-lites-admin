/**
 * MODELES DE BULLETIN EXCEL — lecture, detection des zones, remplissage.
 * Politique : remplir UNIQUEMENT les notes + balises ; rejouer les formules Excel.
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
  general_average: "Moyenne generale de l'eleve",
  first_average: "Moyenne generale du premier",
  last_average: "Moyenne generale du dernier",
  class_average_evaluation: "Moyenne de classe (evaluations)",
  class_average_composition: "Moyenne de classe (compositions)",
  rank: "Rang de l'eleve",
  date: "Date d'edition",
};

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

const COLUMN_HINTS: [ColumnRole, string[]][] = [
  ["subject", ["matiere", "matieres", "discipline", "disciplines"]],
  ["composition", ["composition", "compo", "devoir compo", "note compo"]],
  ["evaluation_average", ["moyenne evaluation", "moyenne des evaluations", "moy eval", "moyenne de classe", "moyenne classe"]],
  ["evaluation", ["evaluation", "evaluations", "eval", "note de classe", "notes de classe", "note classe", "notes classe", "note d evaluation", "interro", "devoir", "devoirs"]],
  ["subject_average", ["moyenne", "moy", "moyenne matiere"]],
  ["coefficient", ["coef", "coefficient", "coeff"]],
  ["subject_rank", ["rang", "rang matiere", "place"]],
  ["appreciation", ["appreciation", "appreciations", "observation", "observations", "mention"]],
  ["teacher", ["professeur", "prof", "enseignant", "nom du professeur"]],
];

const FIELD_HINTS: [FieldRole, string[]][] = [
  ["student_first_name", ["prenom", "prenom de l eleve", "prenom eleve", "first name"]],
  ["student_last_name", ["nom de famille", "nom famille", "last name", "nom"]],
  ["student_name", ["nom et prenom", "nom prenom", "nom de l eleve", "eleve", "nom complet"]],
  ["class_name", ["classe", "class"]],
  ["establishment_name", ["etablissement", "complexe", "ecole", "lycee", "college"]],
  ["period_label", ["periode", "trimestre", "semestre", "mois"]],
  ["headcount", ["effectif", "nombre d eleves", "effectif de la classe", "nb eleves"]],
  ["general_average", ["moyenne generale", "moyenne de l eleve", "moyenne annuelle", "moy gen"]],
  ["first_average", ["moyenne du premier", "premier", "plus forte moyenne", "moyenne la plus forte", "moyenne la plus elevee", "moyenne la plus haute"]],
  ["last_average", ["moyenne du dernier", "dernier", "plus faible moyenne", "moyenne la plus faible", "moyenne la plus basse"]],
  ["class_average_evaluation", ["moyenne de classe", "moyenne classe", "moyenne des evaluations de la classe"]],
  ["class_average_composition", ["moyenne de composition", "moyenne composition", "moyenne des compositions"]],
  ["rank", ["rang", "place", "rang de l eleve"]],
  ["date", ["date", "fait le", "edite le", "date d edition"]],
];

const matchHint = <T extends string>(text: string, hints: [T, string[]][]): T | null => {
  const t = normalize(text);
  if (!t) return null;
  for (const [role, keys] of hints) if (keys.includes(t)) return role;
  for (const [role, keys] of hints) if (keys.some((k) => t.includes(k))) return role;
  return null;
};

export type DetectionResult = { mapping: TemplateMapping; warnings: string[] };

export function detectMapping(sheet: TemplateSheet): DetectionResult {
  const warnings: string[] = [];
  const text = (row1: number, col0: number) => {
    const cell = sheet.cells[ref(row1, col0)];
    return cell && cell.v !== null ? String(cell.v) : "";
  };

  let headerRow = 0;
  let subjectCol = -1;
  for (let r = 1; r <= sheet.rows && headerRow === 0; r++) {
    for (let c = 0; c < sheet.cols; c++) {
      if (matchHint(text(r, c), COLUMN_HINTS) === "subject") {
        headerRow = r;
        subjectCol = c;
        break;
      }
    }
  }

  const columns: Record<string, ColumnRole> = {};
  if (headerRow > 0) {
    for (let c = 0; c < sheet.cols; c++) {
      const label = text(headerRow, c) || text(headerRow - 1, c);
      const role = matchHint(label, COLUMN_HINTS);
      if (role) columns[colLetter(c)] = role;
    }
    if (subjectCol >= 0) columns[colLetter(subjectCol)] = "subject";
    const exclusive: ColumnRole[] = [
      "subject",
      "composition",
      "evaluation_average",
      "subject_average",
      "coefficient",
      "subject_rank",
      "appreciation",
      "teacher",
    ];
    const seen = new Set<ColumnRole>();
    for (const [letter, role] of Object.entries({ ...columns })) {
      if (role === "evaluation" || role === "ignore") continue;
      if (exclusive.includes(role)) {
        if (seen.has(role)) delete columns[letter];
        else seen.add(role);
      }
    }
  }

  let firstSubjectRow = headerRow + 1;
  let lastSubjectRow = firstSubjectRow;
  if (headerRow > 0 && subjectCol >= 0) {
    let r = firstSubjectRow;
    let blanks = 0;
    while (r <= sheet.rows && blanks < 3) {
      const label = text(r, subjectCol);
      if (label && isSubjectLabel(label)) {
        lastSubjectRow = r;
        blanks = 0;
      } else {
        blanks++;
      }
      r++;
    }
    if (lastSubjectRow < firstSubjectRow) lastSubjectRow = firstSubjectRow + 9;
  }

  const fields: Record<string, FieldRole> = {};
  const used = new Set<FieldRole>();
  const extractTokenInner = (raw: string): string | null => {
    const s = raw.trim();
    const pure = /^[[{]([^\]}]+)[\]}]$/.exec(s);
    if (pure) return pure[1]!.trim();
    const embedded = /[[{]([^\]}]+)[\]}]/.exec(s);
    if (embedded) return embedded[1]!.trim();
    return null;
  };
  for (let r = 1; r <= sheet.rows; r++) {
    for (let c = 0; c < sheet.cols; c++) {
      if (headerRow > 0 && subjectCol >= 0 && r >= firstSubjectRow && r <= lastSubjectRow && c === subjectCol) continue;
      const label = text(r, c);
      if (!label) continue;
      const inner = extractTokenInner(label);
      if (inner) {
        const role = matchHint(inner, FIELD_HINTS) ?? matchHint(label, FIELD_HINTS);
        if (role && !used.has(role)) {
          fields[ref(r, c)] = role;
          used.add(role);
        }
        continue;
      }
      const roleFromLabel = matchHint(label, FIELD_HINTS);
      if (!roleFromLabel || used.has(roleFromLabel)) continue;
      if (headerRow > 0 && r === headerRow) continue;
      if (c + 1 < sheet.cols) {
        const right = text(r, c + 1).trim();
        if (!right || extractTokenInner(right)) {
          fields[ref(r, c + 1)] = roleFromLabel;
          used.add(roleFromLabel);
        }
      }
    }
  }
  if (Object.keys(fields).length === 0) {
    warnings.push(
      "Aucune balise detectee. Placez dans une cellule [prenom], [nom], [classe], [effectif], [rang], [date], etc.",
    );
  }

  return {
    mapping: {
      version: 1,
      sheetName: sheet.sheetName,
      headerRow,
      firstSubjectRow,
      lastSubjectRow,
      columns,
      fields,
    },
    warnings,
  };
}

export type FillData = {
  establishmentName: string;
  className: string;
  periodLabel: string;
  studentName: string;
  studentFirstName: string;
  studentLastName: string;
  subjects: {
    name: string;
    composition: number | null;
    evaluations: number[];
    evaluationAverage: number | null;
    average: number | null;
  }[];
  generalAverage: number | null;
  firstAverage: number | null;
  lastAverage: number | null;
  classAverageEvaluation: number | null;
  classAverageComposition: number | null;
  headcount: number;
  rank: number | null;
  scale: number;
};

export type ComputedAverages = {
  generalAverage: number | null;
  subjectAverages: Record<string, number | null>;
};
