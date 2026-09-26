/**
 * Emploi du temps — séances pour enseignants au tarif horaire.
 * Case cochée = séance validée cette semaine → payée (heures × tarif).
 * Les cases se réinitialisent chaque semaine (clé week_start = lundi).
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, Plus, Trash2, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { writeAudit } from "@/lib/data";
import {
  WEEKDAYS, weekdayLabel, formatDuration, currentWeekStart,
  teacherDue, validatedHours, type TeacherAssignment, type TeacherSession,
} from "@/lib/school";
import { formatFCFA } from "@/lib/format";
import { describeError } from "@/lib/errors";
import type { SchoolData } from "@/lib/school-data";

export function TeacherScheduleSection({
  assignment,
  data,
}: {
  assignment: TeacherAssignment;
  data: SchoolData;
}) {
  if (assignment.payment_method !== "hourly") return null;

  const qc = useQueryClient();
  const weekStart = currentWeekStart();
  const sessions = useMemo(
    () => data.sessions.filter((s) => s.assignment_id === assignment.id).sort((a, b) => a.weekday - b.weekday),
    [data.sessions, assignment.id],
  );
  const completions = useMemo(
    () =>
      data.sessionCompletions.filter(
        (c) => sessions.some((s) => s.id === c.session_id) && c.week_start === weekStart,
      ),
    [data.sessionCompletions, sessions, weekStart],
  );
  const completedIds = useMemo(() => new Set(completions.map((c) => c.session_id)), [completions]);

  const hours = validatedHours(assignment.id, data.sessions, data.sessionCompletions);
  const due = teacherDue(assignment, data.sessions, data.sessionCompletions);
  const rate = Number(assignment.hourly_rate ?? 0);

  const classes = data.classes.filter(
    (c) => c.establishment_id === assignment.establishment_id && c.is_active !== false,
  );
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [form, setForm] = useState({
    class_id: "",
    subject_id: "",
    weekday: "1",
    hours: "2",
    name: "",
  });

  const loadSubjects = async (classId: string) => {
    if (!classId) {
      setSubjects([]);
      setSubjectsLoading(false);
      return;
    }
    setSubjectsLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from("class_subjects")
        .select("id, name")
        .eq("class_id", classId)
        .order("name");
      if (error) throw error;
      setSubjects(rows ?? []);
    } catch (e) {
      console.error(e);
      setSubjects([]);
      toast.error(describeError(e, "Impossible de charger les matières"));
    } finally {
      setSubjectsLoading(false);
    }
  };

  const toggleSession = async (session: TeacherSession, checked: boolean) => {
    setBusy(session.id);
    try {
      if (checked) {
        const { error } = await supabase.from("teacher_session_completions").insert({
          session_id: session.id,
          week_start: weekStart,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("teacher_session_completions")
          .delete()
          .eq("session_id", session.id)
          .eq("week_start", weekStart);
        if (error) throw error;
      }
      await qc.invalidateQueries({ queryKey: ["teacher_session_completions"] });
    } catch (e) {
      toast.error(describeError(e, "Mise à jour impossible"));
    } finally {
      setBusy(null);
    }
  };

  const removeSession = async (sessionId: string) => {
    setBusy(sessionId);
    try {
      await supabase.from("teacher_session_completions").delete().eq("session_id", sessionId);
      const { error } = await supabase.from("teacher_sessions").delete().eq("id", sessionId);
      if (error) throw error;
      await writeAudit("delete", "teacher_sessions" as never, sessionId, {});
      await qc.invalidateQueries({ queryKey: ["teacher_sessions"] });
      toast.success("Séance supprimée");
    } catch (e) {
      toast.error(describeError(e, "Suppression impossible"));
    } finally {
      setBusy(null);
    }
  };

  const addSession = async () => {
    const hoursNum = Number(form.hours);
    if (!form.class_id || !form.weekday || !hoursNum || hoursNum <= 0) {
      toast.message("Classe, jour et heures sont obligatoires");
      return;
    }
    const minutes = Math.round(hoursNum * 60);
    const klass = classes.find((c) => c.id === form.class_id);
    const sub = subjects.find((s) => s.id === form.subject_id);
    const label =
      form.name.trim() ||
      `${sub?.name ?? "Cours"} — ${klass?.name ?? ""}`.trim();
    setBusy("add");
    try {
      const { error } = await supabase.from("teacher_sessions").insert({
        assignment_id: assignment.id,
        name: label,
        weekday: Number(form.weekday),
        duration_minutes: minutes,
        class_id: form.class_id || null,
        subject_id: form.subject_id || null,
      });
      if (error) throw error;
      await writeAudit("create", "teacher_sessions" as never, null, { assignment_id: assignment.id });
      await qc.invalidateQueries({ queryKey: ["teacher_sessions"] });
      toast.success("Séance ajoutée");
      setAddOpen(false);
      setForm({ class_id: "", subject_id: "", weekday: "1", hours: "2", name: "" });
      setSubjects([]);
    } catch (e) {
      toast.error(describeError(e, "Création impossible"));
    } finally {
      setBusy(null);
    }
  };

  const formatNumberHours = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(1));

  return (
    <Card className="border-border/80">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-primary" />
            Emploi du temps
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Semaine du {weekStart} · cases réinitialisées chaque lundi
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="tabular-nums">
            {formatNumberHours(hours)} h validées · {formatFCFA(due)}
          </Badge>
          <Button size="sm" className="press" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Séance
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {sessions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Aucune séance. Ajoutez des séances (classe, matière, jour, heures).
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {sessions.map((s) => {
              const done = completedIds.has(s.id);
              const klass = classes.find((c) => c.id === (s as { class_id?: string }).class_id);
              return (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Checkbox
                    checked={done}
                    disabled={busy === s.id}
                    onCheckedChange={(v) => void toggleSession(s, v === true)}
                    aria-label={`Valider ${s.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {weekdayLabel(s.weekday)} · {formatDuration(s.duration_minutes)}
                      {klass ? ` · ${klass.name}` : ""}
                      {done ? " · validée cette semaine" : ""}
                    </p>
                  </div>
                  <Badge variant={done ? "default" : "outline"} className="shrink-0 tabular-nums text-[10px]">
                    {done ? (
                      <>
                        <Check className="mr-1 h-3 w-3" />
                        {formatFCFA((s.duration_minutes / 60) * rate)}
                      </>
                    ) : (
                      formatDuration(s.duration_minutes)
                    )}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive"
                    disabled={busy === s.id}
                    onClick={() => void removeSession(s.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">
          Tarif : {formatFCFA(rate)} / h · Dû cumulé (toutes semaines validées) : {formatFCFA(due)}
        </p>
      </CardContent>

      <Dialog open={addOpen} onOpenChange={(open) => {
        setAddOpen(open);
        if (!open) {
          setForm({ class_id: "", subject_id: "", weekday: "1", hours: "2", name: "" });
          setSubjects([]);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nouvelle séance</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label className="mb-1.5 block text-sm">Classe</Label>
              <Select
                value={form.class_id || undefined}
                onValueChange={(v) => {
                  setForm((f) => ({ ...f, class_id: v, subject_id: "" }));
                  void loadSubjects(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choisir une classe" />
                </SelectTrigger>
                <SelectContent>
                  {classes.length === 0 ? (
                    <div className="px-2 py-3 text-center text-sm text-muted-foreground">
                      Aucune classe active
                    </div>
                  ) : (
                    classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">Matière</Label>
              <Select
                value={form.subject_id || undefined}
                onValueChange={(v) => setForm((f) => ({ ...f, subject_id: v }))}
                disabled={!form.class_id || subjectsLoading}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      !form.class_id
                        ? "Choisir d'abord une classe"
                        : subjectsLoading
                          ? "Chargement…"
                          : subjects.length === 0
                            ? "Aucune matière (optionnel)"
                            : "Matière de la classe"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {subjectsLoading ? (
                    <div className="px-2 py-3 text-center text-sm text-muted-foreground">
                      Chargement des matières…
                    </div>
                  ) : subjects.length === 0 ? (
                    <div className="px-2 py-3 text-center text-sm text-muted-foreground">
                      {form.class_id
                        ? "Aucune matière définie pour cette classe. Vous pouvez renseigner un libellé ci-dessous."
                        : "Sélectionnez une classe"}
                    </div>
                  ) : (
                    subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {form.class_id && !subjectsLoading && subjects.length === 0 && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Ajoutez des matières sur la page de la classe, ou utilisez le libellé libre.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block text-sm">Jour</Label>
                <Select value={form.weekday} onValueChange={(v) => setForm((f) => ({ ...f, weekday: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.filter((d) => d.value !== 0).map((d) => (
                      <SelectItem key={d.value} value={String(d.value)}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block text-sm">Heures</Label>
                <Input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={form.hours}
                  onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">Libellé (optionnel)</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ex. Maths TSE — lundi"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Annuler
            </Button>
            <Button disabled={busy === "add"} onClick={() => void addSession()}>
              Ajouter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
