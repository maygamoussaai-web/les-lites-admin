/**
 * MODÈLES DE BULLETIN EXCEL — lecture, détection des zones, remplissage.
 *
 * NOTE POUR CLAUDE :
 * - Table `report_templates` : le fichier .xlsx est stocké dans le bucket
 *   `report-templates` (chemin `${establishment_id}/...`), et la
 *   correspondance détectée/confirmée est enregistrée dans la colonne
 *   `mapping` (jsonb) au format `TemplateMapping` ci-dessous (champ `version`
 *   pour pouvoir évoluer sans casser les modèles déjà enregistrés).
 * - Aucune règle de calcul n'est inventée ici : les notes et moyennes
 *   viennent de src/lib/grades.ts, les formules du modèle sont rejouées par
 *   src/lib/xlsx-formula.ts.
 * - Politique stricte de remplissage : l'app ne touche qu'aux balises [jeton]
 *   et aux colonnes de notes/moyennes du tableau des matières. Noms de
 *   matières, coefficients, titres et mise en page du fichier restent intacts.
 * - Le rendu PDF passe par canvas puis src/lib/pdf-export.ts:canvasToPdfBlob
 *   (aucune dépendance PDF supplémentaire).
 */
import * as XLSX from "xlsx";
import { evaluateFormula, expandRange, UnsupportedFormulaError, type CellValue } from "@/lib/xlsx-formula";

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
  ignore: "Ne pas remplir",
  subject: "Nom de la matière",
  composition: "Note de composition",
  evaluation: "Notes d'évaluation",
  evaluation_average: "Moyenne des évaluations",
  subject_average: "Moyenne de la matière",
  coefficient: "Coefficient",
  subject_rank: "Rang dans la matière",
  appreciation: "Appréciation",
  teacher: "Professeur",
};

export const FIELD_ROLE_LABELS: Record<FieldRole, string> = {
  ignore: "Ne pas remplir",
  student_name: "Nom complet de l'élève",
  student_first_name: "Prénom de l'élève",
  student_last_name: "Nom de famille de l'élève",
  class_name: "Classe",
  establishment_name: "Établissement",
  period_label: "Période",
  headcount: "Effectif",
  general_average: "Moyenne générale de l'élève",
  first_average: "Moyenne générale du premier",
  last_average: "Moyenne générale du dernier",
  class_average_evaluation: "Moyenne de classe (évaluations)",
  class_average_composition: "Moyenne de classe (compositions)",
  rank: "Rang de l'élève",
  date: "Date d'édition",
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
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const NON_SUBJECT_RE =
  /^(total|sous total|moyenne|moyenne general|moyenne generale|moyenne annuelle|rang|effectif|date|observation|observations|appreciation|appreciations|commentaire|commentaires|signature|visa|le directeur|le provis|provis|parent|tuteur|fait a|fait le)\b/;

export function isSubjectLabel(label: string): boolean {
  const t = normalize(label);
  if (!t || t.length < 2) return false;
  if (/^\d+([.,]\d+)?$/.test(t)) return false;
  if (NON_SUBJECT_RE.test(t)) return false;
  if (/\bobservation/.test(t) && /provis|directeur|proviseur/.test(t)) return false;
  if (t.startsWith("les observations")) return false;
  return true;
}

const COLUMN_HINTS: [ColumnRole, string[]][] = [
  ["subject", ["matiere", "matieres", "discipline", "disciplines"]],
  ["composition", ["composition", "compo", "devoir compo", "note compo"]],
  ["evaluation_average", ["moyenne evaluation", "moyenne des evaluations", "moy eval"]],
  ["evaluation", ["evaluation", "evaluations", "eval", "interro", "devoir", "devoirs"]],
  ["subject_average", ["moyenne", "moy", "moyenne matiere"]],
  ["coefficient", ["coef", "coefficient", "coeff"]],
  ["subject_rank", ["rang", "rang matiere", "place"]],
  ["appreciation", ["appreciation", "appreciations", "observation", "observations", "mention"]],
  ["teacher", ["professeur", "prof", "enseignant", "nom du professeur"]],
];

const FIELD_HINTS: [FieldRole, string[]][] = [
  ["student_first_name", ["prenom", "prenom de l eleve", "prenom eleve"]],
  ["student_last_name", ["nom de famille", "nom famille"]],
  ["student_name", ["nom et prenom", "nom prenom", "nom de l eleve", "eleve", "nom"]],
  ["class_name", ["classe"]],
  ["establishment_name", ["etablissement", "complexe", "ecole"]],
  ["period_label", ["periode", "trimestre", "semestre", "mois"]],
  ["headcount", ["effectif", "nombre d eleves", "effectif de la classe"]],
  ["general_average", ["moyenne generale", "moyenne de l eleve", "moyenne annuelle"]],
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
    for (const [letter, role] of Object.entries(columns)) {
      if (role === "evaluation" || role === "ignore") continue;
      if (!exclusive.includes(role)) continue;
      if (seen.has(role)) columns[letter] = "ignore";
      else seen.add(role);
    }
  } else {
    warnings.push("Le tableau des matières n'a pas été reconnu : indiquez la ligne d'en-tête et le rôle des colonnes.");
  }

  let firstSubjectRow = headerRow > 0 ? headerRow + 1 : 0;
  let lastSubjectRow = firstSubjectRow;
  if (headerRow > 0 && subjectCol >= 0) {
    let r = firstSubjectRow;
    let blanks = 0;
    let foundSubject = false;
    while (r <= sheet.rows && blanks < 2) {
      const label = text(r, subjectCol).trim();
      if (label) {
        if (!isSubjectLabel(label)) {
          if (foundSubject) break;
          blanks++;
        } else {
          lastSubjectRow = r;
          foundSubject = true;
          blanks = 0;
        }
      } else blanks++;
      r++;
    }
    if (lastSubjectRow < firstSubjectRow) lastSubjectRow = firstSubjectRow + 9;
  }

  const fields: Record<string, FieldRole> = {};
  const used = new Set<FieldRole>();
  const isToken = (raw: string) => /^\s*[[{].+[\]}]\s*$/.test(raw);
  for (let r = 1; r <= sheet.rows; r++) {
    for (let c = 0; c < sheet.cols; c++) {
      if (headerRow > 0 && subjectCol >= 0 && r >= firstSubjectRow && r <= lastSubjectRow && c === subjectCol) {
        continue;
      }
      const label = text(r, c);
      if (!label || !isToken(label)) continue;
      const role = matchHint(label, FIELD_HINTS);
      if (!role || used.has(role)) continue;
      fields[ref(r, c)] = role;
      used.add(role);
    }
  }

  for (const [address, cell] of Object.entries(sheet.cells)) {
    if (!cell.f) continue;
    try {
      evaluateFormula(cell.f, () => 0);
    } catch (e) {
      if (e instanceof UnsupportedFormulaError) warnings.push(`Formule non gérée en ${address} : ${e.fn}`);
    }
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
    warnings: [...new Set(warnings)],
  };
}

export type FillSubjectRow = {
  name: string;
  composition: number | null;
  evaluations: number[];
  evaluationAverage: number | null;
  average: number | null;
};

export type FillData = {
  establishmentName: string;
  className: string;
  periodLabel: string;
  studentName: string;
  studentFirstName: string;
  studentLastName: string;
  subjects: FillSubjectRow[];
  generalAverage: number | null;
  firstAverage: number | null;
  lastAverage: number | null;
  classAverageEvaluation: number | null;
  classAverageComposition: number | null;
  headcount: number;
  rank: number | null;
  scale: number;
};

export type FilledSheet = { sheet: TemplateSheet; values: Record<string, CellValue>; warnings: string[] };

const round2 = (v: number) => Math.round(v * 100) / 100;

export function fillTemplate(sheet: TemplateSheet, mapping: TemplateMapping, data: FillData): FilledSheet {
  const warnings: string[] = [];
  const values: Record<string, CellValue> = {};
  for (const [address, cell] of Object.entries(sheet.cells)) values[address] = cell.f ? null : cell.v;

  const toScale = (v: number | null) => (v === null ? null : round2((v / 20) * data.scale));

  const fieldValue = (role: FieldRole): CellValue => {
    switch (role) {
      case "student_name":
        return data.studentName;
      case "student_first_name":
        return data.studentFirstName;
      case "student_last_name":
        return data.studentLastName;
      case "class_name":
        return data.className;
      case "establishment_name":
        return data.establishmentName;
      case "period_label":
        return data.periodLabel;
      case "headcount":
        return data.headcount;
      case "general_average":
        return toScale(data.generalAverage);
      case "first_average":
        return toScale(data.firstAverage);
      case "last_average":
        return toScale(data.lastAverage);
      case "class_average_evaluation":
        return toScale(data.classAverageEvaluation);
      case "class_average_composition":
        return toScale(data.classAverageComposition);
      case "rank":
        return data.rank;
      case "date":
        return new Date().toLocaleDateString("fr-FR");
      default:
        return null;
    }
  };
  for (const [address, role] of Object.entries(mapping.fields)) {
    if (role === "ignore") continue;
    const original = sheet.cells[address];
    if (original?.f) continue;
    const raw = original?.v !== null && original?.v !== undefined ? String(original.v).trim() : "";
    const isTokenCell = /^\s*[[{].+[\]}]\s*$/.test(raw);
    if (raw && !isTokenCell) continue;
    values[address] = fieldValue(role);
  }

  const subjectColumn = Object.entries(mapping.columns).find(([, role]) => role === "subject")?.[0];
  if (mapping.headerRow > 0 && subjectColumn) {
    const remaining = new Map(data.subjects.map((s) => [normalize(s.name), s]));

    for (let r = mapping.firstSubjectRow; r <= mapping.lastSubjectRow; r++) {
      const cell = sheet.cells[`${subjectColumn}${r}`];
      const label = cell && cell.v !== null ? String(cell.v).trim() : "";
      if (!label || !isSubjectLabel(label)) continue;

      const key = normalize(label);
      const match =
        remaining.get(key) ??
        [...remaining.entries()].find(([k]) => k.includes(key) || key.includes(k))?.[1] ??
        null;
      if (!match) {
        warnings.push(`Aucune note pour la matière « ${label} » du modèle.`);
        continue;
      }
      remaining.delete(normalize(match.name));
      writeSubjectRow(r, match);
    }
  } else {
    warnings.push("Le tableau des matières n'est pas défini dans ce modèle.");
  }

  function writeSubjectRow(row: number, subject: FillSubjectRow) {
    const evalLetters = Object.entries(mapping.columns)
      .filter(([, role]) => role === "evaluation")
      .map(([letter]) => letter)
      .sort((a, b) => colIndex(a) - colIndex(b));

    for (const [letter, role] of Object.entries(mapping.columns)) {
      const address = `${letter}${row}`;
      const original = sheet.cells[address];
      if (original?.f) continue;

      if (role === "composition") {
        values[address] = toScale(subject.composition);
        if (subject.composition === null)
          warnings.push(`Pas de note de composition en « ${subject.name} ».`);
        continue;
      }

      if (role === "evaluation") {
        const idx = evalLetters.indexOf(letter);
        const raw = idx >= 0 ? subject.evaluations[idx] ?? null : null;
        values[address] = raw === null || raw === undefined ? null : toScale(raw);
        continue;
      }
    }

    if (subject.evaluations.length === 0 && evalLetters.length > 0)
      warnings.push(`Pas de note d'évaluation en « ${subject.name} ».`);
  }

  const formulas = Object.entries(sheet.cells).filter(([, cell]) => cell.f);
  for (let pass = 0; pass < 4; pass++) {
    for (const [address, cell] of formulas) {
      try {
        values[address] = evaluateFormula(cell.f!, (r) => values[r] ?? null);
      } catch (e) {
        if (pass === 3 && e instanceof UnsupportedFormulaError)
          warnings.push(`Formule non gérée en ${address} : ${e.fn}`);
      }
    }
  }

  return { sheet, values, warnings: [...new Set(warnings)] };
}

const A4_WIDTH = 1240;

export function drawFilledTemplate(filled: FilledSheet): HTMLCanvasElement {
  const { sheet, values } = filled;
  const widths = Array.from({ length: sheet.cols }, (_, c) => Math.max(28, (sheet.colWidths[c] ?? 11) * 8));
  const totalWidth = widths.reduce((a, b) => a + b, 0) || A4_WIDTH;
  const factor = A4_WIDTH / totalWidth;
  const scaled = widths.map((w) => w * factor);
  const rowHeight = Math.max(22, Math.min(34, 26 * factor + 12));
  const height = Math.max(1754, sheet.rows * rowHeight + 80);

  const canvas = document.createElement("canvas");
  canvas.width = A4_WIDTH;
  canvas.height = Math.round(height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "middle";

  const x = (c: number) => scaled.slice(0, c).reduce((a, b) => a + b, 0);
  const y = (r: number) => 30 + r * rowHeight;

  const covered = new Set<string>();
  const mergeOf = new Map<string, { cols: number; rows: number }>();
  for (const m of sheet.merges) {
    for (let r = m.s.r; r <= m.e.r; r++)
      for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(`${r}:${c}`);
    mergeOf.set(`${m.s.r}:${m.s.c}`, { cols: m.e.c - m.s.c + 1, rows: m.e.r - m.s.r + 1 });
  }

  for (let r = 0; r < sheet.rows; r++) {
    for (let c = 0; c < sheet.cols; c++) {
      if (covered.has(`${r}:${c}`)) continue;
      const address = XLSX.utils.encode_cell({ r, c });
      const merge = mergeOf.get(`${r}:${c}`);
      const w = merge ? scaled.slice(c, c + merge.cols).reduce((a, b) => a + b, 0) : (scaled[c] ?? 0);
      const h = (merge?.rows ?? 1) * rowHeight;
      const raw = values[address];
      const source = sheet.cells[address];
      if (raw === undefined && !source) continue;

      ctx.strokeStyle = "#d4d8e0";
      ctx.lineWidth = 1;
      ctx.strokeRect(x(c), y(r), w, h);

      const value = raw === null || raw === undefined ? "" : typeof raw === "number" ? formatNumber(raw) : String(raw);
      if (!value) continue;
      const isHeaderish = typeof raw === "string" && !source?.f && value.length > 0 && value === value.toUpperCase();
      ctx.fillStyle = "#111827";
      ctx.font = `${isHeaderish ? "bold " : ""}${Math.round(13 * Math.min(1.2, factor * 1.15) + 2)}px Helvetica, Arial, sans-serif`;
      const padding = 6;
      let text = value;
      while (ctx.measureText(text).width > w - padding * 2 && text.length > 1) text = text.slice(0, -1);
      const align = typeof raw === "number" ? w - padding - ctx.measureText(text).width : x(c) + padding;
      ctx.fillText(text, typeof raw === "number" ? x(c) + align : align, y(r) + h / 2);
    }
  }
  return canvas;
}

const formatNumber = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
