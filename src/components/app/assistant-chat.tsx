import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  askAssistant,
  clearAssistantMessages,
  loadAssistantMessages,
  saveAssistantMessages,
  type AssistantMessage,
} from "@/lib/ai-assistant";

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function AssistantChat({
  userId,
  compact = false,
  className,
}: {
  userId: string;
  compact?: boolean;
  className?: string;
}) {
  const [messages, setMessages] = useState<AssistantMessage[]>(() => loadAssistantMessages(userId));
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(loadAssistantMessages(userId));
  }, [userId]);

  useEffect(() => {
    saveAssistantMessages(userId, messages);
  }, [userId, messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: AssistantMessage = {
      id: newId(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      const result = await askAssistant(text);
      const reply =
        result.ok
          ? result.data.reply
          : result.error.message || "Une erreur est survenue.";
      const assistantMsg: AssistantMessage = {
        id: newId(),
        role: "assistant",
        content: reply,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          content: "Impossible de joindre l'assistant. Réessayez dans un instant.",
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const clear = () => {
    clearAssistantMessages(userId);
    setMessages([]);
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        ref={listRef}
        className={cn(
          "flex-1 space-y-3 overflow-y-auto rounded-xl border border-border/60 bg-card/50 p-3 sm:p-4",
          compact ? "max-h-[min(420px,50vh)] min-h-[200px]" : "min-h-[320px]",
        )}
      >
        {messages.length === 0 && !sending ? (
          <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Bot className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium text-foreground">Assistant scolaire</p>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              Posez une question sur une classe, un élève ou les résultats. Les moyennes officielles
              proviennent des bulletins.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex",
                m.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[90%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed sm:max-w-[80%]",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "border border-border/60 bg-muted/40 text-foreground",
                )}
              >
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
              </div>
            </div>
          ))
        )}
        {sending ? (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-2 rounded-2xl border border-border/60 bg-muted/40 px-3.5 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Réflexion…
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <div className="mt-3 flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ex. : Présente-toi. Ou : stats de la classe…"
          rows={compact ? 2 : 3}
          maxLength={2000}
          disabled={sending}
          className="min-h-[44px] resize-none"
        />
        <div className="flex shrink-0 flex-col gap-1.5">
          <Button
            type="button"
            size="icon"
            className="h-10 w-10 shrink-0"
            onClick={() => void send()}
            disabled={sending || !input.trim()}
            aria-label="Envoyer"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
          {messages.length > 0 ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 text-muted-foreground"
              onClick={clear}
              disabled={sending}
              aria-label="Effacer la conversation"
              title="Effacer la conversation"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
