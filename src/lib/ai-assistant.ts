/**
 * Client AI assistant — Edge Function Supabase `ai-assistant` (JWT auto).
 * Gemini via secrets Supabase (GEMINI_API_KEY). Aucune gateway Lovable.
 * Conversation en localStorage par userId.
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

const storageKey = (userId: string) => `eg-assistant-messages:${userId}`;

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createMessage(
  role: "user" | "assistant",
  content: string,
  at = Date.now(),
): AssistantMessage {
  return { id: newId(), role, content, at };
}

export function loadAssistantMessages(userId: string): AssistantMessage[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AssistantMessage[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          typeof m.at === "number",
      )
      .map((m) => ({
        ...m,
        id: typeof m.id === "string" && m.id ? m.id : newId(),
      }));
  } catch {
    return [];
  }
}

export function saveAssistantMessages(userId: string, messages: AssistantMessage[]) {
  if (typeof window === "undefined" || !userId) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(messages.slice(-80)));
  } catch {
    /* quota */
  }
}

export function clearAssistantMessages(userId: string) {
  if (typeof window === "undefined" || !userId) return;
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
}

async function parseFunctionsError(error: unknown): Promise<{ code: string; message: string } | null> {
  if (!error || typeof error !== "object") return null;
  const err = error as { context?: Response };
  if (err.context && typeof err.context.json === "function") {
    try {
      const body = await err.context.json();
      if (body && typeof body === "object") {
        const b = body as {
          error?: { code?: string; message?: string };
          message?: string;
          code?: string;
        };
        if (b.error?.message) {
          return { code: String(b.error.code || "UPSTREAM"), message: String(b.error.message) };
        }
        if (typeof b.message === "string" && b.message) {
          return { code: String(b.code || "UPSTREAM"), message: b.message };
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function mapError(rawMsg: string, parsed: { code: string; message: string } | null): {
  code: string;
  message: string;
} {
  if (parsed) {
    const c = parsed.code.toUpperCase();
    if (c === "UNAUTHENTICATED" || c === "FORBIDDEN") {
      return {
        code: c,
        message: parsed.message || "Session expirée ou compte non autorisé. Reconnectez-vous.",
      };
    }
    if (c === "CONFIG" || (c === "INTERNAL" && parsed.message.toLowerCase().includes("config"))) {
      return {
        code: "CONFIG",
        message: parsed.message || "Configuration assistant incomplète (clé Gemini côté Supabase).",
      };
    }
    if (c === "UPSTREAM_UNAVAILABLE" || c === "UPSTREAM") {
      return {
        code: c,
        message: parsed.message || "Assistant temporairement indisponible. Réessayez.",
      };
    }
    return { code: parsed.code, message: parsed.message };
  }
  const lower = (rawMsg || "").toLowerCase();
  if (lower.includes("401") || lower.includes("jwt") || lower.includes("unauthorized")) {
    return { code: "UNAUTHENTICATED", message: "Session expirée. Reconnectez-vous puis réessayez." };
  }
  if (lower.includes("failed to send") || lower.includes("failed to fetch") || lower.includes("network")) {
    return {
      code: "NETWORK",
      message: "Impossible de joindre l'assistant. Vérifiez votre connexion internet.",
    };
  }
  return { code: "UPSTREAM", message: rawMsg || "Erreur assistant." };
}

/** Appelle l'Edge Function ai-assistant (Gemini + outils). */
export async function askAssistant(
  message: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  signal?: AbortSignal,
): Promise<AssistantResponse> {
  const trimmed = message.trim();
  if (!trimmed) {
    return { ok: false, error: { code: "VALIDATION", message: "Message vide." } };
  }
  if (trimmed.length > 2000) {
    return {
      ok: false,
      error: { code: "VALIDATION", message: "Message trop long (2000 caractères max)." },
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke("ai-assistant", {
      body: {
        message: trimmed,
        // NOTE POUR CLAUDE: protocole + doc injectés en tête (voir assistant-protocol.ts).
        history: [
          ...ASSISTANT_PROTOCOL.flatMap((content) => [
            { role: "user" as const, content: content.slice(0, 2000) },
            { role: "assistant" as const, content: "Compris." },
          ]),
          ...history.slice(-(20 - ASSISTANT_PROTOCOL.length * 2)).map((h) => ({
            role: h.role,
            content: h.content.slice(0, 2000),
          })),
        ],
      },
      ...(signal ? { signal } : {}),
    });

    if (signal?.aborted) {
      return { ok: false, error: { code: "ABORTED", message: "Requête annulée." } };
    }

    if (error) {
      const parsed = await parseFunctionsError(error);
      return { ok: false, error: mapError(error.message || "", parsed) };
    }

    if (data && typeof data === "object" && "ok" in data) {
      return data as AssistantResponse;
    }

    return {
      ok: false,
      error: { code: "INTERNAL", message: "Réponse inattendue de l'assistant." },
    };
  } catch (e) {
    if (signal?.aborted) {
      return { ok: false, error: { code: "ABORTED", message: "Requête annulée." } };
    }
    const msg = e instanceof Error ? e.message : "Erreur inattendue";
    return { ok: false, error: mapError(msg, null) };
  }
}

let queryClientInvalidate: (() => unknown) | null = null;
export function setAssistantInvalidator(fn: () => unknown) {
  queryClientInvalidate = fn;
}

export function formatMessageTime(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  const date = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  return `${date} · ${time}`;
}
