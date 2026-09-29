/**
 * Client AI assistant — appelle l'Edge Function ai-assistant (JWT auto via supabase).
 * Conversation stockée en localStorage par userId (MVP, une conversation par user).
 */
import { supabase } from "@/integrations/supabase/client";

export type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
  at: number;
};

export type AssistantResponse =
  | { ok: true; data: { reply: string } }
  | { ok: false; error: { code: string; message: string } };

const storageKey = (userId: string) => `eg-assistant-messages:${userId}`;

export function loadAssistantMessages(userId: string): AssistantMessage[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AssistantMessage[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        typeof m.at === "number",
    );
  } catch {
    return [];
  }
}

export function saveAssistantMessages(userId: string, messages: AssistantMessage[]) {
  if (typeof window === "undefined" || !userId) return;
  try {
    // Garde les 80 derniers messages pour éviter un localStorage trop lourd
    const trimmed = messages.slice(-80);
    localStorage.setItem(storageKey(userId), JSON.stringify(trimmed));
  } catch {
    // quota / private mode — ignore
  }
}

export function clearAssistantMessages(userId: string) {
  if (typeof window === "undefined" || !userId) return;
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    // ignore
  }
}

/**
 * Envoie le message à l'Edge Function. Le JWT de session est transmis automatiquement.
 */
export async function askAssistant(message: string): Promise<AssistantResponse> {
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

  const { data, error } = await supabase.functions.invoke("ai-assistant", {
    body: { message: trimmed },
  });

  if (error) {
    const msg = error.message || "Erreur réseau";
    // Fonctions renvoient souvent FunctionsHttpError avec context
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

  // La fonction renvoie déjà { ok, data } ou { ok, error }
  if (data && typeof data === "object" && "ok" in data) {
    return data as AssistantResponse;
  }

  return {
    ok: false,
    error: { code: "INTERNAL", message: "Réponse inattendue de l'assistant." },
  };
}
