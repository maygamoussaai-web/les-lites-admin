/**
 * Dialogue de saisie de notes (matière/nature, toute la classe).
 * Les matières viennent du plan bulletin (class_subjects) — pas de création libre.
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
import { supabase } from "@/integrations/supabase/client";
import { writeAudit } from "@/lib/data";
import type { ClassSubject, GradePeriod } from "@/lib/grades";

type StudentRef = { id: string; first_name: string; last_name: string };

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
  const [nature, setNature] = useState<"evaluation" | "composition">("evaluation");
  const [subjectId, setSubjectId] = useState("");
  const [scale, setScale] = useState("20");
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNature("evaluation");
    setSubjectId(subjects[0]?.id ?? "");
    setScale("20");
    setValues({});
    setSubmitting(false);
  }, [open, subjects]);

  const scaleNum = Number(scale) || 20;
  const entries = students
    .map((s) => ({ student: s, raw: values[s.id]?.trim() ?? "" }))
    .filter((e) => e.raw !== "");
  const canSubmit =
    !!subjectId &&
    subjects.some((s) => s.id === subjectId) &&
    entries.length > 0 &&
    scaleNum > 0 &&
    !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      let periodId = currentPeriod?.id ?? null;
      if (!periodId) {
        const nextNumber = 1;
        const { data: created, error } = await supabase
          .from("grade_periods")
          .insert({ class_id: classId, establishment_id: establishmentId, period_number: nextNumber })
          .select()
          .single();
        if (error) throw error;
        periodId = created.id;
        qc.invalidateQueries({ queryKey: ["grade_periods"] });
      }

      const rows = entries.map(({ student, raw }) => ({
        period_id: periodId!,
        subject_id: subjectId,
        student_id: student.id,
        class_id: classId,
        establishment_id: establishmentId,
        nature,
        value: Number(raw),
        scale: scaleNum,
      }));

      const { error } = await supabase.from("grades").upsert(rows, {
        onConflict: "period_id,subject_id,student_id,nature",
        ignoreDuplicates: false,
      });
      if (error) throw error;

      await writeAudit("create", "grades" as never, null, {
        class_id: classId,
        subject_id: subjectId,
        nature,
        count: entries.length,
      });
      qc.invalidateQueries({ queryKey: ["grades"] });
      toast.success(`${entries.length} note(s) enregistrée(s)`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Enregistrement impossible");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enregistrer une note</DialogTitle>
          <DialogDescription>
            Choisissez la nature, la matière et le barème, puis remplissez la note de chaque élève concerné.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label className="mb-1.5 block text-sm">Nature</Label>
            <Select value={nature} onValueChange={(v) => setNature(v as "evaluation" | "composition")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="evaluation">Évaluation</SelectItem>
                <SelectItem value="composition">Composition</SelectItem>
              </SelectContent>
            </Select>
            {nature === "composition" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Une seule composition par matière et par période — une nouvelle saisie remplace la précédente.
              </p>
            )}
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">Matière</Label>
            {subjects.length === 0 ? (
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Aucune matière. Importez d&apos;abord un modèle de bulletin Excel pour cette classe — les matières sont
                extraites automatiquement du plan.
              </p>
            ) : (
              <Select value={subjectId || undefined} onValueChange={setSubjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner une matière" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">Barème</Label>
            <Input type="number" step="any" value={scale} onChange={(e) => setScale(e.target.value)} />
          </div>
        </div>

        <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
          {students.map((s) => (
            <div key={s.id} className="flex items-center gap-3">
              <span className="w-40 shrink-0 truncate text-sm font-medium">
                {s.last_name} {s.first_name}
              </span>
              <Input
                type="number"
                step="any"
                placeholder="—"
                className="h-8"
                value={values[s.id] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [s.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={!canSubmit || subjects.length === 0}>
            {submitting ? "Enregistrement…" : `Enregistrer (${entries.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
