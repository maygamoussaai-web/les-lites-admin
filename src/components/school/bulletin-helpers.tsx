/**
 * Helpers bulletins : remplissage Excel, canvas de secours, bulletin annuel.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download } from "lucide-react";
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
import { writeAudit } from "@/lib/data";
import { canvasToPdfBlob, downloadBlob } from "@/lib/pdf-export";
import {
  readTemplate,
  fillTemplate,
  drawFilledTemplate,
  type TemplateMapping,
  type FillData,
  type TemplateSheet,
} from "@/lib/xlsx-template";
import { writeFilledWorkbook, extractComputedAveragesFromRecalculated, convertWorkbookOnline } from "@/lib/xlsx-writeback";
import {
  PASS_THRESHOLD,
  subjectAverage,
  studentAverage,
  groupGradesBySubject,
  type ClassSubject,
  type GradePeriod,
  type Grade,
} from "@/lib/grades";

type StudentRef = { id: string; first_name: string; last_name: string };

export function buildFillData(opts: {
  establishmentName: string;
  className: string;
  studentName: string;
  studentFirstName: string;
  studentLastName: string;
  periodNumber: number;
  subjects: ClassSubject[];
  bySubject: Map<string, Grade[]>;
  allStudentsAverages: number[];
  headcount: number;
  scale: number;
  rank: number | null;
}): FillData {
  const { establishmentName, className, studentName, studentFirstName, studentLastName, periodNumber, subjects, bySubject, allStudentsAverages, headcount, scale, rank } = opts;
  const subjectRows = subjects.map((s) => {
    const gs = bySubject.get(s.id) ?? [];
    const evals = gs.filter((g) => g.nature === "evaluation");
    const comp = gs.find((g) => g.nature === "composition");
    const evalValues = evals.map((g) => (g.scale > 0 ? (Number(g.value) / Number(g.scale)) * 20 : Number(g.value)));
    const composition = comp
      ? comp.scale > 0
        ? (Number(comp.value) / Number(comp.scale)) * 20
        : Number(comp.value)
      : null;
    const evaluationAverage = evalValues.length ? evalValues.reduce((a, b) => a + b, 0) / evalValues.length : null;
    const average = subjectAverage(gs);
    return {
      name: s.name,
      composition,
      evaluations: evalValues,
      evaluationAverage,
      average,
    };
  });
  const generalAverage = studentAverage(bySubject);
  const sorted = [...allStudentsAverages].sort((a, b) => b - a);
  return {
    establishmentName,
    className,
    periodLabel: `Période ${periodNumber}`,
    studentName,
    studentFirstName,
    studentLastName,
    subjects: subjectRows,
    generalAverage,
    firstAverage: sorted[0] ?? null,
    lastAverage: sorted.length ? sorted[sorted.length - 1]! : null,
    classAverageEvaluation: null,
    classAverageComposition: null,
    headcount,
    rank,
    scale,
  };
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
  klass: { id: string; name: string; establishment_id: string };
  establishmentName: string;
  students: StudentRef[];
  subjects: ClassSubject[];
  period: GradePeriod;
  grades: Grade[];
}) {
  const qc = useQueryClient();
  const [index, setIndex] = useState(0);
  const [validated, setValidated] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [templateSheet, setTemplateSheet] = useState<TemplateSheet | null>(null);
  const [templateMapping, setTemplateMapping] = useState<TemplateMapping | null>(null);
  const [templateBuffer, setTemplateBuffer] = useState<ArrayBuffer | null>(null);
  const [templateName, setTemplateName] = useState("bulletin.xlsx");
  const [templateScale, setTemplateScale] = useState(20);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [templateWarning, setTemplateWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTemplateLoading(true);
      setTemplateWarning(null);
      try {
        const { data: tpl, error: tplError } = await supabase
          .from("report_templates")
          .select("file_path, mapping, scale, name, is_active")
          .eq("class_id", klass.id)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (tplError) throw tplError;
        if (cancelled) return;
        if (!tpl?.file_path) {
          setTemplateWarning("Aucun modèle Excel actif — rendu provisoire texte.");
          setTemplateSheet(null);
          setTemplateMapping(null);
          setTemplateBuffer(null);
          return;
        }
        const { data: file, error } = await supabase.storage.from("report-templates").download(tpl.file_path);
        if (error || !file) throw error ?? new Error("Téléchargement du modèle impossible");
        const buffer = await file.arrayBuffer();
        const sheet = readTemplate(buffer);
        setTemplateSheet(sheet);
        setTemplateMapping(tpl.mapping as unknown as TemplateMapping);
        setTemplateBuffer(buffer);
        setTemplateName(tpl.name || "bulletin.xlsx");
        setTemplateScale(Number(tpl.scale) || 20);
      } catch (e) {
        if (!cancelled) {
          setTemplateWarning((e as Error).message || "Modèle indisponible — rendu provisoire.");
          setTemplateSheet(null);
          setTemplateMapping(null);
          setTemplateBuffer(null);
        }
      } finally {
        if (!cancelled) setTemplateLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [klass.id]);

  const student = students[index] ?? null;
  const bySubject = student ? groupGradesBySubject(grades, student.id) : new Map<string, Grade[]>();
  const missingEvaluation = subjects.filter((s) => !(bySubject.get(s.id) ?? []).some((g) => g.nature === "evaluation"));
  const average = studentAverage(bySubject);

  const allStudentsAverages = useMemo(() => {
    const avgs: number[] = [];
    for (const s of students) {
      const bs = groupGradesBySubject(grades, s.id);
      const a = studentAverage(bs);
      if (a !== null) avgs.push(a);
    }
    return avgs;
  }, [students, grades]);

  const validate = async () => {
    if (!student) return;
    setBusy(true);
    try {
      let blob: Blob | undefined;
      let subjectAverages: Record<string, number | null> = {};
      let generalAverage: number | null = average;
      let renderedVia: "online" | "offline-template" | "offline-generic" = "offline-generic";

      const sorted = [...allStudentsAverages].sort((a, b) => b - a);
      const rank = average !== null && sorted.length ? sorted.indexOf(average) + 1 : null;
      const fillData = templateMapping
        ? buildFillData({
            establishmentName,
            className: klass.name,
            studentName: `${student.last_name} ${student.first_name}`,
            studentFirstName: student.first_name,
            studentLastName: student.last_name,
            periodNumber: period.period_number,
            subjects,
            bySubject,
            allStudentsAverages,
            headcount: students.length,
            scale: templateScale,
            rank,
          })
        : null;

      // 1) Essai en ligne : vrai classeur rempli (formules et mise en forme intactes),
      // converti par un vrai moteur Excel/LibreOffice — PDF fidèle à 100 % et moyennes
      // relues sur le fichier recalculé (fiabilité parfaite, pas de simulation JS).
      if (templateBuffer && templateMapping && fillData) {
        const filledWorkbook = writeFilledWorkbook(templateBuffer, templateMapping, fillData);
        const online = await convertWorkbookOnline(filledWorkbook, templateName);
        if (online) {
          blob = online.pdf;
          const computed = extractComputedAveragesFromRecalculated(online.recalculated, templateMapping, fillData.subjects, templateScale);
          generalAverage = computed.generalAverage ?? average;
          for (const s of subjects) subjectAverages[s.name] = computed.subjectAverages[s.name] ?? subjectAverage(bySubject.get(s.id) ?? []);
          renderedVia = "online";
        }
      }

      // 2) Repli hors-ligne (réseau/service indisponible) : simulation JS des formules +
      // redessin canvas — mêmes valeurs de notes, moins fidèle visuellement.
      if (renderedVia !== "online") {
        let canvas: HTMLCanvasElement;
        let filled: ReturnType<typeof fillTemplate> | null = null;
        if (templateSheet && templateMapping && fillData) {
          filled = fillTemplate(templateSheet, templateMapping, fillData);
          if (filled.warnings.length) console.warn("Bulletin warnings", filled.warnings);
          canvas = drawFilledTemplate(filled);
          renderedVia = "offline-template";
        } else {
          canvas = renderBulletinCanvas({
            establishmentName,
            className: klass.name,
            studentName: `${student.last_name} ${student.first_name}`,
            periodNumber: period.period_number,
            subjects,
            bySubject,
            average,
          });
        }
        for (const s of subjects) {
          const fromTemplate = filled?.computed.subjectAverages[s.name];
          subjectAverages[s.name] =
            fromTemplate !== undefined && fromTemplate !== null ? fromTemplate : subjectAverage(bySubject.get(s.id) ?? []);
        }
        generalAverage = filled?.computed.generalAverage ?? average;
        blob = await canvasToPdfBlob(canvas);
      }

      if (!blob) throw new Error("Génération du bulletin impossible (aucun rendu produit).");

      const weakSubjects = Object.entries(subjectAverages)
        .filter(([, avg]) => avg !== null && avg < PASS_THRESHOLD)
        .map(([name]) => name);
      const path = `${klass.establishment_id}/${student.id}/bulletin-p${period.period_number}-${Date.now()}.pdf`;
      const { error: uploadError } = await supabase.storage.from("student-documents").upload(path, blob, { contentType: "application/pdf" });
      if (uploadError) throw uploadError;

      const { data: doc, error: docError } = await supabase
        .from("student_documents")
        .insert({
          student_id: student.id,
          establishment_id: klass.establishment_id,
          name: `Bulletin — Période ${period.period_number}`,
          file_path: path,
          file_type: "application/pdf",
          file_size: blob.size,
        })
        .select()
        .single();
      if (docError) throw docError;

      const { error: cardError } = await supabase.from("student_report_cards").upsert(
        {
          student_id: student.id,
          class_id: klass.id,
          establishment_id: klass.establishment_id,
          period_id: period.id,
          status: "validated",
          weak_subjects: weakSubjects as never,
          general_average: generalAverage,
          subject_averages: subjectAverages as never,
          document_id: doc.id,
          validated_at: new Date().toISOString(),
        },
        { onConflict: "student_id,period_id" },
      );
      if (cardError) throw cardError;

      // Reverse la moyenne retenue pour ce bulletin (issue du modèle Excel
      // s'il y en a un) dans la fiche élève : c'est elle qui doit s'afficher
      // partout ailleurs dans l'app (fiche élève, moyenne annuelle), pas un
      // recalcul JS distinct de ce qui est réellement imprimé.
      if (generalAverage !== null && period.period_number >= 1 && period.period_number <= 3) {
        const termColumn = `term${period.period_number}_average` as "term1_average" | "term2_average" | "term3_average";
        const { error: termError } = await supabase
          .from("students")
          .update({ [termColumn]: generalAverage })
          .eq("id", student.id);
        if (termError) throw termError;
        qc.invalidateQueries({ queryKey: ["students"] });
      }

      await writeAudit("create", "student_report_cards" as never, student.id, { period_id: period.id });
      qc.invalidateQueries({ queryKey: ["student_documents"] });
      setValidated((v) => ({ ...v, [student.id]: doc.id }));
      toast.success(
        renderedVia === "online"
          ? "Bulletin validé — rendu fidèle au modèle (conversion en ligne)"
          : renderedVia === "offline-template"
            ? "Bulletin validé — mode hors-ligne (rendu approximatif, service de conversion indisponible)"
            : "Bulletin validé — modèle provisoire (aucun modèle Excel actif)",
      );
    } catch (e) {
      toast.error((e as Error).message || "Validation impossible");
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!student) return;
    const documentId = validated[student.id];
    if (!documentId) return;
    const { data: doc } = await supabase.from("student_documents").select("file_path,name").eq("id", documentId).single();
    if (!doc) return;
    const { data: signed, error } = await supabase.storage.from("student-documents").createSignedUrl(doc.file_path, 300);
    if (error || !signed) {
      toast.error("Lien indisponible");
      return;
    }
    const res = await fetch(signed.signedUrl);
    downloadBlob(await res.blob(), `${doc.name}.pdf`);
  };

  if (!student) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bulletins terminés</DialogTitle>
            <DialogDescription>Tous les élèves de la classe ont été parcourus.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={onClose}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Bulletin {index + 1} / {students.length} — {student.last_name} {student.first_name}
          </DialogTitle>
          <DialogDescription>
            Période {period.period_number} · {klass.name}
          </DialogDescription>
        </DialogHeader>

        {templateLoading && <p className="text-xs text-muted-foreground">Chargement du modèle de bulletin…</p>}
        {templateWarning && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{templateWarning}</div>
        )}
        {templateSheet && templateMapping && !templateLoading && (
          <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
            Rendu selon le modèle Excel de la classe.
          </div>
        )}

        {missingEvaluation.length > 0 && (
          <div className="rounded-md border border-[oklch(0.75_0.15_80)]/40 bg-[oklch(0.75_0.15_80)]/10 px-3 py-2 text-xs font-medium text-[oklch(0.5_0.13_70)]">
            ⚠ Aucune note d'évaluation pour : {missingEvaluation.map((s) => s.name).join(", ")}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-2">Matière</th>
                <th className="p-2">Évaluation(s)</th>
                <th className="p-2">Composition</th>
                <th className="p-2">Moyenne /20</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => {
                const subjectGrades = bySubject.get(s.id) ?? [];
                const evals = subjectGrades.filter((g) => g.nature === "evaluation");
                const comp = subjectGrades.find((g) => g.nature === "composition");
                const avg = subjectAverage(subjectGrades);
                return (
                  <tr key={s.id} className="border-t border-border">
                    <td className="p-2 font-medium">{s.name}</td>
                    <td className="p-2">{evals.length ? evals.map((g) => `${g.value}/${g.scale}`).join(", ") : "—"}</td>
                    <td className="p-2">{comp ? `${comp.value}/${comp.scale}` : "—"}</td>
                    <td className="p-2 font-medium">{avg !== null ? avg.toFixed(2) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-right text-sm font-semibold">Moyenne générale : {average !== null ? average.toFixed(2) : "—"} / 20</p>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button variant="outline" asChild>
            <Link to="/eleves/$studentId/notes" params={{ studentId: student.id }}>
              Modifier les notes
            </Link>
          </Button>
          <div className="flex flex-wrap gap-2">
            {validated[student.id] ? (
              <Button variant="outline" onClick={download}>
                <Download className="mr-1.5 h-4 w-4" /> Télécharger
              </Button>
            ) : (
              <Button onClick={validate} disabled={busy}>
                {busy ? "Validation..." : "Valider"}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setIndex((i) => i + 1)}>
              {index + 1 < students.length ? "Élève suivant" : "Terminer"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  ctx.fillText(periodNumber === 0 ? "BULLETIN ANNUEL" : "BULLETIN", 60, 140);
  ctx.font = "22px sans-serif";
  ctx.fillStyle = "#333333";
  ctx.fillText(`Classe : ${className}`, 60, 190);
  ctx.fillText(`Élève : ${studentName}`, 60, 220);
  if (periodNumber > 0) ctx.fillText(`Période : ${periodNumber}`, 60, 250);

  let y = 310;
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("Matière", 60, y);
  ctx.fillText("Évaluation(s)", 400, y);
  ctx.fillText("Composition", 720, y);
  ctx.fillText("Moyenne /20", 980, y);
  y += 20;
  ctx.strokeStyle = "#C99A3A";
  ctx.beginPath();
  ctx.moveTo(60, y);
  ctx.lineTo(1180, y);
  ctx.stroke();
  y += 40;
  ctx.font = "18px sans-serif";
  for (const s of subjects) {
    const gs = bySubject.get(s.id) ?? [];
    const evals = gs.filter((g) => g.nature === "evaluation");
    const comp = gs.find((g) => g.nature === "composition");
    const avg = subjectAverage(gs);
    ctx.fillText(s.name, 60, y);
    ctx.fillText(evals.length ? evals.map((g) => `${g.value}/${g.scale}`).join(", ") : "—", 400, y);
    ctx.fillText(comp ? `${comp.value}/${comp.scale}` : "—", 720, y);
    ctx.fillText(avg !== null ? avg.toFixed(2) : "—", 980, y);
    y += 36;
  }

  y += 30;
  ctx.font = "bold 26px sans-serif";
  ctx.fillStyle = "#12266B";
  ctx.fillText(`Moyenne générale : ${average !== null ? average.toFixed(2) : "—"} / 20`, 60, y);
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
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  const generateAll = async () => {
    setBusy(true);
    setDone(0);
    try {
      const periodIds = periods.map((p) => p.id);
      const { data: allGrades, error } = await supabase.from("grades").select("*").in("period_id", periodIds);
      if (error) throw error;
      const grades = (allGrades ?? []) as Grade[];

      let templateSheet: TemplateSheet | null = null;
      let templateMapping: TemplateMapping | null = null;
      let templateScale = 20;
      const { data: tpl } = await supabase
        .from("report_templates")
        .select("file_path, mapping, scale")
        .eq("class_id", klass.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (tpl?.file_path) {
        const { data: file } = await supabase.storage.from("report-templates").download(tpl.file_path);
        if (file) {
          templateSheet = readTemplate(await file.arrayBuffer());
          templateMapping = tpl.mapping as unknown as TemplateMapping;
          templateScale = Number(tpl.scale) || 20;
        }
      }

      const allAvgs: number[] = [];
      for (const s of students) {
        const bs = groupGradesBySubject(grades, s.id);
        const a = studentAverage(bs);
        if (a !== null) allAvgs.push(a);
      }

      for (const student of students) {
        const bySubject = groupGradesBySubject(grades, student.id);
        const average = studentAverage(bySubject);
        const sorted = [...allAvgs].sort((a, b) => b - a);
        const rank = average !== null && sorted.length ? sorted.indexOf(average) + 1 : null;

        let canvas: HTMLCanvasElement;
        if (templateSheet && templateMapping) {
          const fillData = buildFillData({
            establishmentName,
            className: klass.name,
            studentName: `${student.last_name} ${student.first_name}`,
            studentFirstName: student.first_name,
            studentLastName: student.last_name,
            periodNumber: 0,
            subjects,
            bySubject,
            allStudentsAverages: allAvgs,
            headcount: students.length,
            scale: templateScale,
            rank,
          });
          fillData.periodLabel = "Bulletin annuel";
          const filled = fillTemplate(templateSheet, templateMapping, fillData);
          canvas = drawFilledTemplate(filled);
        } else {
          canvas = renderBulletinCanvas({
            establishmentName,
            className: klass.name,
            studentName: `${student.last_name} ${student.first_name}`,
            periodNumber: 0,
            subjects,
            bySubject,
            average,
          });
        }

        const blob = await canvasToPdfBlob(canvas);
        const path = `${klass.establishment_id}/${student.id}/bulletin-annuel-${Date.now()}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("student-documents")
          .upload(path, blob, { contentType: "application/pdf" });
        if (uploadError) throw uploadError;

        await supabase.from("student_documents").insert({
          student_id: student.id,
          establishment_id: klass.establishment_id,
          name: "Bulletin annuel",
          file_path: path,
          file_type: "application/pdf",
          file_size: blob.size,
        });
        setDone((d) => d + 1);
      }

      await writeAudit("create", "student_documents" as never, null, {
        class_id: klass.id,
        type: "annual_bulletin",
        count: students.length,
      });
      qc.invalidateQueries({ queryKey: ["student_documents"] });
      toast.success(`Bulletins annuels générés (${students.length})`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Génération impossible");
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
            Synthèse de toutes les périodes ({periods.length}) pour les {students.length} élèves. Utilise le modèle Excel
            de la classe s'il est disponible.
          </DialogDescription>
        </DialogHeader>
        {busy && (
          <p className="text-sm text-muted-foreground">
            Génération… {done} / {students.length}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={generateAll} disabled={busy}>
            {busy ? "Génération…" : "Générer tous les bulletins annuels"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
