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
  /^(total|sous ?total|moyen|moyenne|moyen general|moyenne general|moyen generale|moyenne generale|moyenne annuelle|rang|effectif|date|observation|observations|appreciation|appreciations|commentaire|commentaires|signature|visa|le directeur|le provis|provis|parent|tuteur|fait a|fait le)\b/;

export function isSubjectLabel(label: string): boolean {
  const t = normalize(label);
  if (!t || t.length < 2) return false;
  if (/^\d+([.,]\d+)?$/.test(t)) return false;
  if (NON_SUBJECT_RE.test(t)) return false;
  // « Moyen Général », « Moyenne générale », « Total : », etc. ne sont JAMAIS des matières
  if (/\bmoyen(ne)?\b/.test(t) && /\bgeneral/.test(t)) return false;
  if (t === "moyen" || t === "moyenne" || t.startsWith("moyen ") || t.startsWith("moyenne ")) return false;
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

/** Extrait le contenu d'une balise [ ... ] ou { ... }. */
export function extractTokenInner(raw: string): string | null {
  const s = raw.trim();
  const pure = /^[[{]([^\]}]+)[\]}]$/.exec(s);
  if (pure) return pure[1]!.trim();
  const embedded = /[[{]([^\]}]+)[\]}]/.exec(s);
  if (embedded) return embedded[1]!.trim();
  return null;
}

export type ColumnTag = { role: ColumnRole; periodIndex?: number };

const COLUMN_TAG_ALIASES: [ColumnRole, string[]][] = [
  ["subject", ["matiere", "matieres", "discipline", "disciplines", "subject"]],
  ["composition", ["compo", "composition", "note compo", "note composition", "devoir compo"]],
  ["evaluation", ["eval", "evaluation", "evaluations", "note classe", "note de classe", "notes de classe", "interro", "devoir"]],
  ["evaluation_average", ["moy eval", "moyenne eval", "moyenne evaluation", "moy_eval", "moyenne des evaluations"]],
  ["subject_average", ["moy", "moyenne", "moyenne matiere", "moyenne_matiere", "moyenne annuelle", "moyenne_annuelle", "moy ann", "moy_ann"]],
  ["coefficient", ["coef", "coefficient", "coeff"]],
  ["subject_rank", ["rang matiere", "rang_matiere", "place matiere"]],
  ["appreciation", ["appreciation", "appreciations", "observation", "mention"]],
  ["teacher", ["prof", "professeur", "enseignant", "teacher"]],
];

function roleFromTagBody(body: string): ColumnRole | null {
  const t = normalize(body);
  if (!t) return null;
  for (const [role, keys] of COLUMN_TAG_ALIASES) {
    if (keys.includes(t)) return role;
  }
  for (const [role, keys] of COLUMN_TAG_ALIASES) {
    if (keys.some((k) => t === k || t.startsWith(k + " ") || t.endsWith(" " + k))) return role;
  }
  return matchHint(body, COLUMN_HINTS);
}

/** Interprète [compo:1] → composition période 0 ; [moy] → subject_average. */
export function parseColumnTag(raw: string): ColumnTag | null {
  const inner = extractTokenInner(raw);
  if (!inner) return null;
  const normalized = inner.trim();
  const withColon = /^(.+?)\s*[:/]\s*(?:p|t|periode|période|trimestre|semestre)?\s*(\d+)\s*$/i.exec(normalized);
  if (withColon) {
    const role = roleFromTagBody(withColon[1]!);
    const n = Number(withColon[2]);
    if (role && Number.isFinite(n) && n >= 1 && n <= 12) return { role, periodIndex: n - 1 };
  }
  const withSpace = /^(.+?)\s+(?:p|t|periode|période|trimestre|semestre)\s*(\d+)\s*$/i.exec(normalized);
  if (withSpace) {
    const role = roleFromTagBody(withSpace[1]!);
    const n = Number(withSpace[2]);
    if (role && Number.isFinite(n) && n >= 1 && n <= 12) return { role, periodIndex: n - 1 };
  }
  const trailingNum = /^(.+?)\s+(\d+)\s*$/.exec(normalized);
  if (trailingNum) {
    const role = roleFromTagBody(trailingNum[1]!);
    const n = Number(trailingNum[2]);
    if (role && Number.isFinite(n) && n >= 1 && n <= 12) return { role, periodIndex: n - 1 };
  }
  const role = roleFromTagBody(normalized);
  if (role) return { role };
  return null;
}

const PERIOD_GROUP_RE =
  /\b(1\s*(er|ere|ère)?|2\s*(e|eme|ème)|3\s*(e|eme|ème)|4\s*(e|eme|ème)|premier|deuxieme|troisieme|trimestre|semestre|periode|période)\b/i;

function isPeriodGroupLabel(raw: string): boolean {
  const t = normalize(raw);
  if (!t) return false;
  if (PERIOD_GROUP_RE.test(t)) return true;
  if (/^t\s*[1-6]$/.test(t) || /^p\s*[1-6]$/.test(t)) return true;
  if (/^(1er|2eme|3eme|4eme)\s*(trimestre|semestre)?$/.test(t)) return true;
  return false;
}

function detectPeriodGroups(
  sheet: TemplateSheet,
  headerRow: number,
  columns: Record<string, ColumnRole>,
): { periodColumns: Record<string, number>; periodGroupLabels: string[] } {
  const periodColumns: Record<string, number> = {};
  const periodGroupLabels: string[] = [];
  if (headerRow < 2) return { periodColumns, periodGroupLabels };
  const text = (row1: number, col0: number) => {
    const cell = sheet.cells[ref(row1, col0)];
    return cell && cell.v !== null ? String(cell.v) : "";
  };
  const groupByCol: (string | null)[] = Array(sheet.cols).fill(null);
  let lastGroup: string | null = null;
  for (let c = 0; c < sheet.cols; c++) {
    const label = text(headerRow - 1, c).trim();
    if (label && isPeriodGroupLabel(label)) {
      lastGroup = label;
      groupByCol[c] = label;
    } else if (label && !matchHint(label, COLUMN_HINTS) && !parseColumnTag(label)) {
      if (normalize(label).length >= 2) {
        lastGroup = label;
        groupByCol[c] = label;
      }
    } else if (lastGroup) {
      groupByCol[c] = lastGroup;
    }
  }
  for (const m of sheet.merges) {
    if (m.s.r + 1 !== headerRow - 1) continue;
    const label = text(headerRow - 1, m.s.c).trim();
    if (!label) continue;
    if (!isPeriodGroupLabel(label) && normalize(label).length < 2) continue;
    for (let c = m.s.c; c <= m.e.c; c++) groupByCol[c] = label;
  }
  const labelToIndex = new Map<string, number>();
  for (let c = 0; c < sheet.cols; c++) {
    const letter = colLetter(c);
    const role = columns[letter];
    if (!role || role === "subject" || role === "ignore" || role === "coefficient" || role === "teacher" || role === "appreciation" || role === "subject_rank") continue;
    const g = groupByCol[c];
    if (!g) continue;
    const key = normalize(g);
    if (!labelToIndex.has(key)) {
      labelToIndex.set(key, periodGroupLabels.length);
      periodGroupLabels.push(g.replace(/\s+/g, " ").trim());
    }
    periodColumns[letter] = labelToIndex.get(key)!;
  }
  return { periodColumns, periodGroupLabels };
}

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
      const cellText = text(r, c);
      const tag = parseColumnTag(cellText);
      if (tag?.role === "subject" || matchHint(cellText, COLUMN_HINTS) === "subject") {
        headerRow = r;
        subjectCol = c;
        break;
      }
    }
  }

  const columns: Record<string, ColumnRole> = {};
  const tagPeriodColumns: Record<string, number> = {};
  const tagPeriodLabels: string[] = [];
  if (headerRow > 0) {
    for (let c = 0; c < sheet.cols; c++) {
      const label = text(headerRow, c) || text(headerRow - 1, c);
      const letter = colLetter(c);
      const tag = parseColumnTag(label) ?? parseColumnTag(text(headerRow, c)) ?? parseColumnTag(text(headerRow - 1, c));
      if (tag) {
        columns[letter] = tag.role;
        if (tag.periodIndex != null) {
          tagPeriodColumns[letter] = tag.periodIndex;
          while (tagPeriodLabels.length <= tag.periodIndex) {
            tagPeriodLabels.push(`Période ${tagPeriodLabels.length + 1}`);
          }
        }
        continue;
      }
      const role = matchHint(label, COLUMN_HINTS);
      if (role) columns[letter] = role;
    }
    if (subjectCol >= 0) columns[colLetter(subjectCol)] = "subject";
    const exclusive: ColumnRole[] = [
      "subject",
      "evaluation_average",
      "subject_average",
      "coefficient",
      "subject_rank",
      "appreciation",
      "teacher",
    ];
    const seen = new Set<ColumnRole>();
    for (const [letter, role] of Object.entries({ ...columns })) {
      if (role === "evaluation" || role === "composition" || role === "ignore") continue;
      if (letter in tagPeriodColumns) continue;
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

  // Champs identité / stats : UNIQUEMENT les balises [token] ou {token}.
  // Aucun libellé en texte libre (« Moyen Général », « Prénom : », …) n'est
  // interprété comme cible d'écriture — les formules du modèle restent la source
  // de vérité pour toute valeur calculée.
  const fields: Record<string, FieldRole> = {};
  const used = new Set<FieldRole>();
  for (let r = 1; r <= sheet.rows; r++) {
    for (let c = 0; c < sheet.cols; c++) {
      if (headerRow > 0 && subjectCol >= 0 && r >= firstSubjectRow && r <= lastSubjectRow && c === subjectCol) continue;
      const label = text(r, c);
      if (!label) continue;
      if (parseColumnTag(label)) continue;
      const inner = extractTokenInner(label);
      if (!inner) continue;
      const role = matchHint(inner, FIELD_HINTS);
      if (role && !used.has(role)) {
        fields[ref(r, c)] = role;
        used.add(role);
      }
    }
  }
  if (Object.keys(fields).length === 0) {
    warnings.push(
      "Aucune balise champ [prenom], [nom], [classe], [effectif], [rang], [date]… détectée. Seules les balises entre crochets ou accolades sont reconnues.",
    );
  }

  const fromHeaders = detectPeriodGroups(sheet, headerRow, columns);
  const periodColumns =
    Object.keys(tagPeriodColumns).length > 0 ? tagPeriodColumns : fromHeaders.periodColumns;
  const periodGroupLabels =
    Object.keys(tagPeriodColumns).length > 0
      ? tagPeriodLabels.filter(Boolean)
      : fromHeaders.periodGroupLabels;

  if (Object.keys(tagPeriodColumns).length > 0) {
    warnings.push(
      `Balises de colonnes avec période détectées (${Object.keys(tagPeriodColumns).length} col.).`,
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
      ...(Object.keys(periodColumns).length > 0 ? { periodColumns, periodGroupLabels } : {}),
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
  /** Moyenne générale de la classe (balise [moy_classe]). */
  classAverage?: number | null;
  /** Statistiques par période (index 0 = période 1) pour [mg:1], [rang:2]… */
  periodStats?: (PeriodStat | null)[];
};

export type PeriodStat = {
  generalAverage: number | null;
  rank: number | null;
  firstAverage: number | null;
  lastAverage: number | null;
  classAverage: number | null;
  headcount: number | null;
};

export type ComputedAverages = {
  generalAverage: number | null;
  subjectAverages: Record<string, number | null>;
};
