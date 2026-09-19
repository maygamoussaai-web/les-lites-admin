/**
 * Helpers bulletins : walkthrough + reexport annuel.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { writeAudit } from "@/lib/data";
import { describeError } from "@/lib/errors";
import { downloadBlob } from "@/lib/pdf-export";
import { uploadBulletinWorkbook } from "@/lib/storage-upload";
import { useActiveReportTemplate, templateBuffer as getTemplateBuffer } from "@/lib/report-template";
import { writeFilledWorkbook } from "@/lib/xlsx-writeback";
import { buildModelFillData } from "@/lib/model-averages";
import {
  studentPeriodAverage, type ClassSubject, type GradePeriod, type Grade,
} from "@/lib/grades";
import type { ClassRow } from "@/lib/school";

type StudentRef = { id: string; first_name: string; last_name: string };

export function BulletinWalkthroughDialog({
  open, onClose, klass, establishmentName, students, subjects, period, grades,
}: {
  open: boolean;
  onClose: () => void;
  klass: ClassRow;
  establishmentName: string;
  students: StudentRef[];
  subjects: ClassSubject[];
  period: GradePeriod;
  grades: Grade[];
}) {
  const qc = useQueryClient();
  const { template: activeTemplate } = useActiveReportTemplate(klass.id);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  const ranked = useMemo(() => {
    return students
      .map((s) => ({ student: s, avg: studentPeriodAverage(grades, s.id) }))
      .filter((r): r is { student: StudentRef; avg: number } => r.avg !== null)
      .sort((a, b) => b.avg - a.avg);
  }, [students, grades]);

  const generate = async () => {
    if (!activeTemplate) {
      toast.error("Aucun modèle Excel actif pour cette classe.");
      return;
    }
    const buf = getTemplateBuffer(activeTemplate);
    if (!buf || buf.byteLength < 64) {
      toast.error("Modèle Excel indisponible — rechargez la page.");
      return;
    }
    setBusy(true);
    setDone(0);
    try {
      let count = 0;
      for (let i = 0; i < ranked.length; i++) {
        const { student, avg } = ranked[i]!;
        const fill = buildModelFillData({
          establishmentName,
          className: klass.name,
          studentFirstName: student.first_name,
          studentLastName: student.last_name,
          periodNumber: period.period_number,
          subjects,
          grades,
          studentId: student.id,
          headcount: students.length,
          scale: activeTemplate.scale,
          rank: i + 1,
          firstAverage: ranked[0]?.avg ?? null,
          lastAverage: ranked[ranked.length - 1]?.avg ?? null,
        });
        const written = writeFilledWorkbook(buf, activeTemplate.mapping, fill);
        const blob = new Blob([written.buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const fileName = `Bulletin_${student.last_name}_${student.first_name}_P${period.period_number}.xlsx`;
        downloadBlob(blob, fileName);
        const storagePath = `${klass.establishment_id}/${klass.id}/${student.id}/P${period.period_number}/${fileName}`;
        try {
          await uploadBulletinWorkbook(storagePath, blob);
        } catch {
          /* stockage optionnel — téléchargement local déjà fait */
        }
        const general = written.computed.generalAverage ?? avg;
        await supabase.from("student_report_cards").upsert(
          {
            student_id: student.id,
            class_id: klass.id,
            establishment_id: klass.establishment_id,
            period_id: period.id,
            general_average: general,
            subject_averages: written.computed.subjectAverages as never,
            generated_at: new Date().toISOString(),
          } as never,
          { onConflict: "student_id,period_id" },
        );
        count++;
        setDone(count);
      }
      await writeAudit("create", "student_report_cards" as never, null, {
        class_id: klass.id,
        period_id: period.id,
        count,
      });
      qc.invalidateQueries({ queryKey: ["student_report_cards"] });
      toast.success(`${count} bulletin(s) généré(s) en .xlsx`);
      onClose();
    } catch (e) {
      toast.error(describeError(e, "Génération des bulletins impossible"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Créer les bulletins</DialogTitle>
          <DialogDescription>
            Génération Excel à partir du modèle actif — période {period.period_number}.
            {" "}{ranked.length} élève(s) avec notes. Les fichiers .xlsx se téléchargent automatiquement.
          </DialogDescription>
        </DialogHeader>
        {!activeTemplate && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Aucun modèle Excel actif. Activez un modèle dans la section « Modèle de bulletin ».
          </p>
        )}
        {busy && (
          <p className="text-sm text-muted-foreground">
            Génération… {done} / {ranked.length}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Annuler</Button>
          <Button className="press" onClick={() => void generate()} disabled={busy || !activeTemplate || ranked.length === 0}>
            <Download className="mr-1.5 h-4 w-4" />
            {busy ? "Génération…" : `Générer ${ranked.length} bulletin(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { AnnualBulletinDialog, renderBulletinCanvas } from "@/components/school/bulletin-annual";
