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
import { useEffect, useMemo, useState } from "react";
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

function toBlob(buffer: ArrayBuffer | Uint8Array | number[]): Blob {
  let bytes: Uint8Array;
  if (buffer instanceof Uint8Array) bytes = buffer;
  else if (buffer instanceof ArrayBuffer) bytes = new Uint8Array(buffer);
  else if (Array.isArray(buffer)) bytes = new Uint8Array(buffer);
  else throw new Error("Buffer Excel invalide");
  if (!bytes.byteLength) throw new Error("Fichier bulletin vide — génération Excel a échoué.");
  return new Blob([bytes], { type: XLSX_MIME });
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
  /** Élèves ayant déjà un bulletin (document) pour cette période — exclus par défaut. */
  alreadyGeneratedIds = [],
}: {
  open: boolean;
  onClose: () => void;
  klass: ClassRow;
  establishmentName?: string;
  students: StudentRef[];
  subjects: ClassSubject[];
  period: GradePeriod | null;
  grades: Grade[];
  alreadyGeneratedIds?: string[];
}) {
  const qc = useQueryClient();
  const { template: activeTemplate, loading: templateLoading } = useActiveReportTemplate(klass.id);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [templateReady, setTemplateReady] = useState(false);
  const [forceRegenerate, setForceRegenerate] = useState(false);
  const etabName = establishmentName?.trim() || klass.name;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTemplateReady(false);
    (async () => {
      try {
        const t = await downloadActiveTemplateBuffer(klass.id, "period");
        if (!cancelled) setTemplateReady(!!t);
      } catch {
        if (!cancelled) setTemplateReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, klass.id]);

  const hasModel = templateReady || !!activeTemplate;

  const alreadySet = useMemo(
    () => new Set(alreadyGeneratedIds),
    [alreadyGeneratedIds],
  );

  const candidates = useMemo(() => {
    const withNotes = new Set(grades.map((g) => g.student_id));
    return students.filter((s) => {
      if (!withNotes.has(s.id)) return false;
      if (forceRegenerate) return true;
      return !alreadySet.has(s.id);
    });
  }, [students, grades, alreadySet, forceRegenerate]);

  const alreadyCount = useMemo(() => {
    const withNotes = new Set(grades.map((g) => g.student_id));
    return students.filter((s) => withNotes.has(s.id) && alreadySet.has(s.id)).length;
  }, [students, grades, alreadySet]);

  const generate = async () => {
    if (!period) {
      toast.error("Aucune période disponible. Démarrez une période d'abord.");
      return;
    }
    setBusy(true);
    setDone(0);
    let successCount = 0;
    const failures: string[] = [];
    const localDownloads: { blob: Blob; name: string }[] = [];
    toast.loading(
      candidates.length
        ? `Génération en cours… 0/${candidates.length}`
        : "Vérification…",
      { id: "bulletin-gen" },
    );

    try {
      const downloaded = await downloadActiveTemplateBuffer(klass.id, "period");
      if (!downloaded) {
        toast.error(
          "Aucun modèle Excel actif pour cette classe. Importez un modèle puis réessayez.",
          { id: "bulletin-gen" },
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
          establishmentName: etabName,
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
            establishmentName: etabName,
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
          const filled = writeFilledWorkbook(buf, mapping, fill);
          const rawBuf = filled.buffer;
          if (!rawBuf || (rawBuf instanceof ArrayBuffer && rawBuf.byteLength === 0)) {
            throw new Error("Génération Excel a produit un fichier vide.");
          }
          const blob = toBlob(rawBuf);
          if (!blob.size) {
            throw new Error("Fichier bulletin vide — génération Excel a échoué.");
          }
          const fileName = `Bulletin_${student.last_name}_${student.first_name}_P${period.period_number}.xlsx`;
          const storagePath = `${klass.establishment_id}/${student.id}/bulletin-p${period.period_number}-${Date.now()}.xlsx`;

          const uploaded = await uploadBulletinWorkbook(storagePath, blob);
          if (!uploaded?.path) throw new Error("Upload storage échoué");
          const storedPath =
            uploaded.bucket && uploaded.bucket !== "student-documents"
              ? `${uploaded.bucket}:${uploaded.path}`
              : uploaded.path;

          const docName = `Bulletin période ${period.period_number}`;
          const { data: docRow, error: docErr } = await supabase
            .from("student_documents")
            .insert({
              student_id: student.id,
              establishment_id: klass.establishment_id,
              name: docName,
              file_path: storedPath,
              file_type: XLSX_MIME,
              file_size: blob.size,
            })
            .select("id")
            .single();
          if (docErr || !docRow?.id) throw docErr ?? new Error("Document non créé");

          const avgInfo = avgByStudent.get(student.id);
          const { error: cardErr } = await supabase.from("student_report_cards").upsert(
            {
              student_id: student.id,
              class_id: klass.id,
              establishment_id: klass.establishment_id,
              period_id: period.id,
              document_id: docRow.id,
              general_average: avgInfo?.avg ?? null,
              subject_averages: avgInfo?.subjects ?? {},
            } as never,
            { onConflict: "student_id,period_id" },
          );
          if (cardErr) throw cardErr;

          await writeAudit("create", "student_report_cards" as never, null, {
            student_id: student.id,
            period_id: period.id,
            document_id: docRow.id,
          });

          localDownloads.push({ blob, name: fileName });
          successCount++;
        } catch (e) {
          failures.push(
            `${student.last_name} ${student.first_name}: ${describeError(e, "échec")}`,
          );
        }
        setDone((d) => {
          const next = d + 1;
          toast.loading(`Génération en cours… ${next}/${candidates.length}`, {
            id: "bulletin-gen",
          });
          return next;
        });
      }

      qc.invalidateQueries({ queryKey: ["student_documents"] });
      qc.invalidateQueries({ queryKey: ["student_report_cards"] });
      qc.invalidateQueries({ queryKey: ["grades"] });

      if (successCount > 0) {
        toast.success(
          `${successCount} bulletin(s) généré(s) et placé(s) en bibliothèque.`,
          { id: "bulletin-gen" },
        );
        for (const f of localDownloads) {
          try {
            downloadBlob(f.blob, f.name);
          } catch {
            /* mobile may block */
          }
        }
        const stillMissing =
          students.filter((s) => {
            const hasNotes = grades.some((g) => g.student_id === s.id);
            if (!hasNotes) return false;
            return !alreadySet.has(s.id);
          }).length - successCount;
        const allCovered = stillMissing <= 0 && failures.length === 0;

        if (allCovered) {
          try {
            const { closedPeriodNumber, newPeriodNumber } = await closeAndStartNextPeriod({
              classId: klass.id,
              establishmentId: klass.establishment_id,
              currentPeriodId: period.id,
            });
            qc.invalidateQueries({ queryKey: ["grade_periods"] });
            toast.success(
              closedPeriodNumber != null
                ? `Période ${closedPeriodNumber} clôturée — période ${newPeriodNumber} ouverte.`
                : `Période ${newPeriodNumber} ouverte.`,
            );
          } catch (e) {
            toast.error(describeError(e, "Bulletins OK, ouverture de période impossible"));
          }
        } else if (successCount > 0) {
          toast.message(`Il reste des bulletins à générer. La période reste ouverte.`);
        }
      }
      if (failures.length) {
        toast.error(`${failures.length} échec(s) : ${failures.slice(0, 2).join(" · ")}`, {
          id: successCount > 0 ? undefined : "bulletin-gen",
        });
      }
      if (successCount === 0 && failures.length === 0) {
        toast.message(
          alreadyCount > 0
            ? "Tous les bulletins de cette période existent déjà."
            : "Aucun élève avec notes à traiter.",
          { id: "bulletin-gen" },
        );
      }

      onClose();
    } catch (e) {
      toast.error(describeError(e, "Génération des bulletins impossible"), {
        id: "bulletin-gen",
      });
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
            {period
              ? `Période ${period.period_number} — ${candidates.length} à générer${
                  alreadyCount > 0 ? `, ${alreadyCount} déjà en bibliothèque` : ""
                }. Les fichiers sont placés dans Documents de chaque élève.`
              : "Aucune période en cours. Démarrez une période avant de générer les bulletins."}
          </DialogDescription>
        </DialogHeader>
        {alreadyCount > 0 && (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={forceRegenerate}
              disabled={busy}
              onChange={(e) => setForceRegenerate(e.target.checked)}
            />
            <span>Régénérer aussi les {alreadyCount} bulletin(s) déjà créés</span>
          </label>
        )}
        {!hasModel && !templateLoading && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Aucun modèle Excel actif. Ajoutez-en un dans « Modèle de bulletin ».
          </p>
        )}
        {templateLoading && !hasModel && (
          <p className="text-sm text-muted-foreground">Vérification du modèle Excel…</p>
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
            disabled={busy || !period || !hasModel || candidates.length === 0}
            onClick={() => void generate()}
          >
            <Download className="mr-1.5 h-4 w-4" />
            {busy ? "Génération…" : `Générer ${candidates.length} bulletin(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { AnnualBulletinDialog } from "./bulletin-annual";
