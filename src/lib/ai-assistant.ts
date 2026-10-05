/**
 * Client AI assistant — Edge Function Supabase `ai-assistant` (JWT auto).
 * Historique partagé entre appareils via public.ai_assistant_messages.
 */
import { supabase } from "@/integrations/supabase/client";
import { ASSISTANT_PROTOCOL } from "@/lib/assistant-protocol";

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: number;
};

export type AssistantResponse =
  | { ok: true; data: { reply: string } }
  | { ok: false; error: { code: string; message: string } };

const PAGE = 30;
const storageKey = (userId: string) => `eg-assistant-messages:${userId}`;

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createMessage(role: "user" | "assistant", content: string, at = Date.now()): AssistantMessage {
  return { id: newId(), role, content, at };
}

type Row = { id: string; role: "user" | "assistant"; content: string; created_at: string };

function fromRow(r: Row): AssistantMessage {
  return { id: r.id, role: r.role, content: r.content, at: new Date(r.created_at).getTime() };
}

export function loadAssistantMessages(userId: string): AssistantMessage[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AssistantMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function loadRecentAssistantMessages(userId: string): Promise<{ messages: AssistantMessage[]; hasOlder: boolean }> {
  const local = loadAssistantMessages(userId);
  const db = supabase as unknown as { from: (t: string) => any };
  const { data, error } = await db.from("ai_assistant_messages").select("id, role, content, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(PAGE + 1);
  if (error || !data) return { messages: local.slice(-PAGE), hasOlder: local.length > PAGE };
  const rows = (data as Row[]).slice(0, PAGE).reverse().map(fromRow);
  const hasOlder = (data as Row[]).length > PAGE;
  if (rows.length) {
    try { localStorage.setItem(storageKey(userId), JSON.stringify(rows)); } catch { /* ignore */ }
    return { messages: rows, hasOlder };
  }
  return { messages: local.slice(-PAGE), hasOlder: local.length > PAGE };
}

export async function loadOlderAssistantMessages(userId: string, beforeAt: number): Promise<{ messages: AssistantMessage[]; hasOlder: boolean }> {
  const db = supabase as unknown as { from: (t: string) => any };
  const { data, error } = await db.from("ai_assistant_messages").select("id, role, content, created_at").eq("user_id", userId).lt("created_at", new Date(beforeAt).toISOString()).order("created_at", { ascending: false }).limit(PAGE + 1);
  if (error || !data) return { messages: [], hasOlder: false };
  const rows = data as Row[];
  return { messages: rows.slice(0, PAGE).reverse().map(fromRow), hasOlder: rows.length > PAGE };
}

export function saveAssistantMessages(userId: string, messages: AssistantMessage[]) {
  if (typeof window === "undefined" || !userId) return;
  try { localStorage.setItem(storageKey(userId), JSON.stringify(messages.slice(-80))); } catch { /* quota */ }
  const last = messages[messages.length - 1];
  if (!last) return;
  const id = /^[0-9a-f-]{36}$/i.test(last.id) ? last.id : crypto.randomUUID();
  const db = supabase as unknown as { from: (t: string) => any };
  void db.from("ai_assistant_messages").upsert({ id, user_id: userId, role: last.role, content: last.content, created_at: new Date(last.at).toISOString() }, { onConflict: "id" });
}

export async function clearAssistantMessages(userId: string) {
  if (typeof window === "undefined" || !userId) return;
  try { localStorage.removeItem(storageKey(userId)); } catch { /* ignore */ }
  const db = supabase as unknown as { from: (t: string) => any };
  await db.from("ai_assistant_messages").delete().eq("user_id", userId);
}

async function parseFunctionsError(error: unknown): Promise<{ code: string; message: string } | null> {
  if (!error || typeof error !== "object") return null;
  const err = error as { context?: Response };
  if (err.context && typeof err.context.json === "function") {
    try {
      const body = await err.context.json();
      if (body && typeof body === "object") {
        const b = body as { error?: { code?: string; message?: string }; message?: string; code?: string };
        if (b.error?.message) return { code: String(b.error.code || "UPSTREAM"), message: String(b.error.message) };
        if (typeof b.message === "string" && b.message) return { code: String(b.code || "UPSTREAM"), message: b.message };
      }
    } catch { /* ignore */ }
  }
  return null;
}

function mapError(rawMsg: string, parsed: { code: string; message: string } | null) {
  if (parsed) return { code: parsed.code, message: parsed.message };
  const lower = (rawMsg || "").toLowerCase();
  if (lower.includes("failed to send") || lower.includes("failed to fetch") || lower.includes("network")) {
    return { code: "NETWORK", message: "Impossible de joindre l'assistant. Vérifiez votre connexion internet." };
  }
  return { code: "UPSTREAM", message: rawMsg || "Erreur assistant." };
}

export async function askAssistant(message: string, history: { role: "user" | "assistant"; content: string }[] = [], signal?: AbortSignal): Promise<AssistantResponse> {
  const trimmed = message.trim();
  if (!trimmed) return { ok: false, error: { code: "VALIDATION", message: "Message vide." } };
  if (trimmed.length > 2000) return { ok: false, error: { code: "VALIDATION", message: "Message trop long (2000 caractères max)." } };
  try {
    const { data, error } = await supabase.functions.invoke("ai-assistant", {
      body: {
        message: trimmed,
        history: [
          ...ASSISTANT_PROTOCOL.flatMap((content) => [
            { role: "user" as const, content: content.slice(0, 2000) },
            { role: "assistant" as const, content: "Compris." },
          ]),
          ...history.slice(-(20 - ASSISTANT_PROTOCOL.length * 2)).map((h) => ({ role: h.role, content: h.content.slice(0, 2000) })),
        ],
      },
      ...(signal ? { signal } : {}),
    });
    if (signal?.aborted) return { ok: false, error: { code: "ABORTED", message: "Requête annulée." } };
    if (error) return { ok: false, error: mapError(error.message || "", await parseFunctionsError(error)) };
    if (data && typeof data === "object" && "ok" in data) return data as AssistantResponse;
    return { ok: false, error: { code: "INTERNAL", message: "Réponse inattendue de l'assistant." } };
  } catch (e) {
    if (signal?.aborted) return { ok: false, error: { code: "ABORTED", message: "Requête annulée." } };
    return { ok: false, error: mapError(e instanceof Error ? e.message : "Erreur inattendue", null) };
  }
}

let queryClientInvalidate: (() => unknown) | null = null;
export function setAssistantInvalidator(fn: () => unknown) { queryClientInvalidate = fn; }
void queryClientInvalidate;

export function formatMessageTime(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const sameDay = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} · ${time}`;
}
