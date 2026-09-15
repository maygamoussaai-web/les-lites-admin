/**
 * FICHE CLASSE — système de gestion des notes et bulletins.
 *
 * NOTE POUR COLLABORATION (Claude + Lovable travaillent en parallèle sur
 * cette fonctionnalité) :
 * - Tables utilisées : class_subjects, grade_periods, grades,
 *   student_report_cards, class_reports (voir src/lib/grades.ts pour les
 *   types et les fonctions de calcul).
 * - Une "période" (grade_periods) est ouverte automatiquement à la première
 *   note enregistrée pour une classe, et fermée via le bouton "Nouvelle
 *   période" (ended_at renseigné). Une seule période ouverte par classe à la
 *   fois (contrainte unique en base : idx_grade_periods_one_open).
 * - Pas de coefficient par matière pour l'instant (simplification
 *   volontaire, voir Phase 3 pour les modèles Excel à venir) : la moyenne
 *   générale d'un élève = moyenne simple des moyennes de chaque matière,
 *   chaque note étant normalisée sur 20 individuellement (voir
 *   src/lib/grades.ts : to20, subjectAverage, studentAverage).
 * - Seuils utilisés : 10/20 = "a eu la moyenne", 15/20 = "excellent" (75% du
 *   barème) — constantes PASS_THRESHOLD / EXCELLENT_THRESHOLD dans
 *   src/lib/grades.ts, à ne pas dupliquer ailleurs.
 * - Le rendu des bulletins/rapports PDF ci-dessous est un rendu GENÉRIQUE
 *   (tableau simple dessiné sur canvas, puis converti en PDF via
 *   src/lib/pdf-export.ts:canvasToPdfBlob). Il sera remplacé par les vrais
 *   modèles par classe dès réception des fichiers Excel fournis par
 *   l'utilisateur (Phase 3). Merci de ne pas dupliquer un second système de
 *   génération PDF — tout doit passer par pdf-export.ts.
 * - Reste à faire (Phase 2, pas encore construit ici) : photo de profil
 *   élève, liste "matières à travailler" sur la fiche élève, page dédiée
 *   "Historique des notes" par élève (le bouton "Modifier" du parcours de
 *   validation des bulletins pointe vers cette page à venir).
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Trophy,
  TrendingDown,
  Users,
  GraduationCap,
  AlertTriangle,
  Plus,
  RotateCcw,
  FileBarChart,
  FileText,
  Download,
  Trash2,
  Eye,
  Clock,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { StudentsDialog } from "@/components/school/students-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData } from "@/lib/school-data";
import { writeAudit, useRows } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { canvasToPdfBlob, downloadBlob } from "@/lib/pdf-export";
import {
  PASS_THRESHOLD,
  EXCELLENT_THRESHOLD,
  subjectAverage,
  studentAverage,
  groupGradesBySubject,
  type ClassSubject,
  type GradePeriod,
  type Grade,
  type ClassReport,
} from "@/lib/grades";

export const Route = createFileRoute("/_authenticated/classes/$classId")({
  head: () => ({
    meta: [
      { title: "Classe – Les Élites de Gao" },
      { name: "description", content: "Notes, bulletins et résultats d'une classe." },
    ],
  }),
  component: Page,
});

type StudentRef = { id: string; first_name: string; last_name: string };
type AveragedStudent = { student: StudentRef; average: number; weakSubjects: string[] };

/** Statistiques calculées pour une période de classe — partagé entre la page et le rapport PDF. */
interface ClassStats {
  withAvg: AveragedStudent[];
  passing: AveragedStudent[];
  excellent: AveragedStudent[];
  struggling: AveragedStudent[];
  classAverage: number | null;
  highest: AveragedStudent | null;
  lowest: AveragedStudent | null;
  bestSubject: { subject: ClassSubject; avg: number } | null;
  worstSubject: { subject: ClassSubject; avg: number } | null;
}

function useSupabaseRows<T extends { id: string }>(
  table: Parameters<typeof useRows>[0],
  eq: Record<string, string> | null,
  orderColumn: string,
  ascending = true,
) {
  const q = useRows<T>(table, { eq: eq ?? {}, enabled: !!eq, order: { column: orderColumn, ascending } });
  return { data: q.data ?? [], isLoading: q.isLoading };
}

function Page() {
  const { classId } = Route.useParams();
  const { isDG, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const data = useSchoolData();
  const qc = useQueryClient();

  const klass = data.classes.find((c) => c.id === classId);
  const allowed = klass && (isDG || establishmentIds.includes(klass.establishment_id));
  const establishment = klass ? data.establishments.find((e) => e.id === klass.establishment_id) : null;
  const classStudents = useMemo(
    () => data.students.filter((s) => s.class_id === classId).sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)),
    [data.students, classId],
  );

  const [studentsOpen, setStudentsOpen] = useState(false);
  const [noteEntryOpen, setNoteEntryOpen] = useState(false);
  const [bulletinsOpen, setBulletinsOpen] = useState(false);

  // Périodes et matières de la classe (RLS filtre déjà par établissement).
  const periodsQuery = useSupabaseRows<GradePeriod>("grade_periods", { class_id: classId }, "period_number");
  const subjectsQuery = useSupabaseRows<ClassSubject>("class_subjects", { class_id: classId }, "name");
  const currentPeriod = periodsQuery.data.find((p) => p.ended_at === null) ?? null;
  const latestPeriod = currentPeriod ?? [...periodsQuery.data].sort((a, b) => b.period_number - a.period_number)[0] ?? null;
  const gradesQuery = useSupabaseRows<Grade>("grades", latestPeriod ? { period_id: latestPeriod.id } : null, "created_at");

  const [renewOpen, setRenewOpen] = useState(false);

  const startNewPeriod = async () => {
    if (!klass) return;
    try {
      if (currentPeriod) {
        const { error } = await supabase.from("grade_periods").update({ ended_at: new Date().toISOString() }).eq("id", currentPeriod.id);
        if (error) throw error;
      }
      const nextNumber = (periodsQuery.data.reduce((max, p) => Math.max(max, p.period_number), 0) || 0) + 1;
      const { error } = await supabase.from("grade_periods").insert({
        class_id: classId,
        establishment_id: klass.establishment_id,
        period_number: nextNumber,
      });
      if (error) throw error;
      await writeAudit("create", "grade_periods" as never, null, { class_id: classId, period_number: nextNumber });
      qc.invalidateQueries({ queryKey: ["grade_periods"] });
      toast.success(`Période ${nextNumber} démarrée`);
    } catch (e) {
      toast.error((e as Error).message || "Impossible de démarrer la période");
    } finally {
      setRenewOpen(false);
    }
  };

  // Statistiques de la période affichée (la plus récente, ouverte ou non).
  const stats: ClassStats | null = useMemo(() => {
    if (!latestPeriod) return null;
    const bySubjectAll = new Map<string, Grade[]>();
    for (const g of gradesQuery.data) {
      const list = bySubjectAll.get(g.subject_id) ?? [];
      list.push(g);
      bySubjectAll.set(g.subject_id, list);
    }

    const withAvg: AveragedStudent[] = [];
    for (const s of classStudents) {
      const bySubject = groupGradesBySubject(gradesQuery.data, s.id);
      const avg = studentAverage(bySubject);
      if (avg === null) continue;
      const weakSubjects = [...bySubject.entries()]
        .map(([subjectId, grades]) => ({ subjectId, avg: subjectAverage(grades) }))
        .filter((x) => x.avg !== null && x.avg < PASS_THRESHOLD)
        .map((x) => subjectsQuery.data.find((sub) => sub.id === x.subjectId)?.name ?? "—");
      withAvg.push({ student: s, average: avg, weakSubjects });
    }

    const passing = withAvg.filter((r) => r.average >= PASS_THRESHOLD);
    const excellent = withAvg.filter((r) => r.average >= EXCELLENT_THRESHOLD);
    const struggling = withAvg.filter((r) => r.average < PASS_THRESHOLD);
    const classAverage = withAvg.length ? withAvg.reduce((a, r) => a + r.average, 0) / withAvg.length : null;
    const highest = withAvg.length ? withAvg.reduce((a, b) => (b.average > a.average ? b : a)) : null;
    const lowest = withAvg.length ? withAvg.reduce((a, b) => (b.average < a.average ? b : a)) : null;

    const subjectAverages = subjectsQuery.data
      .map((sub) => ({ subject: sub, avg: subjectAverage(bySubjectAll.get(sub.id) ?? []) }))
      .filter((x): x is { subject: ClassSubject; avg: number } => x.avg !== null);
    const bestSubject = subjectAverages.length ? subjectAverages.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
    const worstSubject = subjectAverages.length ? subjectAverages.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;

    return { withAvg, passing, excellent, struggling, classAverage, highest, lowest, bestSubject, worstSubject };
  }, [latestPeriod, gradesQuery.data, classStudents, subjectsQuery.data]);

  if (!data.loading && !establishmentIdsLoading && (!klass || !allowed)) {
    return <EmptyState icon={AlertTriangle} title="Accès refusé" description="Cette classe n'existe pas ou vous n'y avez pas accès." />;
  }
  if (!klass) return null;

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link to="/etablissements/$id" params={{ id: klass.establishment_id }}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour à l'établissement
        </Link>
      </Button>

      <PageHeader
        eyebrow={establishment?.name ?? "Classe"}
        title={klass.name}
        description={
          currentPeriod
            ? `Période ${currentPeriod.period_number} en cours — démarrée le ${formatDateTime(currentPeriod.started_at)}`
            : "Aucune période en cours — elle démarrera automatiquement à la première note enregistrée."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="press" onClick={() => setStudentsOpen(true)}>
              <Users className="mr-1.5 h-4 w-4" /> Voir les élèves
            </Button>
            <Button size="sm" className="press" onClick={() => setNoteEntryOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Enregistrer une note
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Moyenne de la classe" value={stats?.classAverage != null ? stats.classAverage.toFixed(2) : "—"} icon={Users} />
        <StatCard label="Ont la moyenne" value={stats ? `${stats.passing.length} / ${stats.withAvg.length}` : "—"} icon={GraduationCap} tone="accent" delay={60} />
        <StatCard label="Plus haute moyenne" value={stats?.highest ? stats.highest.average.toFixed(2) : "—"} icon={Trophy} tone="success" delay={120} />
        <StatCard label="Plus basse moyenne" value={stats?.lowest ? stats.lowest.average.toFixed(2) : "—"} icon={TrendingDown} tone="destructive" delay={180} />
      </div>

      {stats && stats.withAvg.length > 0 && (
        <Card className="animate-rise panel-gradient">
          <CardHeader>
            <CardTitle className="font-display text-base">Taux de réussite</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {stats.passing.length} sur {stats.withAvg.length} ont la moyenne
              </span>
              <span className="font-semibold text-foreground">{Math.round((stats.passing.length / stats.withAvg.length) * 100)}%</span>
            </div>
            <Progress value={(stats.passing.length / stats.withAvg.length) * 100} className="h-2.5" />
          </CardContent>
        </Card>
      )}

      {stats && (stats.bestSubject || stats.worstSubject) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {stats.bestSubject && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Matière la plus forte</p>
              <p className="mt-1 font-display text-lg font-semibold text-foreground">{stats.bestSubject.subject.name}</p>
              <p className="text-sm text-muted-foreground">{stats.bestSubject.avg.toFixed(2)} / 20</p>
            </div>
          )}
          {stats.worstSubject && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Matière la plus faible</p>
              <p className="mt-1 font-display text-lg font-semibold text-foreground">{stats.worstSubject.subject.name}</p>
              <p className="text-sm text-muted-foreground">{stats.worstSubject.avg.toFixed(2)} / 20</p>
            </div>
          )}
        </div>
      )}

      {stats && (
        <div className="grid gap-4 sm:grid-cols-2">
          <StudentGroupCard title="Élèves en difficulté" rows={stats.struggling} tone="destructive" />
          <StudentGroupCard title="Élèves excellents" rows={stats.excellent} tone="success" />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="press" onClick={() => setRenewOpen(true)}>
          <RotateCcw className="mr-1.5 h-4 w-4" /> Nouvelle période
        </Button>
        <Button variant="outline" className="press" onClick={() => setBulletinsOpen(true)} disabled={!latestPeriod || classStudents.length === 0}>
          <FileText className="mr-1.5 h-4 w-4" /> Créer les bulletins
        </Button>
      </div>

      <ClassReportsSection
        classId={classId}
        establishmentId={klass.establishment_id}
        establishmentName={establishment?.name ?? "—"}
        className={klass.name}
        period={latestPeriod}
        stats={stats}
      />

      <StudentsDialog klass={studentsOpen ? klass : null} data={data} onClose={() => setStudentsOpen(false)} />

      <NoteEntryDialog
        open={noteEntryOpen}
        onClose={() => setNoteEntryOpen(false)}
        classId={classId}
        establishmentId={klass.establishment_id}
        students={classStudents}
        subjects={subjectsQuery.data}
        currentPeriod={currentPeriod}
      />

      {bulletinsOpen && latestPeriod && (
        <BulletinWalkthroughDialog
          open={bulletinsOpen}
          onClose={() => setBulletinsOpen(false)}
          klass={klass}
          establishmentName={establishment?.name ?? "—"}
          students={classStudents}
          subjects={subjectsQuery.data}
          period={latestPeriod}
          grades={gradesQuery.data}
        />
      )}

      <AlertDialog open={renewOpen} onOpenChange={setRenewOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Démarrer une nouvelle période ?</AlertDialogTitle>
            <AlertDialogDescription>
              {currentPeriod
                ? `La période ${currentPeriod.period_number} sera clôturée (ses notes restent consultables dans l'historique de chaque élève). Une nouvelle période démarre immédiatement, vide.`
                : "Une nouvelle période vide sera créée."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={startNewPeriod}>Confirmer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function StudentGroupCard({ title, rows, tone }: { title: string; rows: AveragedStudent[]; tone: "destructive" | "success" }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title} ({rows.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun élève.</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.student.id} className="flex items-center justify-between text-sm">
                <span>{r.student.last_name} {r.student.first_name}</span>
                <Badge variant={tone === "destructive" ? "destructive" : "default"} className={tone === "success" ? "bg-success text-success-foreground" : ""}>
                  {r.average.toFixed(2)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------------- */
/* Saisie de note — mode B : une matière/nature à la fois, toute la classe   */
/* ---------------------------------------------------------------------- */

function NoteEntryDialog({
  open,
  onClose,
  classId,
  establishmentId,
  students,
  subjects,
  currentPeriod,
}: {
  open: boolean;
  onClose: () => void;
  classId: string;
  establishmentId: string;
  students: StudentRef[];
  subjects: ClassSubject[];
  currentPeriod: GradePeriod | null;
}) {
  const qc = useQueryClient();
  const [nature, setNature] = useState<"composition" | "evaluation">("evaluation");
  const [subjectId, setSubjectId] = useState("");
  const [newSubjectName, setNewSubjectName] = useState("");
  const [scale, setScale] = useState("20");
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setSubjectId("");
    setNewSubjectName("");
    setScale("20");
    setValues({});
  };

  const scaleNum = Number(scale);
  const canSubmit =
    !!(subjectId || newSubjectName.trim()) &&
    scaleNum > 0 &&
    Object.values(values).some((v) => v !== "") &&
    !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      let finalSubjectId = subjectId;
      if (!finalSubjectId && newSubjectName.trim()) {
        const { data: created, error } = await supabase
          .from("class_subjects")
          .insert({ class_id: classId, establishment_id: establishmentId, name: newSubjectName.trim() })
          .select()
          .single();
        if (error) throw error;
        finalSubjectId = created.id;
      }

      let period = currentPeriod;
      if (!period) {
        const { data: created, error } = await supabase
          .from("grade_periods")
          .insert({ class_id: classId, establishment_id: establishmentId, period_number: 1 })
          .select()
          .single();
        if (error) throw error;
        period = created;
      }

      const entries = Object.entries(values).filter(([, v]) => v !== "" && !Number.isNaN(Number(v)));
      for (const [studentId, value] of entries) {
        if (nature === "composition") {
          const { error } = await supabase.from("grades").upsert(
            {
              period_id: period.id,
              class_id: classId,
              establishment_id: establishmentId,
              subject_id: finalSubjectId,
              student_id: studentId,
              nature: "composition",
              sequence_number: 1,
              value: Number(value),
              scale: scaleNum,
            },
            { onConflict: "period_id,subject_id,student_id", ignoreDuplicates: false },
          );
          if (error) throw error;
        } else {
          const { error } = await supabase.from("grades").insert({
            period_id: period.id,
            class_id: classId,
            establishment_id: establishmentId,
            subject_id: finalSubjectId,
            student_id: studentId,
            nature: "evaluation",
            value: Number(value),
            scale: scaleNum,
          });
          if (error) throw error;
        }
      }

      await writeAudit("create", "grades" as never, null, { class_id: classId, subject_id: finalSubjectId, nature, count: entries.length });
      qc.invalidateQueries({ queryKey: ["grades"] });
      qc.invalidateQueries({ queryKey: ["class_subjects"] });
      qc.invalidateQueries({ queryKey: ["grade_periods"] });
      toast.success(`${entries.length} note(s) enregistrée(s)`);
      reset();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Enregistrement impossible");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enregistrer une note</DialogTitle>
          <DialogDescription>
            Choisissez la nature, la matière et le barème, puis remplissez la note de chaque élève concerné (les
            champs laissés vides sont ignorés).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-sm">Nature</Label>
            <Select value={nature} onValueChange={(v) => setNature(v as "composition" | "evaluation")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="evaluation">Note d'évaluation</SelectItem>
                <SelectItem value="composition">Note de composition</SelectItem>
              </SelectContent>
            </Select>
            {nature === "composition" && (
              <p className="mt-1 text-xs text-muted-foreground">Une seule composition par matière et par période — une nouvelle saisie remplace la précédente.</p>
            )}
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">
              Barème<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input type="number" step="any" value={scale} onChange={(e) => setScale(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">
              Matière<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select value={subjectId || "__new"} onValueChange={(v) => setSubjectId(v === "__new" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__new">+ Nouvelle matière</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!subjectId && (
              <Input
                className="mt-2"
                placeholder="Nom de la matière"
                value={newSubjectName}
                onChange={(e) => setNewSubjectName(e.target.value)}
              />
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Élèves ({students.length})</p>
          {students.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun élève dans cette classe.</p>
          ) : (
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {students.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm">{s.last_name} {s.first_name}</span>
                  <Input
                    type="number"
                    step="any"
                    className="w-24"
                    value={values[s.id] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [s.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? "Enregistrement..." : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------- */
/* Création des bulletins — parcours élève par élève, ordre alphabétique     */
/* ---------------------------------------------------------------------- */

function BulletinWalkthroughDialog({
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
  const [validated, setValidated] = useState<Record<string, string>>({}); // studentId -> document_id
  const [busy, setBusy] = useState(false);

  const student = students[index] ?? null;
  const bySubject = student ? groupGradesBySubject(grades, student.id) : new Map<string, Grade[]>();
  const missingEvaluation = subjects.filter((s) => !(bySubject.get(s.id) ?? []).some((g) => g.nature === "evaluation"));
  const average = studentAverage(bySubject);

  const validate = async () => {
    if (!student) return;
    setBusy(true);
    try {
      const weakSubjects = subjects
        .map((s) => ({ name: s.name, avg: subjectAverage(bySubject.get(s.id) ?? []) }))
        .filter((x) => x.avg !== null && x.avg < PASS_THRESHOLD)
        .map((x) => x.name);

      const canvas = renderBulletinCanvas({
        establishmentName,
        className: klass.name,
        studentName: `${student.last_name} ${student.first_name}`,
        periodNumber: period.period_number,
        subjects,
        bySubject,
        average,
      });
      const blob = await canvasToPdfBlob(canvas);
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
          document_id: doc.id,
          validated_at: new Date().toISOString(),
        },
        { onConflict: "student_id,period_id" },
      );
      if (cardError) throw cardError;

      await writeAudit("create", "student_report_cards" as never, student.id, { period_id: period.id });
      qc.invalidateQueries({ queryKey: ["student_documents"] });
      setValidated((v) => ({ ...v, [student.id]: doc.id }));
      toast.success("Bulletin validé");
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
          <DialogDescription>Période {period.period_number} · {klass.name}</DialogDescription>
        </DialogHeader>

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
            <Link to="/eleves/$studentId" params={{ studentId: student.id }}>
              Modifier (fiche élève)
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

function renderBulletinCanvas({
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
  ctx.fillText("BULLETIN", 60, 140);
  ctx.font = "22px sans-serif";
  ctx.fillStyle = "#333333";
  ctx.fillText(`Classe : ${className}`, 60, 190);
  ctx.fillText(`Élève : ${studentName}`, 60, 220);
  ctx.fillText(`Période : ${periodNumber}`, 60, 250);

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

/* ---------------------------------------------------------------------- */
/* Rapport de classe — généré, téléchargeable, expire après 48h            */
/* ---------------------------------------------------------------------- */

function ClassReportsSection({
  classId,
  establishmentId,
  establishmentName,
  className,
  period,
  stats,
}: {
  classId: string;
  establishmentId: string;
  establishmentName: string;
  className: string;
  period: GradePeriod | null;
  stats: ClassStats | null;
}) {
  const qc = useQueryClient();
  const reportsQuery = useSupabaseRows<ClassReport>("class_reports", { class_id: classId }, "generated_at", false);
  const [generating, setGenerating] = useState(false);

  const activeReports = reportsQuery.data.filter((r) => new Date(r.expires_at) > new Date());

  const generate = async () => {
    if (!period || !stats) return;
    setGenerating(true);
    try {
      const canvas = renderClassReportCanvas({ establishmentName, className, period, stats });
      const blob = await canvasToPdfBlob(canvas);
      const path = `${establishmentId}/${classId}/rapport-p${period.period_number}-${Date.now()}.pdf`;
      const { error: uploadError } = await supabase.storage.from("class-reports").upload(path, blob, { contentType: "application/pdf" });
      if (uploadError) throw uploadError;
      const { error } = await supabase.from("class_reports").insert({
        class_id: classId,
        establishment_id: establishmentId,
        period_id: period.id,
        file_path: path,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["class_reports"] });
      toast.success("Rapport généré — disponible 48h");
    } catch (e) {
      toast.error((e as Error).message || "Génération impossible");
    } finally {
      setGenerating(false);
    }
  };

  const view = async (report: ClassReport) => {
    const { data, error } = await supabase.storage.from("class-reports").createSignedUrl(report.file_path, 300);
    if (error || !data) {
      toast.error("Lien indisponible");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const download = async (report: ClassReport) => {
    const { data, error } = await supabase.storage.from("class-reports").createSignedUrl(report.file_path, 300);
    if (error || !data) {
      toast.error("Lien indisponible");
      return;
    }
    const res = await fetch(data.signedUrl);
    downloadBlob(await res.blob(), `rapport-${className}.pdf`);
  };

  const remove = async (report: ClassReport) => {
    await supabase.storage.from("class-reports").remove([report.file_path]);
    await supabase.from("class_reports").delete().eq("id", report.id);
    qc.invalidateQueries({ queryKey: ["class_reports"] });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">Rapports de classe</h3>
        <Button variant="outline" size="sm" className="press" onClick={generate} disabled={!period || !stats || generating}>
          <FileBarChart className="mr-1.5 h-4 w-4" /> {generating ? "Génération..." : "Générer un rapport"}
        </Button>
      </div>
      {activeReports.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun rapport disponible. Les rapports générés restent disponibles 48h.</p>
      ) : (
        <div className="space-y-2">
          {activeReports.map((r) => {
            const hoursLeft = Math.max(0, Math.round((new Date(r.expires_at).getTime() - Date.now()) / 3_600_000));
            return (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-card px-3 py-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <FileBarChart className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Généré le {formatDateTime(r.generated_at)}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" /> Supprimé automatiquement dans {hoursLeft}h
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => view(r)} aria-label="Voir">
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => download(r)} aria-label="Télécharger">
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(r)} aria-label="Supprimer">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function renderClassReportCanvas({
  establishmentName,
  className,
  period,
  stats,
}: {
  establishmentName: string;
  className: string;
  period: GradePeriod;
  stats: ClassStats;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1000;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#12266B";
  ctx.font = "bold 34px sans-serif";
  ctx.fillText(establishmentName, 60, 80);
  ctx.font = "bold 40px sans-serif";
  ctx.fillText("RAPPORT DE CLASSE", 60, 140);
  ctx.font = "22px sans-serif";
  ctx.fillStyle = "#333333";
  ctx.fillText(`Classe : ${className} — Période ${period.period_number}`, 60, 190);

  const lines = [
    `Moyenne générale de la classe : ${stats.classAverage !== null ? stats.classAverage.toFixed(2) : "—"} / 20`,
    `Élèves ayant la moyenne : ${stats.passing.length} / ${stats.withAvg.length}`,
    `Élèves n'ayant pas la moyenne : ${stats.struggling.length} / ${stats.withAvg.length}`,
    `Plus haute moyenne : ${stats.highest ? `${stats.highest.average.toFixed(2)} (${stats.highest.student.last_name} ${stats.highest.student.first_name})` : "—"}`,
    `Plus basse moyenne : ${stats.lowest ? `${stats.lowest.average.toFixed(2)} (${stats.lowest.student.last_name} ${stats.lowest.student.first_name})` : "—"}`,
    `Matière la plus forte : ${stats.bestSubject ? `${stats.bestSubject.subject.name} (${stats.bestSubject.avg.toFixed(2)})` : "—"}`,
    `Matière la plus faible : ${stats.worstSubject ? `${stats.worstSubject.subject.name} (${stats.worstSubject.avg.toFixed(2)})` : "—"}`,
    `Élèves excellents (≥15/20) : ${stats.excellent.length}`,
  ];
  ctx.font = "22px sans-serif";
  let y = 260;
  for (const line of lines) {
    ctx.fillText(line, 60, y);
    y += 44;
  }

  return canvas;
}
