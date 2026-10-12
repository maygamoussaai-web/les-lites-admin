/**
 * Raccourci tableau de bord : liste les séances du jour et laisse choisir lesquelles valider.
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function ValidateTodaySessionsButton({ data }: { data: SchoolData }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const pending = useMemo(() => {
    const todayWeekday = ((new Date().getDay() + 6) % 7) + 1;
    const weekStart = currentWeekStart();
    const completed = new Set(
      data.sessionCompletions
        .filter((c) => c.week_start === weekStart)
        .map((c) => c.session_id),
    );
    const asgById = new Map(data.assignments.map((a) => [a.id, a]));
    return data.sessions
      .filter((s) => s.weekday === todayWeekday && !completed.has(s.id))
      .map((s) => {
        const asg = asgById.get(s.assignment_id);
        const teacher = asg
          ? data.teachersById.get(asg.teacher_id) ?? data.teachers.find((t) => t.id === asg.teacher_id)
          : undefined;
        const cls = s.class_id
          ? data.classes.find((c) => c.id === s.class_id)
          : undefined;
        return {
          ...s,
          teacherName: teacher
            ? `${teacher.last_name} ${teacher.first_name}`.trim()
            : "Enseignant",
          className: cls?.name ?? "—",
        };
      })
      .sort(
        (a, b) =>
          a.teacherName.localeCompare(b.teacherName, "fr") ||
          (a.name ?? "").localeCompare(b.name ?? "", "fr"),
      );
  }, [data.sessions, data.sessionCompletions, data.assignments, data.teachersById, data.teachers, data.classes]);

  const openDialog = () => {
    if (pending.length === 0) {
      toast.message("Aucune séance à valider pour aujourd'hui.");
      return;
    }
    setSelected(new Set(pending.map((s) => s.id)));
    setOpen(true);
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === pending.length) setSelected(new Set());
    else setSelected(new Set(pending.map((s) => s.id)));
  };

  const onConfirm = async () => {
    const toValidate = pending.filter((s) => selected.has(s.id));
    if (toValidate.length === 0) {
      toast.message("Sélectionnez au moins une séance.");
      return;
    }
    setBusy(true);
    const weekStart = currentWeekStart();
    try {
      for (const s of toValidate) {
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
          label: `Validation séance · ${s.name ?? ""} · ${s.teacherName}`,
        });
      }
      if (typeof navigator === "undefined" || navigator.onLine) {
        await flushQueue(qc);
      }
      await qc.invalidateQueries({ queryKey: ["teacher_session_completions"] });
      toast.success(
        toValidate.length === 1
          ? "1 séance validée."
          : `${toValidate.length} séances validées.`,
      );
      setOpen(false);
    } catch (e) {
      toast.error(describeError(e, "Validation des séances impossible"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
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
              ? `${pending.length} séance${pending.length > 1 ? "s" : ""} aujourd'hui — choisir lesquelles`
              : "Aucune séance en attente aujourd'hui"}
          </p>
        </div>
        {pending.length > 0 && (
          <span className="relative shrink-0 rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold tabular-nums text-white shadow-sm">
            {pending.length}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Séances d'aujourd'hui</DialogTitle>
            <DialogDescription>
              Cochez les séances à marquer comme effectuées pour cette semaine.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs font-medium text-primary hover:underline"
            >
              {selected.size === pending.length ? "Tout décocher" : "Tout cocher"}
            </button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {selected.size} / {pending.length} sélectionnée{selected.size > 1 ? "s" : ""}
            </span>
          </div>

          <ul className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
            {pending.map((s) => {
              const checked = selected.has(s.id);
              return (
                <li key={s.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition",
                      checked
                        ? "border-amber-500/50 bg-amber-500/10"
                        : "border-border/60 bg-card hover:bg-muted/40",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(s.id)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">
                        {s.name || "Séance"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {s.teacherName}
                        {s.className !== "—" ? ` · ${s.className}` : ""}
                        {s.duration_minutes ? ` · ${s.duration_minutes} min` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button
              type="button"
              disabled={busy || selected.size === 0}
              onClick={() => void onConfirm()}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Validation…
                </>
              ) : (
                `Valider ${selected.size} séance${selected.size > 1 ? "s" : ""}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
