import { useMemo } from "react";
import { useRows } from "@/lib/data";
import {
  expectedTuition,
  lateStatus,
  teacherDue,
  sum,
  type ClassRow,
  type Establishment,
  type FeePlan,
  type Installment,
  type Student,
  type Teacher,
  type TeacherAssignment,
  type TeacherPayment,
  type TeacherSession,
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
  const teachers = useRows<Teacher>("teachers", { order: { column: "last_name" } });
  const assignments = useRows<TeacherAssignment>("teacher_assignments");
  const sessions = useRows<TeacherSession>("teacher_sessions", { order: { column: "weekday" } });
  const teacherPayments = useRows<TeacherPayment>("teacher_payments", {
    order: { column: "paid_at", ascending: false },
  });

  const loading =
    establishments.isLoading ||
    classes.isLoading ||
    students.isLoading ||
    feePlans.isLoading ||
    installments.isLoading ||
    tuitionPayments.isLoading;

  const allStudents = students.data ?? [];
  const allTeachers = teachers.data ?? [];

  return {
    loading,
    establishments: establishments.data ?? [],
    classes: classes.data ?? [],
    // Listes actives (archivés exclus) — utilisées pour les cartes, formulaires et pickers.
    students: allStudents.filter((s) => !s.archived_at),
    feePlans: feePlans.data ?? [],
    installments: installments.data ?? [],
    tuitionPayments: tuitionPayments.data ?? [],
    teachers: allTeachers.filter((t) => !t.archived_at),
    assignments: assignments.data ?? [],
    sessions: sessions.data ?? [],
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
      let lateStudents = 0;
      for (const student of estStudents) {
        const due = expectedTuition(student, data.classes, data.feePlans);
        expected += due;
        const klass = data.classes.find((c) => c.id === student.class_id);
        const planInstallments = data.installments.filter((i) => i.fee_plan_id === klass?.fee_plan_id);
        const paid = sum(
          data.tuitionPayments.filter((p) => p.student_id === student.id).map((p) => Number(p.amount)),
        );
        if (planInstallments.length && lateStatus(paid, planInstallments).isLate) lateStudents += 1;
      }
      const estAssignments = data.assignments.filter(
        (a) => a.establishment_id === est.id && a.is_active && data.teachers.some((t) => t.id === a.teacher_id),
      );
      const dueTeachers = estAssignments.reduce((acc, a) => acc + teacherDue(a, data.sessions), 0);
      const paidTeachers = sum(
        data.teacherPayments
          .filter((p) => p.establishment_id === est.id && (!since || p.paid_at >= since))
          .map((p) => Number(p.amount)),
      );
      const allCollected = sum(
        data.tuitionPayments.filter((p) => p.establishment_id === est.id).map((p) => Number(p.amount)),
      );

      map.set(est.id, {
        students: estStudents.length,
        classes: estClasses.length,
        expected,
        collected,
        outstanding: Math.max(0, expected - allCollected),
        lateStudents,
        teachers: estAssignments.length,
        teacherDue: dueTeachers,
        teacherPaid: paidTeachers,
      });
    }
    return map;
  }, [data, since]);
}