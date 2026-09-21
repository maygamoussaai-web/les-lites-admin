/**
 * Génération des bulletins Excel.
 *
 * Règle de vérité (non négociable) :
 * 1. Upload storage (student-documents, fallback report-templates)
 * 2. Ligne student_documents (bibliothèque)
 * 3. student_report_cards.document_id = id du document
 * 4. Seulement alors le bulletin est « généré »
 *
 * Le téléchargement local optionnel se fait APRÈS l'enregistrement,
 * pour ne jamais perdre le fichier si le navigateur mobile bloque le download.
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

function toBlob(buffer: ArrayBuffer | Uint8Array): Blob {
  const copy = new Uint8Array(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
  return new Blob([copy], { type: XLSX_MIME });
}

export function BulletinWalkthroughDialog({
  open,
  onClose,
  klass,
  establishmentName,
  students,
  subjects,
  period,
  grades,
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
    const localDownloads: { blob: Blob; name: string }[] = [];

    try {
      const downloaded = await downloadActiveTemplateBuffer(klass.id);
      if (!downloaded) {
        toast.error(
          "Aucun modèle Excel actif pour cette classe. Importez un modèle puis réessayez.",
        );
        return;
      }
      const { buffer: buf, mapping, scale } = downloaded;

      const avgByStudent = new Map<
        string,
        { avg: number; subjects: Record<string, number | null> }
      >();
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
        if (result.generalAverage !== null) {
          avgByStudent.set(student.id, {
            avg: result.generalAverage,
            subjects: result.subjectAverages,
          });
        }
      }

      const rankedIds = [...avgByStudent.entries()]
        .sort((a, b) => b[1].avg - a[1].avg)
        .map(([id]) => id);
      const rankOf = new Map(rankedIds.map((id, i) => [id, i + 1]));
      const firstAvg = rankedIds.length ? avgByStudent.get(rankedIds[0]!)!.avg : null;
      const lastAvg = rankedIds.length
        ? avgByStudent.get(rankedIds[rankedIds.length - 1]!)!.avg
        : null;

      for (const student of candidates) {
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
            rank: rankOf.get(student.id) ?? null,
            firstAverage: firstAvg,
            lastAverage: lastAvg,
          });
          const written = writeFilledWorkbook(buf, mapping, fill);
          const blob = toBlob(written.buffer);
          const fileName = `Bulletin_${student.last_name}_${student.first_name}_P${period.period_number}.xlsx`;

          const storagePath = `${klass.establishment_id}/${student.id}/bulletin-p${period.period_number}-${Date.now()}.xlsx`;
          const uploaded = await uploadBulletinWorkbook(storagePath, blob);
          const filePathStored =
            uploaded.bucket === "report-templates"
              ? `report-templates:${uploaded.path}`
              : uploaded.bucket === "student-documents"
                ? uploaded.path
                : `${uploaded.bucket}:${uploaded.path}`;

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
            .select("id, file_path, name")
            .single();
          if (docErr || !doc?.id) {
            throw docErr ?? new Error("Enregistrement bibliothèque impossible (student_documents)");
          }

          const pre = avgByStudent.get(student.id);
          const general = written.computed.generalAverage ?? pre?.avg ?? null;
          const subjectAverages =
            written.computed.subjectAverages ?? pre?.subjects ?? {};

          const { error: cardErr } = await supabase.from("student_report_cards").upsert(
            {
              student_id: student.id,
              class_id: klass.id,
              establishment_id: klass.establishment_id,
              period_id: period.id,
              general_average: general,
              subject_averages: subjectAverages as never,
              document_id: doc.id,
              status: "validated",
              validated_at: new Date().toISOString(),
            } as never,
            { onConflict: "student_id,period_id" },
          );
          if (cardErr) {
            failures.push(
              `${student.last_name} ${student.first_name}: fichier en bibliothèque, fiche — ${describeError(cardErr, "erreur")}`,
            );
          }

          localDownloads.push({ blob, name: fileName });
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
      await qc.invalidateQueries({ queryKey: ["student_report_cards"] });
      await qc.invalidateQueries({ queryKey: ["student_documents"] });

      if (successCount === 0) {
        toast.error(
          failures.length
            ? `Aucun bulletin en bibliothèque. ${failures[0]}`
            : "Aucun bulletin enregistré dans la bibliothèque.",
        );
        return;
      }

      for (const file of localDownloads) {
        try {
          downloadBlob(file.blob, file.name);
        } catch {
          /* ignore */
        }
      }

      if (failures.length) {
        toast.warning(
          `${successCount} bulletin(s) en bibliothèque — ${failures.length} alerte(s) : ${failures[0]}`,
        );
      } else {
        toast.success(
          `${successCount} bulletin(s) enregistrés dans Documents de chaque élève.`,
        );
      }

      if (successCount >= candidates.length && candidates.length > 0) {
        try {
          const { closedPeriodNumber, newPeriodNumber } = await closeAndStartNextPeriod(
            klass.id,
            klass.establishment_id,
          );
          await qc.invalidateQueries({ queryKey: ["grade_periods"] });
          toast.success(
            closedPeriodNumber != null
              ? `Période ${closedPeriodNumber} clôturée — période ${newPeriodNumber} ouverte.`
              : `Période ${newPeriodNumber} ouverte.`,
          );
        } catch (e) {
          toast.error(describeError(e, "Bulletins OK, ouverture de période impossible"));
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
            Génération Excel — période {period.period_number}. {candidates.length} élève(s) avec
            notes. Chaque fichier est placé dans Documents de l&apos;élève avant validation.
          </DialogDescription>
        </DialogHeader>
        {!activeTemplate && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Aucun modèle Excel actif. Activez un modèle dans « Modèle de bulletin ».
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
            disabled={busy || candidates.length === 0 || !activeTemplate}
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
