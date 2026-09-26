/**
 * Règles de fin / début de période scolaire (notes / bulletins).
 *
 * Fin de période :
 * 1. Bouton « Nouvelle période » (clôture + ouvre la suivante)
 * 2. Génération complète des bulletins (tous les élèves avec notes → bibliothèque)
 *    → clôture uniquement ; la période suivante s'ouvre à la 1ʳᵉ note
 * 3. Actions classe (renouveler / supprimer) — avec rappel si notes sans bulletins
 *
 * Début de période :
 * - Première note saisie alors qu'aucune période n'est ouverte
 * - Bouton « Nouvelle période »
 * - Renouvellement de classe
 *
 * Les moyennes officielles restent celles du modèle Excel.
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
 * Garantit une période ouverte pour saisir des notes.
 * Si aucune n'est ouverte, en crée une (n° = max+1, ou 1).
 */
export async function ensureOpenPeriod(
  classId: string,
  establishmentId: string,
): Promise<GradePeriod> {
  const { data: open } = await supabase
    .from("grade_periods")
    .select("*")
    .eq("class_id", classId)
    .is("ended_at", null)
    .limit(1);
  if (open?.[0]) return open[0] as GradePeriod;

  const { data: all } = await supabase
    .from("grade_periods")
    .select("period_number")
    .eq("class_id", classId);
  const maxN = (all ?? []).reduce((m, p) => Math.max(m, Number(p.period_number) || 0), 0);
  const nextNumber = maxN + 1;

  const { data: created, error } = await supabase
    .from("grade_periods")
    .insert({
      class_id: classId,
      establishment_id: establishmentId,
      period_number: nextNumber,
    })
    .select("*")
    .single();
  if (error || !created) throw error ?? new Error("Création de période impossible");
  return created as GradePeriod;
}

/**
 * Clôture la période ouverte et en ouvre une nouvelle
 * (bouton « Nouvelle période », renouvellement de classe).
 */
export async function closeAndStartNextPeriod(
  classId: string,
  establishmentId: string,
): Promise<{ closedPeriodNumber: number | null; newPeriodNumber: number }> {
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
