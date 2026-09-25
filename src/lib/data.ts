import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { describeError } from "@/lib/errors";
import { enqueue, flushQueue } from "@/lib/offline-queue";

type TableName = keyof Database["public"]["Tables"];

type ListOptions = {
  select?: string;
  order?: { column: string; ascending?: boolean };
  eq?: Record<string, string | number | boolean | null | undefined>;
  enabled?: boolean;
  limit?: number;
  /**
   * Durée pendant laquelle les données restent « fraîches » sans refetch.
   * Le placeholderData (keepPreviousData) assure un affichage instantané.
   */
  staleTime?: number;
};

/** Tables qui changent souvent (notes, périodes, documents) — cache court. */
const VOLATILE_TABLES = new Set([
  "grades",
  "grade_periods",
  "student_documents",
  "student_report_cards",
  "class_reports",
]);

export function useRows<T = any>(table: TableName, options: ListOptions = {}) {
  const isVolatile = VOLATILE_TABLES.has(table);
  const {
    select = "*",
    order,
    eq,
    enabled = true,
    limit,
    staleTime = isVolatile ? 15_000 : 60_000,
  } = options;
  return useQuery({
    queryKey: [table, select, order, eq, limit],
    enabled,
    staleTime,
    // Toujours rafraîchir les données volatiles au focus / montage ;
    // le reste suit les defaults globaux (45s).
    refetchOnWindowFocus: true,
    refetchOnMount: isVolatile ? "always" : true,
    refetchOnReconnect: true,
    structuralSharing: true,
    placeholderData: keepPreviousData,
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
    onError: (error: unknown) => toast.error(describeError(error, `Enregistrement impossible — ${label}`, table)),
  });
}

export function useDeleteRow(table: TableName, label = "Suppression") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      applyOptimistic(qc, table, (rows) => rows.filter((r) => r.id !== id));
      enqueue({
        id: crypto.randomUUID(),
        table,
        op: "delete",
        rowId: id,
        values: {},
        createdAt: Date.now(),
        label,
      });
      if (isOnline()) await flushQueue(qc);
      return id;
    },
    onSuccess: () => {
      toast.success(isOnline() ? `${label} effectuée` : `${label} — en attente de connexion`);
    },
    onError: (error: unknown) => toast.error(describeError(error, `Suppression impossible — ${label}`, table)),
  });
}

export async function writeAudit(
  action: string,
  entity: string,
  entityId: string | null,
  meta?: Record<string, unknown>,
) {
  try {
    await supabase.from("audit_logs" as never).insert({
      action,
      entity,
      entity_id: entityId,
      meta: meta ?? {},
    } as never);
  } catch {
    /* audit best-effort */
  }
}

export { useQueryClient };
