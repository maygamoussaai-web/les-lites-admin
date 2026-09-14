import type { Tables } from "@/integrations/supabase/types";

export type ClassSubject = Tables<"class_subjects">;
export type GradePeriod = Tables<"grade_periods">;
export type Grade = Tables<"grades">;
export type StudentReportCard = Tables<"student_report_cards">;
export type ClassReport = Tables<"class_reports">;

export const PASS_THRESHOLD = 10; // /20 — "a eu la moyenne"
export const EXCELLENT_THRESHOLD = 15; // /20 — 75% du barème

/** Normalise une note sur 20, quel que soit son barème d'origine. */
export const to20 = (value: number, scale: number) => (value / scale) * 20;

/** Moyenne d'une matière pour un élève : moyenne simple de toutes ses notes (composition + évaluations), normalisées sur 20. */
export function subjectAverage(grades: Pick<Grade, "value" | "scale">[]): number | null {
  if (!grades.length) return null;
  const total = grades.reduce((acc, g) => acc + to20(Number(g.value), Number(g.scale)), 0);
  return total / grades.length;
}

/** Moyenne générale d'un élève : moyenne des moyennes de chaque matière (sur 20), sans coefficient. */
export function studentAverage(gradesBySubject: Map<string, Pick<Grade, "value" | "scale">[]>): number | null {
  const averages = [...gradesBySubject.values()].map(subjectAverage).filter((a): a is number => a !== null);
  if (!averages.length) return null;
  return averages.reduce((a, b) => a + b, 0) / averages.length;
}

/** Regroupe les notes d'un élève par matière. */
export function groupGradesBySubject(grades: Grade[], studentId: string): Map<string, Grade[]> {
  const map = new Map<string, Grade[]>();
  for (const g of grades) {
    if (g.student_id !== studentId) continue;
    const list = map.get(g.subject_id) ?? [];
    list.push(g);
    map.set(g.subject_id, list);
  }
  return map;
}

// ============================================================================
// NOTE POUR CLAUDE :
// Section ajoutée pour le système de notes / bulletins. Elle réutilise
// `useRows` (src/lib/data.ts) — même cache, même fonctionnement hors ligne
// que le reste de l'app — et les tables déjà présentes en base
// (class_subjects, grade_periods, grades). Toute moyenne affichée dans
// l'application (fiche élève, résultats de classe, bulletin, rapport) DOIT
// passer par les fonctions de calcul de ce fichier, jamais par un calcul
// local, sous peine d'incohérences.
// ============================================================================

import { useMemo } from "react";
import { useRows } from "@/lib/data";

/** Charge matières, périodes et notes d'une classe (une requête par table, mises en cache). */
export function useClassGrades(classId: string, enabled = true) {
  const subjects = useRows<ClassSubject>("class_subjects", {
    eq: { class_id: classId },
    order: { column: "name" },
    enabled,
  });
  const periods = useRows<GradePeriod>("grade_periods", {
    eq: { class_id: classId },
    order: { column: "period_number" },
    enabled,
  });
  const grades = useRows<Grade>("grades", {
    eq: { class_id: classId },
    order: { column: "created_at" },
    enabled,
  });

  return useMemo(() => {
    const allPeriods = periods.data ?? [];
    // Période active = la dernière ouverte (ended_at null). Les anciennes
    // périodes restent en base et restent consultables dans l'historique.
    const activePeriod = [...allPeriods].reverse().find((p) => p.ended_at === null) ?? null;
    return {
      loading: subjects.isPending || periods.isPending || grades.isPending,
      subjects: subjects.data ?? [],
      periods: allPeriods,
      activePeriod,
      grades: grades.data ?? [],
    };
  }, [subjects.data, subjects.isPending, periods.data, periods.isPending, grades.data, grades.isPending]);
}

/** Charge toutes les notes d'un élève (historique, toutes périodes confondues). */
export function useStudentGrades(studentId: string) {
  const grades = useRows<Grade>("grades", {
    eq: { student_id: studentId },
    order: { column: "created_at", ascending: false },
  });
  return { grades: grades.data ?? [], loading: grades.isPending };
}

export type SubjectStat = { subject: ClassSubject; average: number | null; count: number };

/** Moyenne d'un élève sur une période (moyenne des moyennes par matière). */
export function studentPeriodAverage(grades: Grade[], studentId: string): number | null {
  return studentAverage(groupGradesBySubject(grades, studentId));
}

/** Matières où l'élève n'a pas la moyenne sur la période — « matières à travailler ». */
export function weakSubjectsFor(
  grades: Grade[],
  studentId: string,
  subjects: ClassSubject[],
): { id: string; name: string; average: number }[] {
  const bySubject = groupGradesBySubject(grades, studentId);
  const weak: { id: string; name: string; average: number }[] = [];
  for (const [subjectId, list] of bySubject) {
    const avg = subjectAverage(list);
    if (avg === null || avg >= PASS_THRESHOLD) continue;
    const subject = subjects.find((s) => s.id === subjectId);
    weak.push({ id: subjectId, name: subject?.name ?? "Matière", average: avg });
  }
  return weak.sort((a, b) => a.average - b.average);
}

export type ClassStats = {
  rows: { studentId: string; name: string; average: number | null }[];
  graded: { studentId: string; name: string; average: number }[];
  classAverage: number | null;
  passing: number;
  failing: number;
  passRate: number;
  failRate: number;
  best: { studentId: string; name: string; average: number } | null;
  worst: { studentId: string; name: string; average: number } | null;
  excellent: { studentId: string; name: string; average: number }[];
  struggling: { studentId: string; name: string; average: number }[];
  subjectStats: SubjectStat[];
  bestSubject: SubjectStat | null;
  worstSubject: SubjectStat | null;
};

/**
 * Statistiques d'une classe pour une période donnée. Source unique de vérité
 * pour la page Résultats, le rapport de classe et les bulletins.
 */
export function computeClassStats(
  students: { id: string; first_name: string; last_name: string }[],
  periodGrades: Grade[],
  subjects: ClassSubject[],
): ClassStats {
  const rows = students.map((s) => ({
    studentId: s.id,
    name: `${s.last_name} ${s.first_name}`,
    average: studentPeriodAverage(periodGrades, s.id),
  }));
  const graded = rows
    .filter((r): r is { studentId: string; name: string; average: number } => r.average !== null)
    .sort((a, b) => b.average - a.average);

  const passingList = graded.filter((r) => r.average >= PASS_THRESHOLD);
  const failingList = graded.filter((r) => r.average < PASS_THRESHOLD);

  const subjectStats: SubjectStat[] = subjects.map((subject) => {
    const list = periodGrades.filter((g) => g.subject_id === subject.id);
    // Moyenne de la matière = moyenne des moyennes des élèves dans cette matière.
    const perStudent = [...new Set(list.map((g) => g.student_id))]
      .map((sid) => subjectAverage(list.filter((g) => g.student_id === sid)))
      .filter((a): a is number => a !== null);
    return {
      subject,
      average: perStudent.length ? perStudent.reduce((a, b) => a + b, 0) / perStudent.length : null,
      count: list.length,
    };
  });
  const ranked = subjectStats.filter((s) => s.average !== null).sort((a, b) => b.average! - a.average!);

  return {
    rows,
    graded,
    classAverage: graded.length ? graded.reduce((acc, r) => acc + r.average, 0) / graded.length : null,
    passing: passingList.length,
    failing: failingList.length,
    passRate: graded.length ? (passingList.length / graded.length) * 100 : 0,
    failRate: graded.length ? (failingList.length / graded.length) * 100 : 0,
    best: graded[0] ?? null,
    worst: graded[graded.length - 1] ?? null,
    excellent: graded.filter((r) => r.average >= EXCELLENT_THRESHOLD),
    struggling: failingList,
    subjectStats,
    bestSubject: ranked[0] ?? null,
    worstSubject: ranked[ranked.length - 1] ?? null,
  };
}
