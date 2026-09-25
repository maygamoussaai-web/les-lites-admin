/**
 * Moyennes « live » à partir des notes saisies (échelle ramenée /20).
 * Repli quand les formules du modèle Excel ne renvoient rien.
 *
 * Formule matière (standard) :
 *   - eval + compo → (moy. évaluations + composition) / 2
 *   - une seule nature → cette valeur
 * Moyenne générale = moyenne simple des matières renseignées
 * (les coefs Excel restent la source de vérité au bulletin généré).
 */
import type { ClassSubject, Grade } from "@/lib/grades";
import { groupGradesBySubject } from "@/lib/grades";

const to20 = (g: Grade) =>
  g.scale > 0 ? (Number(g.value) / Number(g.scale)) * 20 : Number(g.value);

export function subjectAverageFromGrades(gs: Grade[]): number | null {
  if (!gs.length) return null;
  const evals = gs.filter((g) => g.nature === "evaluation").map(to20).filter(Number.isFinite);
  const comps = gs.filter((g) => g.nature === "composition").map(to20).filter(Number.isFinite);
  const evalAvg = evals.length ? evals.reduce((a, b) => a + b, 0) / evals.length : null;
  const compAvg = comps.length ? comps.reduce((a, b) => a + b, 0) / comps.length : null;
  if (evalAvg !== null && compAvg !== null) return Math.round(((evalAvg + compAvg) / 2) * 100) / 100;
  if (evalAvg !== null) return Math.round(evalAvg * 100) / 100;
  if (compAvg !== null) return Math.round(compAvg * 100) / 100;
  return null;
}

export function liveAveragesFromGrades(
  grades: Grade[],
  studentId: string,
  subjects: ClassSubject[],
): { generalAverage: number | null; subjectAverages: Record<string, number | null> } {
  const byId = groupGradesBySubject(grades, studentId);
  const subjectAverages: Record<string, number | null> = {};
  const vals: number[] = [];

  for (const sub of subjects) {
    const list = byId.get(sub.id) ?? [];
    const avg = subjectAverageFromGrades(list);
    subjectAverages[sub.name] = avg;
    if (avg !== null) vals.push(avg);
  }

  const generalAverage =
    vals.length > 0
      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
      : null;

  return { generalAverage, subjectAverages };
}

/** Modèle prioritaire si non null ; sinon notes live. */
export function mergeModelAndLive(
  model: { generalAverage: number | null; subjectAverages: Record<string, number | null> } | null,
  live: { generalAverage: number | null; subjectAverages: Record<string, number | null> },
): {
  generalAverage: number | null;
  subjectAverages: Record<string, number | null>;
  source: "modele" | "live" | "mixte";
} {
  if (!model) return { ...live, source: "live" };

  const subjectAverages: Record<string, number | null> = { ...live.subjectAverages };
  let usedModel = false;
  let usedLive = false;

  for (const [k, v] of Object.entries(model.subjectAverages)) {
    if (v !== null && Number.isFinite(v)) {
      subjectAverages[k] = v;
      usedModel = true;
    } else if (subjectAverages[k] != null) {
      usedLive = true;
    }
  }
  for (const [k, v] of Object.entries(live.subjectAverages)) {
    if ((subjectAverages[k] === null || subjectAverages[k] === undefined) && v !== null) {
      subjectAverages[k] = v;
      usedLive = true;
    }
  }

  let generalAverage =
    model.generalAverage !== null && Number.isFinite(model.generalAverage)
      ? model.generalAverage
      : null;
  if (generalAverage !== null) usedModel = true;
  if (generalAverage === null && live.generalAverage !== null) {
    generalAverage = live.generalAverage;
    usedLive = true;
  }
  if (generalAverage === null) {
    const vals = Object.values(subjectAverages).filter((v): v is number => v !== null);
    if (vals.length) {
      generalAverage = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
      usedLive = true;
    }
  }

  const source = usedModel && usedLive ? "mixte" : usedModel ? "modele" : "live";
  return { generalAverage, subjectAverages, source };
}
