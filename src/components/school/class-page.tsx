/**
 * Page classe — stats via formules modèle Excel + design modernisé.
 * Priorité : bulletins validés. Repli : évaluation live des formules du modèle.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Trophy, TrendingDown, Users, GraduationCap, AlertTriangle,
  Plus, RotateCcw, FileBarChart, FileText, Download,
} from "lucide-react";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { PageLoading } from "@/components/app/page-loading";
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
import { PeriodComparisonChart } from "@/components/school/period-comparison-chart";
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
import { downloadPeriodBulletinsZip } from "@/lib/bulletin-zip";

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
  source: "bulletin" | "modele_live" | "empty";
}

const EMPTY_STATS: ClassStats = {
  withAvg: [],
  passing: [],
  excellent: [],
  struggling: [],
  classAverage: null,
  highest: null,
  lowest: null,
  bestSubject: null,
  worstSubject: null,
  source: "empty",
};

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
  const klass =
    data.classes.find((c) => c.id === classId) ??
    data.archivedClasses.find((c) => c.id === classId);
  const isClassArchived = !!(klass && klass.is_active === false);
  const allowed = klass && (isDG || (establishmentIds ?? []).includes(klass.establishment_id));
  const establishment = klass ? data.establishments.find((e) => e.id === klass.establishment_id) : null;
  const classStudents = useMemo(() => {
    const active = (Array.isArray(data.students) ? data.students : []).filter(
      (s) => s.class_id === classId,
    );
    if (active.length || !isClassArchived) {
      return active.sort((a, b) =>
        `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`),
      );
    }
    const ids = new Set(
      (data.enrollments ?? []).filter((e) => e.class_id === classId).map((e) => e.student_id),
    );
    const list: typeof active = [];
    for (const id of ids) {
      const s = data.studentsById?.get(id) ?? data.archivedStudents?.find((x) => x.id === id);
      if (s) list.push(s as (typeof active)[number]);
    }
    return list.sort((a, b) =>
      `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`),
    );
  }, [data.students, data.enrollments, data.studentsById, data.archivedStudents, classId, isClassArchived]);

  const [studentsOpen, setStudentsOpen] = useState(false);
  const [noteEntryOpen, setNoteEntryOpen] = useState(false);
  const [bulletinsOpen, setBulletinsOpen] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [annualOpen, setAnnualOpen] = useState(false);
  const [pendingForcePeriod, setPendingForcePeriod] = useState(false);
  const [stats, setStats] = useState<ClassStats>(EMPTY_STATS);

  const periodsQuery = useSupabaseRows<GradePeriod>("grade_periods", { class_id: classId }, "period_number");
  const subjectsQuery = useSupabaseRows<ClassSubject>("class_subjects", { class_id: classId }, "name");
  const { template: activeTemplate } = useActiveReportTemplate(classId);
  const currentPeriod = periodsQuery.data.find((p) => p.ended_at === null) ?? null;
  const latestPeriod =
    currentPeriod ??
    [...(Array.isArray(periodsQuery.data) ? periodsQuery.data : [])].sort(
      (a, b) => b.period_number - a.period_number,
    )[0] ??
    null;
  // Filtrer par période + limite haute : sinon le plafond Supabase (~1000) coupe les notes des périodes récentes
  const gradesPeriodQuery = useRows<Grade>("grades", {
    eq: latestPeriod ? { class_id: classId, period_id: latestPeriod.id } : {},
    enabled: !!latestPeriod,
    order: { column: "created_at" },
    limit: 5000,
  });
  const gradesForPeriod = gradesPeriodQuery.data ?? [];
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
    if (!klass || isClassArchived) return;
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
    } catch (e) {
      toast.error(describeError(e, "Impossible de démarrer la période"));
    }
  };

  useEffect(() => {
    let cancelled = false;
    const fromCards = (): ClassStats | null => {
      if (!latestPeriod || !periodCards?.length) return null;
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
      for (const sub of subjectsQuery.data ?? []) {
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
    if (!latestPeriod || !gradesForPeriod?.length || !classStudents?.length) {
      setStats(EMPTY_STATS);
      return;
    }
    (async () => {
      try {
        const downloaded = await downloadActiveTemplateBuffer(classId);
        if (cancelled) return;
        if (!downloaded) {
          const byStudent = new Map<string, number[]>();
          for (const g of gradesForPeriod) {
            if (g.value == null || !Number.isFinite(Number(g.value))) continue;
            const scale = Number(g.scale) || 20;
            const n = (Number(g.value) / scale) * 20;
            (byStudent.get(g.student_id) ?? byStudent.set(g.student_id, []).get(g.student_id)!).push(n);
          }
          const withAvg: AveragedStudent[] = [];
          for (const s of classStudents) {
            const vals = byStudent.get(s.id);
            if (!vals?.length) continue;
            withAvg.push({ student: s, average: vals.reduce((a, b) => a + b, 0) / vals.length, weakSubjects: [] });
          }
          if (!withAvg.length) { setStats(EMPTY_STATS); return; }
          withAvg.sort((a, b) => b.average - a.average);
          setStats({
            withAvg,
            passing: withAvg.filter((r) => r.average >= PASS_THRESHOLD),
            excellent: withAvg.filter((r) => r.average >= EXCELLENT_THRESHOLD),
            struggling: withAvg.filter((r) => r.average < PASS_THRESHOLD),
            classAverage: withAvg.reduce((a, r) => a + r.average, 0) / withAvg.length,
            highest: withAvg[0] ?? null,
            lowest: withAvg[withAvg.length - 1] ?? null,
            bestSubject: null,
            worstSubject: null,
            source: "modele_live",
          });
          return;
        }
        const live = computeLiveClassStats({
          students: classStudents,
          subjects: subjectsQuery.data ?? [],
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
          setStats(EMPTY_STATS);
          return;
        }
        setStats({
          withAvg: live.withAvg ?? [],
          passing: live.passing ?? [],
          excellent: live.excellent ?? [],
          struggling: live.struggling ?? [],
          classAverage: live.classAverage,
          highest: live.highest,
          lowest: live.lowest,
          bestSubject: live.bestSubject,
          worstSubject: live.worstSubject,
          source: "modele_live",
        });
      } catch {
        if (!cancelled) setStats(EMPTY_STATS);
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
  if (!klass) {
    if (data.loading || establishmentIdsLoading) return <PageLoading />;
    return null;
  }

  const periodLabel = currentPeriod
    ? `Période ${currentPeriod.period_number}`
    : latestPeriod
      ? `Période ${latestPeriod.period_number} (clôturée)`
      : "—";

  const studentsWithNotes = new Set(gradesForPeriod.map((g) => g.student_id));
  const withBulletins = new Set(
    periodCards.filter((c) => !!c.document_id).map((c) => c.student_id),
  );
  let bulletinsDone = 0;
  let bulletinsMissing = 0;
  for (const id of studentsWithNotes) {
    if (withBulletins.has(id)) bulletinsDone++;
    else bulletinsMissing++;
  }
  const notesWithoutPeriod = !currentPeriod && !latestPeriod;

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link to={isClassArchived ? "/archives" : "/etablissements/$id"} params={isClassArchived ? {} as never : { id: klass.establishment_id }}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> {isClassArchived ? "Retour aux archives" : "Retour à l'établissement"}
        </Link>
      </Button>

      {isClassArchived && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-muted/40 px-3 py-2.5 text-sm"
        >
          <p className="text-muted-foreground">
            <strong className="text-foreground">Classe archivée</strong>
            {" "}\u2014 consultation des notes, bulletins et stats conservés. Les actions de saisie sont désactivées.
          </p>
          <Button variant="outline" size="sm" className="press shrink-0" asChild>
            <Link to="/archives">Voir les archives</Link>
          </Button>
        </div>
      )}

      {!currentPeriod && latestPeriod && !isClassArchived && (
        <div className="mb-4 rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Période {latestPeriod.period_number} clôturée. La prochaine période s'ouvrira automatiquement
          à la <strong className="text-foreground">première note</strong> enregistrée.
        </div>
      )}

      {currentPeriod && bulletinsMissing > 0 && !isClassArchived && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm"
        >
          <p className="text-amber-900 dark:text-amber-100">
            <strong>{bulletinsMissing}</strong> élève(s) ont des notes sans bulletin pour la période{" "}
            {currentPeriod.period_number}
            {bulletinsDone > 0 ? ` \u00b7 ${bulletinsDone} déjà généré(s)` : ""}.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="press shrink-0 border-amber-600/40"
            onClick={() => setBulletinsOpen(true)}
          >
            Compléter les bulletins
          </Button>
        </div>
      )}

      {notesWithoutPeriod && !isClassArchived && (
        <div
          role="status"
          className="mb-3 rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground"
        >
          Aucune période active. La première note ouvrira automatiquement une période.
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card to-primary/[0.04] shadow-sm">
        <div className="border-b border-border/60 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {establishment?.name ?? "Classe"}{isClassArchived ? " \u00b7 Archivée" : ""}
              </p>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {klass.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                {currentPeriod
                  ? `Période ${currentPeriod.period_number} en cours \u00b7 démarrée le ${formatDateTime(currentPeriod.started_at)}`
                  : latestPeriod
                    ? `Dernière période : ${latestPeriod.period_number} (clôturée)`
                    : "Aucune période en cours"}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="outline" size="sm" className="press" onClick={() => setStudentsOpen(true)}>
                <Users className="mr-1.5 h-4 w-4" /> Élèves
              </Button>
              {!isClassArchived && (
                <Button size="sm" className="press" onClick={() => setNoteEntryOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Note
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="press"
                onClick={() => {
                  if (!(currentPeriod ?? latestPeriod)) {
                    toast.message("Saisissez une note pour ouvrir une période, ou démarrez-en une.");
                    return;
                  }
                  setBulletinsOpen(true);
                }}
              >
                <FileBarChart className="mr-1.5 h-4 w-4" /> Bulletins
                {studentsWithNotes.size > 0 && (
                  <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
                    {bulletinsDone}/{studentsWithNotes.size}
                  </span>
                )}
              </Button>
              {bulletinsDone > 0 && (currentPeriod ?? latestPeriod) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="press"
                  disabled={zipBusy}
                  onClick={() => {
                    const per = currentPeriod ?? latestPeriod;
                    if (!per) return;
                    void (async () => {
                      setZipBusy(true);
                      const toastId = toast.loading("Préparation du ZIP des bulletins\u2026");
                      try {
                        const n = await downloadPeriodBulletinsZip({
                          classId,
                          periodId: per.id,
                          periodNumber: per.period_number,
                          className: klass.name,
                          students: classStudents.map((s) => ({
                            id: s.id,
                            first_name: s.first_name,
                            last_name: s.last_name,
                          })),
                          onProgress: (done, total) => {
                            toast.loading(`ZIP ${done}/${total}\u2026`, { id: toastId });
                          },
                        });
                        toast.success(`${n} bulletin(s) dans le ZIP`, { id: toastId });
                      } catch (e) {
                        toast.error(describeError(e, "ZIP impossible"), { id: toastId });
                      } finally {
                        setZipBusy(false);
                      }
                    })();
                  }}
                >
                  <Download className="mr-1.5 h-4 w-4" />
                  {zipBusy ? "ZIP\u2026" : "ZIP bulletins"}
                </Button>
              )}
              <Button variant="outline" size="sm" className="press" onClick={() => setAnnualOpen(true)}>
                <FileText className="mr-1.5 h-4 w-4" /> Annuel
              </Button>
              {!isClassArchived && (
                <Button variant="outline" size="sm" className="press" onClick={() => void startNewPeriod()}>
                  <RotateCcw className="mr-1.5 h-4 w-4" /> Nouvelle période
                </Button>
              )}
              {!isClassArchived && <ClassActionsMenu klass={klass} data={data} />}
            </div>
          </div>
        </div>
        <div className="grid gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Moyenne de classe"
            value={stats.classAverage != null ? stats.classAverage.toFixed(2) : "\u2014"}
            hint={
              stats.source === "bulletin"
                ? "Bulletins validés"
                : stats.source === "modele_live"
                  ? "Formules du modèle (live)"
                  : periodLabel
            }
            icon={GraduationCap}
          />
          <StatCard
            label="Admis / excellent"
            value={`${stats.passing.length} / ${stats.excellent.length}`}
            hint={`sur ${stats.withAvg.length} élève(s) noté(s)`}
            icon={Trophy}
          />
          <StatCard
            label="En difficulté"
            value={String(stats.struggling.length)}
            hint={
              stats.lowest
                ? `Plus bas : ${stats.lowest.average.toFixed(2)}`
                : stats.withAvg.length
                  ? "Aucun"
                  : "En attente de notes"
            }
            icon={TrendingDown}
          />
          <StatCard
            label="Effectif"
            value={String(classStudents?.length ?? 0)}
            hint={
              stats.highest
                ? `1er : ${stats.highest.student.last_name} (${stats.highest.average.toFixed(2)})`
                : periodLabel
            }
            icon={Users}
          />
        </div>
      </div>

      <div className="mb-6 mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Répartition</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span>Réussite (≥ {PASS_THRESHOLD})</span>
                <span>
                  {stats.withAvg.length
                    ? Math.round((stats.passing.length / stats.withAvg.length) * 100)
                    : 0}
                  %
                </span>
              </div>
              <Progress
                value={
                  stats.withAvg.length
                    ? (stats.passing.length / stats.withAvg.length) * 100
                    : 0
                }
              />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span>Excellence (≥ {EXCELLENT_THRESHOLD})</span>
                <span>
                  {stats.withAvg.length
                    ? Math.round((stats.excellent.length / stats.withAvg.length) * 100)
                    : 0}
                  %
                </span>
              </div>
              <Progress
                value={
                  stats.withAvg.length
                    ? (stats.excellent.length / stats.withAvg.length) * 100
                    : 0
                }
              />
            </div>
            {stats.bestSubject ? (
              <p className="text-sm text-muted-foreground">
                Meilleure matière : <strong>{stats.bestSubject.subject.name}</strong>{" "}
                ({stats.bestSubject.avg.toFixed(2)})
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Meilleure matière : \u2014</p>
            )}
            {stats.worstSubject ? (
              <p className="text-sm text-muted-foreground">
                Matière à renforcer : <strong>{stats.worstSubject.subject.name}</strong>{" "}
                ({stats.worstSubject.avg.toFixed(2)})
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Matière à renforcer : \u2014</p>
            )}
            {!stats.withAvg.length && (
              <p className="text-xs text-muted-foreground">
                Saisissez des notes ou générez les bulletins pour afficher les stats.
              </p>
            )}
          </CardContent>
        </Card>
        <StudentGroupCard
          title="Classement"
          emptyLabel="Aucun classement pour le moment"
          students={
            stats.withAvg.length
              ? stats.withAvg.map((r, i) => ({
                  id: r.student.id,
                  name: `${r.student.last_name} ${r.student.first_name}`,
                  value: r.average.toFixed(2),
                  rank: i + 1,
                }))
              : []
          }
        />
      </div>

      {!isClassArchived && (
        <ReportTemplateManager
          classId={classId}
          establishmentId={klass.establishment_id}
          className={klass.name}
        />
      )}

      <PeriodComparisonChart classId={classId} title="Comparaison des périodes" subtitle="La classe a-t-elle progressé, stagné ou régressé ?" />

      <ClassReportsSection classId={classId} />

      {!isClassArchived && (
        <NoteEntryDialog
          open={noteEntryOpen}
          onClose={() => setNoteEntryOpen(false)}
          classId={classId}
          establishmentId={klass.establishment_id}
          students={classStudents}
          subjects={subjectsQuery.data ?? []}
          currentPeriod={currentPeriod}
          subjectLabels={activeTemplate?.subjectLabels}
          allowedNatures={activeTemplate?.gradeNatures}
          natureLabels={activeTemplate?.natureLabels}
          existingGrades={gradesForPeriod}
        />
      )}

      <StudentsDialog klass={studentsOpen ? klass : null} data={data} onClose={() => setStudentsOpen(false)} />

      <BulletinWalkthroughDialog
        open={bulletinsOpen}
        onClose={() => setBulletinsOpen(false)}
        klass={klass}
        establishmentName={establishment?.name ?? ""}
        students={classStudents}
        period={currentPeriod ?? latestPeriod}
        subjects={subjectsQuery.data ?? []}
        grades={gradesForPeriod}
        alreadyGeneratedIds={periodCards
          .filter((c) => !!c.document_id)
          .map((c) => c.student_id)}
      />

      <AnnualBulletinDialog
        open={annualOpen}
        onClose={() => setAnnualOpen(false)}
        klass={klass}
        students={classStudents}
        periods={periodsQuery.data ?? []}
        subjects={subjectsQuery.data ?? []}
      />

      <AlertDialog open={pendingForcePeriod} onOpenChange={setPendingForcePeriod}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clôturer sans tous les bulletins ?</AlertDialogTitle>
            <AlertDialogDescription>
              Des élèves ont des notes sans bulletin généré. Vous pouvez générer les bulletins d'abord, ou forcer la nouvelle période.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => void startNewPeriod(true)}>Forcer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
