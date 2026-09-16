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
import { describeError } from "@/lib/errors";
import type { ClassSubject, GradePeriod } from "@/lib/grades";
import { isSubjectLabel } from "@/lib/xlsx-template";

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
  // Exclure les faux libellés éventuellement déjà en base (Total, Observations…).
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
    !!subjectId &&
    scaleNum > 0 &&
    Object.values(values).some((v) => v !== "") &&
    !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const finalSubjectId = subjectId;

      let period = currentPeriod;
      if (!period) {
        const { data: created, error } = await supabase
          .from("grade_periods")
          .insert({ class_id: classId, establishment_id: establishmentId, period_number: 1 })
          .select()
          .single();
        if (error) throw error;
        period = created;
      }

      const entries = Object.entries(values).filter(([, v]) => v !== "" && !Number.isNaN(Number(v)));
      if (entries.length === 0) {
        toast.error("Saisissez au moins une note.");
        return;
      }

      if (nature === "composition") {
        for (const [studentId, value] of entries) {
          const payload = {
            period_id: period.id,
            class_id: classId,
            establishment_id: establishmentId,
            subject_id: finalSubjectId,
            student_id: studentId,
            nature: "composition" as const,
            sequence_number: 1,
            value: Number(value),
            scale: scaleNum,
          };
          const { data: existing, error: selErr } = await supabase
            .from("grades")
            .select("id")
            .eq("period_id", period.id)
            .eq("subject_id", finalSubjectId)
            .eq("student_id", studentId)
            .eq("nature", "composition")
            .maybeSingle();
          if (selErr) throw selErr;
          if (existing?.id) {
            const { error } = await supabase
              .from("grades")
              .update({ value: payload.value, scale: payload.scale })
              .eq("id", existing.id);
            if (error) throw error;
          } else {
            const { error } = await supabase.from("grades").insert(payload);
            if (error) throw error;
          }
        }
      } else {
        const rows = entries.map(([studentId, value]) => ({
          period_id: period.id,
          class_id: classId,
          establishment_id: establishmentId,
          subject_id: finalSubjectId,
          student_id: studentId,
          nature: "evaluation" as const,
          value: Number(value),
          scale: scaleNum,
        }));
        const { error } = await supabase.from("grades").insert(rows);
        if (error) throw error;
      }

      try {
        await writeAudit("create", "grades" as never, null, {
          class_id: classId,
          subject_id: finalSubjectId,
          nature,
          count: entries.length,
        });
      } catch {
        // L'audit ne doit jamais bloquer l'enregistrement des notes.
      }
      qc.invalidateQueries({ queryKey: ["grades"] });
      qc.invalidateQueries({ queryKey: ["class_subjects"] });
      qc.invalidateQueries({ queryKey: ["grade_periods"] });
      toast.success(`${entries.length} note(s) enregistrée(s)`);
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
            Choisissez la nature, la matière et le barème, puis remplissez la note de chaque élève concerné (les
            champs laissés vides sont ignorés).
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
            {nature === "composition" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Une seule composition par matière et par période — une nouvelle saisie remplace la précédente.
              </p>
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
                Aucune matière. Importez d'abord un modèle de bulletin Excel pour cette classe — les matières sont
                extraites automatiquement du modèle.
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
