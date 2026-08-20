import type { TableName } from "@/lib/audit";

export type QueueOp = "insert" | "update" | "delete" | "archive";

export interface QueueEntry {
  /** Identifiant de l'entrée de file (différent de rowId). */
  id: string;
  table: TableName;
  op: QueueOp;
  /** Identifiant de la ligne concernée — généré côté client dès la création. */
  rowId: string;
  values?: Record<string, unknown>;
  createdAt: number;
  label: string;
  error?: string;
}

const STORAGE_KEY = "eg-offline-queue";
export const QUEUE_CHANGED_EVENT = "eg-offline-queue-changed";

export function loadQueue(): QueueEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueueEntry[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueueEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    /* stockage indisponible : la file reste valable pour cette session */
  }
  window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
}

export function enqueue(entry: QueueEntry) {
  const queue = loadQueue();
  queue.push(entry);
  saveQueue(queue);
}

export function removeFromQueue(id: string) {
  saveQueue(loadQueue().filter((e) => e.id !== id));
}

export function markError(id: string, error: string) {
  saveQueue(loadQueue().map((e) => (e.id === id ? { ...e, error } : e)));
}