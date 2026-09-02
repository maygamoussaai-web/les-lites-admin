import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { enqueue } from "@/lib/offline-queue";
import { flushQueue } from "@/lib/offline-sync";
import { describeError } from "@/lib/errors";
import type { TableName } from "@/lib/audit";

export type { TableName };
export { writeAudit } from "@/lib/audit";

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
    // Fluidité : garde l'ancienne page de données visible pendant qu'une
    // nouvelle requête (changement de filtre, etc.) est en cours, plutôt que
    // de vider l'écran — et partage la structure des objets inchangés entre
    // deux résultats pour éviter des re-rendus inutiles dans toute l'app.
    structuralSharing: true,
    placeholderData: keepPreviousData,
    refetchOnMount: false,
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

function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine;
}

/** Applique un changement immédiatement à toutes les listes déjà en cache pour cette table. */
function applyOptimistic(qc: QueryClient, table: TableName, updater: (rows: any[]) => any[]) {
  const queries = qc.getQueryCache().findAll({ queryKey: [table] });
  for (const query of queries) {
    const old = query.state.data;
    if (Array.isArray(old)) {
      qc.setQueryData(query.queryKey, updater(old));
    }
  }
}

export function useSaveRow(table: TableName, label = "Enregistrement") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string | null; values: Record<string, unknown> }) => {
      const rowId = id ?? crypto.randomUUID();
      const op: "insert" | "update" = id ? "update" : "insert";

      applyOptimistic(qc, table, (rows) =>
        op === "update"
          ? rows.map((r) => (r.id === rowId ? { ...r, ...values } : r))
          : [...rows, { id: rowId, ...values }],
      );

      enqueue({ id: crypto.randomUUID(), table, op, rowId, values, createdAt: Date.now(), label });

      if (isOnline()) await flushQueue(qc);
      return { id: rowId, ...values };
    },
    onSuccess: () => {
      toast.success(isOnline() ? `${label} enregistré` : `${label} enregistré — en attente de connexion`);
    },
    onError: (error: unknown) => toast.error(describeError(error, `Échec de l'enregistrement (${label})`, table)),
  });
}

export function useDeleteRow(table: TableName, label = "Élément") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rowId: string) => {
      applyOptimistic(qc, table, (rows) => rows.filter((r) => r.id !== rowId));
      enqueue({ id: crypto.randomUUID(), table, op: "delete", rowId, createdAt: Date.now(), label });
      if (isOnline()) await flushQueue(qc);
      return rowId;
    },
    onSuccess: () => toast.success(isOnline() ? `${label} supprimé` : `${label} supprimé — en attente de connexion`),
    onError: (error: unknown) => toast.error(describeError(error, `Suppression impossible (${label})`, table)),
  });
}

/**
 * Archive une ligne (soft-delete) au lieu de la supprimer définitivement.
 * Utilisé pour students et teachers.
 */
export function useArchiveRow(table: TableName, label = "Élément") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rowId: string) => {
      applyOptimistic(qc, table, (rows) =>
        rows.map((r) => (r.id === rowId ? { ...r, archived_at: new Date().toISOString() } : r)),
      );
      enqueue({ id: crypto.randomUUID(), table, op: "archive", rowId, createdAt: Date.now(), label });
      if (isOnline()) await flushQueue(qc);
      return rowId;
    },
    onSuccess: () => toast.success(isOnline() ? `${label} archivé` : `${label} archivé — en attente de connexion`),
    onError: (error: unknown) => toast.error(describeError(error, `Archivage impossible (${label})`, table)),
  });
}