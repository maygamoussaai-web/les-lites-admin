/**
 * Périodes de scolarité — snapshot figé, immunité tarifaire, cycle de vie.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Installment } from "@/lib/school";

export type InstallmentSnapshot = {
  label: string;
  amount: number;
  due_date: string;
  position: number;
};

export function snapshotFromPlan(installments: Installment[]): InstallmentSnapshot[] {
  return [...installments]
    .sort(
      (a, b) =>
        (Number(a.position) || 0) - (Number(b.position) || 0) ||
        String(a.due_date).localeCompare(String(b.due_date)),
    )
    .map((i) => ({
      label: i.label,
      amount: Number(i.amount),
      due_date: i.due_date,
      position: Number(i.position) || 0,
    }));
}

export type StartEnrollmentInput = {
  studentId: string;
  establishmentId: string;
  establishmentName: string;
  classId: string;
  className: string;
  feePlanId: string | null;
  totalAmount: number;
  installments: InstallmentSnapshot[];
};

/** Ouvre une nouvelle période de scolarité (snapshot figé). */
export async function startEnrollmentPeriod(input: StartEnrollmentInput) {
  const { error } = await supabase.from("student_enrollments").insert({
    student_id: input.studentId,
    establishment_id: input.establishmentId,
    class_id: input.classId,
    establishment_name: input.establishmentName,
    class_name: input.className,
    fee_plan_id: input.feePlanId,
    total_amount: input.totalAmount,
    installments_snapshot: input.installments as never,
    started_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Ferme la période active d'un élève (s'il y en a une). */
export async function closeActiveEnrollment(studentId: string) {
  const { error } = await supabase
    .from("student_enrollments")
    .update({ ended_at: new Date().toISOString() })
    .eq("student_id", studentId)
    .is("ended_at", null);
  if (error) throw error;
}

/**
 * Ferme toutes les périodes actives des élèves donnés, puis en ouvre de nouvelles
 * sur la même classe avec le modèle de scolarité actuel (renouvellement d'année).
 */
export async function renewEnrollmentsForClass(opts: {
  studentIds: string[];
  establishmentId: string;
  establishmentName: string;
  classId: string;
  className: string;
  feePlanId: string | null;
  totalAmount: number;
  installments: InstallmentSnapshot[];
}) {
  if (!opts.studentIds.length) return;

  const { error: closeErr } = await supabase
    .from("student_enrollments")
    .update({ ended_at: new Date().toISOString() })
    .in("student_id", opts.studentIds)
    .is("ended_at", null);
  if (closeErr) throw closeErr;

  const rows = opts.studentIds.map((studentId) => ({
    student_id: studentId,
    establishment_id: opts.establishmentId,
    class_id: opts.classId,
    establishment_name: opts.establishmentName,
    class_name: opts.className,
    fee_plan_id: opts.feePlanId,
    total_amount: opts.totalAmount,
    installments_snapshot: opts.installments as never,
    started_at: new Date().toISOString(),
  }));

  const { error: openErr } = await supabase.from("student_enrollments").insert(rows);
  if (openErr) throw openErr;
}
