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
const STABLE_STALE_TIME = 5 * 60_000;
// Listes qui bougent un peu plus souvent mais pas a chaque seconde.
const SEMI_STALE_TIME = 2 * 60_000;

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
    order: { column: "position" },
    staleTime: STABLE_STALE_TIME,
  });
  const tuitionPayments = useRows<TuitionPayment>("tuition_payments", {
    order: { column: "paid_at", ascending: false },
  });
  const enrollments = useRows<StudentEnrollment>("student_enrollments", {
    order: { column: "started_at" },
    staleTime: SEMI_STALE_TIME,
  });
  const teachers = useRows<Teacher>("teachers", {
    order: { column: "last_name" },
    staleTime: SEMI_STALE_TIME,
  });
  const assignments = useRows<TeacherAssignment>("teacher_assignments", {
    staleTime: SEMI_STALE_TIME,
  });
  const sessions = useRows<TeacherSession>("teacher_sessions", {
    order: { column: "weekday" },
    staleTime: STABLE_STALE_TIME,
  });
  const sessionCompletions = useRows<TeacherSessionCompletion>("teacher_session_completions", {
    staleTime: SEMI_STALE_TIME,
  });
  const teacherPayments = useRows<TeacherPayment>("teacher_payments", {
    order: { column: "paid_at", ascending: false },
  });

  const loading =
    establishments.isPending ||
    classes.isPending ||
    students.isPending ||
    feePlans.isPending ||
    installments.isPending ||
    tuitionPayments.isPending ||
    enrollments.isPending;

  return useMemo(() => {
    const allStudents = students.data ?? [];
    const allTeachers = teachers.data ?? [];
    const allEnrollments = enrollments.data ?? [];
    const allClasses = classes.data ?? [];

    const activeEnrollmentByStudent = new Map<string, StudentEnrollment>();
    for (const e of allEnrollments) {
      if (e.ended_at === null) activeEnrollmentByStudent.set(e.student_id, e);
    }

    const allTuitionPayments = tuitionPayments.data ?? [];
    const paidByEnrollment = new Map<string, number>();
    for (const p of allTuitionPayments) {
      if (!p.enrollment_id) continue;
      paidByEnrollment.set(p.enrollment_id, (paidByEnrollment.get(p.enrollment_id) ?? 0) + Number(p.amount));
    }

    return {
      loading,
      establishments: establishments.data ?? [],
      classes: allClasses.filter((c) => c.is_active !== false),
      archivedClasses: allClasses.filter((c) => c.is_active === false),
      students: allStudents.filter((s) => !s.archived_at),
      archivedStudents: allStudents.filter((s) => !!s.archived_at),
      feePlans: feePlans.data ?? [],
      installments: installments.data ?? [],
      tuitionPayments: allTuitionPayments,
      enrollments: allEnrollments,
      activeEnrollmentByStudent,
      paidByEnrollment,
      teachers: allTeachers.filter((t) => !t.archived_at),
      assignments: assignments.data ?? [],
      sessions: sessions.data ?? [],
      sessionCompletions: sessionCompletions.data ?? [],
      teacherPayments: teacherPayments.data ?? [],
      studentsById: new Map(allStudents.map((s) => [s.id, s])),
      teachersById: new Map(allTeachers.map((t) => [t.id, t])),
    };
  }, [
    loading,
    establishments.data,
    classes.data,
    students.data,
    feePlans.data,
    installments.data,
    tuitionPayments.data,
    enrollments.data,
    teachers.data,
    assignments.data,
    sessions.data,
    sessionCompletions.data,
    teacherPayments.data,
  ]);
}

export type SchoolData = ReturnType<typeof useSchoolData>;

export type EstablishmentStats = {
  students: number;
  classes: number;
  expected: number;
  collected: number;
  outstanding: number;
  lateStudents: number;
  teachers: number;
  teacherDue: number;
  teacherPaid: number;
};

export function useEstablishmentStats(data: SchoolData, since?: string) {
  return useMemo(() => {
    const map = new Map<string, EstablishmentStats>();
    for (const est of data.establishments) {
      const estClasses = data.classes.filter((c) => c.establishment_id === est.id);
      const estStudents = data.students.filter((s) => s.establishment_id === est.id);
      const payments = data.tuitionPayments.filter(
        (p) => p.establishment_id === est.id && (!since || p.paid_at >= since),
      );
      const collected = sum(payments.map((p) => Number(p.amount)));

      let expected = 0;
      let outstanding = 0;
      let lateStudents = 0;
      for (const student of estStudents) {
        const enrollment = data.activeEnrollmentByStudent.get(student.id);
        if (!enrollment) continue;
        const total = Number(enrollment.total_amount);
        const paidForEnrollment = sum(
          data.tuitionPayments.filter((p) => p.enrollment_id === enrollment.id).map((p) => Number(p.amount)),
        );
        expected += total;
        outstanding += Math.max(0, total - paidForEnrollment);
        const status = lateStatus(
          paidForEnrollment,
          (enrollment.installments_snapshot as unknown as Installment[]) ?? [],
        );
        if (status.isLate) lateStudents += 1;
      }

      const estAssignments = data.assignments.filter(
        (a) => a.establishment_id === est.id && a.is_active && data.teachers.some((t) => t.id === a.teacher_id),
      );
      const dueTeachers = estAssignments.reduce(
        (acc, a) => acc + teacherDue(a, data.sessions, data.sessionCompletions),
        0,
      );
      const paidTeachers = sum(
        data.teacherPayments
          .filter((p) => p.establishment_id === est.id && (!since || p.paid_at >= since))
          .map((p) => Number(p.amount)),
      );

      map.set(est.id, {
        students: estStudents.length,
        classes: estClasses.length,
        expected,
        collected,
        outstanding,
        lateStudents,
        teachers: estAssignments.length,
        teacherDue: dueTeachers,
        teacherPaid: paidTeachers,
      });
    }
    return map;
  }, [data, since]);
}
