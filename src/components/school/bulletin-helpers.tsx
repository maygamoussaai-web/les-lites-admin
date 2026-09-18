/**
 * Helpers bulletins : remplissage Excel, reexport bulletin annuel.
 * Telechargement .xlsx force dans le navigateur (independant du stockage).
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
import { describeError } from "@/lib/errors";
import { canvasToPdfBlob, downloadBlob } from "@/lib/pdf-export";
import { uploadBulletinWorkbook, uploadStudentPdf } from "@/lib/storage-upload";
import {
  readTemplate,
  fillTemplate,
  type TemplateMapping,
  type FillData,
  type TemplateSheet,
} from "@/lib/xlsx-template";
import { writeFilledWorkbook } from "@/lib/xlsx-writeback";
import { renderFilledSheetCanvas } from "@/lib/xlsx-render";
import { renderBulletinCanvas } from "@/components/school/bulletin-annual";
import {
  PASS_THRESHOLD,
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
  const {
    establishmentName,
    className,
    studentName,
    studentFirstName,
    studentLastName,
    periodNumber,
    subjects,
    bySubject,
    allStudentsAverages,
    headcount,
    scale,
    rank,
  } = opts;
  const subjectRows = subjects.map((s) => {
    const gs = bySubject.get(s.id) ?? [];
    const evals = gs.filter((g) => g.nature === "evaluation");
    const comp = gs.find((g) => g.nature === "composition");
    const evalValues = evals.map((g) =>
      g.scale > 0 ? (Number(g.value) / Number(g.scale)) * 20 : Number(g.value),
    );
    const composition = comp
      ? comp.scale > 0
        ? (Number(comp.value) / Number(comp.scale)) * 20
        : Number(comp.value)
      : null;
    const evaluationAverage = evalValues.length
      ? evalValues.reduce((a, b) => a + b, 0) / evalValues.length
      : null;
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

function toBlobBytes(raw: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (raw instanceof Uint8Array) return raw;
  return Uint8Array.from(raw);
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
  const [localFiles, setLocalFiles] = useState<
    Record<string, { blob: Blob; name: string; ext: string }>
  >({});
  const [busy, setBusy] = useState(false);
  const [templateSheet, setTemplateSheet] = useState<TemplateSheet | null>(null);
  const [templateMapping, setTemplateMapping] = useState<TemplateMapping | null>(null);
  const [templateBuffer, setTemplateBuffer] = useState<ArrayBuffer | null>(null);
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
  const missingEvaluation = subjects.filter(
    (s) => !(bySubject.get(s.id) ?? []).some((g) => g.nature === "evaluation"),
  );
  const average = studentAverage(bySubject);

  const liveModel = useMemo(() => {
    if (!student || !templateBuffer || !templateMapping) return null;
    try {
      const sorted = [...students]
        .map((s) => studentAverage(groupGradesBySubject(grades, s.id)))
        .filter((a): a is number => a !== null)
        .sort((a, b) => b - a);
      let rankVal: number | null = null;
      if (average !== null && sorted.length) {
        const idx = sorted.findIndex((x) => x === average);
        rankVal = idx >= 0 ? idx + 1 : null;
      }
      const fillData = buildFillData({
        establishmentName,
        className: klass.name,
        studentName: `${student.last_name} ${student.first_name}`,
        studentFirstName: student.first_name,
        studentLastName: student.last_name,
        periodNumber: period.period_number,
        subjects,
        bySubject,
        allStudentsAverages: sorted,
        headcount: students.length,
        scale: templateScale,
        rank: rankVal,
      });
      const written = writeFilledWorkbook(templateBuffer, templateMapping, fillData);
      return {
        generalAverage: written.computed.generalAverage,
        subjectAverages: written.computed.subjectAverages,
      };
    } catch (e) {
      console.warn("live model averages", e);
      return null;
    }
  }, [
    student,
    templateBuffer,
    templateMapping,
    templateScale,
    grades,
    subjects,
    bySubject,
    students,
    establishmentName,
    klass.name,
    period.period_number,
    average,
  ]);

  const allStudentsAverages = useMemo(() => {
    const avgs: number[] = [];
    for (const s of students) {
      const a = studentAverage(groupGradesBySubject(grades, s.id));
      if (a !== null) avgs.push(a);
    }
    return avgs;
  }, [students, grades]);

  const validate = async () => {
    if (!student) return;
    setBusy(true);
    try {
      let blob: Blob;
      let subjectAverages: Record<string, number | null> = {};
      let generalAverage: number | null = null;
      let renderedVia: "offline-template" | "offline-generic" = "offline-generic";

      const sorted = [...allStudentsAverages].sort((a, b) => b - a);
      let rankVal: number | null = null;
      if (average !== null && sorted.length) {
        const idx = sorted.findIndex((x) => x === average);
        rankVal = idx >= 0 ? idx + 1 : null;
      }

      const mapping = templateMapping;
      const fillData = mapping
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
            rank: rankVal,
          })
        : null;

      let fileExt = "xlsx";
      let fileMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const downloadName = `Bulletin ${student.last_name} ${student.first_name} - Periode ${period.period_number}`;
      let pdfBlob: Blob | null = null;
      let storageBucket = "student-documents";
      let docId = `local-${student.id}-${Date.now()}`;

      if (templateBuffer && mapping && fillData && templateSheet) {
        const written = writeFilledWorkbook(templateBuffer, mapping, fillData);
        if (written.warnings.length) console.warn("Bulletin formules", written.warnings);
        generalAverage = written.computed.generalAverage;
        for (const s of subjects) {
          subjectAverages[s.name] = written.computed.subjectAverages[s.name] ?? null;
        }
        const bytes = toBlobBytes(written.buffer as ArrayBuffer | Uint8Array | number[]);
        blob = new Blob([bytes], { type: fileMime });
        renderedVia = "offline-template";
        try {
          const filled = fillTemplate(templateSheet, mapping, fillData);
          const canvas = renderFilledSheetCanvas(templateSheet, filled.values);
          pdfBlob = await canvasToPdfBlob(canvas);
        } catch (e) {
          console.warn("PDF modele", e);
        }
      } else {
        for (const s of subjects) {
          subjectAverages[s.name] = null;
        }
        generalAverage = liveModel?.generalAverage ?? null;
        const canvas = renderBulletinCanvas({
          establishmentName,
          className: klass.name,
          studentName: `${student.last_name} ${student.first_name}`,
          periodNumber: period.period_number,
          subjects,
          bySubject,
          average: generalAverage,
        });
        blob = await canvasToPdfBlob(canvas);
        fileExt = "pdf";
        fileMime = "application/pdf";
        renderedVia = "offline-generic";
      }

      if (!blob || blob.size === 0) throw new Error("Generation du bulletin impossible (fichier vide).");

      // Telechargement immediat dans le navigateur (ne depend pas du stockage)
      downloadBlob(blob, `${downloadName}.${fileExt}`);
      setLocalFiles((prev) => ({
        ...prev,
        [student.id]: { blob, name: downloadName, ext: fileExt },
      }));

      const weakSubjects = Object.entries(subjectAverages)
        .filter(([, avg]) => avg !== null && avg < PASS_THRESHOLD)
        .map(([name]) => name);
      const stamp = Date.now();
      const path = `${klass.establishment_id}/${student.id}/bulletin-p${period.period_number}-${stamp}.${fileExt}`;

      // Stockage : non bloquant (le navigateur a deja le fichier)
      try {
        if (fileExt === "xlsx") {
          const up = await uploadBulletinWorkbook(path, blob);
          storageBucket = up.bucket;
          fileMime = up.contentType;
        } else {
          await uploadStudentPdf(path, blob);
        }
        const { data: doc, error: docError } = await supabase
          .from("student_documents")
          .insert({
            student_id: student.id,
            establishment_id: klass.establishment_id,
            name: downloadName,
            file_path: storageBucket === "student-documents" ? path : `${storageBucket}:${path}`,
            file_type: fileMime,
            file_size: blob.size,
          })
          .select()
          .single();
        if (!docError && doc) docId = doc.id;

        if (pdfBlob && pdfBlob.size > 0 && fileExt === "xlsx") {
          const pdfPath = `${klass.establishment_id}/${student.id}/bulletin-p${period.period_number}-${stamp}.pdf`;
          try {
            await uploadStudentPdf(pdfPath, pdfBlob);
            await supabase.from("student_documents").insert({
              student_id: student.id,
              establishment_id: klass.establishment_id,
              name: `${downloadName} (PDF)`,
              file_path: pdfPath,
              file_type: "application/pdf",
              file_size: pdfBlob.size,
            });
          } catch (e) {
            console.warn("PDF upload", e);
          }
        }
      } catch (e) {
        console.warn("Stockage bulletin (fichier deja telecharge)", e);
        toast.message("Fichier telecharge. Enregistrement cloud en echec — reessayez plus tard.");
      }

      const cardPayload = {
        student_id: student.id,
        class_id: klass.id,
        establishment_id: klass.establishment_id,
        period_id: period.id,
        status: "validated" as const,
        weak_subjects: weakSubjects as never,
        general_average: generalAverage,
        subject_averages: subjectAverages as never,
        document_id: docId.startsWith("local-") ? null : docId,
        validated_at: new Date().toISOString(),
      };
      try {
        const { error: cardError } = await supabase
          .from("student_report_cards")
          .upsert(cardPayload, { onConflict: "student_id,period_id" });
        if (cardError) {
          await supabase.from("student_report_cards").insert(cardPayload);
        }
      } catch (e) {
        console.warn("report card", e);
      }

      if (generalAverage !== null && period.period_number >= 1 && period.period_number <= 3) {
        const termColumn = `term${period.period_number}_average` as
          | "term1_average"
          | "term2_average"
          | "term3_average";
        const { error: termError } = await supabase
          .from("students")
          .update({ [termColumn]: generalAverage })
          .eq("id", student.id);
        if (termError) console.warn("term average update", termError);
        else qc.invalidateQueries({ queryKey: ["students"] });
      }

      try {
        await writeAudit("create", "student_report_cards" as never, student.id, { period_id: period.id });
      } catch {
        /* ignore */
      }
      qc.invalidateQueries({ queryKey: ["student_documents"] });
      qc.invalidateQueries({ queryKey: ["student_report_cards"] });
      setValidated((v) => ({ ...v, [student.id]: docId }));
      toast.success(
        renderedVia === "offline-template"
          ? `Bulletin .xlsx telecharge${generalAverage != null ? ` (moy. ${generalAverage.toFixed(2)})` : ""}`
          : "Bulletin PDF provisoire telecharge",
      );
    } catch (e) {
      console.error("validate bulletin", e);
      toast.error(describeError(e, "Validation du bulletin impossible", "report_templates"));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!student) return;
    const local = localFiles[student.id];
    if (local) {
      downloadBlob(local.blob, `${local.name}.${local.ext}`);
      return;
    }
    const documentId = validated[student.id];
    if (!documentId || documentId.startsWith("local-")) {
      toast.error("Fichier non disponible — revalidez le bulletin.");
      return;
    }
    const { data: doc } = await supabase
      .from("student_documents")
      .select("file_path,name,file_type")
      .eq("id", documentId)
      .single();
    if (!doc) return;
    let bucket = "student-documents";
    let path = doc.file_path;
    if (path.includes(":") && !path.startsWith("http")) {
      const [b, ...rest] = path.split(":");
      if (b === "report-templates" || b === "student-documents") {
        bucket = b;
        path = rest.join(":");
      }
    }
    const { data: signed, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
    if (error || !signed) {
      toast.error("Lien indisponible");
      return;
    }
    const res = await fetch(signed.signedUrl);
    const ext = path.includes(".xlsx") ? "xlsx" : path.includes(".pdf") ? "pdf" : "xlsx";
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

        {templateLoading && <p className="text-xs text-muted-foreground">Chargement du modele…</p>}
        {templateWarning && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {templateWarning}
          </div>
        )}
        {templateSheet && templateMapping && !templateLoading && (
          <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
            A la validation : telechargement .xlsx immediat + enregistrement bibliotheque.
          </div>
        )}

        {missingEvaluation.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
            Notes d'evaluation manquantes : {missingEvaluation.map((s) => s.name).join(", ")}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-2">Matiere</th>
                <th className="p-2 text-right">Eval.</th>
                <th className="p-2 text-right">Compo</th>
                <th className="p-2 text-right">Moy.</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => {
                const subjectGrades = bySubject.get(s.id) ?? [];
                const evals = subjectGrades.filter((g) => g.nature === "evaluation");
                const comp = subjectGrades.find((g) => g.nature === "composition");
                const moy = liveModel?.subjectAverages[s.name] ?? null;
                return (
                  <tr key={s.id} className="border-t border-border">
                    <td className="p-2 font-medium">{s.name}</td>
                    <td className="p-2 text-right tabular-nums">
                      {evals.length ? evals.map((g) => `${g.value}/${g.scale}`).join(", ") : "—"}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {comp ? `${comp.value}/${comp.scale}` : "—"}
                    </td>
                    <td className="p-2 text-right tabular-nums font-medium">
                      {moy !== null && moy !== undefined ? moy.toFixed(2) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Moyenne generale (modele) :{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {liveModel?.generalAverage != null ? `${liveModel.generalAverage.toFixed(2)}/20` : "—"}
          </span>
          {" · "}Eval / composition ne comptent pas comme moyenne. Seule la formule Excel compte.
        </p>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button variant="outline" asChild>
            <Link to="/eleves/$studentId/notes" params={{ studentId: student.id }}>
              Modifier les notes
            </Link>
          </Button>
          <div className="flex flex-wrap gap-2">
            {validated[student.id] ? (
              <Button variant="outline" onClick={() => void download()}>
                <Download className="mr-1.5 h-4 w-4" /> Telecharger
              </Button>
            ) : (
              <Button onClick={() => void validate()} disabled={busy || templateLoading}>
                {busy ? "Validation…" : "Valider"}
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

export { AnnualBulletinDialog, renderBulletinCanvas } from "@/components/school/bulletin-annual";
