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
 *
 * La génération continue en arrière-plan si le dialogue est fermé.
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
import { closeOpenPeriodOnly } from "@/lib/period-lifecycle";
import { type ClassSubject, type GradePeriod, type Grade } from "@/lib/grades";
import type { ClassRow } from "@/lib/school";

type StudentRef = { id: string; first_name: string; last_name: string };

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Verrou global : une génération par classe à la fois (survit à la fermeture du dialogue). */
const runningByClass = new Set<string>();

export function isBulletinGenerationRunning(classId: string): boolean {
  return runningByClass.has(classId);
}

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
    if (runningByClass.has(klass.id)) {
      toast.message("Une génération est déjà en cours pour cette classe.");
      return;
    }

    const periodSnap = period;
    const candidatesSnap = [...candidates];
    const alreadySnap = new Set(alreadySet);
    const studentsSnap = [...students];
    const gradesSnap = [...grades];
    const subjectsSnap = [...subjects];
    const forceSnap = forceRegenerate;
    const alreadyCountSnap = alreadyCount;
    const toastId = `bulletin-gen-${klass.id}`;

    runningByClass.add(klass.id);
    setBusy(true);
    setDone(0);
    let successCount = 0;
    const successIds = new Set<string>();
    const failures: string[] = [];
    const localDownloads: { blob: Blob; name: string }[] = [];

    toast.loading(
      candidatesSnap.length
        ? `Génération en arrière-plan… 0/${candidatesSnap.length}`
        : "Vérification…",
      { id: toastId, duration: Infinity },
    );
    onClose();

    try {
      const downloaded = await downloadActiveTemplateBuffer(klass.id, "period");
      if (!downloaded) {
        toast.error(
          "Aucun modèle Excel actif pour cette classe. Importez un modèle puis réessayez.",
          { id: toastId },
        );
        return;
      }
      const { buffer: buf, mapping, scale } = downloaded;

      const avgByStudent = new Map<
        string,
        { avg: number; subjects: Record<string, number | null> }
      >();
      for (const student of candidatesSnap) {
        const fill = buildModelFillData({
          establishmentName: etabName,
          className: klass.name,
          studentFirstName: student.first_name,
          studentLastName: student.last_name,
          periodNumber: periodSnap.period_number,
          subjects: subjectsSnap,
          grades: gradesSnap,
          studentId: student.id,
          headcount: studentsSnap.length,
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

      for (let i = 0; i < candidatesSnap.length; i++) {
        const student = candidatesSnap[i]!;
        try {
          const fill = buildModelFillData({
            establishmentName: etabName,
            className: klass.name,
            studentFirstName: student.first_name,
            studentLastName: student.last_name,
            periodNumber: periodSnap.period_number,
            subjects: subjectsSnap,
            grades: gradesSnap,
            studentId: student.id,
            headcount: studentsSnap.length,
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
          const fileName = `Bulletin_${student.last_name}_${student.first_name}_P${periodSnap.period_number}.xlsx`;
          const storagePath = `${klass.establishment_id}/${student.id}/bulletin-p${periodSnap.period_number}-${Date.now()}.xlsx`;

          const uploaded = await uploadBulletinWorkbook(storagePath, blob);
          if (!uploaded?.path) throw new Error("Upload storage échoué");
          const storedPath =
            uploaded.bucket && uploaded.bucket !== "student-documents"
              ? `${uploaded.bucket}:${uploaded.path}`
              : uploaded.path;

          const docName = `Bulletin période ${periodSnap.period_number}`;
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
              period_id: periodSnap.id,
              document_id: docRow.id,
              general_average: avgInfo?.avg ?? null,
              subject_averages: avgInfo?.subjects ?? {},
            } as never,
            { onConflict: "student_id,period_id" },
          );
          if (cardErr) throw cardErr;

          await writeAudit("create", "student_report_cards" as never, null, {
            student_id: student.id,
            period_id: periodSnap.id,
            document_id: docRow.id,
          });

          localDownloads.push({ blob, name: fileName });
          successIds.add(student.id);
          successCount++;
        } catch (e) {
          failures.push(
            `${student.last_name} ${student.first_name}: ${describeError(e, "échec")}`,
          );
        }
        const next = i + 1;
        toast.loading(`Génération en arrière-plan… ${next}/${candidatesSnap.length}`, {
          id: toastId,
          duration: Infinity,
        });
      }

      qc.invalidateQueries({ queryKey: ["student_documents"] });
      qc.invalidateQueries({ queryKey: ["student_report_cards"] });
      qc.invalidateQueries({ queryKey: ["grades"] });

      if (successCount > 0) {
        toast.success(
          `${successCount} bulletin(s) généré(s) et placé(s) en bibliothèque.`,
          { id: toastId, duration: 8_000 },
        );
        for (const f of localDownloads) {
          try {
            downloadBlob(f.blob, f.name);
          } catch {
            /* mobile / background may block */
          }
        }
        const needBulletinIds = studentsSnap
          .filter((s) => gradesSnap.some((g) => g.student_id === s.id))
          .map((s) => s.id);
        const covered = new Set<string>([...alreadySnap, ...successIds]);
        const allCovered =
          needBulletinIds.length > 0 &&
          failures.length === 0 &&
          needBulletinIds.every((id) => covered.has(id));

        if (allCovered) {
          try {
            const { closedPeriodNumber } = await closeOpenPeriodOnly(klass.id);
            qc.invalidateQueries({ queryKey: ["grade_periods"] });
            toast.success(
              closedPeriodNumber != null
                ? `Tous les bulletins sont en bibliothèque — période ${closedPeriodNumber} clôturée. La prochaine s'ouvrira à la première note.`
                : "Tous les bulletins sont en bibliothèque — période clôturée.",
            );
          } catch (e) {
            toast.error(describeError(e, "Bulletins OK, clôture de période impossible"));
          }
        } else if (successCount > 0) {
          toast.message("Il reste des bulletins à générer. La période reste ouverte.");
        }
      }
      if (failures.length) {
        toast.error(`${failures.length} échec(s) : ${failures.slice(0, 2).join(" · ")}`, {
          id: successCount > 0 ? undefined : toastId,
          duration: 10_000,
        });
      }
      if (successCount === 0 && failures.length === 0) {
        if (alreadyCountSnap > 0) {
          const needIds = studentsSnap
            .filter((s) => gradesSnap.some((g) => g.student_id === s.id))
            .map((s) => s.id);
          const allAlready =
            needIds.length > 0 && needIds.every((id) => alreadySnap.has(id));
          if (allAlready) {
            try {
              const { closedPeriodNumber } = await closeOpenPeriodOnly(klass.id);
              qc.invalidateQueries({ queryKey: ["grade_periods"] });
              toast.success(
                closedPeriodNumber != null
                  ? `Bulletins déjà complets — période ${closedPeriodNumber} clôturée.`
                  : "Bulletins déjà complets — période clôturée.",
                { id: toastId },
              );
            } catch {
              toast.message("Tous les bulletins existent déjà.", { id: toastId });
            }
          } else {
            toast.message("Tous les bulletins de cette période existent déjà.", { id: toastId });
          }
        } else {
          toast.message("Aucun élève avec notes à traiter.", { id: toastId });
        }
      }
    } catch (e) {
      toast.error(describeError(e, "Génération des bulletins impossible"), {
        id: toastId,
      });
    } finally {
      runningByClass.delete(klass.id);
      setBusy(false);
    }
  };

  const jobRunning = busy || runningByClass.has(klass.id);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          if (jobRunning) {
            toast.message("Génération continue en arrière-plan — vous serez notifié à la fin.");
          }
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Créer les bulletins</DialogTitle>
          <DialogDescription>
            {period
              ? `Période ${period.period_number} — ${candidates.length} à générer${
                  alreadyCount > 0 ? `, ${alreadyCount} déjà en bibliothèque` : ""
                }. Les fichiers vont dans Documents de chaque élève. Vous pouvez fermer cette fenêtre : la génération continue.`
              : "Aucune période en cours. Démarrez une période avant de générer les bulletins."}
          </DialogDescription>
        </DialogHeader>
        {alreadyCount > 0 && (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={forceRegenerate}
              disabled={jobRunning}
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
        {jobRunning && (
          <p className="text-sm text-muted-foreground">
            Génération en arrière-plan… {done} / {candidates.length || "…"}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (jobRunning) {
                toast.message("Génération continue en arrière-plan — vous serez notifié à la fin.");
              }
              onClose();
            }}
          >
            {jobRunning ? "Continuer en arrière-plan" : "Annuler"}
          </Button>
          <Button
            className="press"
            disabled={jobRunning || !period || !hasModel || candidates.length === 0}
            onClick={() => void generate()}
          >
            <Download className="mr-1.5 h-4 w-4" />
            {jobRunning ? "En cours…" : `Générer ${candidates.length} bulletin(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { AnnualBulletinDialog } from "./bulletin-annual";
