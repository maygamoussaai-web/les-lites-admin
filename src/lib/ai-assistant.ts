/**
 * Client AI assistant — Edge Function ai-assistant (JWT auto).
 * Conversation en localStorage par userId. Historique multi-tour envoyé au backend.
 */
import { supabase } from "@/integrations/supabase/client";

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

  try {
    const { data, error } = await supabase.functions.invoke("ai-assistant", {
      body: {
        message: trimmed,
        history: history.slice(-20).map((h) => ({
          role: h.role,
          content: h.content.slice(0, 2000),
        })),
      },
    });

    if (signal?.aborted) {
      return { ok: false, error: { code: "ABORTED", message: "Requête annulée." } };
    }

    if (error) {
      const msg = error.message || "Erreur réseau";
      return {
        ok: false,
        error: {
          code: "UPSTREAM",
          message:
            msg.includes("Failed to send") || msg.includes("fetch")
              ? "Impossible de joindre l'assistant. Vérifiez votre connexion."
              : msg,
        },
      };
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
    return { ok: false, error: { code: "UPSTREAM", message: msg } };
  }
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
