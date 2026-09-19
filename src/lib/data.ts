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
  /**
   * Duree (ms) pendant laquelle la donnee est fraiche avant revalidation.
   * Defaut 45s. Tables stables : passer 5 min.
   */
  staleTime?: number;
};

function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine;
}

export function useRows<T = any>(table: TableName, options: ListOptions = {}) {
  const { select = "*", order, eq, enabled = true, limit, staleTime = 45_000 } = options;
  return useQuery({
    queryKey: [table, select, order, eq, limit],
    enabled,
    staleTime,
    networkMode: "offlineFirst",
    structuralSharing: true,
    placeholderData: keepPreviousData,
    // Hors ligne : pas de refetch qui echoue et clignote l'UI.
    refetchOnReconnect: true,
    retry: (n) => isOnline() && n < 1,
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

/** Applique un changement immediatement a toutes les listes en cache pour cette table. */
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
    networkMode: "offlineFirst",
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
      toast.success(isOnline() ? `${label} enregistre` : `${label} enregistre — en attente de connexion`);
    },
    onError: (error: unknown) => toast.error(describeError(error, `Echec de l'enregistrement (${label})`, table)),
  });
}

export function useDeleteRow(table: TableName, label = "Element") {
  const qc = useQueryClient();
  return useMutation({
    networkMode: "offlineFirst",
    mutationFn: async (rowId: string) => {
      applyOptimistic(qc, table, (rows) => rows.filter((r) => r.id !== rowId));
      enqueue({ id: crypto.randomUUID(), table, op: "delete", rowId, createdAt: Date.now(), label });
      if (isOnline()) await flushQueue(qc);
      return rowId;
    },
    onSuccess: () => toast.success(isOnline() ? `${label} supprime` : `${label} supprime — en attente de connexion`),
    onError: (error: unknown) => toast.error(describeError(error, `Suppression impossible (${label})`, table)),
  });
}

export function useArchiveRow(table: TableName, label = "Element") {
  const qc = useQueryClient();
  return useMutation({
    networkMode: "offlineFirst",
    mutationFn: async (rowId: string) => {
      applyOptimistic(qc, table, (rows) =>
        rows.map((r) => (r.id === rowId ? { ...r, archived_at: new Date().toISOString() } : r)),
      );
      enqueue({ id: crypto.randomUUID(), table, op: "archive", rowId, createdAt: Date.now(), label });
      if (isOnline()) await flushQueue(qc);
      return rowId;
    },
    onSuccess: () => toast.success(isOnline() ? `${label} archive` : `${label} archive — en attente de connexion`),
    onError: (error: unknown) => toast.error(describeError(error, `Archivage impossible (${label})`, table)),
  });
}
