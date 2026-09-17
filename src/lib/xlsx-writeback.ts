/**
 * REMPLISSAGE RÉEL DU CLASSEUR EXCEL — Option B (fidélité parfaite).
 *
 * Contrairement à fillTemplate()/drawFilledTemplate() (xlsx-template.ts), qui simulent les
 * formules en JS et REDESSINENT un tableau générique sur un canvas (repli hors-ligne, garde
 * la mise en forme d'origine côté visuel), ce module ne touche JAMAIS aux formules ni au
 * style : il réutilise le classeur SheetJS tel que lu depuis le fichier d'origine, et modifie
 * uniquement les cellules de saisie (notes + balises). Le fichier produit reste un vrai
 * .xlsx — mêmes formules, mêmes couleurs, mêmes polices, mêmes bordures, même logo — prêt à
 * être envoyé à un service de conversion externe qui le recalculera avec un vrai moteur
 * Excel/LibreOffice, pour un PDF fidèle à 100 % et des moyennes fiables à 100 %.
 *
 * ⚠️ Nécessite un réseau + un service de conversion configuré (voir bulletin-helpers.tsx).
 * Sans ça, l'app doit retomber sur fillTemplate()/drawFilledTemplate() (mode hors-ligne).
 */
import * as XLSX from "xlsx";
import { colIndex, isSubjectLabel, normalize, type TemplateMapping, type FillData, type ComputedAverages } from "@/lib/xlsx-template";

const toScale = (v: number | null, scale: number) => (v === null ? null : Math.round(((v / 20) * scale) * 100) / 100);
const fromScale = (v: unknown, scale: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(((v / scale) * 20) * 100) / 100 : null;

/**
 * Remplit les cellules de saisie du classeur d'origine (mêmes matières, mêmes balises que
 * fillTemplate) SANS jamais écrire dans une cellule à formule — le moteur de conversion
 * recalculera ces formules lui-même à l'ouverture. Retourne le classeur .xlsx complet, prêt
 * à être envoyé au service de conversion.
 */
export function writeFilledWorkbook(originalBuffer: ArrayBuffer, mapping: TemplateMapping, data: FillData): ArrayBuffer {
  const wb = XLSX.read(originalBuffer, { type: "array", cellFormula: true, cellStyles: true });
  const ws = wb.Sheets[mapping.sheetName] ?? wb.Sheets[wb.SheetNames[0]!];
  if (!ws) throw new Error("Feuille du modèle introuvable dans le fichier.");

  const setCell = (address: string, value: number | string | null) => {
    const cell = ws[address];
    if (cell?.f) return; // ne jamais écraser une formule : Excel/LibreOffice la recalculera
    if (value === null || value === undefined) {
      if (cell) {
        delete cell.v;
        delete cell.w;
      }
      return;
    }
    ws[address] = { ...(cell ?? {}), t: typeof value === "number" ? "n" : "s", v: value };
  };

  // Balises isolées — mêmes rôles que fillTemplate().
  for (const [address, role] of Object.entries(mapping.fields)) {
    let value: number | string | null;
    switch (role) {
      case "student_name":
        value = data.studentName;
        break;
      case "student_first_name":
        value = data.studentFirstName;
        break;
      case "student_last_name":
        value = data.studentLastName;
        break;
      case "class_name":
        value = data.className;
        break;
      case "establishment_name":
        value = data.establishmentName;
        break;
      case "period_label":
        value = data.periodLabel;
        break;
      case "headcount":
        value = data.headcount;
        break;
      case "general_average":
        value = toScale(data.generalAverage, data.scale);
        break;
      case "first_average":
        value = toScale(data.firstAverage, data.scale);
        break;
      case "last_average":
        value = toScale(data.lastAverage, data.scale);
        break;
      case "class_average_evaluation":
        value = toScale(data.classAverageEvaluation, data.scale);
        break;
      case "class_average_composition":
        value = toScale(data.classAverageComposition, data.scale);
        break;
      case "rank":
        value = data.rank;
        break;
      case "date":
        value = new Date().toLocaleDateString("fr-FR");
        break;
      default:
        continue;
    }
    setCell(address, value);
  }

  // Tableau des matières — même appariement (par nom normalisé) que fillTemplate(), pour
  // que le rendu réel et le repli hors-ligne donnent toujours le même résultat.
  const subjectColumn = Object.entries(mapping.columns).find(([, role]) => role === "subject")?.[0];
  if (subjectColumn) {
    const remaining = new Map(data.subjects.map((s) => [normalize(s.name), s]));
    const evalLetters = Object.entries(mapping.columns)
      .filter(([, role]) => role === "evaluation")
      .map(([letter]) => letter)
      .sort((a, b) => colIndex(a) - colIndex(b));

    for (let r = mapping.firstSubjectRow; r <= mapping.lastSubjectRow; r++) {
      const cell = ws[`${subjectColumn}${r}`];
      const label = cell && cell.v !== undefined && cell.v !== null ? String(cell.v).trim() : "";
      if (!label || !isSubjectLabel(label)) continue;
      const key = normalize(label);
      const match =
        remaining.get(key) ?? [...remaining.entries()].find(([k]) => k.includes(key) || key.includes(k))?.[1] ?? null;
      if (!match) continue;
      remaining.delete(normalize(match.name));

      for (const [letter, role] of Object.entries(mapping.columns)) {
        const address = `${letter}${r}`;
        if (role === "composition") {
          setCell(address, toScale(match.composition, data.scale));
        } else if (role === "evaluation") {
          const idx = evalLetters.indexOf(letter);
          const raw = idx >= 0 ? (match.evaluations[idx] ?? null) : null;
          setCell(address, toScale(raw, data.scale));
        }
      }
    }
  }

  // Force le recalcul complet à l'ouverture (respecté par la plupart des moteurs de
  // conversion basés sur un vrai Excel/LibreOffice).
  wb.Workbook = { ...(wb.Workbook ?? {}), CalcPr: { ...(wb.Workbook?.CalcPr ?? {}), fullCalcOnLoad: true } };

  return XLSX.write(wb, { type: "array", bookType: "xlsx", cellStyles: true }) as ArrayBuffer;
}

/**
 * Extrait la moyenne générale + les moyennes par matière depuis un classeur RECALCULÉ par
 * un vrai moteur Excel (renvoyé par le service de conversion après writeFilledWorkbook).
 * Lit les valeurs mises en cache par le moteur dans les cellules à formule — fiabilité
 * parfaite, contrairement à l'évaluateur JS de fillTemplate().
 */
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
      generalAverage = fromScale(ws[address]?.v, scale);
    }
  }

  const subjectAverages: Record<string, number | null> = {};
  const subjectColumn = Object.entries(mapping.columns).find(([, role]) => role === "subject")?.[0];
  const subjectAverageCol = Object.entries(mapping.columns).find(([, role]) => role === "subject_average")?.[0];
  if (ws && subjectColumn && subjectAverageCol) {
    const remaining = new Map(subjects.map((s) => [normalize(s.name), s]));
    for (let r = mapping.firstSubjectRow; r <= mapping.lastSubjectRow; r++) {
      const cell = ws[`${subjectColumn}${r}`];
      const label = cell && cell.v !== undefined && cell.v !== null ? String(cell.v).trim() : "";
      if (!label || !isSubjectLabel(label)) continue;
      const key = normalize(label);
      const match =
        remaining.get(key) ?? [...remaining.entries()].find(([k]) => k.includes(key) || key.includes(k))?.[1] ?? null;
      if (!match) continue;
      remaining.delete(normalize(match.name));
      subjectAverages[match.name] = fromScale(ws[`${subjectAverageCol}${r}`]?.v, scale);
    }
  }

  return { generalAverage, subjectAverages };
}
