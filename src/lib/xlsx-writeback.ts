/**
 * REMPLISSAGE DU CLASSEUR EXCEL ORIGINAL — fidélité au modèle importé.
 *
 * 1. Part du fichier .xlsx d'origine.
 * 2. N'écrit que les entrées (notes, balises [prenom]/[nom]…).
 * 3. Ne touche jamais une cellule déjà en formule.
 * 4. Après écriture : fusion JSZip des media/drawings/theme d'origine
 *    (logos, photos, thème) pour coller au modèle importé.
 * 5. Moyennes = formules du modèle uniquement (pas de reduce JS).
 */
import * as XLSX from "xlsx";
import JSZip from "jszip";
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

export async function writeFilledWorkbook(
  originalBuffer: ArrayBuffer,
  mapping: TemplateMapping,
  data: FillData,
): Promise<{ buffer: ArrayBuffer; computed: ComputedAverages; warnings: string[] }> {
  const wb = XLSX.read(originalBuffer, { type: "array", cellFormula: true, cellStyles: true });
  const ws = wb.Sheets[mapping.sheetName] ?? wb.Sheets[wb.SheetNames[0]!];
  if (!ws) throw new Error("Feuille du modele introuvable dans le fichier.");

  const warnings: string[] = [];

  // Rattrapage : balises de colonnes + libellés absents du mapping stocké
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

  /** Adresses réellement écrites (balises + notes) — seules celles-ci partent dans le .xlsx livré. */
  const touched = new Map<string, number | string>();

  const setInputCell = (address: string, value: number | string | null) => {
    const cell = ws[address] as XLSX.CellObject | undefined;
    if (cell?.f) return; // jamais écraser une formule du modèle
    if (value === null || value === undefined) {
      if (cell) {
        delete cell.v;
        delete cell.w;
      }
      touched.delete(address);
      return;
    }
    touched.set(address, value);
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
    // IMPORTANT : n'écrire QUE si la cellule est une balise pure [token]/{token}.
    // Jamais une cellule vide (mapping obsolète) ni un libellé libre.
    const isToken = /^\s*[[{].+[\]}]\s*$/.test(raw);
    if (!isToken) continue;
    setInputCell(address, fieldValue(role, data));
  }

  // Repli : balises [prenom], [nom], … même si absentes du mapping stocké
  {
    const TOKEN_ROLES: Record<string, FieldRole> = {
      prenom: "student_first_name",
      nom: "student_last_name",
      "nom de famille": "student_last_name",
      "nom et prenom": "student_name",
      classe: "class_name",
      etablissement: "establishment_name",
      periode: "period_label",
      trimestre: "period_label",
      effectif: "headcount",
      rang: "rank",
      date: "date",
      "moyenne du premier": "first_average",
      "moyenne du dernier": "last_average",
    };
    const rangeTok = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    for (let r = rangeTok.s.r; r <= rangeTok.e.r; r++) {
      for (let c = rangeTok.s.c; c <= rangeTok.e.c; c++) {
        const address = XLSX.utils.encode_cell({ r, c });
        const cell = ws[address] as XLSX.CellObject | undefined;
        if (!cell || cell.f) continue;
        const raw = cell.v !== null && cell.v !== undefined ? String(cell.v).trim() : "";
        const m = /^\[\s*([^\]]+?)\s*\]$/.exec(raw) || /^\{\s*([^}]+?)\s*\}$/.exec(raw);
        if (!m) continue;
        const key = normalize(m[1]!);
        const role = TOKEN_ROLES[key];
        if (!role || !PRE_FORMULA_FIELDS.has(role)) continue;
        setInputCell(address, fieldValue(role, data));
      }
    }
  }

  // NOTE POUR CLAUDE: balises statistiques indexées par période (bulletins annuels
  // ou tout modèle multi-périodes) : [mg:1], [rang:2], [premier:3], [dernier:1],
  // [moy_classe:2], [effectif:3] ; suffixe « :annuel » ou sans indice = valeur annuelle/courante.
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
        // Sans indice : rang/effectif/premier/dernier déjà gérés plus haut.
        // generalAverage sans indice = sortie (formule Excel) → on n'écrit jamais.
        // classAverage sans indice = entrée légitime (moyenne de classe connue).
        // Avec indice ([mg:1], [rang:2]…) = stats de période (bulletin annuel).
        if (idx === null && !m[2]) {
          if (key === "generalAverage") continue;
          if (key !== "classAverage") continue;
        }
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

      const periodCols = mapping.periodColumns ?? {};
      for (const [letter, role] of Object.entries(mapping.columns)) {
        const address = `${letter}${r}`;
        const periodIdx = periodCols[letter];
        if (role === "composition") {
          const raw =
            periodIdx != null && match.evaluations[periodIdx] != null
              ? match.evaluations[periodIdx]
              : match.composition;
          setInputCell(address, toScale(raw, data.scale));
        } else if (role === "evaluation") {
          const raw =
            periodIdx != null
              ? (match.evaluations[periodIdx] ?? null)
              : (() => {
                  const idx = evalLetters.indexOf(letter);
                  return idx >= 0 ? (match.evaluations[idx] ?? null) : null;
                })();
          setInputCell(address, toScale(raw, data.scale));
        } else if (role === "evaluation_average") {
          // Entrée légitime uniquement si index de période (bulletin annuel [moy_eval:1]).
          // Sans période : jamais de moyenne inventée en JS — formule Excel uniquement.
          const raw =
            periodIdx != null ? (match.evaluations[periodIdx] ?? null) : null;
          setInputCell(address, toScale(raw, data.scale));
        } else if (role === "subject_average") {
          // Idem : moyennes matière sans formule = lecture seule Excel.
          // Avec période ([moy:1]…) = moyenne de période déjà calculée par le modèle périodique.
          const raw =
            periodIdx != null
              ? (match.evaluations[periodIdx] ?? null)
              : null;
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

  // NOTE POUR CLAUDE: « Cas A » validé par l'utilisateur — la formule du modèle
  // est CONSERVÉE dans le .xlsx livré (cell.f) ; on n'y ajoute que la valeur
  // calculée (cell.v) pour un affichage immédiat. Excel recalcule à l'ouverture.
  for (const { address, formula } of formulas) {
    const result = values[address];
    const cell = ws[address] as XLSX.CellObject | undefined;
    const next: XLSX.CellObject = { ...(cell ?? {}), f: formula } as XLSX.CellObject;
    delete next.w;
    if (result === null || result === undefined) {
      delete next.v;
      next.t = "s";
    } else if (typeof result === "number") {
      next.t = "n";
      next.v = result;
    } else {
      next.t = "s";
      next.v = String(result);
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

  // Livraison fidèle : ExcelJS part du buffer d'origine (couleurs, styles, fusions, images).
  // On n'écrit QUE les entrées (balises + notes). Jamais de formule inventée.
  try {
    const ExcelJS = (await import("exceljs")).default;
    const ewb = new ExcelJS.Workbook();
    await ewb.xlsx.load(originalBuffer as ArrayBuffer);
    const ews = ewb.getWorksheet(mapping.sheetName) ?? ewb.worksheets[0];
    if (!ews) throw new Error("Feuille ExcelJS introuvable");

    // Écrit UNIQUEMENT les cellules touchées (balises + notes matières).
    for (const [address, value] of touched) {
      const cell = ews.getCell(address);
      if (cell.formula) continue;
      const v = cell.value as unknown;
      if (v && typeof v === "object" && "formula" in (v as object)) continue;
      cell.value = value;
    }

    const out = await ewb.xlsx.writeBuffer();
    const buffer: ArrayBuffer =
      out instanceof ArrayBuffer
        ? out
        : (out as Uint8Array).buffer.slice(
            (out as Uint8Array).byteOffset,
            (out as Uint8Array).byteOffset + (out as Uint8Array).byteLength,
          );
    return {
      buffer,
      computed: { generalAverage, subjectAverages },
      warnings: [...new Set(warnings)],
    };
  } catch (e) {
    warnings.push(
      `ExcelJS indisponible (${e instanceof Error ? e.message : "erreur"}) — repli SheetJS + media.`,
    );
  }

  const written = XLSX.write(wb, { type: "array", bookType: "xlsx", cellStyles: true });
  let buffer: ArrayBuffer =
    written instanceof ArrayBuffer
      ? written
      : new Uint8Array(written as number[]).buffer.slice(0);

  try {
    const origZip = await JSZip.loadAsync(originalBuffer);
    const newZip = await JSZip.loadAsync(buffer);
    for (const [path, entry] of Object.entries(origZip.files)) {
      if (entry.dir) continue;
      if (
        path.startsWith("xl/media/") ||
        path.startsWith("xl/drawings/") ||
        path.startsWith("xl/theme/") ||
        (path.includes("_rels") && (path.includes("drawing") || path.includes("sheet")))
      ) {
        newZip.file(path, await entry.async("uint8array"));
      }
    }
    buffer = await newZip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  } catch {
    /* ignore */
  }

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
