/**
 * Notes de l'eleve — periodes classees par classe.
 * Clic sur une periode : notes, moyenne generale, bulletin.
 */
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  ShieldAlert,
  ChevronRight,
  FileText,
  Download,
  BookOpen,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData } from "@/lib/school-data";
import { writeAudit, useRows } from "@/lib/data";
import { describeError } from "@/lib/errors";
import { formatDate, formatNumber, formatDateTime } from "@/lib/format";
import { downloadBlob } from "@/lib/pdf-export";
import {
  PASS_THRESHOLD,
  to20,
  studentPeriodAverage,
  type Grade,
  type GradePeriod,
  type ClassSubject,
  type StudentReportCard,
} from "@/lib/grades";
import type { Tables } from "@/integrations/supabase/types";

type StudentDocument = Tables<"student_documents">;

export const Route = createFileRoute("/_authenticated/eleves/$studentId/notes")({
  head: () => ({
    meta: [
      { title: "Notes de l'eleve – Les Elites de Gao" },
      { name: "description", content: "Periodes, notes, moyennes et bulletins par classe." },
    ],
  }),
  component: Page,
});

function Page() {
  const { studentId } = Route.useParams();
  const navigate = useNavigate();
  const { isDG, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const data = useSchoolData();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);

  const student = data.students.find((s) => s.id === studentId);
  const allowed = student && (isDG || establishmentIds.includes(student.establishment_id));

  const gradesQuery = useRows<Grade>("grades", {
    eq: { student_id: studentId },
    order: { column: "created_at", ascending: false },
  });
  const grades = gradesQuery.data ?? [];

  const classIds = useMemo(() => {
    const ids = new Set<string>();
    if (student?.class_id) ids.add(student.class_id);
    for (const e of data.enrollments.filter((x) => x.student_id === studentId)) {
      if (e.class_id) ids.add(e.class_id);
    }
    for (const g of grades) {
      if (g.class_id) ids.add(g.class_id);
    }
    return [...ids];
  }, [student?.class_id, data.enrollments, studentId, grades]);

  const allPeriodsQuery = useRows<GradePeriod>("grade_periods", {
    order: { column: "period_number", ascending: true },
  });
  const periods = useMemo(
    () => (allPeriodsQuery.data ?? []).filter((p) => classIds.includes(p.class_id)),
    [allPeriodsQuery.data, classIds],
  );

  const subjectsQuery = useRows<ClassSubject>("class_subjects", {
    order: { column: "name" },
  });
  const subjectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of subjectsQuery.data ?? []) {
      if (classIds.includes(s.class_id)) map.set(s.id, s.name);
    }
    return map;
  }, [subjectsQuery.data, classIds]);

  const cardsQuery = useRows<StudentReportCard>("student_report_cards", {
    eq: { student_id: studentId },
  });
  const cards = cardsQuery.data ?? [];

  const docsQuery = useRows<StudentDocument>("student_documents", {
    eq: { student_id: studentId },
    order: { column: "created_at", ascending: false },
  });
  const documents = docsQuery.data ?? [];

  const classLabel = (classId: string) => {
    const c = data.classes.find((x) => x.id === classId);
    if (c) return c.name;
    const e = data.enrollments.find((x) => x.student_id === studentId && x.class_id === classId);
    return e?.class_name ?? "Classe";
  };

  const groups = useMemo(() => {
    const byClass = new Map<
      string,
      {
        classId: string;
        className: string;
        periods: {
          period: GradePeriod;
          grades: Grade[];
          average: number | null;
          validatedAvg: number | null;
          bulletinDoc: StudentDocument | null;
        }[];
      }
    >();

    for (const p of periods) {
      const classId = p.class_id;
      const name = classLabel(classId);
      if (!byClass.has(classId)) {
        byClass.set(classId, { classId, className: name, periods: [] });
      }
      const mine = grades.filter((g) => g.period_id === p.id);
      const card = cards.find((c) => c.period_id === p.id);
      const validatedAvg =
        card?.general_average !== null && card?.general_average !== undefined
          ? Number(card.general_average)
          : null;
      const liveAvg = studentPeriodAverage(mine, studentId);
      const average = validatedAvg ?? liveAvg;

      let bulletinDoc: StudentDocument | null = null;
      if (card?.document_id) {
        bulletinDoc = documents.find((d) => d.id === card.document_id) ?? null;
      }
      if (!bulletinDoc) {
        const needle = `periode ${p.period_number}`.toLowerCase();
        bulletinDoc =
          documents.find(
            (d) =>
              d.name.toLowerCase().includes(needle) ||
              d.file_path.includes(`bulletin-p${p.period_number}`),
          ) ?? null;
      }

      byClass.get(classId)!.periods.push({
        period: p,
        grades: mine.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
        average,
        validatedAvg,
        bulletinDoc,
      });
    }

    for (const g of byClass.values()) {
      g.periods.sort((a, b) => b.period.period_number - a.period.period_number);
    }

    return [...byClass.values()].sort((a, b) => a.className.localeCompare(b.className));
  }, [periods, grades, cards, documents, studentId, data.classes, data.enrollments]);

  const selected = useMemo(() => {
    if (!selectedPeriodId) return null;
    for (const g of groups) {
      const found = g.periods.find((x) => x.period.id === selectedPeriodId);
      if (found) return { ...found, className: g.className, classId: g.classId };
    }
    return null;
  }, [selectedPeriodId, groups]);

  const loading = gradesQuery.isPending || allPeriodsQuery.isPending;

  if (!data.loading && !establishmentIdsLoading && (!student || !allowed)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Eleve introuvable"
        description="Cet eleve n'existe pas ou vous n'y avez pas acces."
      />
    );
  }
  if (!student) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit"
        onClick={() => navigate({ to: "/eleves/$studentId", params: { studentId } })}
      >
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour a la fiche
      </Button>

      <PageHeader
        eyebrow="Notes"
        title={`Notes — ${student.last_name} ${student.first_name}`}
        description="Periodes classees par classe. Cliquez une periode pour voir les notes, la moyenne et le bulletin."
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Aucune periode"
          description="Aucune periode scolaire ni note pour cet eleve."
        />
      ) : selected ? (
        <PeriodDetail
          studentId={studentId}
          className={selected.className}
          period={selected.period}
          grades={selected.grades}
          average={selected.average}
          validated={selected.validatedAvg !== null}
          bulletinDoc={selected.bulletinDoc}
          subjectName={subjectName}
          onBack={() => setSelectedPeriodId(null)}
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.classId} className="space-y-2">
              <h2 className="font-display text-sm font-semibold text-foreground">{g.className}</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {g.periods.map(({ period, average, grades: list, bulletinDoc }) => {
                  const locked = period.ended_at !== null;
                  const active = period.ended_at === null;
                  return (
                    <button
                      key={period.id}
                      type="button"
                      onClick={() => setSelectedPeriodId(period.id)}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition hover:border-primary/40 ${
                        active ? "border-primary/30 bg-primary/5" : "border-border bg-card"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">
                          Periode {period.period_number}
                          {active ? " · en cours" : locked ? " · close" : ""}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {list.length} note{list.length !== 1 ? "s" : ""}
                          {bulletinDoc ? " · bulletin" : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={average !== null && average < PASS_THRESHOLD ? "destructive" : "secondary"}
                          className="tabular-nums"
                        >
                          {average === null ? "—" : formatNumber(average, 2)}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function PeriodDetail({
  studentId,
  className,
  period,
  grades,
  average,
  validated,
  bulletinDoc,
  subjectName,
  onBack,
}: {
  studentId: string;
  className: string;
  period: GradePeriod;
  grades: Grade[];
  average: number | null;
  validated: boolean;
  bulletinDoc: StudentDocument | null;
  subjectName: Map<string, string>;
  onBack: () => void;
}) {
  const locked = period.ended_at !== null;
  const [busy, setBusy] = useState(false);

  const openBulletin = async () => {
    if (!bulletinDoc) {
      toast.message("Aucun bulletin enregistre pour cette periode.");
      return;
    }
    setBusy(true);
    try {
      let bucket = "student-documents";
      let path = bulletinDoc.file_path;
      if (path.includes(":") && !path.startsWith("http")) {
        const [b, ...rest] = path.split(":");
        if (b === "report-templates" || b === "student-documents") {
          bucket = b;
          path = rest.join(":");
        }
      }
      const { data: signed, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
      if (error || !signed) throw error ?? new Error("Lien indisponible");
      const res = await fetch(signed.signedUrl);
      const blob = await res.blob();
      const ext = path.includes(".xlsx") ? "xlsx" : path.includes(".pdf") ? "pdf" : "bin";
      downloadBlob(blob, `${bulletinDoc.name}.${ext}`);
    } catch (e) {
      toast.error((e as Error).message || "Telechargement impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={onBack}>
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Toutes les periodes
      </Button>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              {className} — Periode {period.period_number}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Du {formatDate(period.started_at)}{" "}
              {period.ended_at ? `au ${formatDate(period.ended_at)}` : "— en cours"}
              {locked ? " · lecture seule" : ""}
            </p>
          </div>
          <Badge
            variant={average !== null && average < PASS_THRESHOLD ? "destructive" : "default"}
            className="tabular-nums text-sm"
          >
            Moyenne {average === null ? "—" : `${formatNumber(average, 2)} / 20`}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {validated && <Badge variant="secondary">Bulletin valide</Badge>}
            {bulletinDoc ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void openBulletin()}>
                <Download className="mr-1.5 h-4 w-4" />
                Telecharger le bulletin
                {bulletinDoc.file_path.includes(".xlsx") ? " (.xlsx)" : ""}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" /> Pas encore de bulletin pour cette periode
              </p>
            )}
            <Button size="sm" variant="ghost" asChild>
              <Link to="/eleves/$studentId" params={{ studentId }}>
                Fiche eleve
              </Link>
            </Button>
          </div>

          {grades.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune note sur cette periode.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {grades.map((g) => (
                <GradeRow
                  key={g.id}
                  grade={g}
                  subject={subjectName.get(g.subject_id) ?? "Matiere"}
                  locked={locked}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GradeRow({ grade, subject, locked }: { grade: Grade; subject: string; locked?: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(grade.value));
  const [scale, setScale] = useState(String(grade.scale));
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["grades"] });

  const save = async () => {
    if (locked) {
      toast.error("Cette periode est close : modification impossible.");
      return;
    }
    const v = Number(value);
    const s = Number(scale);
    if (!(s > 0) || !(v >= 0) || v > s) {
      toast.error("Note invalide : elle doit etre comprise entre 0 et le bareme.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from("grades").update({ value: v, scale: s }).eq("id", grade.id);
      if (error) throw error;
      await writeAudit("update", "grades" as never, grade.id, { value: v, scale: s });
      refresh();
      toast.success("Note modifiee");
      setOpen(false);
    } catch (e) {
      toast.error(describeError(e, "Modification impossible", "grades"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (locked) {
      toast.error("Cette periode est close : suppression impossible.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from("grades").delete().eq("id", grade.id);
      if (error) throw error;
      await writeAudit("delete", "grades" as never, grade.id, {});
      refresh();
      toast.success("Note supprimee");
    } catch (e) {
      toast.error(describeError(e, "Suppression impossible", "grades"));
    } finally {
      setBusy(false);
    }
  };

  const normalized = to20(Number(grade.value), Number(grade.scale));

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{subject}</p>
        <p className="text-xs text-muted-foreground">
          {grade.nature === "composition" ? "Composition" : `Evaluation ${grade.sequence_number ?? ""}`} ·{" "}
          {formatDate(grade.created_at)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="tabular-nums text-sm font-semibold text-foreground">
          {formatNumber(Number(grade.value), 2)} / {formatNumber(Number(grade.scale), 0)}
        </span>
        <Badge variant={normalized < PASS_THRESHOLD ? "destructive" : "outline"} className="tabular-nums">
          {formatNumber(normalized, 2)} /20
        </Badge>
        {locked ? (
          <Badge variant="secondary" className="text-[10px]">
            Close
          </Badge>
        ) : (
          <>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(true)} aria-label="Modifier">
              <Pencil className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Supprimer">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Supprimer cette note ?</AlertDialogTitle>
                  <AlertDialogDescription>La note de {subject} sera supprimee.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction disabled={busy} onClick={() => void remove()}>
                    Supprimer
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Modifier la note</DialogTitle>
            <DialogDescription>{subject}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-sm">Note</Label>
              <Input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">Bareme</Label>
              <Input type="number" step="any" value={scale} onChange={(e) => setScale(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button disabled={busy || locked} onClick={() => void save()}>
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
