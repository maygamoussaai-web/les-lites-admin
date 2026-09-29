/**
 * Chat de l'assistant scolaire — messages en localStorage par user.
 * Mode compact (Sheet FAB) ou plein écran (page /mon-assistant).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAdminProfile } from "@/hooks/use-auth";
import {
  askAssistant,
  clearAssistantMessages,
  loadAssistantMessages,
  saveAssistantMessages,
  type AssistantMessage,
} from "@/lib/ai-assistant";
import { cn } from "@/lib/utils";

type Props = {
  /** Hauteur réduite pour le Sheet FAB */
  compact?: boolean;
  className?: string;
};

const WELCOME =
  "Bonjour ! Je suis l'assistant scolaire des Élites de Gao. Posez-moi une question sur une classe, un élève ou les statistiques d'une période.";

export function AssistantChat({ compact = false, className }: Props) {
  const { user } = useAdminProfile();
  const userId = user?.id ?? "";
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!userId) return;
    setMessages(loadAssistantMessages(userId));
  }, [userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const persist = useCallback(
    (next: AssistantMessage[]) => {
      setMessages(next);
      if (userId) saveAssistantMessages(userId, next);
    },
    [userId],
  );

  const send = async () => {
    const text = input.trim();
    if (!text || sending || !userId) return;

    const userMsg: AssistantMessage = { role: "user", content: text, at: Date.now() };
    const withUser = [...messages, userMsg];
    persist(withUser);
    setInput("");
    setSending(true);

    try {
      const res = await askAssistant(text);
      if (res.ok) {
        persist([
          ...withUser,
          { role: "assistant", content: res.data.reply, at: Date.now() },
        ]);
      } else {
        const errText = res.error.message || "Une erreur est survenue.";
        persist([
          ...withUser,
          { role: "assistant", content: `Désolé : ${errText}`, at: Date.now() },
        ]);
        if (res.error.code === "UPSTREAM_UNAVAILABLE" || res.error.code === "UPSTREAM") {
          toast.error(errText);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur inattendue";
      persist([
        ...withUser,
        { role: "assistant", content: `Désolé : ${msg}`, at: Date.now() },
      ]);
      toast.error(msg);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const clear = () => {
    if (!userId) return;
    clearAssistantMessages(userId);
    setMessages([]);
    toast.success("Conversation effacée");
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-1 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bot className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">Assistant scolaire</p>
            <p className="truncate text-[11px] text-muted-foreground">
              Classes · élèves · statistiques
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={clear}
            aria-label="Effacer la conversation"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <ScrollArea
        className={cn(
          "min-h-0 flex-1 pr-3",
          compact ? "max-h-[min(420px,55vh)]" : "max-h-[min(640px,65vh)]",
        )}
      >
        <div className="space-y-3 py-3">
          {messages.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
              {WELCOME}
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={`${m.at}-${i}`}
              className={cn(
                "flex",
                m.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "border border-border/60 bg-card text-foreground shadow-sm",
                )}
              >
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-border/60 bg-card px-3.5 py-2 text-sm text-muted-foreground shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Réflexion…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="mt-auto flex gap-2 border-t border-border/60 pt-3">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ex. Moyenne de la 6e A au 1er trimestre…"
          rows={compact ? 2 : 3}
          disabled={sending || !userId}
          className="min-h-[44px] resize-none text-sm"
          maxLength={2000}
        />
        <Button
          type="button"
          size="icon"
          className="h-11 w-11 shrink-0 self-end"
          onClick={() => void send()}
          disabled={sending || !input.trim() || !userId}
          aria-label="Envoyer"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
