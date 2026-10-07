/**
 * Persistance légère du cache React Query dans localStorage.
 * Sans dépendance externe (compatible Lovable).
 * Sert à garder listes élèves/classes visibles après rechargement hors ligne.
 */

import type { QueryClient, QueryKey } from "@tanstack/react-query";

export const QUERY_PERSIST_MAX_AGE = 1000 * 60 * 60 * 24 * 7;
const STORAGE_KEY = "eg-rq-cache-v1";
const MAX_ENTRIES = 80;
const MAX_BYTES = 1_800_000;

/** Tables stables à persister (pas les notes volatiles). */
const PERSIST_TABLES = new Set([
  "establishments",
  "classes",
  "students",
  "fee_plans",
  "fee_plan_installments",
  "student_enrollments",
  "teachers",
  "teacher_assignments",
  "teacher_sessions",
  "teacher_session_completions",
  "tuition_payments",
  "teacher_payments",
]);

type StoredEntry = {
  key: QueryKey;
  data: unknown;
  dataUpdatedAt: number;
};

type StoredBlob = {
  version: 1;
  savedAt: number;
  entries: StoredEntry[];
};

function tableOf(key: QueryKey): string | null {
  const k0 = key?.[0];
  return typeof k0 === "string" ? k0 : null;
}

function shouldPersist(key: QueryKey): boolean {
  const t = tableOf(key);
  return !!t && PERSIST_TABLES.has(t);
}

export function hydrateQueryClient(qc: QueryClient) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const blob = JSON.parse(raw) as StoredBlob;
    if (!blob || blob.version !== 1 || !Array.isArray(blob.entries)) return;
    if (Date.now() - (blob.savedAt || 0) > QUERY_PERSIST_MAX_AGE) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    for (const e of blob.entries) {
      if (!e?.key || !shouldPersist(e.key)) continue;
      if (Date.now() - (e.dataUpdatedAt || 0) > QUERY_PERSIST_MAX_AGE) continue;
      qc.setQueryData(e.key, e.data, { updatedAt: e.dataUpdatedAt });
    }
  } catch {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function schedulePersist(qc: QueryClient) {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persistNow(qc), 800);
}

export function persistNow(qc: QueryClient) {
  if (typeof window === "undefined") return;
  try {
    const cache = qc.getQueryCache().getAll();
    const entries: StoredEntry[] = [];
    for (const q of cache) {
      if (q.state.status !== "success") continue;
      if (!shouldPersist(q.queryKey)) continue;
      if (q.state.data === undefined) continue;
      entries.push({
        key: q.queryKey,
        data: q.state.data,
        dataUpdatedAt: q.state.dataUpdatedAt || Date.now(),
      });
      if (entries.length >= MAX_ENTRIES) break;
    }
    const blob: StoredBlob = { version: 1, savedAt: Date.now(), entries };
    const json = JSON.stringify(blob);
    if (json.length > MAX_BYTES) {
      const priority = new Set(["students", "classes", "establishments", "student_enrollments"]);
      blob.entries = entries.filter((e) => priority.has(String(e.key?.[0] ?? "")));
      const smaller = JSON.stringify(blob);
      if (smaller.length > MAX_BYTES) return;
      window.localStorage.setItem(STORAGE_KEY, smaller);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, json);
  } catch {
    /* quota / mode privé */
  }
}

/** Branche l'abonnement cache → localStorage (à appeler une fois côté client). */
export function attachQueryPersist(qc: QueryClient) {
  if (typeof window === "undefined") return () => {};
  hydrateQueryClient(qc);
  const unsub = qc.getQueryCache().subscribe(() => schedulePersist(qc));
  const onHide = () => persistNow(qc);
  window.addEventListener("pagehide", onHide);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistNow(qc);
  });
  return () => {
    unsub();
    window.removeEventListener("pagehide", onHide);
  };
}
