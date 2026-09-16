/**
 * Dialogue de saisie de notes — matières du plan bulletin, hors ligne OK.
 */
import { useState } from "react";
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
import type { ClassSubject, GradePeriod } from "@/lib/grades";

type StudentRef = { id: string; first_name: string; last_name: string };

const isOnline = () => typeof navigator === "undefined" || navigator.onLine;

function applyOptimisticGrades(
  qc: ReturnType<typeof useQueryClient>,
  rows: Record<string, unknown>[],
) {
  qc.setQueriesData({ queryKey: ["grades"] }, (old: unknown) => {
    if (!Array.isArray(old)) return old;
    const byId = new Map((old as { id: string }[]).map((r) => [r.id, r]));
    for (const row of rows) {
      const id = String(row.id);
      byId.set(id, { ...(byId.get(id) ?? {}), ...row } as { id: string });
    }
    return [...byId.values()];
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
}: {
  open: boolean;
  onClose: () => void;
  classId: string;
  establishmentId: string;
  students: StudentRef[];
  subjects: ClassSubject[];
  currentPeriod: GradePeriod | null;
}) {
  const qc = useQueryClient();
  const realSubjects = subjects.filter((s) => isSubjectLabel(s.name));
  const [nature, setNature] = useState<"composition" | "evaluation">("evaluation");
  const [subjectId, setSubjectId] = useState("");
  const [scale, setScale] = useState("20");
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setSubjectId("");
    setScale("20");
    setValues({});
  };

  const scaleNum = Number(scale);
  const canSubmit =
    !!subjectId && scaleNum > 0 && Object.values(values).some((v) => v !== "") && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const entries = Object.entries(values).filter(([, v]) => v !== "" && !Number.isNaN(Number(v)));
      if (entries.length === 0) {
        toast.error("Saisissez au moins une note.");
        return;
      }

      let periodId = currentPeriod?.id ?? null;
      if (!periodId) {
        periodId = crypto.randomUUID();
        const periodRow = {
          id: periodId,
          class_id: classId,
          establishment_id: establishmentId,
          period_number: 1,
          started_at: new Date().toISOString(),
          ended_at: null,
        };
        enqueue({
          id: crypto.randomUUID(),
          table: "grade_periods",
          op: "insert",
          rowId: periodId,
          values: periodRow,
          createdAt: Date.now(),
          label: "Période",
        });
        qc.setQueriesData({ queryKey: ["grade_periods"] }, (old: unknown) => {
          if (!Array.isArray(old)) return [periodRow];
          return [...old, periodRow];
        });
      }

      const optimistic: Record<string, unknown>[] = [];

      if (nature === "composition") {
        for (const [studentId, value] of entries) {
          const cached = (qc.getQueriesData({ queryKey: ["grades"] }) as [unknown, unknown][])
            .flatMap(([, data]) => (Array.isArray(data) ? data : []))
            .find(
              (g: any) =>
                g &&
                g.period_id === periodId &&
                g.subject_id === subjectId &&
                g.student_id === studentId &&
                g.nature === "composition",
            ) as { id?: string } | undefined;

          const rowId = cached?.id ?? crypto.randomUUID();
          const payload = {
            id: rowId,
            period_id: periodId,
            class_id: classId,
            establishment_id: establishmentId,
            subject_id: subjectId,
            student_id: studentId,
            nature: "composition" as const,
            sequence_number: 1,
            value: Number(value),
            scale: scaleNum,
          };
          enqueue({
            id: crypto.randomUUID(),
            table: "grades",
            op: cached?.id ? "update" : "insert",
            rowId,
            values: cached?.id ? { value: payload.value, scale: payload.scale } : payload,
            createdAt: Date.now(),
            label: "Note",
          });
          optimistic.push(payload);
        }
      } else {
        for (const [studentId, value] of entries) {
          const rowId = crypto.randomUUID();
          const payload = {
            id: rowId,
            period_id: periodId,
            class_id: classId,
            establishment_id: establishmentId,
            subject_id: subjectId,
            student_id: studentId,
            nature: "evaluation" as const,
            value: Number(value),
            scale: scaleNum,
          };
          enqueue({
            id: crypto.randomUUID(),
            table: "grades",
            op: "insert",
            rowId,
            values: payload,
            createdAt: Date.now(),
            label: "Note",
          });
          optimistic.push(payload);
        }
      }

      applyOptimisticGrades(qc, optimistic);

      try {
        await writeAudit("create", "grades" as never, null, {
          class_id: classId,
          subject_id: subjectId,
          nature,
          count: entries.length,
          offline: !isOnline(),
        });
      } catch {
        /* audit non bloquant */
      }

      if (isOnline()) {
        await flushQueue(qc);
        toast.success(`${entries.length} note(s) enregistrée(s)`);
      } else {
        toast.success(`${entries.length} note(s) enregistrée(s) — en attente de connexion`);
      }

      reset();
      onClose();
    } catch (e) {
      toast.error(describeError(e, "Enregistrement des notes impossible", "grades"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enregistrer une note</DialogTitle>
          <DialogDescription>
            Nature, matière et barème, puis notes par élève. Fonctionne aussi hors ligne.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-sm">Nature</Label>
            <Select value={nature} onValueChange={(v) => setNature(v as "composition" | "evaluation")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="evaluation">Note d'évaluation</SelectItem>
                <SelectItem value="composition">Note de composition</SelectItem>
              </SelectContent>
            </Select>
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
                Aucune matière. Importez d'abord un modèle de bulletin Excel.
              </p>
            ) : (
              <Select value={subjectId || undefined} onValueChange={setSubjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner une matière" />
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

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Élèves ({students.length})</p>
          {students.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun élève dans cette classe.</p>
          ) : (
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {students.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm">
                    {s.last_name} {s.first_name}
                  </span>
                  <Input
                    type="number"
                    step="any"
                    className="w-24"
                    value={values[s.id] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [s.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? "Enregistrement..." : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
