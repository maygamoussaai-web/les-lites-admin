import { useEffect, useMemo, useState } from "react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StudentsDialog } from "@/components/school/students-dialog";
import { ReportTemplateManager } from "@/components/school/report-template-manager";
import { NoteEntryDialog } from "@/components/school/note-entry-dialog";
import { ClassActionsMenu } from "@/components/school/class-actions-menu";
import { BulletinWalkthroughDialog, AnnualBulletinDialog } from "@/components/school/bulletin-helpers";
import { supabase } from "@/integrations/supabase/client";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData } from "@/lib/school-data";
import { writeAudit, useRows } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { canvasToPdfBlob, downloadBlob } from "@/lib/pdf-export";
import {
  PASS_THRESHOLD,
  EXCELLENT_THRESHOLD,
  type ClassSubject,
  type GradePeriod,
  type Grade,
  type ClassReport,
} from "@/lib/grades";
import { computeClassModelAverages } from "@/lib/model-averages";
import type { TemplateMapping } from "@/lib/xlsx-template";

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

  const [templateBuffer, setTemplateBuffer] = useState<ArrayBuffer | null>(null);
  const [templateMapping, setTemplateMapping] = useState<TemplateMapping | null>(null);
  const [templateScale, setTemplateScale] = useState(20);
  const [templateReady, setTemplateReady] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [stats, setStats] = useState<ClassStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const periodsQuery = useSupabaseRows<GradePeriod>("grade_periods", { class_id: classId }, "period_number");
  const subjectsQuery = useSupabaseRows<ClassSubject>("class_subjects", { class_id: classId }, "name");
  const currentPeriod = periodsQuery.data.find((p) => p.ended_at === null) ?? null;
  const latestPeriod =
    currentPeriod ?? [...periodsQuery.data].sort((a, b) => b.period_number - a.period_number)[0] ?? null;
  const gradesQuery = useSupabaseRows<Grade>("grades", latestPeriod ? { period_id: latestPeriod.id } : null, "created_at");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTemplateReady(false);
      setTemplateError(null);
      setTemplateBuffer(null);
      setTemplateMapping(null);
      try {
        const { data: tpl, error: tplError } = await supabase
          .from("report_templates")
          .select("file_path, mapping, scale, is_active")
          .eq("class_id", classId)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (tplError) throw tplError;
        if (!tpl?.file_path || !tpl.mapping) {
          if (!cancelled) {
            setTemplateError("Aucun modele Excel actif — les moyennes ne peuvent pas etre calculees.");
            setTemplateReady(true);
          }
          return;
        }
        const { data: file, error } = await supabase.storage.from("report-templates").download(tpl.file_path);
        if (error || !file) throw error ?? new Error("Telechargement du modele impossible");
        const buffer = await file.arrayBuffer();
        if (cancelled) return;
        setTemplateBuffer(buffer);
        setTemplateMapping(tpl.mapping as unknown as TemplateMapping);
        setTemplateScale(Number(tpl.scale) || 20);
        setTemplateReady(true);
      } catch (e) {
        if (!cancelled) {
          setTemplateError((e as Error).message || "Modele indisponible");
          setTemplateReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classId]);

  const startNewPeriod = async () => {
    if (!klass) return;
    try {
      if (currentPeriod) {
        const { error } = await supabase
          .from("grade_periods")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", currentPeriod.id);
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

  useEffect(() => {
    if (!latestPeriod || !templateReady) {
      setStats(null);
      return;
    }
    if (!templateBuffer || !templateMapping) {
      setStats({
        withAvg: [],
        passing: [],
        excellent: [],
        struggling: [],
        classAverage: null,
        highest: null,
        lowest: null,
        bestSubject: null,
        worstSubject: null,
      });
      return;
    }
    let cancelled = false;
    setStatsLoading(true);
    const handle = window.setTimeout(() => {
      try {
        const { perStudent, warnings } = computeClassModelAverages({
          templateBuffer,
          mapping: templateMapping,
          scale: templateScale,
          establishmentName: establishment?.name ?? "",
          className: klass?.name ?? "",
          periodNumber: latestPeriod.period_number,
          subjects: subjectsQuery.data,
          grades: gradesQuery.data,
          students: classStudents,
        });
        if (warnings.length) console.warn("Formules modele", warnings);
        if (cancelled) return;
        const withAvg: AveragedStudent[] = [];
        for (const s of classStudents) {
          const model = perStudent.get(s.id);
          if (!model || model.generalAverage === null) continue;
          const weakSubjects = Object.entries(model.subjectAverages)
            .filter(([, avg]) => avg !== null && avg < PASS_THRESHOLD)
            .map(([name]) => name);
          withAvg.push({ student: s, average: model.generalAverage, weakSubjects });
        }
        const passing = withAvg.filter((r) => r.average >= PASS_THRESHOLD);
        const excellent = withAvg.filter((r) => r.average >= EXCELLENT_THRESHOLD);
        const struggling = withAvg.filter((r) => r.average < PASS_THRESHOLD);
        const classAverage = withAvg.length ? withAvg.reduce((a, r) => a + r.average, 0) / withAvg.length : null;
        const highest = withAvg.length ? withAvg.reduce((a, b) => (b.average > a.average ? b : a)) : null;
        const lowest = withAvg.length ? withAvg.reduce((a, b) => (b.average < a.average ? b : a)) : null;
        const subjectAgg = new Map<string, number[]>();
        for (const s of classStudents) {
          const model = perStudent.get(s.id);
          if (!model) continue;
          for (const [name, avg] of Object.entries(model.subjectAverages)) {
            if (avg === null) continue;
            const list = subjectAgg.get(name) ?? [];
            list.push(avg);
            subjectAgg.set(name, list);
          }
        }
        const subjectAverages = subjectsQuery.data
          .map((sub) => {
            const list = subjectAgg.get(sub.name) ?? [];
            return { subject: sub, avg: list.length ? list.reduce((a, b) => a + b, 0) / list.length : null };
          })
          .filter((x): x is { subject: ClassSubject; avg: number } => x.avg !== null);
        const bestSubject = subjectAverages.length ? subjectAverages.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
        const worstSubject = subjectAverages.length ? subjectAverages.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;
        setStats({ withAvg, passing, excellent, struggling, classAverage, highest, lowest, bestSubject, worstSubject });
      } catch (e) {
        console.error(e);
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [
    latestPeriod,
    templateReady,
    templateBuffer,
    templateMapping,
    templateScale,
    gradesQuery.data,
    classStudents,
    subjectsQuery.data,
    establishment?.name,
    klass?.name,
  ]);

  if (!data.loading && !establishmentIdsLoading && (!klass || !allowed)) {
    return (
      <EmptyState icon={AlertTriangle} title="Accès refusé" description="Cette classe n'existe pas ou vous n'y avez pas accès." />
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

      <ReportTemplateManager classId={classId} establishmentId={klass.establishment_id} className={klass.name} />

      {templateError && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {templateError}
        </div>
      )}
      {templateBuffer && templateMapping && (
        <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          Moyennes via formules du modele Excel.
        </div>
      )}
      {statsLoading && (
        <p className="text-xs text-muted-foreground">Calcul des moyennes…</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Moyenne de la classe" value={stats?.classAverage != null ? stats.classAverage.toFixed(2) : "—"} icon={Users} />
        <StatCard
          label="Ont la moyenne"
          value={stats ? `${stats.passing.length} / ${stats.withAvg.length}` : "—"}
          icon={GraduationCap}
          tone="accent"
          delay={60}
        />
        <StatCard label="Plus haute" value={stats?.highest ? stats.highest.average.toFixed(2) : "—"} icon={Trophy} tone="success" delay={120} />
        <StatCard label="Plus basse" value={stats?.lowest ? stats.lowest.average.toFixed(2) : "—"} icon={TrendingDown} tone="destructive" delay={180} />
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
              <span className="font-semibold">{Math.round((stats.passing.length / stats.withAvg.length) * 100)}%</span>
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
              <p className="mt-1 font-display text-lg font-semibold">{stats.bestSubject.subject.name}</p>
              <p className="text-sm text-muted-foreground">{stats.bestSubject.avg.toFixed(2)} / 20</p>
            </div>
          )}
          {stats.worstSubject && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Matière la plus faible</p>
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
          disabled={!latestPeriod || classStudents.length === 0}
        >
          <FileText className="mr-1.5 h-4 w-4" /> Créer les bulletins
        </Button>
        <Button
          variant="outline"
          className="press"
          onClick={() => setAnnualOpen(true)}
          disabled={periodsQuery.data.length === 0 || classStudents.length === 0}
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

      {annualOpen && (
        <AnnualBulletinDialog
          open={annualOpen}
          onClose={() => setAnnualOpen(false)}
          klass={klass}
          establishmentName={establishment?.name ?? "—"}
          students={classStudents}
          subjects={subjectsQuery.data}
          periods={periodsQuery.data}
          grades={gradesQuery.data}
        />
      )}

      <AlertDialog open={renewOpen} onOpenChange={setRenewOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Démarrer une nouvelle période ?</AlertDialogTitle>
            <AlertDialogDescription>
              {currentPeriod
                ? `La période ${currentPeriod.period_number} sera clôturée.`
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

function StudentGroupCard({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: AveragedStudent[];
  tone: "destructive" | "success";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {title} ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun élève.</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.student.id} className="flex items-center justify-between text-sm">
                <span>
                  {r.student.last_name} {r.student.first_name}
                </span>
                <Badge
                  variant={tone === "destructive" ? "destructive" : "default"}
                  className={tone === "success" ? "bg-success text-success-foreground" : ""}
                >
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
      const { error: uploadError } = await supabase.storage
        .from("class-reports")
        .upload(path, blob, { contentType: "application/pdf" });
      if (uploadError) throw uploadError;
      const { error } = await supabase.from("class_reports").insert({
        class_id: classId,
        establishment_id: establishmentId,
        period_id: period.id,
        file_path: path,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["class_reports"] });
      toast.success("Rapport généré");
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
    downloadBlob(await res.blob(), `Rapport-${className}.pdf`);
  };

  const remove = async (report: ClassReport) => {
    await supabase.storage.from("class-reports").remove([report.file_path]);
    await supabase.from("class_reports").delete().eq("id", report.id);
    qc.invalidateQueries({ queryKey: ["class_reports"] });
    toast.success("Rapport supprimé");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Rapports de classe</CardTitle>
        <Button size="sm" className="press" onClick={generate} disabled={generating || !period || !stats}>
          {generating ? "…" : "Générer"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {activeReports.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun rapport actif.</p>
        ) : (
          <ul className="space-y-2">
            {activeReports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDateTime(r.generated_at)}
                </span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => view(r)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => download(r)}>
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(r)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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
  canvas.height = 1754;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#12266B";
  ctx.font = "bold 34px sans-serif";
  ctx.fillText(establishmentName, 60, 80);
  ctx.font = "bold 40px sans-serif";
  ctx.fillText(`Rapport — ${className}`, 60, 140);
  ctx.fillStyle = "#374151";
  ctx.font = "22px sans-serif";
  ctx.fillText(`Période ${period.period_number}`, 60, 190);
  let y = 260;
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(`Moyenne : ${stats.classAverage != null ? stats.classAverage.toFixed(2) : "—"}`, 60, y);
  y += 40;
  ctx.fillText(`Réussite : ${stats.passing.length}/${stats.withAvg.length}`, 60, y);
  return canvas;
}
