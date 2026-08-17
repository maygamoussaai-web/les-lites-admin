import type { Tables } from "@/integrations/supabase/types";

export type Establishment = Tables<"establishments">;
export type FeePlan = Tables<"fee_plans">;
export type Installment = Tables<"fee_plan_installments">;
export type ClassRow = Tables<"classes">;
export type Student = Tables<"students">;
export type TuitionPayment = Tables<"tuition_payments">;
export type Teacher = Tables<"teachers">;
export type TeacherAssignment = Tables<"teacher_assignments">;
export type TeacherSession = Tables<"teacher_sessions">;
export type TeacherSessionCompletion = Tables<"teacher_session_completions">;
export type TeacherPayment = Tables<"teacher_payments">;

export const WEEKDAYS = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 0, label: "Dimanche" },
] as const;

export const weekdayLabel = (value: number) =>
  WEEKDAYS.find((d) => d.value === value)?.label ?? "—";

export const formatDuration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
};

/** Moyenne annuelle : uniquement si les trois trimestres sont renseignés. */
export function annualAverage(student: Pick<Student, "term1_average" | "term2_average" | "term3_average">) {
  const values = [student.term1_average, student.term2_average, student.term3_average];
  if (values.some((v) => v === null || v === undefined)) return null;
  return (Number(values[0]) + Number(values[1]) + Number(values[2])) / 3;
}

export const sum = (values: (number | null | undefined)[]) =>
  values.reduce<number>((acc, v) => acc + Number(v ?? 0), 0);

/** Scolarité attendue d'un élève = montant total du modèle rattaché à sa classe. */
export function expectedTuition(
  student: Student,
  classes: ClassRow[],
  plans: FeePlan[],
): number {
  const klass = classes.find((c) => c.id === student.class_id);
  if (!klass?.fee_plan_id) return 0;
  return Number(plans.find((p) => p.id === klass.fee_plan_id)?.total_amount ?? 0);
}

export type LateDetail = {
  isLate: boolean;
  /** Montant à régler immédiatement pour être à jour. */
  overdueAmount: number;
  /** Tranches échues non soldées. */
  unpaidInstallments: Installment[];
};

/** Statut de retard d'un élève au regard des tranches échues de son modèle. */
export function lateStatus(
  paid: number,
  installments: Installment[],
  today = new Date(),
): LateDetail {
  const ordered = [...installments].sort(
    (a, b) => a.due_date.localeCompare(b.due_date) || a.position - b.position,
  );
  let cumulative = 0;
  let requiredSoFar = 0;
  const unpaid: Installment[] = [];
  for (const inst of ordered) {
    cumulative += Number(inst.amount);
    const isDue = new Date(inst.due_date + "T23:59:59") < today;
    if (!isDue) continue;
    requiredSoFar = cumulative;
    if (paid < cumulative) unpaid.push(inst);
  }
  const overdue = Math.max(0, requiredSoFar - paid);
  return { isLate: overdue > 0, overdueAmount: overdue, unpaidInstallments: unpaid };
}

/**
 * Minutes cumulées validées pour un ensemble de séances, à partir de l'historique
 * des validations hebdomadaires (chaque semaine cochée compte pour toujours, même
 * si la case se réinitialise visuellement la semaine suivante).
 */
function cumulativeValidatedMinutes(
  sessionIds: Set<string>,
  sessions: TeacherSession[],
  completions: TeacherSessionCompletion[],
) {
  return completions
    .filter((c) => sessionIds.has(c.session_id))
    .reduce((acc, c) => {
      const session = sessions.find((s) => s.id === c.session_id);
      return acc + (session?.duration_minutes ?? 0);
    }, 0);
}

/** Montant dû à un enseignant pour un établissement donné. */
export function teacherDue(
  assignment: TeacherAssignment,
  sessions: TeacherSession[],
  completions: TeacherSessionCompletion[],
) {
  if (assignment.payment_method === "fixed_salary") return Number(assignment.salary_amount ?? 0);
  const sessionIds = new Set(sessions.filter((s) => s.assignment_id === assignment.id).map((s) => s.id));
  const minutes = cumulativeValidatedMinutes(sessionIds, sessions, completions);
  return (minutes / 60) * Number(assignment.hourly_rate ?? 0);
}

export function validatedHours(
  assignmentId: string,
  sessions: TeacherSession[],
  completions: TeacherSessionCompletion[],
) {
  const sessionIds = new Set(sessions.filter((s) => s.assignment_id === assignmentId).map((s) => s.id));
  return cumulativeValidatedMinutes(sessionIds, sessions, completions) / 60;
}

export type Period = "week" | "month" | "year";

export const PERIODS: { value: Period; label: string }[] = [
  { value: "week", label: "Cette semaine" },
  { value: "month", label: "Ce mois" },
  { value: "year", label: "Cette année" },
];

/** Début de période (ISO date) — la semaine démarre le lundi. */
export function periodStart(period: Period, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week") {
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
  } else if (period === "month") {
    d.setDate(1);
  } else {
    d.setMonth(0, 1);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Lundi de la semaine en cours (YYYY-MM-DD) — sert de clé pour les cases à cocher. */
export const currentWeekStart = (now = new Date()) => periodStart("week", now);

export const ESTABLISHMENT_VISUALS: Record<
  string,
  { gradient: string; ring: string; accent: string }
> = {
  universite: {
    gradient: "from-[oklch(0.32_0.15_258)] to-[oklch(0.45_0.16_285)]",
    ring: "oklch(0.55 0.16 275)",
    accent: "text-[oklch(0.75_0.14_275)]",
  },
  lycee: {
    gradient: "from-[oklch(0.30_0.13_215)] to-[oklch(0.46_0.13_195)]",
    ring: "oklch(0.55 0.13 200)",
    accent: "text-[oklch(0.75_0.12_200)]",
  },
  college: {
    gradient: "from-[oklch(0.30_0.11_165)] to-[oklch(0.45_0.13_150)]",
    ring: "oklch(0.55 0.13 155)",
    accent: "text-[oklch(0.75_0.12_155)]",
  },
  fondamentale: {
    gradient: "from-[oklch(0.32_0.12_60)] to-[oklch(0.50_0.15_75)]",
    ring: "oklch(0.62 0.15 75)",
    accent: "text-[oklch(0.80_0.14_80)]",
  },
};