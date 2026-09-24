/**
 * Page classe — stats via formules modèle Excel.
 * Priorité : bulletins validés (student_report_cards).
 * Repli : calcul live modèle (même source que la fiche élève) si notes présentes.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Trophy, TrendingDown, Users, GraduationCap, AlertTriangle,
  Plus, RotateCcw, FileBarChart, FileText,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StudentsDialog } from "@/components/school/students-dialog";
import { ReportTemplateManager } from "@/components/school/report-template-manager";
import { NoteEntryDialog } from "@/components/school/note-entry-dialog";
import { useActiveReportTemplate, downloadActiveTemplateBuffer } from "@/lib/report-template";
import { ClassActionsMenu } from "@/components/school/class-actions-menu";
import { BulletinWalkthroughDialog, AnnualBulletinDialog } from "@/components/school/bulletin-helpers";
import { StudentGroupCard, ClassReportsSection } from "@/components/school/class-results-helpers";
import { supabase } from "@/integrations/supabase/client";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData } from "@/lib/school-data";
import { writeAudit, useRows } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import {
  PASS_THRESHOLD, EXCELLENT_THRESHOLD,
  type ClassSubject, type GradePeriod, type Grade, type StudentReportCard,
} from "@/lib/grades";
import { describeError } from "@/lib/errors";
import { computeLiveClassStats } from "@/lib/class-model-stats";

type AveragedStudent = {
  student: { id: string; first_name: string; last_name: string };
  average: number;
  weakSubjects: string[];
};

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
  source: "bulletin" | "modele_live";
}

function useSupabaseRows<T extends { id: string }>(
  table: Parameters<typeof useRows>[0],
  eq: Record<string, string> | null,
  orderColumn: string,
) {
  const q = useRows<T>(table, { eq: eq ?? {}, enabled: !!eq, order: { column: orderColumn } });
  return { data: q.data ?? [], isLoading: q.isLoading };
}

export function ClassPage() {
  const { classId } = useParams({ from: "/_authenticated/classes/$classId" });
  const { isDG, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const data = useSchoolData();
  const qc = useQueryClient();
  const klass = data.classes.find((c) => c.id === classId);
  const allowed = klass && (isDG || establishmentIds.includes(klass.establishment_id));
  const establishment = klass ? data.establishments.find((e) => e.id === klass.establishment_id) : null;
  const classStudents = useMemo(
    () =>
      data.students
        .filter((s) => s.class_id === classId)
        .sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)),
    [data.students, classId],
  );

  const [studentsOpen, setStudentsOpen] = useState(false);
  const [noteEntryOpen, setNoteEntryOpen] = useState(false);
  const [bulletinsOpen, setBulletinsOpen] = useState(false);
  const [annualOpen, setAnnualOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [pendingForcePeriod, setPendingForcePeriod] = useState(false);
  const [stats, setStats] = useState<ClassStats | null>(null);

  const periodsQuery = useSupabaseRows<GradePeriod>("grade_periods", { class_id: classId }, "period_number");
  const subjectsQuery = useSupabaseRows<ClassSubject>("class_subjects", { class_id: classId }, "name");
  const { template: activeTemplate } = useActiveReportTemplate(classId);
  const currentPeriod = periodsQuery.data.find((p) => p.ended_at === null) ?? null;
  const latestPeriod =
    currentPeriod ??
    [...periodsQuery.data].sort((a, b) => b.period_number - a.period_number)[0] ??
    null;
  const gradesAllQuery = useSupabaseRows<Grade>("grades", { class_id: classId }, "created_at");
  const gradesForPeriod = useMemo(
    () => (!latestPeriod ? [] : gradesAllQuery.data.filter((g) => g.period_id === latestPeriod.id)),
    [gradesAllQuery.data, latestPeriod],
  );
  const cardsQuery = useSupabaseRows<StudentReportCard>(
    "student_report_cards",
    latestPeriod ? { class_id: classId } : null,
    "created_at",
  );
  const periodCards = useMemo(
    () => (latestPeriod ? cardsQuery.data.filter((c) => c.period_id === latestPeriod.id) : []),
    [cardsQuery.data, latestPeriod],
  );

  const startNewPeriod = async (force = false) => {
    if (!klass) return;
    try {
      if (currentPeriod && !force) {
        const studentIdsWithNotes = new Set(gradesForPeriod.map((g) => g.student_id));
        const withBulletins = new Set(
          periodCards.filter((c) => c.document_id).map((c) => c.student_id),
        );
        let missing = 0;
        for (const id of studentIdsWithNotes) {
          if (!withBulletins.has(id)) missing++;
        }
        if (missing > 0) {
          toast.message(
            `${missing} élève(s) ont des notes sans bulletin. Générez les bulletins, ou confirmez pour clôturer sans bulletins.`,
          );
          setPendingForcePeriod(true);
          return;
        }
      }
      if (currentPeriod) {
        const { error } = await supabase
          .from("grade_periods")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", currentPeriod.id);
        if (error) throw error;
      }
      const nextNumber =
        (periodsQuery.data.reduce((max, p) => Math.max(max, p.period_number), 0) || 0) + 1;
      const { error } = await supabase.from("grade_periods").insert({
        class_id: classId,
        establishment_id: klass.establishment_id,
        period_number: nextNumber,
      });
      if (error) throw error;
      await writeAudit("create", "grade_periods" as never, null, {
        class_id: classId,
        period_number: nextNumber,
      });
      qc.invalidateQueries({ queryKey: ["grade_periods"] });
      qc.invalidateQueries({ queryKey: ["student_report_cards"] });
      toast.success(`Période ${nextNumber} démarrée`);
      setPendingForcePeriod(false);
      setRenewOpen(false);
    } catch (e) {
      toast.error(describeError(e, "Impossible de démarrer la période"));
    }
  };

  useEffect(() => {
    let cancelled = false;

    const fromCards = (): ClassStats | null => {
      if (!latestPeriod || periodCards.length === 0) return null;
      const withAvg: AveragedStudent[] = [];
      for (const s of classStudents) {
        const card = periodCards.find((c) => c.student_id === s.id);
        if (!card || card.general_average === null || card.general_average === undefined) continue;
        const avg = Number(card.general_average);
        if (!Number.isFinite(avg)) continue;
        const sa = (card.subject_averages as Record<string, number | null> | null) ?? {};
        const weak = Object.entries(sa)
          .filter(([, v]) => v !== null && (v as number) < PASS_THRESHOLD)
          .map(([name]) => name);
        withAvg.push({ student: s, average: avg, weakSubjects: weak });
      }
      if (!withAvg.length) return null;
      withAvg.sort((a, b) => b.average - a.average);

      const ranked: { subject: ClassSubject; avg: number }[] = [];
      for (const sub of subjectsQuery.data) {
        const vals: number[] = [];
        for (const c of periodCards) {
          const sa = (c.subject_averages as Record<string, number | null> | null) ?? {};
          const v = sa[sub.name];
          if (v !== null && v !== undefined && Number.isFinite(Number(v))) vals.push(Number(v));
        }
        if (vals.length) ranked.push({ subject: sub, avg: vals.reduce((a, b) => a + b, 0) / vals.length });
      }
      ranked.sort((a, b) => b.avg - a.avg);

      return {
        withAvg,
        passing: withAvg.filter((r) => r.average >= PASS_THRESHOLD),
        excellent: withAvg.filter((r) => r.average >= EXCELLENT_THRESHOLD),
        struggling: withAvg.filter((r) => r.average < PASS_THRESHOLD),
        classAverage: withAvg.reduce((a, r) => a + r.average, 0) / withAvg.length,
        highest: withAvg[0] ?? null,
        lowest: withAvg[withAvg.length - 1] ?? null,
        bestSubject: ranked[0] ?? null,
        worstSubject: ranked[ranked.length - 1] ?? null,
        source: "bulletin",
      };
    };

    const bulletinStats = fromCards();
    if (bulletinStats) {
      setStats(bulletinStats);
      return;
    }

    if (!latestPeriod || gradesForPeriod.length === 0 || !classStudents.length) {
      setStats(null);
      return;
    }

    (async () => {
      try {
        const downloaded = await downloadActiveTemplateBuffer(classId);
        if (cancelled || !downloaded) {
          if (!cancelled) setStats(null);
          return;
        }
        const live = computeLiveClassStats({
          students: classStudents,
          subjects: subjectsQuery.data,
          grades: gradesForPeriod,
          periodNumber: latestPeriod.period_number,
          templateBuffer: downloaded.buffer,
          mapping: downloaded.mapping,
          scale: downloaded.scale,
          establishmentName: establishment?.name ?? "",
          className: klass?.name ?? "",
        });
        if (cancelled) return;
        if (!live) {
          setStats(null);
          return;
        }
        setStats({
          withAvg: live.withAvg,
          passing: live.passing,
          excellent: live.excellent,
          struggling: live.struggling,
          classAverage: live.classAverage,
          highest: live.highest,
          lowest: live.lowest,
          bestSubject: live.bestSubject,
          worstSubject: live.worstSubject,
          source: "modele_live",
        });
      } catch {
        if (!cancelled) setStats(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    classId,
    classStudents,
    subjectsQuery.data,
    gradesForPeriod,
    periodCards,
    latestPeriod,
    establishment?.name,
    klass?.name,
  ]);

  if (!data.loading && !establishmentIdsLoading && (!klass || !allowed)) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Accès refusé"
        description="Cette classe n'existe pas ou vous n'y avez pas accès."
      />
    );
  }
  if (!klass) return null;

  const periodLabel = currentPeriod
    ? `Période ${currentPeriod.period_number}`
    : latestPeriod
      ? `Période ${latestPeriod.period_number} (clôturée)`
      : "—";

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
            : "Aucune période en cours."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="press" onClick={() => setStudentsOpen(true)}>
              <Users className="mr-1.5 h-4 w-4" /> Élèves
            </Button>
            <Button size="sm" className="press" onClick={() => setNoteEntryOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Note
            </Button>
            <Button variant="outline" size="sm" className="press" onClick={() => setBulletinsOpen(true)}>
              <FileBarChart className="mr-1.5 h-4 w-4" /> Bulletins
            </Button>
            <Button variant="outline" size="sm" className="press" onClick={() => setAnnualOpen(true)}>
              <FileText className="mr-1.5 h-4 w-4" /> Annuel
            </Button>
            <Button variant="outline" size="sm" className="press" onClick={() => void startNewPeriod()}>
              <RotateCcw className="mr-1.5 h-4 w-4" /> Nouvelle période
            </Button>
            <ClassActionsMenu klass={klass} data={data} />
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Moyenne de classe"
          value={stats?.classAverage != null ? stats.classAverage.toFixed(2) : "—"}
          description={stats?.source === "bulletin" ? "D'après les bulletins" : stats ? "Calcul modèle (live)" : periodLabel}
          icon={GraduationCap}
        />
        <StatCard
          title="Admis / excellent"
          value={stats ? `${stats.passing.length} / ${stats.excellent.length}` : "—"}
          description={stats ? `sur ${stats.withAvg.length} élève(s)` : "—"}
          icon={Trophy}
        />
        <StatCard
          title="En difficulté"
          value={stats ? String(stats.struggling.length) : "—"}
          description={stats?.lowest ? `Plus bas : ${stats.lowest.average.toFixed(2)}` : "—"}
          icon={TrendingDown}
        />
        <StatCard
          title="Effectif"
          value={String(classStudents.length)}
          description={periodLabel}
          icon={Users}
        />
      </div>

      {stats && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Répartition</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-sm">
                  <span>Réussite (≥ {PASS_THRESHOLD})</span>
                  <span>{stats.withAvg.length ? Math.round((stats.passing.length / stats.withAvg.length) * 100) : 0}%</span>
                </div>
                <Progress value={stats.withAvg.length ? (stats.passing.length / stats.withAvg.length) * 100 : 0} />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-sm">
                  <span>Excellence (≥ {EXCELLENT_THRESHOLD})</span>
                  <span>{stats.withAvg.length ? Math.round((stats.excellent.length / stats.withAvg.length) * 100) : 0}%</span>
                </div>
                <Progress value={stats.withAvg.length ? (stats.excellent.length / stats.withAvg.length) * 100 : 0} />
              </div>
              {stats.bestSubject && (
                <p className="text-sm text-muted-foreground">
                  Meilleure matière : <strong>{stats.bestSubject.subject.name}</strong> ({stats.bestSubject.avg.toFixed(2)})
                </p>
              )}
              {stats.worstSubject && (
                <p className="text-sm text-muted-foreground">
                  Plus faible : <strong>{stats.worstSubject.subject.name}</strong> ({stats.worstSubject.avg.toFixed(2)})
                </p>
              )}
            </CardContent>
          </Card>
          <StudentGroupCard
            title="Classement"
            students={stats.withAvg.slice(0, 10).map((r, i) => ({
              id: r.student.id,
              name: `${r.student.last_name} ${r.student.first_name}`,
              value: r.average.toFixed(2),
              rank: i + 1,
            }))}
          />
        </div>
      )}

      <ReportTemplateManager
        classId={classId}
        establishmentId={klass.establishment_id}
        className={klass.name}
      />

      <ClassReportsSection classId={classId} />

      <NoteEntryDialog
        open={noteEntryOpen}
        onClose={() => setNoteEntryOpen(false)}
        classId={classId}
        establishmentId={klass.establishment_id}
        students={classStudents}
        subjects={subjectsQuery.data}
        currentPeriod={currentPeriod}
        subjectLabels={activeTemplate?.subjectLabels}
        allowedNatures={activeTemplate?.gradeNatures}
        natureLabels={activeTemplate?.natureLabels}
        existingGrades={gradesForPeriod}
      />

      <StudentsDialog klass={studentsOpen ? klass : null} data={data} onClose={() => setStudentsOpen(false)} />

      <BulletinWalkthroughDialog
        open={bulletinsOpen}
        onClose={() => setBulletinsOpen(false)}
        klass={klass}
        students={classStudents}
        period={currentPeriod ?? latestPeriod}
        subjects={subjectsQuery.data}
        grades={gradesForPeriod}
      />

      <AnnualBulletinDialog
        open={annualOpen}
        onClose={() => setAnnualOpen(false)}
        klass={klass}
        students={classStudents}
        periods={periodsQuery.data}
        subjects={subjectsQuery.data}
      />

      <AlertDialog open={pendingForcePeriod} onOpenChange={setPendingForcePeriod}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clôturer sans tous les bulletins ?</AlertDialogTitle>
            <AlertDialogDescription>
              Des notes existent pour des élèves sans bulletin généré. Vous pouvez générer les bulletins d'abord, ou forcer la nouvelle période.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => void startNewPeriod(true)}>Forcer la nouvelle période</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
