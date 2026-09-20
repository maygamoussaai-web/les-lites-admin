import type { Tables } from "@/integrations/supabase/types";

export type ClassSubject = Tables<"class_subjects">;
export type GradePeriod = Tables<"grade_periods">;
export type Grade = Tables<"grades">;
export type StudentReportCard = Tables<"student_report_cards">;
export type ClassReport = Tables<"class_reports">;

export const PASS_THRESHOLD = 10;
export const EXCELLENT_THRESHOLD = 15;

export const to20 = (value: number, scale: number) => (value / scale) * 20;

export function subjectNotesComplete(
  grades: Pick<Grade, "value" | "scale" | "nature">[],
  required: Array<"evaluation" | "composition"> = ["evaluation", "composition"],
): boolean {
  const present = grades.filter(
    (g) =>
      g.value !== null &&
      g.value !== undefined &&
      Number(g.scale) > 0 &&
      Number.isFinite(Number(g.value)),
  );
  if (!required.length) return present.length > 0;
  return required.every((nature) => present.some((g) => g.nature === nature));
}

export function subjectAverage(
  grades: Pick<Grade, "value" | "scale" | "nature">[],
): number | null {
  const present = grades.filter(
    (g) => g.value !== null && g.value !== undefined && Number(g.scale) > 0 && Number.isFinite(Number(g.value)),
  );
  if (!present.length) return null;
  if (present.length === 1) return to20(Number(present[0]!.value), Number(present[0]!.scale));
  const total = present.reduce((acc, g) => acc + to20(Number(g.value), Number(g.scale)), 0);
  return total / present.length;
}

export function studentAverage(gradesBySubject: Map<string, Pick<Grade, "value" | "scale" | "nature">[]>): number | null {
  const averages = [...gradesBySubject.values()].map(subjectAverage).filter((a): a is number => a !== null);
  if (!averages.length) return null;
  return averages.reduce((a, b) => a + b, 0) / averages.length;
}

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

import { useMemo } from "react";
import { useRows } from "@/lib/data";

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

export type SubjectStat = { subject: ClassSubject; average: number | null; count: number };

export function studentPeriodAverage(grades: Grade[], studentId: string): number | null {
  return studentAverage(groupGradesBySubject(grades, studentId));
}

export function weakSubjectsFor(
  grades: Grade[],
  studentId: string,
  subjects: ClassSubject[],
): { id: string; name: string; average: number }[] {
  const bySubject = groupGradesBySubject(grades, studentId);
  const weak: { id: string; name: string; average: number }[] = [];
  for (const [subjectId, list] of bySubject) {
    if (!subjectNotesComplete(list)) continue;
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
    const perStudent = [...new Set(list.map((g) => g.student_id))]
      .map((sid) => {
        const studentList = list.filter((g) => g.student_id === sid);
        if (!subjectNotesComplete(studentList)) return null;
        return subjectAverage(studentList);
      })
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
