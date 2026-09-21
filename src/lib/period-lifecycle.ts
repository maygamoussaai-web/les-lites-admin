/**
 * Règles de fin / début de période scolaire.
 *
 * Fin de période uniquement via :
 * 1. Bouton « Nouvelle période »
 * 2. Génération complète des bulletins (tous les élèves avec notes)
 * 3. Actions classe (renouveler / supprimer) — avec rappel si notes sans bulletins
 * 4. Transfert d'élève (période élève = celle de la nouvelle classe)
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
    (cards ?? [])
      .filter((c) => c.document_id)
      .map((c) => c.student_id),
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

/** Clôture la période ouverte et en ouvre une nouvelle. */
export async function closeAndStartNextPeriod(
  classId: string,
  establishmentId: string,
): Promise<{ closedPeriodNumber: number | null; newPeriodNumber: number }> {
  const { data: open } = await supabase
    .from("grade_periods")
    .select("*")
    .eq("class_id", classId)
    .is("ended_at", null)
    .limit(1);
  const current = open?.[0] as GradePeriod | undefined;

  if (current) {
    const { error } = await supabase
      .from("grade_periods")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", current.id);
    if (error) throw error;
  }

  const { data: all } = await supabase
    .from("grade_periods")
    .select("period_number")
    .eq("class_id", classId);
  const maxN = (all ?? []).reduce((m, p) => Math.max(m, p.period_number), 0);
  const nextNumber = maxN + 1;

  const { error: insErr } = await supabase.from("grade_periods").insert({
    class_id: classId,
    establishment_id: establishmentId,
    period_number: nextNumber,
  });
  if (insErr) throw insErr;

  return {
    closedPeriodNumber: current?.period_number ?? null,
    newPeriodNumber: nextNumber,
  };
}
