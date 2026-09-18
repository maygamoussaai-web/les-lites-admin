/**
 * MOYENNES SELON LE MODELE EXCEL — en temps reel, sans inventer de calcul.
 *
 * NOTE POUR CLAUDE : regles appliquees, dans cet ordre, pour CHAQUE matiere :
 *  1. Si le modele a une colonne « moyenne » avec une formule ET que les deux
 *     notes (evaluation + composition) existent -> on rejoue LA formule du
 *     fichier pour cette ligne.
 *  2. Sinon, si les deux notes existent -> (evaluation + 2 x composition) / 3.
 *  3. Si une seule note existe -> c'est elle la moyenne de la matiere.
 *  4. Aucune note -> null. Une cellule vide n'est JAMAIS un zero.
 * La moyenne generale suit la formule du modele quand toutes les matieres ont
 * une moyenne ; sinon c'est la moyenne des matieres notees (provisoire).
 */
import { evaluateFormula, type CellValue } from "@/lib/xlsx-formula";
import {
  colIndex,
  fillTemplate,
  type FillData,
  type FillSubjectRow,
  type TemplateMapping,
  type TemplateSheet,
} from "@/lib/xlsx-template";

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Regle 2/3/4 : utilisee quand le modele n'a pas de formule de moyenne exploitable. */
export function defaultSubjectAverage(
  evaluationAverage: number | null,
  composition: number | null,
): number | null {
  if (evaluationAverage === null && composition === null) return null;
  if (composition === null) return evaluationAverage;
  if (evaluationAverage === null) return composition;
  return round2((evaluationAverage + 2 * composition) / 3);
}

const columnWithRole = (mapping: TemplateMapping, role: string) =>
  Object.entries(mapping.columns).find(([, r]) => r === role)?.[0] ?? null;

const evaluationColumns = (mapping: TemplateMapping) =>
  Object.entries(mapping.columns)
    .filter(([, r]) => r === "evaluation")
    .map(([letter]) => letter)
    .sort((a, b) => colIndex(a) - colIndex(b));

function runFormulas(
  sheet: TemplateSheet,
  values: Record<string, CellValue>,
  locked: Set<string>,
  passes = 4,
) {
  const formulas = Object.entries(sheet.cells).filter(([address, cell]) => cell.f && !locked.has(address));
  for (let p = 0; p < passes; p++) {
    for (const [address, cell] of formulas) {
      try {
        values[address] = evaluateFormula(cell.f!, (r) => values[r] ?? null);
      } catch {
        /* formule non geree : signalee ailleurs (import du modele) */
      }
    }
  }
}

export type ModelAveragesResult = {
  /** Valeurs du bulletin, cellule par cellule — sert au rendu PDF. */
  values: Record<string, CellValue>;
  /** Moyenne par matiere, ramenee sur 20. */
  subjectAverages: Record<string, number | null>;
  /** Moyenne generale, ramenee sur 20. */
  generalAverage: number | null;
  /** true si au moins une matiere n'a aucune note (moyenne generale provisoire). */
  partial: boolean;
  warnings: string[];
};

/** Remplit le modele avec les notes de l'eleve puis applique les regles de moyenne. */
export function applyModelRules(
  sheet: TemplateSheet,
  mapping: TemplateMapping,
  data: FillData,
): ModelAveragesResult {
  const scale = data.scale || 20;
  const toScale = (v: number | null) => (v === null ? null : round2((v / 20) * scale));
  const fromScale = (v: CellValue): number | null =>
    typeof v === "number" && Number.isFinite(v) ? round2((v / scale) * 20) : null;

  const filled = fillTemplate(sheet, mapping, data);
  const values = filled.values;
  const avgCol = columnWithRole(mapping, "subject_average");
  const byName = new Map(data.subjects.map((s) => [s.name, s]));

  const subjectAverages: Record<string, number | null> = {};
  const locked = new Set<string>();
  let partial = false;

  for (const [rowKey, name] of Object.entries(filled.rowSubjects)) {
    const row = Number(rowKey);
    const subject = byName.get(name);
    if (!subject) continue;
    const evalAvg = subject.evaluationAverage;
    const compo = subject.composition;

    let average: number | null;
    if (evalAvg !== null && compo !== null) {
      const fromTemplate = avgCol ? fromScale(values[`${avgCol}${row}`] ?? null) : null;
      average = fromTemplate ?? defaultSubjectAverage(evalAvg, compo);
    } else {
      average = defaultSubjectAverage(evalAvg, compo);
    }

    subjectAverages[name] = average;
    if (average === null) partial = true;
    if (avgCol) {
      values[`${avgCol}${row}`] = toScale(average);
      locked.add(`${avgCol}${row}`);
    }
  }

  for (const s of data.subjects) if (!(s.name in subjectAverages)) subjectAverages[s.name] = null;
  if (Object.values(subjectAverages).some((v) => v === null)) partial = true;

  // On rejoue les formules restantes avec les moyennes-matieres figees.
  runFormulas(sheet, values, locked);

  const gaAddress = Object.entries(mapping.fields).find(([, role]) => role === "general_average")?.[0] ?? null;
  const graded = Object.values(subjectAverages).filter((v): v is number => v !== null);
  let generalAverage: number | null = null;
  if (!partial && gaAddress) generalAverage = fromScale(values[gaAddress] ?? null);
  if (generalAverage === null && graded.length) {
    generalAverage = round2(graded.reduce((a, b) => a + b, 0) / graded.length);
  }
  if (gaAddress) values[gaAddress] = toScale(generalAverage);

  return {
    values,
    subjectAverages,
    generalAverage,
    partial,
    warnings: filled.warnings,
  };
}

/**
 * Evaluateur leger d'une seule matiere — pour l'affichage en direct pendant la
 * saisie des notes (pas de remplissage complet du classeur a chaque frappe).
 */
export function makeSubjectAverageFn(
  sheet: TemplateSheet | null,
  mapping: TemplateMapping | null,
  scale: number,
): (subjectName: string, evaluations: number[], composition: number | null) => number | null {
  const avgOf = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

  if (!sheet || !mapping) {
    return (_name, evaluations, composition) => defaultSubjectAverage(avgOf(evaluations), composition);
  }

  const subjectCol = columnWithRole(mapping, "subject");
  const avgCol = columnWithRole(mapping, "subject_average");
  const compoCol = columnWithRole(mapping, "composition");
  const evalAvgCol = columnWithRole(mapping, "evaluation_average");
  const evalCols = evaluationColumns(mapping);

  const rowByName = new Map<string, number>();
  if (subjectCol) {
    for (let r = mapping.firstSubjectRow; r <= mapping.lastSubjectRow; r++) {
      const cell = sheet.cells[`${subjectCol}${r}`];
      const label = cell && cell.v !== null ? String(cell.v).trim() : "";
      if (label) rowByName.set(normalizeName(label), r);
    }
  }

  return (subjectName, evaluations, composition) => {
    const evalAverage = avgOf(evaluations);
    if (evalAverage === null || composition === null) {
      return defaultSubjectAverage(evalAverage, composition);
    }
    const row = rowByName.get(normalizeName(subjectName));
    const formula = avgCol && row ? sheet.cells[`${avgCol}${row}`]?.f : undefined;
    if (!formula || !row) return defaultSubjectAverage(evalAverage, composition);

    const toScale = (v: number | null) => (v === null ? null : round2((v / 20) * scale));
    try {
      const result = evaluateFormula(formula, (address) => {
        const m = /^([A-Z]+)(\d+)$/.exec(address);
        if (!m || Number(m[2]) !== row) return sheet.cells[address]?.v ?? null;
        const letter = m[1]!;
        if (letter === compoCol) return toScale(composition);
        if (letter === evalAvgCol) return toScale(evalAverage);
        const idx = evalCols.indexOf(letter);
        if (idx >= 0) return toScale(evaluations[idx] ?? evalAverage);
        return sheet.cells[address]?.v ?? null;
      });
      if (typeof result === "number" && Number.isFinite(result)) return round2((result / scale) * 20);
    } catch {
      /* formule non geree : on retombe sur la regle par defaut */
    }
    return defaultSubjectAverage(evalAverage, composition);
  };
}

const normalizeName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export type { FillSubjectRow };
