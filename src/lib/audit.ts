import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type TableName = keyof Database["public"]["Tables"];

/**
 * Écrit une entrée d'audit sans jamais bloquer l'opération appelante.
 * Isolé dans son propre fichier (plutôt que dans data.ts) pour éviter toute
 * dépendance circulaire avec le moteur de synchronisation hors ligne.
 */
export async function writeAudit(
  action: string,
  table: TableName,
  entityId?: string | null,
  metadata: Record<string, unknown> = {},
) {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    await supabase.from("audit_logs").insert({
      actor_id: userId,
      action,
      entity_type: table,
      entity_id: entityId ?? null,
      metadata: metadata as never,
    });
  } catch {
    /* audit ne doit jamais bloquer l'opération */
  }
}