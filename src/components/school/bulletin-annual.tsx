/**
 * Bulletin annuel — génération Excel adaptable à tout modèle (bref ou complet).
 *
 * Prérequis : modèle actif de kind « annual » pour la classe.
 * Données : agrégation des student_report_cards des périodes (moyennes matière / MG).
 * Remplissage : même writeback que les bulletins de période (formules Excel respectées).
 * Fallback PDF canvas uniquement si aucun modèle annuel n'est configuré.
 *
 * La génération continue en arrière-plan si le dialogue est fermé.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { describeError } from "@/lib/errors";
import { downloadActiveTemplateBuffer } from "@/lib/report-template";
import { buildAnnualFillData } from "@/lib/model-averages";
import { writeFilledWorkbook } from "@/lib/xlsx-writeback";
import { uploadBulletinWorkbook } from "@/lib/storage-upload";
import type { ClassSubject, GradePeriod, StudentReportCard } from "@/lib/grades";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Verrou global : une génération annuelle par classe à la fois. */
const runningAnnualByClass = new Set<string>();

export function isAnnualBulletinGenerationRunning(classId: string): boolean {
  return runningAnnualByClass.has(classId);
}

type StudentRef = { id: string; first_name: string; last_name: string };

function toBlob(buffer: ArrayBuffer) {
  return new Blob([buffer], { type: XLSX_MIME });
}

/** Rendu canvas de secours (sans modèle Excel annuel). */
export function renderBulletinCanvas(opts: {
  establishmentName: string;
  className: string;
  studentName: string;
  periodNumber: number;
  subjectLines: { name: string; average: number | null }[];
  average: number | null;
}): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 794;
  canvas.height = 1123;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(opts.establishmentName, 48, 56);
  ctx.font = "16px sans-serif";
  ctx.fillText(`Bulletin annuel — ${opts.className}`, 48, 88);
  ctx.fillText(opts.studentName, 48, 120);
  let y = 170;
  ctx.font = "14px sans-serif";
  for (const line of opts.subjectLines) {
    const avg = line.average != null ? line.average.toFixed(2) : "—";
    ctx.fillText(`${line.name}`, 48, y);
    ctx.fillText(avg, 520, y);
    y += 28;
  }
  y += 24;
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(
    `Moyenne générale : ${opts.average != null ? opts.average.toFixed(2) : "—"} / 20`,
    48,
    y,
  );
  return canvas;
}

async function canvasToImageBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  const jpeg = dataUrl.split(",")[1] ?? "";
  const bin = atob(jpeg);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
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
  grades?: unknown;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  const generateAll = async () => {
    if (runningAnnualByClass.has(klass.id)) {
      toast.message("Une génération annuelle est déjà en cours pour cette classe.");
      return;
    }

    const studentsSnap = [...students];
    const subjectsSnap = [...subjects];
    const periodsSnap = [...periods];
    const toastId = `bulletin-annual-${klass.id}`;

    runningAnnualByClass.add(klass.id);
    setBusy(true);
    setDone(0);

    toast.loading(
      studentsSnap.length
        ? `Bulletin annuel en arrière-plan… 0/${studentsSnap.length}`
        : "Vérification…",
      { id: toastId, duration: Infinity },
    );
    onClose();

    try {
      const periodIds = periodsSnap.map((p) => p.id);
      if (!periodIds.length) {
        toast.error("Aucune période disponible pour construire l'annuel.", { id: toastId });
        return;
      }

      const sortedPeriods = [...periodsSnap].sort(
        (a, b) => (a.period_number ?? 0) - (b.period_number ?? 0),
      );
      const yearLabel =
        sortedPeriods.length > 0
          ? `Année — ${sortedPeriods.length} période${sortedPeriods.length > 1 ? "s" : ""}`
          : "Année scolaire";

      const { data: cards, error } = await supabase
        .from("student_report_cards")
        .select("*")
        .eq("class_id", klass.id)
        .in("period_id", periodIds);
      if (error) throw error;
      const list = (cards ?? []) as StudentReportCard[];

      if (!list.length) {
        toast.error(
          "Aucun bulletin de période trouvé. Générez d'abord les bulletins de chaque période.",
          { id: toastId },
        );
        return;
      }

      const tpl = await downloadActiveTemplateBuffer(klass.id, "annual");
      const useExcel = !!tpl?.buffer && !!tpl.mapping;

      const annualByStudent = new Map<string, number>();
      for (const s of studentsSnap) {
        const sc = list.filter((c) => c.student_id === s.id);
        const avgs = sc
          .map((c) => (c.general_average != null ? Number(c.general_average) : null))
          .filter((v): v is number => v != null && Number.isFinite(v));
        if (avgs.length) {
          annualByStudent.set(s.id, avgs.reduce((a, b) => a + b, 0) / avgs.length);
        }
      }
      const ranked = [...annualByStudent.entries()].sort((a, b) => b[1] - a[1]);
      const rankOf = new Map<string, number>();
      ranked.forEach(([id], i) => rankOf.set(id, i + 1));
      const firstAverage = ranked[0]?.[1] ?? null;
      const lastAverage = ranked.length ? ranked[ranked.length - 1]![1] : null;

      let success = 0;
      const failures: string[] = [];

      for (let i = 0; i < studentsSnap.length; i++) {
        const s = studentsSnap[i]!;
        const studentCards = list
          .filter((c) => c.student_id === s.id)
          .sort((a, b) => {
            const pa = sortedPeriods.find((p) => p.id === a.period_id)?.period_number ?? 0;
            const pb = sortedPeriods.find((p) => p.id === b.period_id)?.period_number ?? 0;
            return pa - pb;
          });

        if (!studentCards.length) {
          failures.push(`${s.last_name} ${s.first_name}: aucune fiche de période`);
          toast.loading(`Bulletin annuel en arrière-plan… ${i + 1}/${studentsSnap.length}`, {
            id: toastId,
            duration: Infinity,
          });
          continue;
        }

        try {
          if (useExcel && tpl) {
            const fill = buildAnnualFillData({
              establishmentName,
              className: klass.name,
              studentFirstName: s.first_name,
              studentLastName: s.last_name,
              schoolYearLabel: yearLabel,
              subjects: subjectsSnap,
              studentCards,
              headcount: studentsSnap.length,
              scale: tpl.scale,
              rank: rankOf.get(s.id) ?? null,
              firstAverage,
              lastAverage,
            });
            const written = writeFilledWorkbook(tpl.buffer, tpl.mapping, fill);
            const blob = toBlob(written.buffer);
            const storagePath = `${klass.establishment_id}/${s.id}/bulletin-annuel-${Date.now()}.xlsx`;
            const uploaded = await uploadBulletinWorkbook(storagePath, blob);
            const filePathStored =
              uploaded.bucket === "student-documents"
                ? uploaded.path
                : uploaded.bucket === "report-templates"
                  ? `report-templates:${uploaded.path}`
                  : `${uploaded.bucket}:${uploaded.path}`;

            const { error: docErr } = await supabase.from("student_documents").insert({
              student_id: s.id,
              establishment_id: klass.establishment_id,
              name: "Bulletin annuel",
              file_path: filePathStored,
              file_type: XLSX_MIME,
              file_size: blob.size,
            });
            if (docErr) throw docErr;
            success++;
          } else {
            const periodAvgs = studentCards
              .map((c) =>
                c.general_average != null ? Number(c.general_average) : null,
              )
              .filter((v): v is number => v != null && Number.isFinite(v));
            const annual =
              periodAvgs.length > 0
                ? periodAvgs.reduce((a, b) => a + b, 0) / periodAvgs.length
                : null;
            const subjectLines = subjectsSnap.map((sub) => {
              const vals: number[] = [];
              for (const c of studentCards) {
                const sa = c.subject_averages as Record<string, number | null> | null;
                const v = sa?.[sub.name];
                if (v != null && Number.isFinite(Number(v))) vals.push(Number(v));
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
            const blob = await canvasToImageBlob(canvas);
            const path = `${klass.establishment_id}/${s.id}/bulletin-annuel-${Date.now()}.jpg`;
            await supabase.storage.from("student-documents").upload(path, blob, {
              contentType: "image/jpeg",
              upsert: true,
            });
            await supabase.from("student_documents").insert({
              student_id: s.id,
              establishment_id: klass.establishment_id,
              name: "Bulletin annuel (aperçu)",
              file_path: path,
              file_type: "image/jpeg",
              file_size: blob.size,
            });
            success++;
          }
        } catch (e) {
          failures.push(
            `${s.last_name} ${s.first_name}: ${describeError(e, "échec")}`,
          );
        }
        toast.loading(`Bulletin annuel en arrière-plan… ${i + 1}/${studentsSnap.length}`, {
          id: toastId,
          duration: Infinity,
        });
      }

      void qc.invalidateQueries({ queryKey: ["student_documents"] });

      if (success > 0 && failures.length === 0) {
        toast.success(
          useExcel
            ? `${success} bulletin(s) annuel(s) Excel généré(s)`
            : `${success} aperçu(s) annuel(s) généré(s) — chargez un modèle annuel Excel pour le format officiel`,
          { id: toastId, duration: 8_000 },
        );
      } else if (success > 0) {
        toast.message(`${success} OK, ${failures.length} échec(s)`, {
          id: toastId,
          description: failures.slice(0, 3).join(" · "),
          duration: 10_000,
        });
      } else {
        toast.error(failures[0] ?? "Aucun bulletin annuel généré", { id: toastId });
      }
    } catch (e) {
      toast.error(describeError(e, "Génération annuelle impossible"), { id: toastId });
    } finally {
      runningAnnualByClass.delete(klass.id);
      setBusy(false);
    }
  };

  const jobRunning = busy || runningAnnualByClass.has(klass.id);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          if (jobRunning) {
            toast.message("Génération annuelle continue en arrière-plan — vous serez notifié à la fin.");
          }
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulletin annuel</DialogTitle>
          <DialogDescription>
            Synthèse à partir des bulletins de période déjà générés (
            {periods.length} période{periods.length > 1 ? "s" : ""}). Le modèle Excel{" "}
            <strong>annuel</strong> de la classe est utilisé s'il est actif. Vous pouvez fermer
            cette fenêtre : la génération continue en arrière-plan.
          </DialogDescription>
        </DialogHeader>
        {jobRunning && (
          <p className="text-sm text-muted-foreground">
            {done} / {students.length}…
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (jobRunning) {
                toast.message("Génération annuelle continue en arrière-plan — vous serez notifié à la fin.");
              }
              onClose();
            }}
          >
            {jobRunning ? "Continuer en arrière-plan" : "Annuler"}
          </Button>
          <Button
            onClick={() => void generateAll()}
            disabled={jobRunning || students.length === 0}
          >
            {jobRunning ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> En cours…
              </>
            ) : (
              "Générer"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
