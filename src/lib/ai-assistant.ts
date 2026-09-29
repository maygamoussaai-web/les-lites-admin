import { supabase } from "@/integrations/supabase/client";

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type AssistantOk = { ok: true; data: { reply: string } };
type AssistantErr = {
  ok: false;
  error: { code: string; message: string };
};

export type AssistantResponse = AssistantOk | AssistantErr;

function storageKey(userId: string): string {
  return `eg-assistant-messages:${userId}`;
}

export function loadAssistantMessages(userId: string): AssistantMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AssistantMessage[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    );
  } catch {
    return [];
  }
}

export function saveAssistantMessages(userId: string, messages: AssistantMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    // Limite pour éviter un localStorage trop volumineux
    const trimmed = messages.slice(-80);
    localStorage.setItem(storageKey(userId), JSON.stringify(trimmed));
  } catch {
    /* quota / mode privé */
  }
}

export function clearAssistantMessages(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
}

export async function askAssistant(message: string): Promise<AssistantResponse> {
  const trimmed = message.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: { code: "VALIDATION", message: "Le message est vide." },
    };
  }

  const { data, error } = await supabase.functions.invoke<AssistantResponse>("ai-assistant", {
    body: { message: trimmed },
  });

  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 401) {
      return {
        ok: false,
        error: { code: "UNAUTHENTICATED", message: "Session expirée. Reconnectez-vous." },
      };
    }
    if (status === 403) {
      return {
        ok: false,
        error: { code: "FORBIDDEN", message: "Accès refusé." },
      };
    }
    // Corps d'erreur éventuel renvoyé par la function
    if (data && typeof data === "object" && "ok" in data && data.ok === false) {
      return data as AssistantErr;
    }
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: error.message || "Impossible de contacter l'assistant.",
      },
    };
  }

  if (!data || typeof data !== "object") {
    return {
      ok: false,
      error: { code: "INTERNAL", message: "Réponse invalide de l'assistant." },
    };
  }

  if ("ok" in data && data.ok === true && data.data?.reply) {
    return data as AssistantOk;
  }
  if ("ok" in data && data.ok === false) {
    return data as AssistantErr;
  }

  return {
    ok: false,
    error: { code: "INTERNAL", message: "Réponse invalide de l'assistant." },
  };
}
