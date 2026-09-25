/**
 * Stats de classe — bulletins validés prioritaires, sinon aperçu live
 * (formules modèle + repli notes saisies).
 */
import { buildModelFillData, computeModelAverages } from "@/lib/model-averages";
import { liveAveragesFromGrades, mergeModelAndLive } from "@/lib/live-averages";
import type { TemplateMapping } from "@/lib/xlsx-template";
import type { ClassSubject, Grade } from "@/lib/grades";
import { PASS_THRESHOLD, EXCELLENT_THRESHOLD } from "@/lib/grades";

export type LiveAveragedStudent = {
  student: { id: string; first_name: string; last_name: string };
  average: number;
  weakSubjects: string[];
  subjectAverages: Record<string, number | null>;
};

export type LiveClassStats = {
  withAvg: LiveAveragedStudent[];
  passing: LiveAveragedStudent[];
  excellent: LiveAveragedStudent[];
  struggling: LiveAveragedStudent[];
  classAverage: number | null;
  highest: LiveAveragedStudent | null;
  lowest: LiveAveragedStudent | null;
  bestSubject: { subject: ClassSubject; avg: number } | null;
  worstSubject: { subject: ClassSubject; avg: number } | null;
  source: "bulletin" | "modele_live" | "notes_live";
};

export function computeLiveClassStats(args: {
  students: { id: string; first_name: string; last_name: string }[];
  subjects: ClassSubject[];
  grades: Grade[];
  periodNumber: number;
  templateBuffer: ArrayBuffer | null;
  mapping: TemplateMapping | null;
  scale: number;
  establishmentName?: string;
  className?: string;
}): LiveClassStats | null {
  const {
    students,
    subjects,
    grades,
    periodNumber,
    templateBuffer,
    mapping,
    scale,
    establishmentName = "",
    className = "",
  } = args;

  const studentIdsWithNotes = new Set(grades.map((g) => g.student_id));
  const withAvg: LiveAveragedStudent[] = [];
  let anyModel = false;
  let anyLive = false;

  for (const s of students) {
    if (!studentIdsWithNotes.has(s.id)) continue;

    const live = liveAveragesFromGrades(grades, s.id, subjects);
    let model: { generalAverage: number | null; subjectAverages: Record<string, number | null> } | null =
      null;

    if (templateBuffer && mapping) {
      try {
        const fill = buildModelFillData({
          establishmentName,
          className,
          studentFirstName: s.first_name,
          studentLastName: s.last_name,
          periodNumber,
          subjects,
          grades,
          studentId: s.id,
          headcount: students.length,
          scale,
          rank: null,
          firstAverage: null,
          lastAverage: null,
        });
        model = computeModelAverages(templateBuffer, mapping, fill);
      } catch {
        model = null;
      }
    }

    const merged = mergeModelAndLive(model, live);
    if (merged.source === "modele" || merged.source === "mixte") anyModel = true;
    if (merged.source === "live" || merged.source === "mixte") anyLive = true;

    if (merged.generalAverage === null || !Number.isFinite(merged.generalAverage)) continue;

    const weak = Object.entries(merged.subjectAverages)
      .filter(([, v]) => v !== null && (v as number) < PASS_THRESHOLD)
      .map(([name]) => name);

    withAvg.push({
      student: s,
      average: merged.generalAverage,
      weakSubjects: weak,
      subjectAverages: merged.subjectAverages,
    });
  }

  if (!withAvg.length) return null;
  withAvg.sort((a, b) => b.average - a.average);

  const ranked: { subject: ClassSubject; avg: number }[] = [];
  for (const sub of subjects) {
    const vals: number[] = [];
    for (const row of withAvg) {
      const v = row.subjectAverages[sub.name];
      if (v !== null && v !== undefined && Number.isFinite(v)) vals.push(v);
    }
    if (vals.length) ranked.push({ subject: sub, avg: vals.reduce((a, b) => a + b, 0) / vals.length });
  }
  ranked.sort((a, b) => b.avg - a.avg);

  return {
    withAvg,
    passing: withAvg.filter((r) => r.average >= PASS_THRESHOLD),
    excellent: withAvg.filter((r) => r.average >= EXCELLENT_THRESHOLD),
    struggling: withAvg.filter((r) => r.average < PASS_THRESHOLD),
    classAverage: withAvg.reduce((a, r) => a + r.average, 0) / withAvg.length,
    highest: withAvg[0] ?? null,
    lowest: withAvg[withAvg.length - 1] ?? null,
    bestSubject: ranked[0] ?? null,
    worstSubject: ranked.length ? ranked[ranked.length - 1]! : null,
    source: anyModel && !anyLive ? "modele_live" : anyModel ? "modele_live" : "notes_live",
  };
}
