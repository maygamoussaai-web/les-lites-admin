/**
 * REMPLISSAGE DU CLASSEUR EXCEL ORIGINAL — Option 2.
 *
 * 1. Part du fichier .xlsx d'origine (mise en page, styles, fusions intacts).
 * 2. Ecrit uniquement notes + balises dans les cellules de saisie.
 * 3. Pour chaque cellule qui a une formule : lit LA formule du modele,
 *    la calcule dans l'app (moteur JS), ecrit le resultat numerique fige.
 * 4. Les moyennes affichees / livrees viennent UNIQUEMENT de ces formules.
 */
import * as XLSX from "xlsx";
import { evaluateFormula, UnsupportedFormulaError, type CellValue } from "@/lib/xlsx-formula";
import {
  colIndex,
  isSubjectLabel,
  normalize,
  type TemplateMapping,
  type FillData,
  type ComputedAverages,
  type FieldRole,
} from "@/lib/xlsx-template";

const toScale = (v: number | null, scale: number) =>
  v === null ? null : Math.round(((v / 20) * scale) * 100) / 100;
const fromScale = (v: unknown, scale: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(((v / scale) * 20) * 100) / 100 : null;

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

function fieldValue(role: FieldRole, data: FillData): number | string | null {
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
      return null;
    case "first_average":
      return toScale(data.firstAverage, data.scale);
    case "last_average":
      return toScale(data.lastAverage, data.scale);
    case "class_average_evaluation":
      return toScale(data.classAverageEvaluation, data.scale);
    case "class_average_composition":
      return toScale(data.classAverageComposition, data.scale);
    case "rank":
      return data.rank;
    case "date":
      return new Date().toLocaleDateString("fr-FR");
    default:
      return null;
  }
}

export function writeFilledWorkbook(
  originalBuffer: ArrayBuffer,
  mapping: TemplateMapping,
  data: FillData,
): { buffer: ArrayBuffer; computed: ComputedAverages; warnings: string[] } {
  const wb = XLSX.read(originalBuffer, { type: "array", cellFormula: true, cellStyles: true });
  const ws = wb.Sheets[mapping.sheetName] ?? wb.Sheets[wb.SheetNames[0]!];
  if (!ws) throw new Error("Feuille du modele introuvable dans le fichier.");

  const warnings: string[] = [];

  const setInputCell = (address: string, value: number | string | null) => {
    const cell = ws[address] as XLSX.CellObject | undefined;
    if (cell?.f) return;
    if (value === null || value === undefined) {
      if (cell) {
        delete cell.v;
        delete cell.w;
      }
      return;
    }
    ws[address] = {
      ...(cell ?? {}),
      t: typeof value === "number" ? "n" : "s",
      v: value,
    } as XLSX.CellObject;
  };

  for (const [address, role] of Object.entries(mapping.fields)) {
    if (role === "ignore" || role === "general_average") continue;
    if (!PRE_FORMULA_FIELDS.has(role)) continue;
    const cell = ws[address] as XLSX.CellObject | undefined;
    if (cell?.f) continue;
    const raw = cell?.v !== null && cell?.v !== undefined ? String(cell.v).trim() : "";
    const isToken = /^\s*[[{].+[\]}]\s*$/.test(raw);
    if (raw && !isToken) continue;
    setInputCell(address, fieldValue(role, data));
  }

  const subjectColumn = Object.entries(mapping.columns).find(([, role]) => role === "subject")?.[0];
  const rowSubjectName = new Map<number, string>();
  if (subjectColumn) {
    const remaining = new Map(data.subjects.map((s) => [normalize(s.name), s]));
    const evalLetters = Object.entries(mapping.columns)
      .filter(([, role]) => role === "evaluation")
      .map(([letter]) => letter)
      .sort((a, b) => colIndex(a) - colIndex(b));

    for (let r = mapping.firstSubjectRow; r <= mapping.lastSubjectRow; r++) {
      const cell = ws[`${subjectColumn}${r}`] as XLSX.CellObject | undefined;
      const label = cell && cell.v !== undefined && cell.v !== null ? String(cell.v).trim() : "";
      if (!label || !isSubjectLabel(label)) continue;
      const key = normalize(label);
      const match =
        remaining.get(key) ??
        [...remaining.entries()].find(([k]) => k.includes(key) || key.includes(k))?.[1] ??
        null;
      if (!match) continue;
      remaining.delete(normalize(match.name));
      rowSubjectName.set(r, match.name);

      for (const [letter, role] of Object.entries(mapping.columns)) {
        const address = `${letter}${r}`;
        if (role === "composition") {
          setInputCell(address, toScale(match.composition, data.scale));
        } else if (role === "evaluation") {
          const idx = evalLetters.indexOf(letter);
          const raw = idx >= 0 ? (match.evaluations[idx] ?? null) : null;
          setInputCell(address, toScale(raw, data.scale));
        }
      }
    }
  }

  const formulas: { address: string; formula: string }[] = [];
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = ws[address] as XLSX.CellObject | undefined;
      if (cell?.f) formulas.push({ address, formula: String(cell.f) });
    }
  }

  const values: Record<string, CellValue> = {};
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = ws[address] as XLSX.CellObject | undefined;
      if (!cell) continue;
      if (cell.f) {
        values[address] = null;
        continue;
      }
      if (cell.t === "n" && typeof cell.v === "number") values[address] = cell.v;
      else if (cell.v === undefined || cell.v === null) values[address] = null;
      else values[address] = String(cell.v);
    }
  }

  const maxPasses = Math.max(8, formulas.length + 2);
  for (let pass = 0; pass < maxPasses; pass++) {
    for (const { address, formula } of formulas) {
      try {
        values[address] = evaluateFormula(formula, (ref) => values[ref] ?? null);
      } catch (e) {
        if (pass === maxPasses - 1 && e instanceof UnsupportedFormulaError) {
          warnings.push(`Formule non geree en ${address} : ${e.fn}`);
        }
      }
    }
  }

  for (const { address } of formulas) {
    const result = values[address];
    const cell = ws[address] as XLSX.CellObject | undefined;
    if (result === null || result === undefined) {
      if (cell) {
        delete cell.f;
        delete cell.v;
        delete cell.w;
      }
      continue;
    }
    const next: XLSX.CellObject = { ...(cell ?? {}) };
    delete next.f;
    if (typeof result === "number") {
      next.t = "n";
      next.v = result;
    } else {
      next.t = "s";
      next.v = String(result);
    }
    ws[address] = next;
  }

  // Extraire les moyennes UNIQUEMENT depuis les resultats des formules du modele.
  const readNumericNear = (address: string): number | null => {
    const direct = fromScale(values[address] ?? (ws[address] as XLSX.CellObject | undefined)?.v, data.scale);
    if (direct !== null) return direct;
    try {
      const { r, c } = XLSX.utils.decode_cell(address);
      for (const [dr, dc] of [
        [0, 1],
        [0, 2],
        [1, 0],
        [1, 1],
        [0, -1],
      ] as const) {
        const near = XLSX.utils.encode_cell({ r: r + dr, c: c + dc });
        const v = fromScale(values[near] ?? (ws[near] as XLSX.CellObject | undefined)?.v, data.scale);
        if (v !== null) return v;
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  let generalAverage: number | null = null;
  for (const [address, role] of Object.entries(mapping.fields)) {
    if (role !== "general_average") continue;
    const v = readNumericNear(address);
    if (v !== null) generalAverage = v;
  }

  const subjectAverages: Record<string, number | null> = {};
  const subjectAverageCol = Object.entries(mapping.columns).find(([, role]) => role === "subject_average")?.[0];
  if (subjectAverageCol) {
    for (const [row, name] of rowSubjectName) {
      subjectAverages[name] = fromScale(values[`${subjectAverageCol}${row}`], data.scale);
    }
  }

  // Si pas de cellule MG mappee : moyenne des moyennes-matieres issues des formules du modele
  if (generalAverage === null) {
    const vals = Object.values(subjectAverages).filter((v): v is number => v !== null);
    if (vals.length) {
      generalAverage = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
  }

  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx", cellStyles: true }) as ArrayBuffer;
  return {
    buffer,
    computed: { generalAverage, subjectAverages },
    warnings: [...new Set(warnings)],
  };
}

export function extractComputedAveragesFromRecalculated(
  recalculatedBuffer: ArrayBuffer,
  mapping: TemplateMapping,
  subjects: FillData["subjects"],
  scale: number,
): ComputedAverages {
  const wb = XLSX.read(recalculatedBuffer, { type: "array", cellFormula: true });
  const ws = wb.Sheets[mapping.sheetName] ?? wb.Sheets[wb.SheetNames[0]!];

  let generalAverage: number | null = null;
  if (ws) {
    for (const [address, role] of Object.entries(mapping.fields)) {
      if (role !== "general_average") continue;
      generalAverage = fromScale((ws[address] as XLSX.CellObject | undefined)?.v, scale);
    }
  }

  const subjectAverages: Record<string, number | null> = {};
  const subjectColumn = Object.entries(mapping.columns).find(([, role]) => role === "subject")?.[0];
  const subjectAverageCol = Object.entries(mapping.columns).find(([, role]) => role === "subject_average")?.[0];
  if (ws && subjectColumn && subjectAverageCol) {
    const remaining = new Map(subjects.map((s) => [normalize(s.name), s]));
    for (let r = mapping.firstSubjectRow; r <= mapping.lastSubjectRow; r++) {
      const cell = ws[`${subjectColumn}${r}`] as XLSX.CellObject | undefined;
      const label = cell && cell.v !== undefined && cell.v !== null ? String(cell.v).trim() : "";
      if (!label || !isSubjectLabel(label)) continue;
      const key = normalize(label);
      const match =
        remaining.get(key) ??
        [...remaining.entries()].find(([k]) => k.includes(key) || key.includes(k))?.[1] ??
        null;
      if (!match) continue;
      remaining.delete(normalize(match.name));
      subjectAverages[match.name] = fromScale(
        (ws[`${subjectAverageCol}${r}`] as XLSX.CellObject | undefined)?.v,
        scale,
      );
    }
  }

  return { generalAverage, subjectAverages };
}

export async function convertWorkbookOnline(
  _workbook: ArrayBuffer,
  _filename?: string,
): Promise<{ pdf: Blob; recalculated: ArrayBuffer } | null> {
  return null;
}
