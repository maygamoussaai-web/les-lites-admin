import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type TableName = keyof Database["public"]["Tables"];

type ListOptions = {
  select?: string;
  order?: { column: string; ascending?: boolean };
  eq?: Record<string, string | number | boolean | null | undefined>;
  enabled?: boolean;
  limit?: number;
};

export function useRows<T = any>(table: TableName, options: ListOptions = {}) {
  const { select = "*", order, eq, enabled = true, limit } = options;
  return useQuery({
    queryKey: [table, select, order, eq, limit],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase.from(table).select(select);
      if (eq) {
        for (const [k, v] of Object.entries(eq)) {
          if (v === undefined || v === null || v === "") continue;
          q = q.eq(k, v as never);
        }
      }
      if (order) q = q.order(order.column, { ascending: order.ascending ?? true });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
}

async function writeAudit(action: string, table: TableName, entityId?: string | null, metadata: Record<string, unknown> = {}) {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    await supabase.from("audit_logs").insert({
      actor_id: data.user.id,
      action,
      entity_type: table,
      entity_id: entityId ?? null,
      metadata: metadata as never,
    });
  } catch {
    /* audit ne doit jamais bloquer l'opération */
  }
}

export function useSaveRow(table: TableName, label = "Enregistrement") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string | null | undefined; values: Record<string, unknown> }) => {
      if (id) {
        const { data, error } = await supabase.from(table).update(values as never).eq("id", id).select().maybeSingle();
        if (error) throw error;
        await writeAudit("update", table, id, values);
        return data;
      }
      const { data, error } = await supabase.from(table).insert(values as never).select().maybeSingle();
      if (error) throw error;
      await writeAudit("create", table, (data as { id?: string } | null)?.id, values);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [table] });
      toast.success(`${label} enregistré`);
    },
    onError: (error: Error) => toast.error(error.message || "Échec de l'enregistrement"),
  });
}

export function useDeleteRow(table: TableName, label = "Élément") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
      await writeAudit("delete", table, id);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [table] });
      toast.success(`${label} supprimé`);
    },
    onError: (error: Error) => toast.error(error.message || "Suppression impossible"),
  });
/**
 * Archive une ligne (soft-delete) au lieu de la supprimer définitivement.
 * Utilisé pour students et teachers : ils disparaissent des listes actives
 * mais restent en base pour l'historique (transferts, paiements, audit).
 */
export function useArchiveRow(table: TableName, label = "Élément") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from(table)
        .update({ archived_at: new Date().toISOString() } as never)
        .eq("id", id);
      if (error) throw error;
      await writeAudit("archive", table, id);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [table] });
      toast.success(`${label} archivé`);
    },
    onError: (error: Error) => toast.error(error.message || "Archivage impossible"),
  });
}
}
