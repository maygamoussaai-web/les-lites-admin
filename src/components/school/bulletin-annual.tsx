/**
 * Bulletin annuel — moyennes issues des bulletins périodiques (formules modèle).
 * Aucune moyenne inventée à partir des notes brutes.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { describeError } from "@/lib/errors";
import { canvasToPdfBlob } from "@/lib/pdf-export";
import type { ClassSubject, GradePeriod, Grade, StudentReportCard } from "@/lib/grades";

type StudentRef = { id: string; first_name: string; last_name: string };

export function renderBulletinCanvas({
  establishmentName,
  className,
  studentName,
  periodNumber,
  subjectLines,
  average,
}: {
  establishmentName: string;
  className: string;
  studentName: string;
  periodNumber: number;
  subjectLines: { name: string; average: number | null }[];
  average: number | null;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#12266B";
  ctx.font = "bold 34px sans-serif";
  ctx.fillText(establishmentName, 60, 80);
  ctx.font = "bold 44px sans-serif";
  ctx.fillText(
    periodNumber === 0 ? "BULLETIN ANNUEL" : `BULLETIN — Période ${periodNumber}`,
    60,
    140,
  );
  ctx.fillStyle = "#374151";
  ctx.font = "24px sans-serif";
  ctx.fillText(`Classe : ${className}`, 60, 190);
  ctx.fillText(`Élève : ${studentName}`, 60, 230);
  let y = 300;
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("Matière", 60, y);
  ctx.fillText("Moyenne", 900, y);
  y += 40;
  ctx.font = "20px sans-serif";
  for (const line of subjectLines) {
    ctx.fillText(line.name, 60, y);
    ctx.fillText(line.average !== null ? line.average.toFixed(2) : "—", 900, y);
    y += 36;
  }
  y += 20;
  ctx.font = "bold 24px sans-serif";
  ctx.fillText(
    `Moyenne générale : ${average !== null ? average.toFixed(2) : "—"} / 20`,
    60,
    y,
  );
  return canvas;
}

export function AnnualBulletinDialog({
  open,
  onClose,
  klass,
  establishmentName,
  students,
  subjects,
  periods,
}: {
  open: boolean;
  onClose: () => void;
  klass: { id: string; name: string; establishment_id: string };
  establishmentName: string;
  students: StudentRef[];
  subjects: ClassSubject[];
  periods: GradePeriod[];
  /** Conservé pour compatibilité d'appel — non utilisé pour calculer des moyennes. */
  grades?: Grade[];
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  const generateAll = async () => {
    setBusy(true);
    setDone(0);
    try {
      const periodIds = periods.map((p) => p.id);
      if (!periodIds.length) {
        toast.error("Aucune période disponible.");
        return;
      }
      const { data: cards, error } = await supabase
        .from("student_report_cards")
        .select("*")
        .eq("class_id", klass.id)
        .in("period_id", periodIds);
      if (error) throw error;
      const list = (cards ?? []) as StudentReportCard[];

      for (const s of students) {
        const studentCards = list.filter((c) => c.student_id === s.id);
        const periodAvgs = studentCards
          .map((c) =>
            c.general_average !== null && c.general_average !== undefined
              ? Number(c.general_average)
              : null,
          )
          .filter((v): v is number => v !== null && Number.isFinite(v));
        const annual =
          periodAvgs.length > 0
            ? periodAvgs.reduce((a, b) => a + b, 0) / periodAvgs.length
            : null;

        const subjectLines = subjects.map((sub) => {
          const vals: number[] = [];
          for (const c of studentCards) {
            const sa = c.subject_averages as Record<string, number | null> | null;
            const v = sa?.[sub.name];
            if (v !== null && v !== undefined && Number.isFinite(Number(v))) vals.push(Number(v));
          }
          return {
            name: sub.name,
            average: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
          };
        });

        const canvas = renderBulletinCanvas({
          establishmentName,
          className: klass.name,
          studentName: `${s.last_name} ${s.first_name}`,
          periodNumber: 0,
          subjectLines,
          average: annual,
        });
        const blob = await canvasToPdfBlob(canvas);
        const path = `${klass.establishment_id}/${s.id}/bulletin-annuel-${Date.now()}.pdf`;
        await supabase.storage.from("student-documents").upload(path, blob, {
          contentType: "application/pdf",
        });
        await supabase.from("student_documents").insert({
          student_id: s.id,
          establishment_id: klass.establishment_id,
          name: "Bulletin annuel",
          file_path: path,
          file_type: "application/pdf",
          file_size: blob.size,
        });
        setDone((d) => d + 1);
      }
      qc.invalidateQueries({ queryKey: ["student_documents"] });
      toast.success("Bulletins annuels générés");
      onClose();
    } catch (e) {
      toast.error(describeError(e, "Génération annuelle impossible"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulletin annuel</DialogTitle>
          <DialogDescription>
            Moyennes annuelles à partir des bulletins périodiques déjà générés (
            {periods.length} période{periods.length > 1 ? "s" : ""}).
          </DialogDescription>
        </DialogHeader>
        {busy && (
          <p className="text-sm text-muted-foreground">
            {done} / {students.length}…
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => void generateAll()} disabled={busy || students.length === 0}>
            {busy ? "Génération…" : "Générer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
