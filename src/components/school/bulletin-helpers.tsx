/**
 * Helpers bulletins : remplissage Excel, bulletin annuel.
 * Avec modele actif : livrable = .xlsx original rempli (notes + formules du modele).
 * Sans modele : PDF provisoire canvas.
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
  type TemplateMapping,
  type FillData,
  type TemplateSheet,
} from "@/lib/xlsx-template";
import { writeFilledWorkbook } from "@/lib/xlsx-writeback";
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
    return {
      name: s.name,
      composition,
      evaluations: evalValues,
      evaluationAverage,
      average: null as number | null,
    };
  });
  const sorted = [...allStudentsAverages].sort((a, b) => b - a);
  return {
    establishmentName,
    className,
    periodLabel: `Periode ${periodNumber}`,
    studentName,
    studentFirstName,
    studentLastName,
    subjects: subjectRows,
    // generalAverage laisse a null : c'est la formule du modele qui decide
    generalAverage: null,
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
          setTemplateWarning("Aucun modele Excel actif — livrable PDF provisoire uniquement.");
          setTemplateSheet(null);
          setTemplateMapping(null);
          setTemplateBuffer(null);
          return;
        }
        const { data: file, error } = await supabase.storage.from("report-templates").download(tpl.file_path);
        if (error || !file) throw error ?? new Error("Telechargement du modele impossible");
        const buffer = await file.arrayBuffer();
        const sheet = readTemplate(buffer);
        setTemplateSheet(sheet);
        setTemplateMapping(tpl.mapping as unknown as TemplateMapping);
        setTemplateBuffer(buffer);
        setTemplateName(tpl.name || "bulletin.xlsx");
        setTemplateScale(Number(tpl.scale) || 20);
      } catch (e) {
        if (!cancelled) {
          setTemplateWarning((e as Error).message || "Modele indisponible — PDF provisoire.");
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
      let generalAverage: number | null = null;
      let renderedVia: "offline-template" | "offline-generic" = "offline-generic";

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

      let fileExt = "xlsx";
      let fileMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const downloadName = `Bulletin — Periode ${period.period_number}`;

      if (templateBuffer && templateMapping && fillData) {
        // Modele actif : .xlsx original + formules du modele uniquement
        const written = writeFilledWorkbook(templateBuffer, templateMapping, fillData);
        if (written.warnings.length) console.warn("Bulletin formules", written.warnings);
        generalAverage = written.computed.generalAverage;
        for (const s of subjects) {
          subjectAverages[s.name] = written.computed.subjectAverages[s.name] ?? null;
        }
        blob = new Blob([written.buffer], { type: fileMime });
        renderedVia = "offline-template";
      } else {
        // Pas de modele : PDF provisoire (formules app, faute de modele)
        for (const s of subjects) {
          subjectAverages[s.name] = subjectAverage(bySubject.get(s.id) ?? []);
        }
        generalAverage = average;
        const canvas = renderBulletinCanvas({
          establishmentName,
          className: klass.name,
          studentName: `${student.last_name} ${student.first_name}`,
          periodNumber: period.period_number,
          subjects,
          bySubject,
          average,
        });
        blob = await canvasToPdfBlob(canvas);
        fileExt = "pdf";
        fileMime = "application/pdf";
        renderedVia = "offline-generic";
      }

      if (!blob) throw new Error("Generation du bulletin impossible (aucun rendu produit).");

      const weakSubjects = Object.entries(subjectAverages)
        .filter(([, avg]) => avg !== null && avg < PASS_THRESHOLD)
        .map(([name]) => name);
      const path = `${klass.establishment_id}/${student.id}/bulletin-p${period.period_number}-${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from("student-documents").upload(path, blob, { contentType: fileMime });
      if (uploadError) throw uploadError;

      const { data: doc, error: docError } = await supabase
        .from("student_documents")
        .insert({
          student_id: student.id,
          establishment_id: klass.establishment_id,
          name: downloadName,
          file_path: path,
          file_type: fileMime,
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
        renderedVia === "offline-template"
          ? "Bulletin valide — fichier .xlsx du modele (formules du modele)"
          : "Bulletin valide — PDF provisoire (aucun modele Excel actif)",
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
    const { data: doc } = await supabase.from("student_documents").select("file_path,name,file_type").eq("id", documentId).single();
    if (!doc) return;
    const { data: signed, error } = await supabase.storage.from("student-documents").createSignedUrl(doc.file_path, 300);
    if (error || !signed) {
      toast.error("Lien indisponible");
      return;
    }
    const res = await fetch(signed.signedUrl);
    const ext = doc.file_path?.includes(".xlsx") ? "xlsx" : doc.file_path?.includes(".pdf") ? "pdf" : "xlsx";
    downloadBlob(await res.blob(), `${doc.name}.${ext}`);
  };

  if (!student) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bulletins termines</DialogTitle>
            <DialogDescription>Tous les eleves de la classe ont ete parcourus.</DialogDescription>
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
            Periode {period.period_number} · {klass.name}
          </DialogDescription>
        </DialogHeader>

        {templateLoading && <p className="text-xs text-muted-foreground">Chargement du modele de bulletin…</p>}
        {templateWarning && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{templateWarning}</div>
        )}
        {templateSheet && templateMapping && !templateLoading && (
          <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
            Livrable : fichier .xlsx du modele (notes + formules du modele, pas les formules de l'app).
          </div>
        )}

        {missingEvaluation.length > 0 && (
          <div className="rounded-md border border-[oklch(0.75_0.15_80)]/40 bg-[oklch(0.75_0.15_80)]/10 px-3 py-2 text-xs font-medium text-[oklch(0.5_0.13_70)]">
            Aucune note d'evaluation pour : {missingEvaluation.map((s) => s.name).join(", ")}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-2">Matiere</th>
                <th className="p-2">Evaluation(s)</th>
                <th className="p-2">Composition</th>
                <th className="p-2">Notes saisies</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => {
                const subjectGrades = bySubject.get(s.id) ?? [];
                const evals = subjectGrades.filter((g) => g.nature === "evaluation");
                const comp = subjectGrades.find((g) => g.nature === "composition");
                return (
                  <tr key={s.id} className="border-t border-border">
                    <td className="p-2 font-medium">{s.name}</td>
                    <td className="p-2">{evals.length ? evals.map((g) => `${g.value}/${g.scale}`).join(", ") : "—"}</td>
                    <td className="p-2">{comp ? `${comp.value}/${comp.scale}` : "—"}</td>
                    <td className="p-2 text-muted-foreground text-xs">moyenne = formule du modele</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-right text-xs text-muted-foreground">
          Apercu notes saisies uniquement — la moyenne generale sera celle calculee par les formules du fichier Excel.
        </p>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button variant="outline" asChild>
            <Link to="/eleves/$studentId/notes" params={{ studentId: student.id }}>
              Modifier les notes
            </Link>
          </Button>
          <div className="flex flex-wrap gap-2">
            {validated[student.id] ? (
              <Button variant="outline" onClick={download}>
                <Download className="mr-1.5 h-4 w-4" /> Telecharger .xlsx
              </Button>
            ) : (
              <Button onClick={validate} disabled={busy}>
                {busy ? "Validation..." : "Valider (.xlsx)"}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setIndex((i) => i + 1)}>
              {index + 1 < students.length ? "Eleve suivant" : "Terminer"}
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
    y += 36;
  }
  y += 20;
  ctx.font = "bold 24px sans-serif";
  ctx.fillText(`Moyenne generale : ${average !== null ? average.toFixed(2) : "—"} / 20`, 60, y);
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
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const qc = useQueryClient();

  const generateAll = async () => {
    setBusy(true);
    setDone(0);
    try {
      for (const student of students) {
        const bySubject = groupGradesBySubject(grades, student.id);
        const avg = studentAverage(bySubject);
        const canvas = renderBulletinCanvas({
          establishmentName,
          className: klass.name,
          studentName: `${student.last_name} ${student.first_name}`,
          periodNumber: 0,
          subjects,
          bySubject,
          average: avg,
        });
        const blob = await canvasToPdfBlob(canvas);
        const path = `${klass.establishment_id}/${student.id}/bulletin-annuel-${Date.now()}.pdf`;
        const { error: uploadError } = await supabase.storage.from("student-documents").upload(path, blob, {
          contentType: "application/pdf",
        });
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
      qc.invalidateQueries({ queryKey: ["student_documents"] });
      toast.success("Bulletins annuels generes (PDF provisoire)");
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Generation impossible");
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
            Synthese de toutes les periodes ({periods.length}) pour les {students.length} eleves.
          </DialogDescription>
        </DialogHeader>
        {busy && (
          <p className="text-sm text-muted-foreground">
            Generation… {done} / {students.length}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={generateAll} disabled={busy}>
            {busy ? "Generation…" : "Generer tous les bulletins annuels"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
