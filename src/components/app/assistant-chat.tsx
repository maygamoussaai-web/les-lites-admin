/**
 * Chat assistant scolaire — style conversation LLM (timestamps, édition, annulation, copier, régénérer).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  Loader2,
  Pencil,
  RefreshCw,
  Send,
  Square,
  Trash2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAdminProfile } from "@/hooks/use-auth";
import {
  askAssistant,
  clearAssistantMessages,
  createMessage,
  formatMessageTime,
  loadAssistantMessages,
  saveAssistantMessages,
  type AssistantMessage,
} from "@/lib/ai-assistant";
import { cn } from "@/lib/utils";

type Props = {
  compact?: boolean;
  className?: string;
};

const SUGGESTIONS = [
  "Liste les établissements",
  "Quelles classes sont disponibles ?",
  "Moyenne d'une classe au dernier trimestre",
  "Fiche d'un élève",
];

export function AssistantChat({ compact = false, className }: Props) {
  const { user } = useAdminProfile();
  const userId = user?.id ?? "";
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
  };

  const runAsk = async (text: string, baseMessages: AssistantMessage[]) => {
    const history = baseMessages.map((m) => ({ role: m.role, content: m.content }));
    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
    try {
      const res = await askAssistant(text, history, controller.signal);
      if (controller.signal.aborted) return;
      if (res.ok) {
        persist([...baseMessages, createMessage("assistant", res.data.reply)]);
      } else if (res.error.code !== "ABORTED") {
        const errText = res.error.message || "Une erreur est survenue.";
        persist([...baseMessages, createMessage("assistant", `Désolé : ${errText}`)]);
        if (res.error.code === "UPSTREAM_UNAVAILABLE" || res.error.code === "UPSTREAM") {
          toast.error(errText);
        }
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      const msg = e instanceof Error ? e.message : "Erreur inattendue";
      persist([...baseMessages, createMessage("assistant", `Désolé : ${msg}`)]);
      toast.error(msg);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || sending || !userId) return;
    const userMsg = createMessage("user", text);
    const withUser = [...messages, userMsg];
    persist(withUser);
    setInput("");
    await runAsk(text, withUser);
  };

  const regenerate = async (assistantMsgId: string) => {
    if (sending || !userId) return;
    const idx = messages.findIndex((m) => m.id === assistantMsgId);
    if (idx < 1) return;
    let userIdx = idx - 1;
    while (userIdx >= 0 && messages[userIdx].role !== "user") userIdx--;
    if (userIdx < 0) return;
    const userText = messages[userIdx].content;
    const base = messages.slice(0, userIdx + 1);
    persist(base);
    await runAsk(userText, base);
  };

  const startEdit = (m: AssistantMessage) => {
    if (m.role !== "user" || sending) return;
    setEditingId(m.id);
    setEditDraft(m.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };

  const submitEdit = async () => {
    if (!editingId || !editDraft.trim() || sending) return;
    const idx = messages.findIndex((m) => m.id === editingId);
    if (idx < 0) return;
    const text = editDraft.trim();
    const base = messages.slice(0, idx);
    const userMsg = createMessage("user", text);
    const withUser = [...base, userMsg];
    persist(withUser);
    setEditingId(null);
    setEditDraft("");
    await runAsk(text, withUser);
  };

  const copyText = async (m: AssistantMessage) => {
    try {
      await navigator.clipboard.writeText(m.content);
      setCopiedId(m.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      toast.error("Copie impossible");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const clear = () => {
    if (!userId || sending) return;
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
              {sending ? "Réflexion en cours…" : "Classes · élèves · statistiques"}
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
            disabled={sending}
            aria-label="Effacer la conversation"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <ScrollArea
        className={cn(
          "min-h-0 flex-1 pr-2",
          compact ? "max-h-[min(420px,55vh)]" : "max-h-[min(640px,65vh)]",
        )}
      >
        <div className="space-y-4 py-3">
          {messages.length === 0 && !sending && (
            <div className="space-y-3">
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-4 text-sm text-muted-foreground">
                Bonjour ! Posez une question sur les classes, les élèves ou les résultats.
                Une conversation par compte, enregistrée sur cet appareil.
              </div>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs text-foreground shadow-sm transition hover:border-primary/40 hover:bg-primary/5"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            const isUser = m.role === "user";
            const isEditing = editingId === m.id;

            return (
              <div
                key={m.id}
                className={cn("group flex gap-2.5", isUser ? "flex-row-reverse" : "flex-row")}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs",
                    isUser
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                </span>

                <div className={cn("flex min-w-0 max-w-[85%] flex-col gap-1", isUser && "items-end")}>
                  {isEditing ? (
                    <div className="w-full min-w-[220px] space-y-2 rounded-2xl border border-border/60 bg-card p-2 shadow-sm">
                      <Textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={3}
                        className="min-h-[60px] resize-none text-sm"
                        maxLength={2000}
                        autoFocus
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
                          <X className="mr-1 h-3.5 w-3.5" />
                          Annuler
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={!editDraft.trim()}
                          onClick={() => void submitEdit()}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" />
                          Envoyer
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                        isUser
                          ? "bg-primary text-primary-foreground"
                          : "border border-border/60 bg-card text-foreground shadow-sm",
                      )}
                    >
                      {m.content}
                    </div>
                  )}

                  <div
                    className={cn(
                      "flex items-center gap-1 px-1 text-[10px] text-muted-foreground",
                      isUser && "flex-row-reverse",
                    )}
                  >
                    <span>{formatMessageTime(m.at)}</span>
                    {!isEditing && (
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          type="button"
                          className="rounded p-1 hover:bg-muted hover:text-foreground"
                          onClick={() => void copyText(m)}
                          aria-label="Copier"
                          title="Copier"
                        >
                          {copiedId === m.id ? (
                            <Check className="h-3 w-3 text-green-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                        {isUser && (
                          <button
                            type="button"
                            className="rounded p-1 hover:bg-muted hover:text-foreground"
                            onClick={() => startEdit(m)}
                            disabled={sending}
                            aria-label="Modifier"
                            title="Modifier"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                        {!isUser && (
                          <button
                            type="button"
                            className="rounded p-1 hover:bg-muted hover:text-foreground"
                            onClick={() => void regenerate(m.id)}
                            disabled={sending}
                            aria-label="Régénérer"
                            title="Régénérer"
                          >
                            <RefreshCw className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {sending && (
            <div className="flex gap-2.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Bot className="h-3.5 w-3.5" />
              </span>
              <div className="inline-flex items-center gap-2 rounded-2xl border border-border/60 bg-card px-3.5 py-2 text-sm text-muted-foreground shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Réflexion…
                <button
                  type="button"
                  onClick={cancel}
                  className="ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Arrêter"
                >
                  <Square className="h-3 w-3 fill-current" />
                  Arrêter
                </button>
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
          placeholder="Écrivez votre message… (Entrée pour envoyer)"
          rows={compact ? 2 : 3}
          disabled={!userId || !!editingId}
          className="min-h-[44px] resize-none text-sm"
          maxLength={2000}
        />
        {sending ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-11 w-11 shrink-0 self-end"
            onClick={cancel}
            aria-label="Arrêter"
          >
            <Square className="h-4 w-4 fill-current" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            className="h-11 w-11 shrink-0 self-end"
            onClick={() => void send()}
            disabled={!input.trim() || !userId || !!editingId}
            aria-label="Envoyer"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
