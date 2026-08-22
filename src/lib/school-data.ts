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

/**
 * Charge l'ensemble des données visibles par l'utilisateur courant.
 * Les RLS Supabase limitent automatiquement le personnel à son établissement.
 */
export function useSchoolData() {
  const establishments = useRows<Establishment>("establishments", { order: { column: "name" } });
  const classes = useRows<ClassRow>("classes", { order: { column: "name" } });
  const students = useRows<Student>("students", { order: { column: "last_name" } });
  const feePlans = useRows<FeePlan>("fee_plans", { order: { column: "name" } });
  const installments = useRows<Installment>("fee_plan_installments", { order: { column: "position" } });
  const tuitionPayments = useRows<TuitionPayment>("tuition_payments", {
    order: { column: "paid_at", ascending: false },
  });
  const enrollments = useRows<StudentEnrollment>("student_enrollments", { order: { column: "started_at" } });
  const teachers = useRows<Teacher>("teachers", { order: { column: "last_name" } });
  const assignments = useRows<TeacherAssignment>("teacher_assignments");
  const sessions = useRows<TeacherSession>("teacher_sessions", { order: { column: "weekday" } });
  const sessionCompletions = useRows<TeacherSessionCompletion>("teacher_session_completions");
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

  const allStudents = students.data ?? [];
  const allTeachers = teachers.data ?? [];
  const allEnrollments = enrollments.data ?? [];

  const activeEnrollmentByStudent = new Map<string, StudentEnrollment>();
  for (const e of allEnrollments) {
    if (e.ended_at === null) activeEnrollmentByStudent.set(e.student_id, e);
  }

  return {
    loading,
    establishments: establishments.data ?? [],
    classes: classes.data ?? [],
    // Listes actives (archivés exclus) — utilisées pour les cartes, formulaires et pickers.
    students: allStudents.filter((s) => !s.archived_at),
    feePlans: feePlans.data ?? [],
    installments: installments.data ?? [],
    tuitionPayments: tuitionPayments.data ?? [],
    enrollments: allEnrollments,
    activeEnrollmentByStudent,
    teachers: allTeachers.filter((t) => !t.archived_at),
    assignments: assignments.data ?? [],
    sessions: sessions.data ?? [],
    sessionCompletions: sessionCompletions.data ?? [],
    teacherPayments: teacherPayments.data ?? [],
    // Recherches non filtrées — utilisées pour retrouver le NOM dans l'historique
    // (paiements, journal d'audit) même après archivage d'un élève ou d'un enseignant.
    studentsById: new Map(allStudents.map((s) => [s.id, s])),
    teachersById: new Map(allTeachers.map((t) => [t.id, t])),
  };
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
        const status = lateStatus(paidForEnrollment, (enrollment.installments_snapshot as unknown as Installment[]) ?? []);
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