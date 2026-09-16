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
 * - Le rendu PDF passe par canvas puis src/lib/pdf-export.ts:canvasToPdfBlob
 *   (aucune dépendance PDF supplémentaire).
 */
import * as XLSX from "xlsx";
import { evaluateFormula, expandRange, UnsupportedFormulaError, type CellValue } from "@/lib/xlsx-formula";

// ---------------------------------------------------------------------------
// Rôles
// ---------------------------------------------------------------------------

/** Rôle d'une colonne du tableau des matières. */
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

/** Rôle d'une cellule isolée (en-tête / pied du bulletin). */
export type FieldRole =
  | "ignore"
  | "student_name"
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
  student_name: "Nom de l'élève",
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

// ---------------------------------------------------------------------------
// Lecture du fichier
// ---------------------------------------------------------------------------

export type TemplateCell = { v: CellValue; f?: string };

export type TemplateSheet = {
  sheetName: string;
  rows: number;
  cols: number;
  cells: Record<string, TemplateCell>;
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[];
  colWidths: number[]; // en caractères
};

export const colLetter = (index0: number) => XLSX.utils.encode_col(index0);
export const colIndex = (letter: string) => XLSX.utils.decode_col(letter);
export const ref = (row1: number, col0: number) => `${colLetter(col0)}${row1}`;

/** Lit la première feuille utile d'un fichier .xlsx. */
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

// ---------------------------------------------------------------------------
// Détection automatique
// ---------------------------------------------------------------------------

export type TemplateMapping = {
  version: 1;
  sheetName: string;
  /** Ligne (1-indexée) des intitulés de colonnes du tableau des matières. */
  headerRow: number;
  /** Première et dernière ligne de matières (1-indexées). */
  firstSubjectRow: number;
  lastSubjectRow: number;
  /** Rôle par colonne (lettre Excel). */
  columns: Record<string, ColumnRole>;
  /** Rôle par cellule isolée (référence A1). */
  fields: Record<string, FieldRole>;
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const COLUMN_HINTS: [ColumnRole, string[]][] = [
  ["subject", ["matiere", "matieres", "discipline", "disciplines"]],
  ["composition", ["composition", "compo", "devoir compo", "note compo"]],
  ["evaluation_average", ["moyenne evaluation", "moyenne des evaluations", "moy eval"]],
  ["evaluation", ["evaluation", "evaluations", "eval", "interro", "devoir", "devoirs", "classe"]],
  ["subject_average", ["moyenne", "moy", "moyenne matiere"]],
  ["coefficient", ["coef", "coefficient", "coeff"]],
  ["subject_rank", ["rang", "rang matiere", "place"]],
  ["appreciation", ["appreciation", "appreciations", "observation", "observations", "mention"]],
  ["teacher", ["professeur", "prof", "enseignant", "nom du professeur"]],
];

const FIELD_HINTS: [FieldRole, string[]][] = [
  ["student_name", ["nom et prenom", "nom prenom", "nom de l eleve", "eleve", "nom"]],
  ["class_name", ["classe"]],
  ["establishment_name", ["etablissement", "complexe", "ecole"]],
  ["period_label", ["periode", "trimestre", "semestre", "mois"]],
  ["headcount", ["effectif", "nombre d eleves"]],
  ["general_average", ["moyenne generale", "moyenne de l eleve", "moyenne annuelle"]],
  ["first_average", ["moyenne du premier", "premier", "plus forte moyenne", "moyenne la plus forte"]],
  ["last_average", ["moyenne du dernier", "dernier", "plus faible moyenne", "moyenne la plus faible"]],
  ["class_average_evaluation", ["moyenne de classe", "moyenne classe", "moyenne des evaluations de la classe"]],
  ["class_average_composition", ["moyenne de composition", "moyenne composition", "moyenne des compositions"]],
  ["rank", ["rang", "place", "rang de l eleve"]],
  ["date", ["date", "fait le", "edite le"]],
];

const matchHint = <T extends string>(text: string, hints: [T, string[]][]): T | null => {
  const t = normalize(text);
  if (!t) return null;
  for (const [role, keys] of hints) if (keys.includes(t)) return role;
  for (const [role, keys] of hints) if (keys.some((k) => t.includes(k))) return role;
  return null;
};

export type DetectionResult = { mapping: TemplateMapping; warnings: string[] };

/**
 * Propose une correspondance à partir des intitulés du fichier.
 * L'utilisateur la confirme ou la corrige dans l'écran de vérification.
 */
export function detectMapping(sheet: TemplateSheet): DetectionResult {
  const warnings: string[] = [];
  const text = (row1: number, col0: number) => {
    const cell = sheet.cells[ref(row1, col0)];
    return cell && cell.v !== null ? String(cell.v) : "";
  };

  // 1. Ligne d'en-tête du tableau : celle qui contient "matière" + au moins un autre intitulé connu.
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
  } else {
    warnings.push("Le tableau des matières n'a pas été reconnu : indiquez la ligne d'en-tête et le rôle des colonnes.");
  }

  // 2. Lignes de matières : de la ligne suivant l'en-tête jusqu'à la dernière ligne
  //    non vide de la colonne des matières (ou 15 lignes par défaut).
  let firstSubjectRow = headerRow > 0 ? headerRow + 1 : 0;
  let lastSubjectRow = firstSubjectRow;
  if (headerRow > 0 && subjectCol >= 0) {
    let r = firstSubjectRow;
    let blanks = 0;
    while (r <= sheet.rows && blanks < 2) {
      if (text(r, subjectCol).trim()) {
        lastSubjectRow = r;
        blanks = 0;
      } else blanks++;
      r++;
    }
    if (lastSubjectRow < firstSubjectRow) lastSubjectRow = firstSubjectRow + 9;
  }

  // 3. Cellules isolées : un libellé suivi d'une case vide (à droite, sinon en dessous).
  const fields: Record<string, FieldRole> = {};
  const used = new Set<FieldRole>();
  for (let r = 1; r <= sheet.rows; r++) {
    if (headerRow > 0 && r >= headerRow && r <= lastSubjectRow) continue;
    for (let c = 0; c < sheet.cols; c++) {
      const label = text(r, c);
      if (!label) continue;
      const role = matchHint(label, FIELD_HINTS);
      if (!role || used.has(role)) continue;
      const candidates = [ref(r, c + 1), ref(r, c + 2), ref(r + 1, c)];
      const target = candidates.find((address) => {
        const cell = sheet.cells[address];
        return !cell || cell.v === null || String(cell.v).trim() === "" || String(cell.v).trim() === ":";
      });
      if (!target) continue;
      fields[target] = role;
      used.add(role);
    }
  }

  // 4. Formules non gérées.
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

// ---------------------------------------------------------------------------
// Remplissage
// ---------------------------------------------------------------------------

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
  subjects: FillSubjectRow[];
  generalAverage: number | null;
  firstAverage: number | null;
  lastAverage: number | null;
  classAverageEvaluation: number | null;
  classAverageComposition: number | null;
  headcount: number;
  rank: number | null;
  /** Barème du modèle (note maximale) — les notes sont converties dans ce barème. */
  scale: number;
};

export type FilledSheet = { sheet: TemplateSheet; values: Record<string, CellValue>; warnings: string[] };

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Remplit la grille du modèle avec les données d'un élève, puis rejoue les formules. */
export function fillTemplate(sheet: TemplateSheet, mapping: TemplateMapping, data: FillData): FilledSheet {
  const warnings: string[] = [];
  const values: Record<string, CellValue> = {};
  for (const [address, cell] of Object.entries(sheet.cells)) values[address] = cell.f ? null : cell.v;

  const toScale = (v: number | null) => (v === null ? null : round2((v / 20) * data.scale));

  // Cellules isolées
  const fieldValue = (role: FieldRole): CellValue => {
    switch (role) {
      case "student_name":
        return data.studentName;
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
    values[address] = fieldValue(role);
  }

  // Tableau des matières : on associe chaque ligne du modèle à une matière de la classe.
  const subjectColumn = Object.entries(mapping.columns).find(([, role]) => role === "subject")?.[0];
  if (mapping.headerRow > 0 && subjectColumn) {
    const remaining = new Map(data.subjects.map((s) => [normalize(s.name), s]));
    const templateRows: { row: number; label: string }[] = [];
    for (let r = mapping.firstSubjectRow; r <= mapping.lastSubjectRow; r++) {
      const cell = sheet.cells[`${subjectColumn}${r}`];
      const label = cell && cell.v !== null ? String(cell.v).trim() : "";
      templateRows.push({ row: r, label });
    }

    const labelled = templateRows.filter((r) => r.label);
    const blanks = templateRows.filter((r) => !r.label);
    const freeSubjects = [...remaining.values()];

    for (const { row, label } of labelled) {
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
      writeSubjectRow(row, match);
    }

    // Matières de la classe absentes du modèle : on les place dans les lignes vides du tableau.
    const leftovers = freeSubjects.filter((s) => remaining.has(normalize(s.name)));
    leftovers.forEach((subject, i) => {
      const slot = blanks[i];
      if (!slot) {
        warnings.push(`La matière « ${subject.name} » n'a pas de ligne disponible dans le modèle.`);
        return;
      }
      values[`${subjectColumn}${slot.row}`] = subject.name;
      writeSubjectRow(slot.row, subject);
    });
  } else {
    warnings.push("Le tableau des matières n'est pas défini dans ce modèle.");
  }

  function writeSubjectRow(row: number, subject: FillSubjectRow) {
    for (const [letter, role] of Object.entries(mapping.columns)) {
      const address = `${letter}${row}`;
      switch (role) {
        case "subject":
          values[address] = subject.name;
          break;
        case "composition":
          values[address] = toScale(subject.composition);
          break;
        case "evaluation":
          values[address] = subject.evaluations.length
            ? subject.evaluations.map((v) => String(toScale(v))).join(" / ")
            : null;
          break;
        case "evaluation_average":
          values[address] = toScale(subject.evaluationAverage);
          break;
        case "subject_average":
          values[address] = toScale(subject.average);
          break;
        default:
          break;
      }
      if (subject.composition === null && role === "composition")
        warnings.push(`Pas de note de composition en « ${subject.name} ».`);
      if (subject.evaluations.length === 0 && (role === "evaluation" || role === "evaluation_average"))
        warnings.push(`Pas de note d'évaluation en « ${subject.name} ».`);
    }
  }

  // Formules du modèle — plusieurs passes pour résoudre les dépendances entre cellules.
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

// ---------------------------------------------------------------------------
// Rendu canvas (aperçu + PDF)
// ---------------------------------------------------------------------------

const A4_WIDTH = 1240;

/** Dessine la grille remplie sur un canvas A4 portrait, en respectant les fusions. */
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
