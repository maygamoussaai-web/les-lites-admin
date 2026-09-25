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
  const tuitionPayments = useRows<TuitionPayment>("tuition_payments", {
    order: { column: "paid_at", ascending: false },
    staleTime: SEMI_STALE_TIME,
  });
  const enrollments = useRows<StudentEnrollment>("student_enrollments", {
    order: { column: "created_at", ascending: false },
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
  const sessionCompletions = useRows<TeacherSessionCompletion>("teacher_session_completions", {
    order: { column: "created_at", ascending: false },
    staleTime: SEMI_STALE_TIME,
  });
  const teacherPayments = useRows<TeacherPayment>("teacher_payments", {
    order: { column: "paid_at", ascending: false },
    staleTime: SEMI_STALE_TIME,
  });

  const isPending =
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

    const data = {
      establishments: establishments.data ?? [],
      classes: allClasses,
      students: allStudents,
      feePlans: feePlans.data ?? [],
      installments: installments.data ?? [],
      tuitionPayments: allTuitionPayments,
      enrollments: allEnrollments,
      teachers: allTeachers,
      assignments: assignments.data ?? [],
      sessions: sessions.data ?? [],
      sessionCompletions: sessionCompletions.data ?? [],
      teacherPayments: teacherPayments.data ?? [],
      activeEnrollmentByStudent,
      paidByEnrollment,
      isPending,
    };

    // Stats par établissement (tableau de bord)
    const byEstablishment = (data.establishments as Establishment[]).map((est) => {
      const estStudents = allStudents.filter((s) => s.establishment_id === est.id && !s.archived_at);
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
          .filter((p) => p.establishment_id === est.id)
          .map((p) => Number(p.amount)),
      );

      return {
        establishment: est,
        studentCount: estStudents.length,
        classCount: allClasses.filter((c) => c.establishment_id === est.id).length,
        expectedTuition: expected,
        outstandingTuition: outstanding,
        lateStudents,
        teacherDue: Math.max(0, dueTeachers - paidTeachers),
      };
    });

    return { ...data, byEstablishment };
  }, [
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
    isPending,
  ]);
}
