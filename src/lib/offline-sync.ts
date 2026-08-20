import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { writeAudit } from "@/lib/audit";
import { loadQueue, removeFromQueue, markError, type QueueEntry } from "@/lib/offline-queue";

let syncing = false;

async function runEntry(entry: QueueEntry) {
  if (entry.op === "insert") {
    const { error } = await supabase
      .from(entry.table)
      .upsert({ id: entry.rowId, ...entry.values } as never, { onConflict: "id" });
    if (error) throw error;
    void writeAudit("create", entry.table, entry.rowId, entry.values);
  } else if (entry.op === "update") {
    const { error } = await supabase.from(entry.table).update(entry.values as never).eq("id", entry.rowId);
    if (error) throw error;
    void writeAudit("update", entry.table, entry.rowId, entry.values);
  } else if (entry.op === "archive") {
    const { error } = await supabase
      .from(entry.table)
      .update({ archived_at: new Date().toISOString() } as never)
      .eq("id", entry.rowId);
    if (error) throw error;
    void writeAudit("archive", entry.table, entry.rowId);
  } else if (entry.op === "delete") {
    const { error } = await supabase.from(entry.table).delete().eq("id", entry.rowId);
    if (error) throw error;
    void writeAudit("delete", entry.table, entry.rowId);
  }
}

/**
 * Traite la file d'attente dans l'ordre. S'arrête à la première vraie erreur
 * (pas une erreur réseau — dans ce cas on n'aurait même pas commencé) pour ne
 * jamais désynchroniser l'ordre entre actions liées (ex: un prof créé avant
 * son affectation).
 */
export async function flushQueue(qc: QueryClient) {
  if (syncing) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  syncing = true;
  const touchedTables = new Set<string>();
  try {
    for (const entry of loadQueue()) {
      try {
        await runEntry(entry);
        touchedTables.add(entry.table);
        removeFromQueue(entry.id);
      } catch (e) {
        markError(entry.id, (e as Error).message || "Échec de synchronisation");
        break;
      }
    }
  } finally {
    syncing = false;
    for (const table of touchedTables) qc.invalidateQueries({ queryKey: [table] });
  }
}