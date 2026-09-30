/**
 * Chat assistant — plein écran, sobré, standards LLM 2026.
 * Timestamps, édition, annulation, copier, régénérer. 1 conversation / compte (localStorage).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check, Copy, Loader2, Pencil, RefreshCw, Send, Square, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAdminProfile } from "@/hooks/use-auth";
import {
  askAssistant, clearAssistantMessages, createMessage, formatMessageTime,
  loadAssistantMessages, saveAssistantMessages, type AssistantMessage,
} from "@/lib/ai-assistant";
import { cn } from "@/lib/utils";

type Props = { className?: string };

const SUGGESTIONS = [
  "Liste les établissements",
  "Quelles classes sont disponibles ?",
  "Moyenne de la classe 6ème A",
  "Fiche d'un élève",
  "Liste des enseignants",
];

export function AssistantChat({ className }: Props) {
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
    <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-3 py-4 sm:px-4 sm:py-6">
          {messages.length === 0 && !sending && (
            <div className="flex flex-col items-center justify-center gap-6 py-10 sm:py-16">
              <div className="max-w-md text-center">
                <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                  Comment puis-je vous aider ?
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Posez une question sur les établissements, classes, élèves, enseignants ou
                  résultats. Une conversation par compte, enregistrée sur cet appareil.
                </p>
              </div>
              <div className="flex max-w-lg flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-border/70 bg-card px-3.5 py-2 text-left text-xs text-foreground transition-colors hover:border-border hover:bg-muted/60 sm:text-sm"
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
                className={cn("group flex w-full gap-3", isUser ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "flex min-w-0 max-w-[min(100%,42rem)] flex-col gap-1",
                    isUser && "items-end",
                  )}
                >
                  {isEditing ? (
                    <div className="w-full min-w-[min(100%,20rem)] space-y-2 rounded-2xl border border-border bg-card p-3">
                      <Textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={3}
                        className="min-h-[72px] resize-none text-sm"
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
                        "whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed",
                        isUser
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-foreground",
                      )}
                    >
                      {m.content}
                    </div>
                  )}
                  <div
                    className={cn(
                      "flex items-center gap-1 px-1 text-[11px] text-muted-foreground",
                      isUser && "flex-row-reverse",
                    )}
                  >
                    <span>{formatMessageTime(m.at)}</span>
                    {!isEditing && (
                      <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
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
            <div className="flex justify-start gap-3">
              <div className="inline-flex items-center gap-2.5 rounded-2xl bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Réflexion…</span>
                <button
                  type="button"
                  onClick={cancel}
                  className="ml-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs hover:bg-muted hover:text-foreground"
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
      </div>

      <div className="shrink-0 border-t border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto w-full max-w-3xl px-3 py-3 sm:px-4 sm:py-4">
          <div className="flex items-end gap-2 rounded-2xl border border-border/70 bg-card p-2 shadow-sm focus-within:border-border">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Écrivez votre message…"
              rows={1}
              disabled={!userId || !!editingId}
              className="min-h-[44px] max-h-[160px] flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-[15px] shadow-none focus-visible:ring-0"
              maxLength={2000}
            />
            {sending ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="h-10 w-10 shrink-0 rounded-xl"
                onClick={cancel}
                aria-label="Arrêter"
              >
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl"
                onClick={() => void send()}
                disabled={!input.trim() || !userId || !!editingId}
                aria-label="Envoyer"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 px-1">
            <p className="text-[11px] text-muted-foreground">
              Entrée pour envoyer · Maj+Entrée pour une nouvelle ligne
            </p>
            {messages.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                onClick={clear}
                disabled={sending}
              >
                <Trash2 className="h-3 w-3" />
                Effacer
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
