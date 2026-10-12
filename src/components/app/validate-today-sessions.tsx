/**
 * Raccourci tableau de bord : valider toutes les séances prévues aujourd'hui.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { currentWeekStart } from "@/lib/school";
import { describeError } from "@/lib/errors";
import { enqueue } from "@/lib/offline-queue";
import { flushQueue } from "@/lib/offline-sync";
import { cn } from "@/lib/utils";
import type { SchoolData } from "@/lib/school-data";

export function ValidateTodaySessionsButton({ data }: { data: SchoolData }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const pending = useMemo(() => {
    const todayWeekday = ((new Date().getDay() + 6) % 7) + 1;
    const weekStart = currentWeekStart();
    const completed = new Set(
      data.sessionCompletions
        .filter((c) => c.week_start === weekStart)
        .map((c) => c.session_id),
    );
    return data.sessions.filter((s) => s.weekday === todayWeekday && !completed.has(s.id));
  }, [data.sessions, data.sessionCompletions]);

  const onClick = async () => {
    if (busy) return;
    if (pending.length === 0) {
      toast.message("Aucune séance à valider pour aujourd'hui.");
      return;
    }
    setBusy(true);
    const weekStart = currentWeekStart();
    try {
      for (const s of pending) {
        const rowId = crypto.randomUUID();
        enqueue({
          id: crypto.randomUUID(),
          table: "teacher_session_completions",
          op: "insert",
          rowId,
          values: {
            session_id: s.id,
            week_start: weekStart,
            completed_at: new Date().toISOString(),
          },
          createdAt: Date.now(),
          label: "Validation séance",
        });
      }
      if (typeof navigator === "undefined" || navigator.onLine) {
        await flushQueue(qc);
      }
      await qc.invalidateQueries({ queryKey: ["teacher_session_completions"] });
      toast.success(
        pending.length === 1
          ? "1 séance d'aujourd'hui validée."
          : `${pending.length} séances d'aujourd'hui validées.`,
      );
    } catch (e) {
      toast.error(describeError(e, "Validation des séances impossible"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={busy}
      className={cn(
        "group relative flex items-center gap-4 overflow-hidden rounded-2xl border-2 border-amber-500/40 bg-gradient-to-br from-amber-500/15 via-amber-500/10 to-orange-500/10 p-4 text-left shadow-sm transition",
        "hover:border-amber-500/60 hover:from-amber-500/20 hover:to-orange-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
        "disabled:opacity-70",
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-amber-400/20 blur-2xl"
      />
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/25 text-amber-700 dark:text-amber-300">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
      </span>
      <div className="relative min-w-0 flex-1">
        <p className="font-semibold text-foreground">Valider les séances</p>
        <p className="text-xs text-muted-foreground">
          {pending.length > 0
            ? `${pending.length} séance${pending.length > 1 ? "s" : ""} aujourd'hui à valider`
            : "Aucune séance en attente aujourd'hui"}
        </p>
      </div>
      {pending.length > 0 && (
        <span className="relative shrink-0 rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold tabular-nums text-white shadow-sm">
          {pending.length}
        </span>
      )}
    </button>
  );
}
