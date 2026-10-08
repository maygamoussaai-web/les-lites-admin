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
  parseColumnTag,
  type TemplateMapping,
  type FillData,
  type ComputedAverages,
  type FieldRole,
  type PeriodStat,
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

  {
    const cols = { ...mapping.columns };
    const periodCols = { ...(mapping.periodColumns ?? {}) };
    if (mapping.headerRow > 0) {
      for (let c = 0; c < 24; c++) {
        const letter = XLSX.utils.encode_col(c);
        const cell = ws[`${letter}${mapping.headerRow}`] as XLSX.CellObject | undefined;
        const above = ws[`${letter}${mapping.headerRow - 1}`] as XLSX.CellObject | undefined;
        const raw = cell?.v != null ? String(cell.v) : "";
        const rawAbove = above?.v != null ? String(above.v) : "";
        const tag = parseColumnTag(raw) ?? parseColumnTag(rawAbove);
        if (tag) {
          cols[letter] = tag.role;
          if (tag.periodIndex != null) periodCols[letter] = tag.periodIndex;
          continue;
        }
        if (cols[letter] && cols[letter] !== "ignore") continue;
        const label = normalize(raw);
        if (!label) continue;
        if (
          label.includes("note classe") ||
          label.includes("note de classe") ||
          label === "eval" ||
          label.includes("evaluation") ||
          label.includes("interro")
        ) {
          cols[letter] = "evaluation";
        } else if (label.includes("compo") || label.includes("composition")) {
          cols[letter] = "composition";
        }
      }
      mapping.columns = cols;
      if (Object.keys(periodCols).length) mapping.periodColumns = periodCols;
    }
  }

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
    setInputCell(address, fieldValue(role, data));
  }

  {
    const STAT_KEYS: Record<string, keyof PeriodStat> = {
      mg: "generalAverage", moyenne: "generalAverage", "moyenne generale": "generalAverage", moy_gen: "generalAverage",
      rang: "rank", premier: "firstAverage", "moyenne premier": "firstAverage",
      dernier: "lastAverage", "moyenne dernier": "lastAverage",
      moy_classe: "classAverage", "moyenne classe": "classAverage", effectif: "headcount",
    };
    const current: PeriodStat = {
      generalAverage: data.generalAverage, rank: data.rank, firstAverage: data.firstAverage,
      lastAverage: data.lastAverage, classAverage: data.classAverage ?? null, headcount: data.headcount,
    };
    const rangeStat = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    for (let r = rangeStat.s.r; r <= rangeStat.e.r; r++) {
      for (let c = rangeStat.s.c; c <= rangeStat.e.c; c++) {
        const address = XLSX.utils.encode_cell({ r, c });
        const cell = ws[address] as XLSX.CellObject | undefined;
        if (!cell || cell.f || typeof cell.v !== "string") continue;
        const m = /^\s*[[{]\s*([a-z_ ]+?)\s*(?::\s*(\d+|annuel|annual|an))?\s*[\]}]\s*$/i.exec(cell.v);
        if (!m) continue;
        const rawKey = m[1]!.toLowerCase().trim();
        const key = STAT_KEYS[rawKey] ?? STAT_KEYS[normalize(rawKey)];
        if (!key) continue;
        const idx = m[2] && /^\d+$/.test(m[2]) ? Number(m[2]) - 1 : null;
        if (idx === null && !m[2] && key !== "generalAverage" && key !== "classAverage") continue;
        const stat = idx === null ? current : data.periodStats?.[idx];
        const raw = stat ? stat[key] : null;
        const isCount = key === "rank" || key === "headcount";
        setInputCell(address, raw == null ? null : isCount ? raw : toScale(raw, data.scale));
      }
    }
  }

  const subjectColumn = Object.entries(mapping.columns).find(([, role]) => role === "subject")?.[0];
  const rowSubjectName = new Map<number, string>();
  if (subjectColumn) {
    const remaining = new Map(data.subjects.map((s) => [normalize(s.name), s]));
    const evalLetters = Object.entries(mapping.columns)
      .filter(([, role]) => role === "evaluation")
      .map(([letter]) => letter);
    const compLetter = Object.entries(mapping.columns).find(([, role]) => role === "composition")?.[0];
    const evalAvgLetter = Object.entries(mapping.columns).find(([, role]) => role === "evaluation_average")?.[0];
    const subjAvgLetter = Object.entries(mapping.columns).find(([, role]) => role === "subject_average")?.[0];
    const periodCols = mapping.periodColumns ?? {};

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

      for (const letter of evalLetters) {
        const address = `${letter}${r}`;
        const periodIdx = periodCols[letter];
        const raw =
          periodIdx != null
            ? (match.evaluations[periodIdx] ?? null)
            : match.evaluations.length === 1
              ? match.evaluations[0]!
              : match.evaluations[0] ?? null;
        setInputCell(address, toScale(raw, data.scale));
      }
      if (compLetter) {
        const address = `${compLetter}${r}`;
        const periodIdx = periodCols[compLetter];
        const raw =
          periodIdx != null
            ? (match.evaluations[periodIdx] ?? match.composition)
            : match.composition;
        setInputCell(address, toScale(raw, data.scale));
      }
      if (evalAvgLetter) {
        const address = `${evalAvgLetter}${r}`;
        const periodIdx = periodCols[evalAvgLetter];
        const raw =
          periodIdx != null
            ? (match.evaluations[periodIdx] ?? match.evaluationAverage ?? match.average)
            : (match.evaluationAverage ?? match.average);
        setInputCell(address, toScale(raw, data.scale));
      }
      if (subjAvgLetter) {
        const address = `${subjAvgLetter}${r}`;
        const periodIdx = periodCols[subjAvgLetter];
        const raw =
          periodIdx != null
            ? (match.evaluations[periodIdx] ?? match.average)
            : match.average;
        setInputCell(address, toScale(raw, data.scale));
      }
    }
  }

  const values: Record<string, CellValue> = {};
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = ws[address] as XLSX.CellObject | undefined;
      if (!cell) continue;
      if (cell.f) {
        try {
          const result = evaluateFormula(cell.f, (ref) => {
            if (ref in values) return values[ref]!;
            const dep = ws[ref] as XLSX.CellObject | undefined;
            if (!dep) return null;
            if (dep.f && !(ref in values)) return null;
            return (dep.v as CellValue) ?? null;
          });
          values[address] = result;
          ws[address] = { ...cell, t: typeof result === "number" ? "n" : "s", v: result ?? undefined };
        } catch (e) {
          if (e instanceof UnsupportedFormulaError) {
            warnings.push(`Formule non supportée (${address}): ${cell.f}`);
          }
          values[address] = (cell.v as CellValue) ?? null;
        }
      } else {
        values[address] = (cell.v as CellValue) ?? null;
      }
    }
  }

  for (const [address, cell] of Object.entries(ws)) {
    if (address.startsWith("!")) continue;
    const c = cell as XLSX.CellObject;
    if (!c.f) continue;
    const next = { ...c };
    if (address in values && values[address] != null) {
      next.v = values[address] as string | number;
      next.t = typeof values[address] === "number" ? "n" : "s";
    }
    ws[address] = next;
  }
  wb.Workbook = { ...(wb.Workbook ?? {}), CalcPr: { fullCalcOnLoad: "1" } } as unknown as NonNullable<XLSX.WorkBook["Workbook"]>;

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

  if (generalAverage === null && ws) {
    const range2 = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    for (let r = range2.s.r; r <= range2.e.r; r++) {
      let label = "";
      for (let c = range2.s.c; c <= Math.min(range2.e.c, range2.s.c + 3); c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr] as XLSX.CellObject | undefined;
        if (cell?.v != null && !cell.f) label += " " + String(cell.v);
      }
      const norm = normalize(label);
      if (!norm.includes("moyen") || (!norm.includes("general") && !norm.includes("generale"))) continue;
      for (let c = range2.s.c; c <= range2.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const v = fromScale(values[addr], data.scale);
        if (v !== null) {
          generalAverage = v;
          break;
        }
      }
      if (generalAverage !== null) break;
    }
  }

  // Pas de fallback arithmétique : la MG doit venir uniquement des formules du modèle Excel.
  if (generalAverage === null) {
    warnings.push(
      "Moyenne générale introuvable dans le modèle (formule Excel absente ou non évaluable). Aucune moyenne inventée par l'application.",
    );
  }

  const written = XLSX.write(wb, { type: "array", bookType: "xlsx", cellStyles: true });
  const buffer: ArrayBuffer =
    written instanceof ArrayBuffer
      ? written
      : new Uint8Array(written as number[]).buffer.slice(0);
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
