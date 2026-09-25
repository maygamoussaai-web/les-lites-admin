import { useMemo } from "react";
import { useRows } from "@/lib/data";
import {
  lateStatus,
  teacherDue,
  sum,
  type ClassRow,
  type Establishment,
  type FeePlan,
  type Installment,
  type Student,
  type StudentEnrollment,
  type Teacher,
  type TeacherAssignment,
  type TeacherPayment,
  type TeacherSession,
  type TeacherSessionCompletion,
  type TuitionPayment,
} from "@/lib/school";

// Structure stable : moins de refetch, UI plus fluide (surtout mobile).
const STABLE_STALE_TIME = 2 * 60_000;
// Listes qui bougent un peu plus souvent mais pas a chaque seconde.
const SEMI_STALE_TIME = 45_000;

/**
 * Charge l'ensemble des donnees visibles par l'utilisateur courant.
 * RLS Supabase limite le personnel a son etablissement.
 */
export function useSchoolData() {
  const establishments = useRows<Establishment>("establishments", {
    order: { column: "name" },
    staleTime: STABLE_STALE_TIME,
  });
  const classes = useRows<ClassRow>("classes", {
    order: { column: "name" },
    staleTime: STABLE_STALE_TIME,
  });
  const students = useRows<Student>("students", {
    order: { column: "last_name" },
    staleTime: SEMI_STALE_TIME,
  });
  const feePlans = useRows<FeePlan>("fee_plans", {
    order: { column: "name" },
    staleTime: STABLE_STALE_TIME,
  });
  const installments = useRows<Installment>("fee_plan_installments", {
    order: { column: "due_date" },
    staleTime: STABLE_STALE_TIME,
  });
  const enrollments = useRows<StudentEnrollment>("student_enrollments", {
    order: { column: "created_at", ascending: false },
    staleTime: SEMI_STALE_TIME,
  });
  const tuitionPayments = useRows<TuitionPayment>("tuition_payments", {
    order: { column: "paid_at", ascending: false },
    staleTime: SEMI_STALE_TIME,
  });
  const teachers = useRows<Teacher>("teachers", {
    order: { column: "last_name" },
    staleTime: STABLE_STALE_TIME,
  });
  const assignments = useRows<TeacherAssignment>("teacher_assignments", {
    order: { column: "created_at", ascending: false },
    staleTime: SEMI_STALE_TIME,
  });
  const sessions = useRows<TeacherSession>("teacher_sessions", {
    order: { column: "session_date", ascending: false },
    staleTime: SEMI_STALE_TIME,
  });
  const completions = useRows<TeacherSessionCompletion>("teacher_session_completions", {
    order: { column: "created_at", ascending: false },
    staleTime: SEMI_STALE_TIME,
  });
  const teacherPayments = useRows<TeacherPayment>("teacher_payments", {
    order: { column: "paid_at", ascending: false },
    staleTime: SEMI_STALE_TIME,
  });

  const loading =
    establishments.isLoading ||
    classes.isLoading ||
    students.isLoading ||
    feePlans.isLoading ||
    installments.isLoading ||
    enrollments.isLoading ||
    tuitionPayments.isLoading ||
    teachers.isLoading ||
    assignments.isLoading ||
    sessions.isLoading ||
    completions.isLoading ||
    teacherPayments.isLoading;

  const stats = useMemo(() => {
    const st = students.data ?? [];
    const cl = classes.data ?? [];
    const en = enrollments.data ?? [];
    const tp = tuitionPayments.data ?? [];
    const te = teachers.data ?? [];
    return {
      studentCount: st.length,
      classCount: cl.length,
      teacherCount: te.length,
      enrollmentCount: en.length,
      tuitionCollected: sum(tp.map((p) => Number(p.amount) || 0)),
      lateStudents: st.filter((s) => lateStatus(s, en, installments.data ?? [], tp)).length,
      teacherDueTotal: sum(te.map((t) => teacherDue(t, assignments.data ?? [], sessions.data ?? [], completions.data ?? [], teacherPayments.data ?? []))),
    };
  }, [
    students.data,
    classes.data,
    enrollments.data,
    tuitionPayments.data,
    teachers.data,
    assignments.data,
    sessions.data,
    completions.data,
    teacherPayments.data,
    installments.data,
  ]);

  return {
    loading,
    establishments: establishments.data ?? [],
    classes: classes.data ?? [],
    students: students.data ?? [],
    feePlans: feePlans.data ?? [],
    installments: installments.data ?? [],
    enrollments: enrollments.data ?? [],
    tuitionPayments: tuitionPayments.data ?? [],
    teachers: teachers.data ?? [],
    assignments: assignments.data ?? [],
    sessions: sessions.data ?? [],
    completions: completions.data ?? [],
    teacherPayments: teacherPayments.data ?? [],
    stats,
    refetchAll: () => {
      void establishments.refetch();
      void classes.refetch();
      void students.refetch();
      void feePlans.refetch();
      void installments.refetch();
      void enrollments.refetch();
      void tuitionPayments.refetch();
      void teachers.refetch();
      void assignments.refetch();
      void sessions.refetch();
      void completions.refetch();
      void teacherPayments.refetch();
    },
  };
}
