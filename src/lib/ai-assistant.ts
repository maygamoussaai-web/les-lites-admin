/**
 * Client AI assistant — Edge Function ai-assistant (JWT auto).
 * Conversation en localStorage par userId. Historique multi-turn envoyé au backend.
 */
import { supabase } from "@/integrations/supabase/client";
import { askAssistantFn } from "@/lib/assistant.functions";

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
    const trimmed = messages.slice(-80);
    localStorage.setItem(storageKey(userId), JSON.stringify(trimmed));
  } catch {
    /* quota / private mode */
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

/** Extrait le corps d'erreur renvoyé par l'Edge Function (non-2xx). */
async function parseFunctionsError(error: unknown): Promise<{
  code: string;
  message: string;
} | null> {
  if (!error || typeof error !== "object") return null;
  const err = error as {
    message?: string;
    context?: Response | { json?: () => Promise<unknown>; status?: number };
    name?: string;
  };
  const ctx = err.context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      const body = await (ctx as Response).json();
      if (body && typeof body === "object") {
        const b = body as {
          ok?: boolean;
          error?: { code?: string; message?: string };
          message?: string;
          code?: string;
        };
        if (b.error?.message) {
          return {
            code: String(b.error.code || "UPSTREAM"),
            message: String(b.error.message),
          };
        }
        if (typeof b.message === "string" && b.message) {
          return { code: String(b.code || "UPSTREAM"), message: b.message };
        }
      }
    } catch {
      /* ignore parse errors */
    }
  }
  return null;
}

function mapInvokeError(rawMsg: string, parsed: { code: string; message: string } | null): {
  code: string;
  message: string;
} {
  if (parsed) {
    const c = parsed.code.toUpperCase();
    if (c === "UNAUTHENTICATED" || c === "FORBIDDEN") {
      return {
        code: c,
        message:
          parsed.message ||
          "Session expirée ou compte non autorisé. Reconnectez-vous puis réessayez.",
      };
    }
    if (c === "CONFIG") {
      return {
        code: "CONFIG",
        message: parsed.message || "Configuration assistant incomplète côté serveur.",
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

  const msg = rawMsg || "Erreur réseau";
  const lower = msg.toLowerCase();

  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("jwt") ||
    lower.includes("unauthorized") ||
    lower.includes("not authenticated")
  ) {
    return {
      code: "UNAUTHENTICATED",
      message: "Session expirée. Reconnectez-vous puis réessayez.",
    };
  }

  if (
    lower.includes("edge function") ||
    lower.includes("non-2xx") ||
    lower.includes("546") ||
    lower.includes("503") ||
    lower.includes("502")
  ) {
    return {
      code: "UPSTREAM",
      message:
        "L'assistant a renvoyé une erreur serveur. Réessayez dans un instant. Si ça continue, contactez le support.",
    };
  }

  if (
    lower.includes("failed to send") ||
    lower.includes("networkerror") ||
    lower.includes("failed to fetch") ||
    lower.includes("load failed") ||
    lower.includes("network request failed")
  ) {
    return {
      code: "NETWORK",
      message: "Impossible de joindre l'assistant. Vérifiez votre connexion internet puis réessayez.",
    };
  }

  return { code: "UPSTREAM", message: msg };
}

/**
 * Envoie le message + historique à l'Edge Function.
 * signal permet d'annuler la requête en cours.
 */
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

  // NOTE POUR CLAUDE: appel de la fonction serveur askAssistantFn (droits = ceux de l'utilisateur).
  try {
    const res = await askAssistantFn({
      data: {
        message: trimmed,
        history: history.slice(-30).map((h) => ({ role: h.role, content: h.content.slice(0, 8000) })),
      },
    });
    if (signal?.aborted) {
      return { ok: false, error: { code: "ABORTED", message: "Requête annulée." } };
    }
    if (res.ok) {
      if (res.actions.length) void queryClientInvalidate?.();
      return { ok: true, data: { reply: res.reply } };
    }
    return { ok: false, error: { code: "UPSTREAM", message: res.error } };
  } catch (e) {
    if (signal?.aborted) {
      return { ok: false, error: { code: "ABORTED", message: "Requête annulée." } };
    }
    const msg = e instanceof Error ? e.message : "Erreur inattendue";
    return { ok: false, error: mapInvokeError(msg, null) };
  }
}

/** Branché par le chat pour rafraîchir les écrans après une action de l'IA. */
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
