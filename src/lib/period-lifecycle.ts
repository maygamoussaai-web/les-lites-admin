/**
 * Règles de fin / début de période et d'année scolaire (notes / bulletins).
 *
 * PÉRIODE :
 * - Ouverture UNIQUEMENT via le bouton « Nouvelle période » (pas à la 1ʳᵉ note).
 * - Clôture dès qu'UN bulletin périodique d'un élève de la classe est généré
 *   et classé en bibliothèque (document_id renseigné).
 * - Période clôturée → plus d'action sur les notes ; régénération bulletins OK ;
 *   « Nouvelle période » reste disponible.
 *
 * ANNÉE :
 * - Clôturée dès qu'UN bulletin annuel d'un élève de la classe est classé
 *   en bibliothèque → plus de notes ni de nouvelles périodes.
 *
 * Une période sans aucune note n'entre pas dans les calculs live ni dans l'annuel.
 */
import { supabase } from "@/integrations/supabase/client";
import type { GradePeriod } from "@/lib/grades";

export type PeriodCloseCheck = {
  hasOpenPeriod: boolean;
  period: GradePeriod | null;
  notesCount: number;
  bulletinsCount: number;
  studentsWithNotes: number;
  studentsWithBulletins: number;
  missingBulletins: boolean;
};

/** Vérifie notes vs bulletins pour la période ouverte d'une classe. */
export async function checkOpenPeriodBulletins(classId: string): Promise<PeriodCloseCheck> {
  const { data: periods } = await supabase
    .from("grade_periods")
    .select("*")
    .eq("class_id", classId)
    .is("ended_at", null)
    .limit(1);
  const period = (periods?.[0] as GradePeriod | undefined) ?? null;
  if (!period) {
    return {
      hasOpenPeriod: false,
      period: null,
      notesCount: 0,
      bulletinsCount: 0,
      studentsWithNotes: 0,
      studentsWithBulletins: 0,
      missingBulletins: false,
    };
  }

  const { data: grades } = await supabase
    .from("grades")
    .select("student_id")
    .eq("period_id", period.id);
  const withNotes = new Set((grades ?? []).map((g) => g.student_id));

  const { data: cards } = await supabase
    .from("student_report_cards")
    .select("student_id, document_id")
    .eq("period_id", period.id);
  const withBulletins = new Set(
    (cards ?? []).filter((c) => c.document_id).map((c) => c.student_id),
  );

  const studentsWithNotes = withNotes.size;
  let studentsWithBulletins = 0;
  for (const id of withNotes) {
    if (withBulletins.has(id)) studentsWithBulletins++;
  }

  return {
    hasOpenPeriod: true,
    period,
    notesCount: (grades ?? []).length,
    bulletinsCount: withBulletins.size,
    studentsWithNotes,
    studentsWithBulletins,
    missingBulletins: studentsWithNotes > 0 && studentsWithBulletins < studentsWithNotes,
  };
}

/** Clôture la période ouverte sans en ouvrir une nouvelle. */
export async function closeOpenPeriodOnly(
  classId: string,
): Promise<{ closedPeriodNumber: number | null }> {
  const { data: open } = await supabase
    .from("grade_periods")
    .select("*")
    .eq("class_id", classId)
    .is("ended_at", null)
    .limit(1);
  const current = open?.[0] as GradePeriod | undefined;
  if (!current) return { closedPeriodNumber: null };

  const { error } = await supabase
    .from("grade_periods")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", current.id);
  if (error) throw error;

  return { closedPeriodNumber: current.period_number ?? null };
}

/**
 * Clôture la période ouverte dès qu'au moins un bulletin périodique
 * a été classé (appelé après génération réussie d'un bulletin).
 * No-op si déjà clôturée.
 */
export async function closePeriodAfterFirstBulletin(
  classId: string,
): Promise<{ closedPeriodNumber: number | null; alreadyClosed: boolean }> {
  const { data: open } = await supabase
    .from("grade_periods")
    .select("*")
    .eq("class_id", classId)
    .is("ended_at", null)
    .limit(1);
  if (!open?.[0]) return { closedPeriodNumber: null, alreadyClosed: true };
  const closed = await closeOpenPeriodOnly(classId);
  return { closedPeriodNumber: closed.closedPeriodNumber, alreadyClosed: false };
}

/**
 * Retourne la période ouverte si elle existe.
 * Ne crée JAMAIS de période (contrairement à l'ancienne règle « 1ʳᵉ note »).
 */
export async function requireOpenPeriod(classId: string): Promise<GradePeriod | null> {
  const { data: open } = await supabase
    .from("grade_periods")
    .select("*")
    .eq("class_id", classId)
    .is("ended_at", null)
    .limit(1);
  return (open?.[0] as GradePeriod | undefined) ?? null;
}

/**
 * @deprecated Utiliser requireOpenPeriod. Ne crée plus de période automatiquement.
 * Conservé pour compatibilité : retourne l'ouverte ou lève une erreur explicite.
 */
export async function ensureOpenPeriod(
  classId: string,
  _establishmentId: string,
): Promise<GradePeriod> {
  const open = await requireOpenPeriod(classId);
  if (open) return open;
  throw new Error(
    "Aucune période ouverte. Utilisez le bouton « Nouvelle période » sur la fiche classe.",
  );
}

/**
 * Clôture la période ouverte et en ouvre une nouvelle
 * (bouton « Nouvelle période » uniquement — et renouvellement de classe).
 * Interdit si l'année est clôturée (bulletin annuel classé).
 */
export async function closeAndStartNextPeriod(
  classId: string,
  establishmentId: string,
): Promise<{ closedPeriodNumber: number | null; newPeriodNumber: number }> {
  if (await isYearClosedForClass(classId)) {
    throw new Error(
      "Année clôturée (un bulletin annuel a été classé). Impossible d'ouvrir une nouvelle période.",
    );
  }

  const closed = await closeOpenPeriodOnly(classId);

  const { data: all } = await supabase
    .from("grade_periods")
    .select("period_number")
    .eq("class_id", classId);
  const maxN = (all ?? []).reduce((m, p) => Math.max(m, Number(p.period_number) || 0), 0);
  const nextNumber = maxN + 1;

  const { error: insErr } = await supabase.from("grade_periods").insert({
    class_id: classId,
    establishment_id: establishmentId,
    period_number: nextNumber,
  });
  if (insErr) throw insErr;

  return {
    closedPeriodNumber: closed.closedPeriodNumber,
    newPeriodNumber: nextNumber,
  };
}

/**
 * Année clôturée = au moins un document « Bulletin annuel » classé
 * pour un élève (encore) rattaché à cette classe.
 */
export async function isYearClosedForClass(classId: string): Promise<boolean> {
  const { data: students } = await supabase
    .from("students")
    .select("id")
    .eq("class_id", classId)
    .is("archived_at", null);
  const ids = (students ?? []).map((s) => s.id);
  if (!ids.length) return false;

  const { data: docs } = await supabase
    .from("student_documents")
    .select("id")
    .in("student_id", ids)
    .ilike("name", "Bulletin annuel%")
    .limit(1);

  return (docs ?? []).length > 0;
}

/**
 * Périodes qui ont au moins une note (les périodes vides n'influencent
 * ni l'annuel ni les stats live).
 */
export async function periodsWithGrades(classId: string): Promise<GradePeriod[]> {
  const { data: periods } = await supabase
    .from("grade_periods")
    .select("*")
    .eq("class_id", classId)
    .order("period_number");
  if (!periods?.length) return [];

  const { data: gradeRows } = await supabase
    .from("grades")
    .select("period_id")
    .eq("class_id", classId);
  const withNotes = new Set((gradeRows ?? []).map((g) => g.period_id));
  return (periods as GradePeriod[]).filter((p) => withNotes.has(p.id));
}

/**
 * Tous les élèves actifs de la classe ont un bulletin classé pour cette période.
 */
export async function allStudentsHavePeriodBulletin(
  classId: string,
  periodId: string,
  studentIds: string[],
): Promise<boolean> {
  if (!studentIds.length) return false;
  const { data: cards } = await supabase
    .from("student_report_cards")
    .select("student_id, document_id")
    .eq("class_id", classId)
    .eq("period_id", periodId)
    .not("document_id", "is", null);
  const done = new Set((cards ?? []).map((c) => c.student_id));
  return studentIds.every((id) => done.has(id));
}

/**
 * Tous les élèves actifs ont un bulletin annuel classé.
 */
export async function allStudentsHaveAnnualBulletin(
  classId: string,
  studentIds: string[],
): Promise<boolean> {
  if (!studentIds.length) return false;
  const { data: docs } = await supabase
    .from("student_documents")
    .select("student_id")
    .in("student_id", studentIds)
    .ilike("name", "Bulletin annuel%");
  const done = new Set((docs ?? []).map((d) => d.student_id));
  return studentIds.every((id) => done.has(id));
}
