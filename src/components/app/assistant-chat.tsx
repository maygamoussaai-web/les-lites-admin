/**
 * Chat assistant — plein écran, typographie soignée, markdown (gras/listes).
 * Actions : copier, éditer, régénérer, annuler. 1 conversation / compte.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  "Quelles classes sont disponibles ?",
  "Liste les élèves de TSE",
  "Infos sur un élève",
  "Liste des enseignants",
  "Établissements du complexe",
];

/**
 * Rendu Markdown sans dépendance : titres, **gras**, *italique*, ~~barré~~, `code`,
 * blocs de code, listes, tableaux, citations, séparateurs, liens.
 * NOTE POUR CLAUDE: volontairement sans bibliothèque (règle « pas de dépendance non demandée »).
 */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${keyBase}-${i++}`;
    if (t.startsWith("**") || t.startsWith("__"))
      nodes.push(<strong key={k} className="font-semibold text-foreground">{renderInline(t.slice(2, -2), k)}</strong>);
    else if (t.startsWith("~~")) nodes.push(<del key={k} className="opacity-70">{t.slice(2, -2)}</del>);
    else if (t.startsWith("`"))
      nodes.push(<code key={k} className="rounded-md border border-border/60 bg-muted/70 px-1.5 py-0.5 font-mono text-[0.85em]">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const mm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = mm?.[2] ?? "#";
      nodes.push(
        <a key={k} href={/^(https?:|\/)/.test(href) ? href : "#"} target={href.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="font-medium text-primary underline underline-offset-4">
          {mm?.[1] ?? t}
        </a>,
      );
    } else nodes.push(<em key={k} className="italic">{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { type: "p" | "quote"; text: string }
  | { type: "h"; level: number; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "code"; lang: string; text: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "hr" };

const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? "")) buf.push(lines[i++] ?? "");
      i++;
      out.push({ type: "code", lang: fence[1] ?? "", text: buf.join("\n") });
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) { out.push({ type: "h", level: h[1]!.length, text: h[2]! }); i++; continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { out.push({ type: "hr" }); i++; continue; }
    if (line.includes("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim()) rows.push(cells(lines[i++] ?? ""));
      out.push({ type: "table", head, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) buf.push((lines[i++] ?? "").replace(/^\s*>\s?/, ""));
      out.push({ type: "quote", text: buf.join("\n") });
      continue;
    }
    const listRe = /^\s*([-*•]|\d+[.)])\s+(.+)$/;
    const lm = line.match(listRe);
    if (lm) {
      const ordered = /\d/.test(lm[1]!);
      const items: string[] = [];
      while (i < lines.length) {
        const x = (lines[i] ?? "").match(listRe);
        if (!x || /\d/.test(x[1]!) !== ordered) break;
        items.push(x[2]!);
        i++;
      }
      out.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !listRe.test(lines[i] ?? "") && !/^(#{1,4}\s|\s*>|\s*```)/.test(lines[i] ?? "")) buf.push(lines[i++] ?? "");
    out.push({ type: "p", text: buf.join("\n") });
  }
  return out;
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/50">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono">{lang || "texte"}</span>
        <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? "Copié" : "Copier"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed"><code>{text}</code></pre>
    </div>
  );
}

function MessageContent({ content, isUser }: { content: string; isUser: boolean }) {
  const blocks = useMemo(() => (isUser ? [] : parseMarkdown(content)), [content, isUser]);
  if (isUser) {
    return <div className="whitespace-pre-wrap text-[15px] leading-relaxed tracking-[-0.01em]">{content}</div>;
  }
  return (
    <div className="space-y-3 text-[15px] leading-[1.7] tracking-[-0.005em] text-foreground">
      {blocks.map((b, bi) => {
        const k = `b${bi}`;
        switch (b.type) {
          case "h": {
            const cls = b.level <= 2 ? "font-display text-lg font-semibold mt-4 first:mt-0" : "text-[15.5px] font-semibold mt-3 first:mt-0";
            return <h3 key={k} className={cn("tracking-tight text-foreground", cls)}>{renderInline(b.text, k)}</h3>;
          }
          case "p":
            return <p key={k} className="whitespace-pre-wrap">{renderInline(b.text, k)}</p>;
          case "quote":
            return <blockquote key={k} className="rounded-r-lg border-l-[3px] border-primary/60 bg-primary/5 py-2 pl-4 pr-3 text-foreground/90 whitespace-pre-wrap">{renderInline(b.text, k)}</blockquote>;
          case "hr":
            return <hr key={k} className="border-border/60" />;
          case "code":
            return <CodeBlock key={k} lang={b.lang} text={b.text} />;
          case "ul":
          case "ol": {
            const L = b.type === "ul" ? "ul" : "ol";
            return (
              <L key={k} className={cn("space-y-1.5 pl-5 marker:text-primary/70", b.type === "ul" ? "list-disc" : "list-decimal marker:font-semibold")}>
                {b.items.map((it, ii) => <li key={ii} className="pl-1">{renderInline(it, `${k}-${ii}`)}</li>)}
              </L>
            );
          }
          case "table":
            return (
              <div key={k} className="overflow-x-auto rounded-xl border border-border/60">
                <table className="w-full border-collapse text-[13.5px]">
                  <thead className="bg-muted/60">
                    <tr>{b.head.map((h, hi) => <th key={hi} className="whitespace-nowrap px-3 py-2 text-left font-semibold text-foreground">{renderInline(h, `${k}h${hi}`)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={ri} className="border-t border-border/50 even:bg-muted/20">
                        {r.map((c, ci) => <td key={ci} className="px-3 py-2 align-top tabular-nums">{renderInline(c, `${k}r${ri}c${ci}`)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}

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
        <div className="mx-auto w-full max-w-2xl space-y-6 px-3 py-5 sm:max-w-3xl sm:px-5 sm:py-7">
          {messages.length === 0 && !sending && (
            <div className="flex flex-col items-center justify-center gap-7 py-12 sm:py-20">
              <div className="max-w-md text-center">
                <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  Comment puis-je vous aider ?
                </h2>
                <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">
                  Classes, élèves, enseignants, établissements et résultats.
                  Une conversation par compte, enregistrée sur cet appareil.
                </p>
              </div>
              <div className="flex max-w-lg flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-border/60 bg-card/80 px-3.5 py-2 text-left text-[13px] text-foreground transition-colors hover:border-border hover:bg-muted/50 sm:text-sm"
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
                    "flex min-w-0 max-w-[min(100%,40rem)] flex-col gap-1.5",
                    isUser && "items-end",
                  )}
                >
                  {isEditing ? (
                    <div className="w-full min-w-[min(100%,20rem)] space-y-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
                      <Textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={3}
                        className="min-h-[72px] resize-none text-[15px]"
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
                        "rounded-2xl px-4 py-3",
                        isUser
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-muted/40 text-foreground ring-1 ring-border/40",
                      )}
                    >
                      <MessageContent content={m.content} isUser={isUser} />
                    </div>
                  )}
                  <div
                    className={cn(
                      "flex items-center gap-1.5 px-1 text-[11px] tabular-nums text-muted-foreground",
                      isUser && "flex-row-reverse",
                    )}
                  >
                    <span>{formatMessageTime(m.at)}</span>
                    {!isEditing && (
                      <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                        <button
                          type="button"
                          className="rounded-md p-1.5 hover:bg-muted hover:text-foreground"
                          onClick={() => void copyText(m)}
                          aria-label="Copier"
                          title="Copier"
                        >
                          {copiedId === m.id ? (
                            <Check className="h-3.5 w-3.5 text-green-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        {isUser && (
                          <button
                            type="button"
                            className="rounded-md p-1.5 hover:bg-muted hover:text-foreground"
                            onClick={() => startEdit(m)}
                            disabled={sending}
                            aria-label="Modifier"
                            title="Modifier"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {!isUser && (
                          <button
                            type="button"
                            className="rounded-md p-1.5 hover:bg-muted hover:text-foreground"
                            onClick={() => void regenerate(m.id)}
                            disabled={sending}
                            aria-label="Régénérer"
                            title="Régénérer"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
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
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2.5 rounded-2xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground ring-1 ring-border/40">
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

      <div className="shrink-0 border-t border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto w-full max-w-2xl px-3 py-3 sm:max-w-3xl sm:px-5 sm:py-4">
          <div className="flex items-end gap-2 rounded-2xl border border-border/60 bg-card p-2 shadow-sm focus-within:border-border focus-within:ring-1 focus-within:ring-border/50">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Écrivez votre message…"
              rows={1}
              disabled={!userId || !!editingId}
              className="min-h-[44px] max-h-[160px] flex-1 resize-none border-0 bg-transparent px-2.5 py-2.5 text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
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
