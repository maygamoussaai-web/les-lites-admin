/**
 * Génération des bulletins Excel.
 * Classement et moyennes = formules du modèle uniquement.
 *
 * Règle de vérité :
 * - Un bulletin n'est « généré » que s'il est uploadé, enregistré dans
 *   student_documents (bibliothèque élève) et lié via document_id.
 * - Jamais de toast de succès sans fichier réellement en bibliothèque.
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
import { useActiveReportTemplate, downloadActiveTemplateBuffer } from "@/lib/report-template";
import { writeFilledWorkbook } from "@/lib/xlsx-writeback";
import { buildModelFillData, computeModelAverages } from "@/lib/model-averages";
import { closeAndStartNextPeriod } from "@/lib/period-lifecycle";
import { type ClassSubject, type GradePeriod, type Grade } from "@/lib/grades";
import type { ClassRow } from "@/lib/school";

type StudentRef = { id: string; first_name: string; last_name: string };

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

  const candidates = useMemo(() => {
    const withNotes = new Set(grades.map((g) => g.student_id));
    return students.filter((s) => withNotes.has(s.id));
  }, [students, grades]);

  const generate = async () => {
    setBusy(true);
    setDone(0);
    let successCount = 0;
    const failures: string[] = [];

    try {
      const downloaded = await downloadActiveTemplateBuffer(klass.id);
      if (!downloaded) {
        toast.error("Aucun modèle Excel actif pour cette classe. Importez un modèle puis réessayez.");
        return;
      }
      const { buffer: buf, mapping, scale } = downloaded;

      const ranked: {
        student: StudentRef;
        avg: number;
        subjects: Record<string, number | null>;
      }[] = [];

      for (const student of candidates) {
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
          scale,
          rank: null,
          firstAverage: null,
          lastAverage: null,
        });
        const result = computeModelAverages(buf, mapping, fill);
        if (result.generalAverage === null) {
          failures.push(`${student.last_name} ${student.first_name} (moyenne modèle nulle)`);
          continue;
        }
        ranked.push({
          student,
          avg: result.generalAverage,
          subjects: result.subjectAverages,
        });
      }
      ranked.sort((a, b) => b.avg - a.avg);

      const firstAvg = ranked[0]?.avg ?? null;
      const lastAvg = ranked[ranked.length - 1]?.avg ?? null;

      for (let i = 0; i < ranked.length; i++) {
        const { student } = ranked[i]!;
        try {
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
            scale,
            rank: i + 1,
            firstAverage: firstAvg,
            lastAverage: lastAvg,
          });
          const written = writeFilledWorkbook(buf, mapping, fill);
          const bytes = new Uint8Array(written.buffer);
          const blob = new Blob([bytes], { type: XLSX_MIME });
          const fileName = `Bulletin_${student.last_name}_${student.first_name}_P${period.period_number}.xlsx`;
          downloadBlob(blob, fileName);

          const storagePath = `${klass.establishment_id}/${student.id}/bulletin-p${period.period_number}-${Date.now()}.xlsx`;
          const uploaded = await uploadBulletinWorkbook(storagePath, blob);
          const filePathStored =
            uploaded.bucket === "report-templates"
              ? `report-templates:${uploaded.path}`
              : uploaded.path;

          const docName = `Bulletin période ${period.period_number}`;
          const { data: doc, error: docErr } = await supabase
            .from("student_documents")
            .insert({
              student_id: student.id,
              establishment_id: klass.establishment_id,
              name: docName,
              file_path: filePathStored,
              file_type: XLSX_MIME,
              file_size: blob.size,
            })
            .select("id")
            .single();
          if (docErr || !doc) throw docErr ?? new Error("Enregistrement bibliothèque impossible");

          const general = written.computed.generalAverage ?? ranked[i]!.avg;
          const { error: cardErr } = await supabase.from("student_report_cards").upsert(
            {
              student_id: student.id,
              class_id: klass.id,
              establishment_id: klass.establishment_id,
              period_id: period.id,
              general_average: general,
              subject_averages: written.computed.subjectAverages as never,
              document_id: doc.id,
              status: "validated",
              validated_at: new Date().toISOString(),
            } as never,
            { onConflict: "student_id,period_id" },
          );
          if (cardErr) throw cardErr;

          successCount++;
          setDone(successCount);
        } catch (err) {
          failures.push(
            `${student.last_name} ${student.first_name}: ${describeError(err, "échec")}`,
          );
        }
      }

      await writeAudit("create", "student_report_cards" as never, null, {
        class_id: klass.id,
        period_id: period.id,
        count: successCount,
      });
      qc.invalidateQueries({ queryKey: ["student_report_cards"] });
      qc.invalidateQueries({ queryKey: ["student_documents"] });

      if (successCount === 0) {
        toast.error(
          failures.length
            ? `Aucun bulletin enregistré. ${failures[0]}`
            : "Aucun bulletin enregistré dans la bibliothèque.",
        );
        return;
      }

      if (failures.length) {
        toast.warning(
          `${successCount} bulletin(s) en bibliothèque, ${failures.length} échec(s).`,
        );
      } else {
        toast.success(
          `${successCount} bulletin(s) enregistré(s) dans la bibliothèque des élèves.`,
        );
      }

      const allCovered = candidates.every((s) =>
        ranked.some((r) => r.student.id === s.id),
      ) && failures.length === 0 && successCount >= candidates.length;

      if (allCovered && candidates.length > 0) {
        try {
          const { closedPeriodNumber, newPeriodNumber } = await closeAndStartNextPeriod(
            klass.id,
            klass.establishment_id,
          );
          qc.invalidateQueries({ queryKey: ["grade_periods"] });
          toast.success(
            closedPeriodNumber != null
              ? `Période ${closedPeriodNumber} clôturée — période ${newPeriodNumber} ouverte.`
              : `Période ${newPeriodNumber} ouverte.`,
          );
        } catch (e) {
          toast.error(describeError(e, "Bulletins OK, mais ouverture de période impossible"));
        }
      }

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
            Génération Excel à partir du modèle actif — période {period.period_number}.{" "}
            {candidates.length} élève(s) avec notes. Chaque fichier est placé dans la
            bibliothèque de l'élève ; la période se clôture quand tous sont générés.
          </DialogDescription>
        </DialogHeader>
        {!activeTemplate && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Aucun modèle Excel actif. Activez un modèle dans la section « Modèle de bulletin ».
          </p>
        )}
        {busy && (
          <p className="text-sm text-muted-foreground">
            Génération… {done} / {candidates.length}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            className="press"
            onClick={() => void generate()}
            disabled={busy || candidates.length === 0}
          >
            <Download className="mr-1.5 h-4 w-4" />
            {busy ? "Génération…" : `Générer ${candidates.length} bulletin(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { AnnualBulletinDialog, renderBulletinCanvas } from "@/components/school/bulletin-annual";
