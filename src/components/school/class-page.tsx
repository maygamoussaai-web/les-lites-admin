/**
 * Page classe — stats issues des bulletins validés (formules modèle Excel).
 * Aucune moyenne inventée dans l'app.
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
import { useActiveReportTemplate } from "@/lib/report-template";
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
    if (!latestPeriod || periodCards.length === 0) {
      setStats(null);
      return;
    }
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

    setStats({
      withAvg,
      passing: withAvg.filter((r) => r.average >= PASS_THRESHOLD),
      excellent: withAvg.filter((r) => r.average >= EXCELLENT_THRESHOLD),
      struggling: withAvg.filter((r) => r.average < PASS_THRESHOLD),
      classAverage: withAvg.length
        ? withAvg.reduce((a, r) => a + r.average, 0) / withAvg.length
        : null,
      highest: withAvg[0] ?? null,
      lowest: withAvg[withAvg.length - 1] ?? null,
      bestSubject: ranked[0] ?? null,
      worstSubject: ranked[ranked.length - 1] ?? null,
    });
  }, [latestPeriod, periodCards, classStudents, subjectsQuery.data]);

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
            <ClassActionsMenu klass={klass} data={data} />
          </div>
        }
      />
      <ReportTemplateManager
        classId={classId}
        establishmentId={klass.establishment_id}
        className={klass.name}
      />
      {!stats ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Générez les bulletins pour afficher les moyennes (formules du modèle Excel).
        </div>
      ) : (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Moyennes issues des bulletins générés (formules du modèle).
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Moyenne de la classe"
          value={stats?.classAverage != null ? stats.classAverage.toFixed(2) : "—"}
          icon={Users}
        />
        <StatCard
          label="Ont la moyenne"
          value={stats ? `${stats.passing.length} / ${stats.withAvg.length}` : "—"}
          icon={GraduationCap}
          tone="accent"
          delay={60}
        />
        <StatCard
          label="Plus haute"
          value={stats?.highest ? stats.highest.average.toFixed(2) : "—"}
          icon={Trophy}
          tone="success"
          delay={120}
        />
        <StatCard
          label="Plus basse"
          value={stats?.lowest ? stats.lowest.average.toFixed(2) : "—"}
          icon={TrendingDown}
          tone="destructive"
          delay={180}
        />
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
              <span className="font-semibold">
                {Math.round((stats.passing.length / stats.withAvg.length) * 100)}%
              </span>
            </div>
            <Progress value={(stats.passing.length / stats.withAvg.length) * 100} className="h-2.5" />
          </CardContent>
        </Card>
      )}
      {stats && (stats.bestSubject || stats.worstSubject) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {stats.bestSubject && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Matière la plus forte
              </p>
              <p className="mt-1 font-display text-lg font-semibold">{stats.bestSubject.subject.name}</p>
              <p className="text-sm text-muted-foreground">{stats.bestSubject.avg.toFixed(2)} / 20</p>
            </div>
          )}
          {stats.worstSubject && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Matière la plus faible
              </p>
              <p className="mt-1 font-display text-lg font-semibold">{stats.worstSubject.subject.name}</p>
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
        <Button
          variant="outline"
          className="press"
          onClick={() => setBulletinsOpen(true)}
          disabled={!latestPeriod || !classStudents.length}
        >
          <FileText className="mr-1.5 h-4 w-4" /> Créer les bulletins
        </Button>
        <Button
          variant="outline"
          className="press"
          onClick={() => setAnnualOpen(true)}
          disabled={!periodsQuery.data.length || !classStudents.length}
        >
          <FileBarChart className="mr-1.5 h-4 w-4" /> Bulletin annuel
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
        subjectLabels={activeTemplate?.subjectLabels}
        allowedNatures={activeTemplate?.gradeNatures}
        existingGrades={gradesForPeriod}
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
          grades={gradesForPeriod}
        />
      )}
      {annualOpen && (
        <AnnualBulletinDialog
          open={annualOpen}
          onClose={() => setAnnualOpen(false)}
          klass={klass}
          establishmentName={establishment?.name ?? "—"}
          students={classStudents}
          subjects={subjectsQuery.data}
          periods={periodsQuery.data}
          grades={gradesAllQuery.data}
        />
      )}
      <AlertDialog
        open={renewOpen}
        onOpenChange={(v) => {
          setRenewOpen(v);
          if (!v) setPendingForcePeriod(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Démarrer une nouvelle période ?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                La période en cours sera clôturée. Les notes restent dans l'historique.
              </span>
              {pendingForcePeriod && (
                <span className="block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  Des notes existent sans bulletin. Générez les bulletins d'abord, ou confirmez pour clôturer quand même.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => void startNewPeriod(pendingForcePeriod)}>
              {pendingForcePeriod ? "Clôturer sans bulletins" : "Confirmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
