/**
 * Notes & périodes — utilitaires de données uniquement.
 *
 * RÈGLE MÉTIER (ne pas violer) :
 * - Aucune moyenne matière / générale / classe n'est inventée ici.
 * - Les moyennes officielles viennent UNIQUEMENT des formules du modèle Excel
 *   (voir src/lib/model-averages.ts + xlsx-writeback.ts).
 * - Exception autorisée : si plusieurs notes d'évaluation existent pour une
 *   même matière, on en fait la moyenne arithmétique simple pour l'affichage
 *   dans l'app (evaluationColumnAverage). Rien d'autre.
 */
import { useMemo } from "react";
import { useRows } from "@/lib/data";
import type { Tables } from "@/integrations/supabase/types";

export type ClassSubject = Tables<"class_subjects">;
export type GradePeriod = Tables<"grade_periods">;
export type Grade = Tables<"grades">;
export type StudentReportCard = Tables<"student_report_cards">;
export type ClassReport = Tables<"class_reports">;

/** Seuil de réussite affiché dans l'UI (ne calcule pas de moyenne). */
export const PASS_THRESHOLD = 10;
/** Seuil d'excellence affiché dans l'UI. */
export const EXCELLENT_THRESHOLD = 15;

/** Convertit une note brute vers /20 pour affichage ou envoi au modèle. */
export const to20 = (value: number, scale: number) =>
  scale > 0 ? (value / scale) * 20 : value;

/**
 * Moyenne des notes d'évaluation d'une matière uniquement.
 * Exception autorisée : plusieurs notes de classe / évaluation → moyenne simple.
 * Ne combine jamais avec la composition et n'invente pas de moyenne matière.
 */
export function evaluationColumnAverage(
  grades: Pick<Grade, "value" | "scale" | "nature">[],
): number | null {
  const evals = grades.filter(
    (g) =>
      g.nature === "evaluation" &&
      g.value !== null &&
      g.value !== undefined &&
      Number(g.scale) > 0 &&
      Number.isFinite(Number(g.value)),
  );
  if (!evals.length) return null;
  const total = evals.reduce((acc, g) => acc + to20(Number(g.value), Number(g.scale)), 0);
  return total / evals.length;
}

/** Groupe les notes d'un élève par matière. */
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

/** Charge matières, périodes et notes d'une classe. */
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

export function useStudentGrades(studentId: string) {
  const grades = useRows<Grade>("grades", {
    eq: { student_id: studentId },
    order: { column: "created_at", ascending: false },
  });
  return { grades: grades.data ?? [], loading: grades.isPending };
}

/** @deprecated Compat — préfère evaluationColumnAverage. Ne combine pas avec composition. */
export function subjectAverage(
  grades: Pick<Grade, "value" | "scale" | "nature">[],
): number | null {
  return evaluationColumnAverage(grades);
}

/** @deprecated Compat — les moyennes générales viennent du modèle / bulletins. */
export function studentAverage(
  _gradesBySubject: Map<string, Pick<Grade, "value" | "scale" | "nature">[]>,
): number | null {
  return null;
}

/** @deprecated Compat */
export function studentPeriodAverage(_grades: Grade[], _studentId: string): number | null {
  return null;
}

/** @deprecated Compat */
export function weakSubjectsFor(
  _grades: Grade[],
  _studentId: string,
  _subjects: ClassSubject[],
): { id: string; name: string; average: number }[] {
  return [];
}

/** @deprecated Compat — stats classe via bulletins / model-averages uniquement. */
export function computeClassStats(
  students: { id: string; first_name: string; last_name: string }[],
  _periodGrades: Grade[],
  _subjects: ClassSubject[],
): {
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
  subjectStats: { subject: ClassSubject; average: number | null; count: number }[];
  bestSubject: { subject: ClassSubject; average: number | null; count: number } | null;
  worstSubject: { subject: ClassSubject; average: number | null; count: number } | null;
} {
  const rows = students.map((s) => ({
    studentId: s.id,
    name: `${s.last_name} ${s.first_name}`,
    average: null as number | null,
  }));
  return {
    rows,
    graded: [],
    classAverage: null,
    passing: 0,
    failing: 0,
    passRate: 0,
    failRate: 0,
    best: null,
    worst: null,
    excellent: [],
    struggling: [],
    subjectStats: [],
    bestSubject: null,
    worstSubject: null,
  };
}
