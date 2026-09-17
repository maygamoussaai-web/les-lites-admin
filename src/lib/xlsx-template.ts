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
  ignore: "Ne pas remplir",
  subject: "Nom de la matiere",
  composition: "Note de composition",
  evaluation: "Notes d'evaluation (note de classe)",
  evaluation_average: "Moyenne des evaluations (notes de classe)",
  subject_average: "Moyenne de la matiere",
  coefficient: "Coefficient",
  subject_rank: "Rang dans la matiere",
  appreciation: "Appreciation",
  teacher: "Professeur",
};

export const FIELD_ROLE_LABELS: Record<FieldRole, string> = {
  ignore: "Ne pas remplir",
  student_name: "Nom complet de l'eleve",
  student_first_name: "Prenom de l'eleve",
  student_last_name: "Nom de famille de l'eleve",
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
  ["evaluation", ["evaluation", "evaluations", "eval", "note de classe", "notes de classe", "interro", "devoir", "devoirs"]],
  ["subject_average", ["moyenne", "moy", "moyenne matiere"]],
  ["coefficient", ["coef", "coefficient", "coeff"]],
  ["subject_rank", ["rang", "rang matiere", "place"]],
  ["appreciation", ["appreciation", "appreciations", "observation", "observations", "mention"]],
  ["teacher", ["professeur", "prof", "enseignant", "nom du professeur"]],
];

const FIELD_HINTS: [FieldRole, string[]][] = [
  ["student_first_name", ["prenom", "prenom de l eleve", "prenom eleve", "first name"]],
  ["student_last_name", ["nom de famille", "nom famille", "last name"]],
  ["student_name", ["nom et prenom", "nom prenom", "nom de l eleve", "eleve", "nom complet", "nom"]],
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
    for (const [letter, role] of Object.entries(columns)) {
      if (role === "evaluation" || role === "ignore") continue;
      if (!exclusive.includes(role)) continue;
      if (seen.has(role)) columns[letter] = "ignore";
      else seen.add(role);
    }
  } else {
    warnings.push("Le tableau des matieres n'a pas ete reconnu : indiquez la ligne d'en-tete et le role des colonnes.");
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

  for (const [address, cell] of Object.entries(sheet.cells)) {
    if (!cell.f) continue;
    try {
      evaluateFormula(cell.f, () => 0);
    } catch (e) {
      if (e instanceof UnsupportedFormulaError) warnings.push(`Formule non geree en ${address} : ${e.fn}`);
    }
  }

  // Preferer la cellule formule adjacente pour general_average
  const relocateGeneralAverage = () => {
    const entries = Object.entries(fields).filter(([, role]) => role === "general_average");
    for (const [address] of entries) {
      const cell = sheet.cells[address];
      if (cell?.f) continue;
      const m = /^([A-Z]+)(\d+)$/i.exec(address);
      if (!m) continue;
      let col = 0;
      for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
      const row1 = Number(m[2]);
      const col0 = col - 1;
      for (const [dr, dc] of [[0, 1], [0, 2], [1, 0], [1, 1], [0, -1]] as const) {
        const near = ref(row1 + dr, col0 + dc);
        const nc = sheet.cells[near];
        if (nc?.f) {
          delete fields[address];
          fields[near] = "general_average";
          break;
        }
      }
    }
  };
  relocateGeneralAverage();

  if (!Object.values(fields).includes("general_average")) {
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (cell.v === null || cell.v === undefined) continue;
      const label = String(cell.v);
      if (matchHint(label, FIELD_HINTS) !== "general_average") continue;
      const m = /^([A-Z]+)(\d+)$/i.exec(address);
      if (!m) continue;
      let col = 0;
      for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
      const row1 = Number(m[2]);
      const col0 = col - 1;
      let mapped = address;
      for (const [dr, dc] of [[0, 1], [0, 2], [1, 0], [1, 1]] as const) {
        const near = ref(row1 + dr, col0 + dc);
        if (sheet.cells[near]?.f) {
          mapped = near;
          break;
        }
      }
      fields[mapped] = "general_average";
      break;
    }
  }

  if (!Object.values(columns).includes("subject_average")) {
    warnings.push(
      "Colonne moyenne matiere non detectee : les moyennes par matiere (formules du modele) ne pourront pas etre lues.",
    );
  }
  if (!Object.values(fields).includes("general_average")) {
    warnings.push(
      "Moyenne generale non detectee : placez une formule Excel de MG, ou un libelle « Moyenne generale » a cote de la formule.",
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

export type ComputedAverages = {
  generalAverage: number | null;
  subjectAverages: Record<string, number | null>;
};

export type FilledSheet = {
  sheet: TemplateSheet;
  values: Record<string, CellValue>;
  warnings: string[];
  computed: ComputedAverages;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

export function fillTemplate(sheet: TemplateSheet, mapping: TemplateMapping, data: FillData): FilledSheet {
  const warnings: string[] = [];
  const values: Record<string, CellValue> = {};
  for (const [address, cell] of Object.entries(sheet.cells)) values[address] = cell.f ? null : cell.v;

  const toScale = (v: number | null) => (v === null ? null : round2((v / 20) * data.scale));
  const fromScale = (v: CellValue): number | null =>
    typeof v === "number" && Number.isFinite(v) ? round2((v / data.scale) * 20) : null;

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

  const PRE_FORMULA_FIELDS = new Set<FieldRole>([
    "student_name",
    "student_first_name",
    "student_last_name",
    "class_name",
    "establishment_name",
    "period_label",
    "headcount",
    "rank",
    "first_average",
    "last_average",
    "class_average_evaluation",
    "class_average_composition",
    "date",
  ]);
  for (const [address, role] of Object.entries(mapping.fields)) {
    if (role === "ignore" || role === "general_average") continue;
    if (!PRE_FORMULA_FIELDS.has(role)) continue;
    const original = sheet.cells[address];
    if (original?.f) continue;
    const raw = original?.v !== null && original?.v !== undefined ? String(original.v).trim() : "";
    const isTokenCell = /[[{][^\]}]+[\]}]/.test(raw);
    if (raw && !isTokenCell) continue;
    values[address] = fieldValue(role);
  }

  const subjectColumn = Object.entries(mapping.columns).find(([, role]) => role === "subject")?.[0];
  const rowSubjectName = new Map<number, string>();
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
        warnings.push(`Aucune note pour la matiere « ${label} » du modele.`);
        continue;
      }
      remaining.delete(normalize(match.name));
      rowSubjectName.set(r, match.name);
      writeSubjectRow(r, match);
    }
  } else {
    warnings.push("Le tableau des matieres n'est pas defini dans ce modele.");
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
        continue;
      }
      if (role === "evaluation") {
        const idx = evalLetters.indexOf(letter);
        const raw = idx >= 0 ? subject.evaluations[idx] ?? null : null;
        values[address] = raw === null || raw === undefined ? null : toScale(raw);
      }
    }
  }

  const formulas = Object.entries(sheet.cells).filter(([, cell]) => cell.f);
  const maxPasses = Math.max(8, formulas.length + 2);
  for (let pass = 0; pass < maxPasses; pass++) {
    for (const [address, cell] of formulas) {
      try {
        values[address] = evaluateFormula(cell.f!, (r) => values[r] ?? null);
      } catch (e) {
        if (pass === maxPasses - 1 && e instanceof UnsupportedFormulaError)
          warnings.push(`Formule non geree en ${address} : ${e.fn}`);
      }
    }
  }

  let generalAverageOut: number | null = null;
  for (const [address, role] of Object.entries(mapping.fields)) {
    if (role !== "general_average") continue;
    generalAverageOut = fromScale(values[address] ?? null);
  }

  const subjectAveragesOut: Record<string, number | null> = {};
  const subjectAverageCol = Object.entries(mapping.columns).find(([, role]) => role === "subject_average")?.[0];
  if (subjectAverageCol) {
    for (const [row, name] of rowSubjectName) {
      subjectAveragesOut[name] = fromScale(values[`${subjectAverageCol}${row}`] ?? null);
    }
  }

  if (generalAverageOut === null) {
    const vals = Object.values(subjectAveragesOut).filter((v): v is number => v !== null);
    if (vals.length) generalAverageOut = vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  return {
    sheet,
    values,
    warnings: [...new Set(warnings)],
    computed: { generalAverage: generalAverageOut, subjectAverages: subjectAveragesOut },
  };
}

export const formatNumber = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
