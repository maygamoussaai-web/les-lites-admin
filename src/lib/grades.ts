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
