/**
 * Dialogue de saisie de notes — matières du plan bulletin, hors ligne OK.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { writeAudit } from "@/lib/data";
import { describeError } from "@/lib/errors";
import { enqueue } from "@/lib/offline-queue";
import { flushQueue } from "@/lib/offline-sync";
import { isSubjectLabel } from "@/lib/xlsx-template";
import { subjectsOfTemplate, type GradeNature } from "@/lib/report-template";
import { evaluationColumnAverage, type ClassSubject, type GradePeriod, type Grade } from "@/lib/grades";
import { ensureOpenPeriod } from "@/lib/period-lifecycle";

type StudentRef = { id: string; first_name: string; last_name: string };

const isOnline = () => typeof navigator === "undefined" || navigator.onLine;

const DEFAULT_NATURE_LABELS: Record<GradeNature, string> = {
  evaluation: "Note d'évaluation",
  composition: "Note de composition",
};

function applyOptimisticGrades(
  qc: ReturnType<typeof useQueryClient>,
  rows: Record<string, unknown>[],
) {
  qc.setQueriesData({ queryKey: ["grades"] }, (old: unknown) => {
    if (!Array.isArray(old)) return old;
    const byId = new Map((old as { id: string }[]).map((r) => [r.id, r]));
    for (const row of rows) {
      const id = String(row.id);
      byId.set(id, { ...(byId.get(id) ?? {}), ...row });
    }
    return Array.from(byId.values());
  });
}

function removeOptimisticGrades(
  qc: ReturnType<typeof useQueryClient>,
  ids: string[],
) {
  const idSet = new Set(ids);
  qc.setQueriesData({ queryKey: ["grades"] }, (old: unknown) => {
    if (!Array.isArray(old)) return old;
    return (old as { id: string }[]).filter((r) => !idSet.has(r.id));
  });
}

export function NoteEntryDialog({
  open,
  onClose,
  classId,
  establishmentId,
  students,
  subjects,
  currentPeriod,
  subjectLabels,
  allowedNatures,
  natureLabels,
  existingGrades = [],
}: {
  open: boolean;
  onClose: () => void;
  classId: string;
  establishmentId: string;
  students: StudentRef[];
  subjects: ClassSubject[];
  currentPeriod: GradePeriod | null;
  subjectLabels?: string[];
  allowedNatures?: GradeNature[];
  natureLabels?: Partial<Record<GradeNature, string>>;
  existingGrades?: Grade[];
}) {
  const qc = useQueryClient();
  const realSubjects = subjectsOfTemplate(
    subjects.filter((s) => isSubjectLabel(s.name)),
    subjectLabels,
  );
  const natures: GradeNature[] =
    allowedNatures && allowedNatures.length > 0
      ? allowedNatures
      : ["evaluation", "composition"];
  const labelFor = (n: GradeNature) =>
    (natureLabels?.[n] && natureLabels[n]!.trim()) || DEFAULT_NATURE_LABELS[n];
  const naturesKey = natures.join("|");
  const [nature, setNature] = useState<GradeNature>(natures[0]!);
  const [subjectId, setSubjectId] = useState("");
  const [scale, setScale] = useState("20");
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const allowed = naturesKey.split("|") as GradeNature[];
    if (!allowed.includes(nature)) {
      setNature(allowed[0]!);
    }
  }, [naturesKey, nature]);

  useEffect(() => {
    if (open) {
      setValues({});
      setSubjectId(realSubjects[0]?.id ?? "");
      setScale("20");
    }
  }, [open, realSubjects]);

  const onSubmit = async () => {
    if (!subjectId) {
      toast.error("Choisissez une matière");
      return;
    }
    const scaleNum = Number(scale);
    if (!Number.isFinite(scaleNum) || scaleNum <= 0) {
      toast.error("Barème invalide");
      return;
    }
    const entries = students
      .map((s) => {
        const raw = values[s.id]?.trim();
        if (!raw) return null;
        const value = Number(raw.replace(",", "."));
        if (!Number.isFinite(value)) return null;
        return { student: s, value };
      })
      .filter(Boolean) as { student: StudentRef; value: number }[];
    if (!entries.length) {
      toast.error("Saisissez au moins une note");
      return;
    }
    const outOfRange = entries.filter((e) => e.value < 0 || e.value > scaleNum);
    if (outOfRange.length) {
      const sample = outOfRange
        .slice(0, 2)
        .map((e) => `${e.student.last_name} (${e.value})`)
        .join(", ");
      toast.error(
        `Note hors barème (0–${scaleNum}) : ${sample}${outOfRange.length > 2 ? "…" : ""}`,
      );
      return;
    }
    setSubmitting(true);
    try {
      let period = currentPeriod;
      if (!period) {
        period = await ensureOpenPeriod(classId, establishmentId);
        qc.invalidateQueries({ queryKey: ["grade_periods"] });
        toast.message(`Période ${period.period_number} ouverte — enregistrement des notes.`);
      }
      const periodId = period.id;
      const rows: Record<string, unknown>[] = [];
      for (const { student, value } of entries) {
        const id = crypto.randomUUID();
        let sequence_number = 1;
        if (nature === "composition") {
          const prior = existingGrades.filter(
            (g) =>
              g.student_id === student.id &&
              g.subject_id === subjectId &&
              g.period_id === periodId &&
              g.nature === "composition",
          );
          sequence_number = prior.length + 1;
        } else {
          const prior = existingGrades.filter(
            (g) =>
              g.student_id === student.id &&
              g.subject_id === subjectId &&
              g.period_id === periodId &&
              g.nature === "evaluation",
          );
          sequence_number = prior.length + 1;
        }
        rows.push({
          id,
          class_id: classId,
          establishment_id: establishmentId,
          student_id: student.id,
          subject_id: subjectId,
          period_id: periodId,
          nature,
          value,
          scale: scaleNum,
          sequence_number,
        });
      }
      if (isOnline()) {
        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase.from("grades").insert(rows as never);
        if (error) throw error;
        for (const row of rows) {
          await writeAudit("create", "grades" as never, null, row);
        }
        applyOptimisticGrades(qc, rows);
        qc.invalidateQueries({ queryKey: ["grades"] });
        const gradeIds = rows.map((r) => String(r.id));
        toast.success(`${rows.length} note(s) enregistrée(s)`, {
          duration: 10_000,
          action: {
            label: "Annuler",
            onClick: () => {
              void (async () => {
                try {
                  const { error: delErr } = await supabase
                    .from("grades")
                    .delete()
                    .in("id", gradeIds);
                  if (delErr) throw delErr;
                  for (const row of rows) {
                    await writeAudit("delete", "grades" as never, String(row.id), {});
                  }
                  removeOptimisticGrades(qc, gradeIds);
                  qc.invalidateQueries({ queryKey: ["grades"] });
                  toast.message("Note(s) annulée(s)");
                } catch (err) {
                  toast.error(describeError(err, "Annulation impossible"));
                }
              })();
            },
          },
        });
      } else {
        for (const row of rows) {
          enqueue({
            id: crypto.randomUUID(),
            table: "grades",
            op: "insert",
            payload: row,
            createdAt: Date.now(),
            label: `Note ${labelFor(nature)}`,
          });
        }
        applyOptimisticGrades(qc, rows);
        toast.message(`${rows.length} note(s) en file hors ligne`);
      }
      onClose();
      void flushQueue();
    } catch (e) {
      toast.error(describeError(e, "Impossible d'enregistrer les notes"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enregistrer une note</DialogTitle>
          <DialogDescription>
            Matières et types de notes issus du modèle Excel. Hors ligne OK.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-sm">Nature</Label>
            {natures.length === 1 ? (
              <div className="flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 text-sm">
                {labelFor(natures[0]!)}
              </div>
            ) : (
              <Select value={nature} onValueChange={(v) => setNature(v as GradeNature)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {natures.map((n) => (
                    <SelectItem key={n} value={n}>
                      {labelFor(n)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">
              Barème<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input type="number" step="any" value={scale} onChange={(e) => setScale(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">
              Matière<span className="ml-0.5 text-destructive">*</span>
            </Label>
            {realSubjects.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Aucune matière disponible.
              </p>
            ) : (
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choisir…" />
                </SelectTrigger>
                <SelectContent>
                  {realSubjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <div className="mt-2 space-y-2">
          <Label className="text-sm">Notes par élève</Label>
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-2">
            {students.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {s.last_name} {s.first_name}
                </span>
                <Input
                  className={(() => {
                    const raw = values[s.id]?.trim();
                    if (!raw) return "w-24";
                    const n = Number(raw.replace(",", "."));
                    const scaleNum = Number(scale);
                    if (!Number.isFinite(n)) return "w-24 border-destructive";
                    if (Number.isFinite(scaleNum) && (n < 0 || n > scaleNum))
                      return "w-24 border-destructive focus-visible:ring-destructive";
                    return "w-24";
                  })()}
                  type="number"
                  step="any"
                  min={0}
                  max={Number(scale) || undefined}
                  placeholder="—"
                  aria-invalid={(() => {
                    const raw = values[s.id]?.trim();
                    if (!raw) return false;
                    const n = Number(raw.replace(",", "."));
                    const scaleNum = Number(scale);
                    return (
                      !Number.isFinite(n) ||
                      (Number.isFinite(scaleNum) && (n < 0 || n > scaleNum))
                    );
                  })()}
                  value={values[s.id] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [s.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button type="button" disabled={submitting} onClick={() => void onSubmit()}>
            {submitting ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
