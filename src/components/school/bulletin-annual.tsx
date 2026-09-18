/**
 * Bulletin annuel + canvas provisoire (sans modele Excel).
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
import { canvasToPdfBlob } from "@/lib/pdf-export";
import { writeAudit } from "@/lib/data";
import {
  subjectAverage,
  studentAverage,
  groupGradesBySubject,
  type ClassSubject,
  type GradePeriod,
  type Grade,
} from "@/lib/grades";

type StudentRef = { id: string; first_name: string; last_name: string };

export function renderBulletinCanvas({
  establishmentName,
  className,
  studentName,
  periodNumber,
  subjects,
  bySubject,
  average,
}: {
  establishmentName: string;
  className: string;
  studentName: string;
  periodNumber: number;
  subjects: ClassSubject[];
  bySubject: Map<string, Grade[]>;
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
  ctx.fillText(periodNumber === 0 ? "BULLETIN ANNUEL" : `BULLETIN — Periode ${periodNumber}`, 60, 140);
  ctx.fillStyle = "#374151";
  ctx.font = "24px sans-serif";
  ctx.fillText(`Classe : ${className}`, 60, 190);
  ctx.fillText(`Eleve : ${studentName}`, 60, 230);
  let y = 300;
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("Matiere", 60, y);
  ctx.fillText("Moyenne", 900, y);
  y += 40;
  ctx.font = "20px sans-serif";
  for (const s of subjects) {
    const avg = subjectAverage(bySubject.get(s.id) ?? []);
    ctx.fillText(s.name, 60, y);
    ctx.fillText(avg !== null ? avg.toFixed(2) : "—", 900, y);
    y += 32;
  }
  y += 20;
  ctx.font = "bold 24px sans-serif";
  ctx.fillText(`Moyenne generale : ${average !== null ? average.toFixed(2) : "—"}`, 60, y);
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
  grades,
}: {
  open: boolean;
  onClose: () => void;
  klass: { id: string; name: string; establishment_id: string };
  establishmentName: string;
  students: StudentRef[];
  subjects: ClassSubject[];
  periods: GradePeriod[];
  grades: Grade[];
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      for (const s of students) {
        const bySubject = groupGradesBySubject(grades, s.id);
        const average = studentAverage(bySubject);
        const canvas = renderBulletinCanvas({
          establishmentName,
          className: klass.name,
          studentName: `${s.last_name} ${s.first_name}`,
          periodNumber: 0,
          subjects,
          bySubject,
          average,
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
      }
      await writeAudit("create", "student_documents" as never, null, { class_id: klass.id, kind: "annual" });
      qc.invalidateQueries({ queryKey: ["student_documents"] });
      toast.success("Bulletins annuels generes");
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Generation annuelle impossible");
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
            Combine les periodes de {klass.name} ({periods.length} periode(s), {students.length} eleve(s)).
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={generate} disabled={busy}>
            {busy ? "Generation…" : "Generer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
