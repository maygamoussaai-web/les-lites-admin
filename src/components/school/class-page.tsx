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

  // NOTE: rest of file continues - EMERGENCY: if truncated this is incomplete
  return null;
}
