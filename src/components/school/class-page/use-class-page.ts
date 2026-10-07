/**
 * Données + logique métier de la page classe (sans UI).
 */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useActiveReportTemplate, downloadActiveTemplateBuffer } from "@/lib/report-template";
import { supabase } from "@/integrations/supabase/client";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData } from "@/lib/school-data";
import { writeAudit, useRows } from "@/lib/data";
import {
  PASS_THRESHOLD, EXCELLENT_THRESHOLD, periodLabel as formatPeriodLabel,
  type ClassSubject, type GradePeriod, type Grade, type StudentReportCard,
} from "@/lib/grades";
import { describeError } from "@/lib/errors";
import { computeLiveClassStats } from "@/lib/class-model-stats";
import { EMPTY_STATS, type AveragedStudent, type ClassStats } from "./types";

function useSupabaseRows<T extends { id: string }>(
  table: Parameters<typeof useRows>[0],
  eq: Record<string, string> | null,
  orderColumn: string,
) {
  const q = useRows<T>(table, { eq: eq ?? {}, enabled: !!eq, order: { column: orderColumn } });
  return { data: q.data ?? [], isLoading: q.isLoading };
}

export function useClassPage() {
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
            withAvg.push({
              student: s,
              average: vals.reduce((a, b) => a + b, 0) / vals.length,
              weakSubjects: [],
            });
          }
          if (!withAvg.length) {
            setStats(EMPTY_STATS);
            return;
          }
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

  const periodLabelText = currentPeriod
    ? formatPeriodLabel(currentPeriod)
    : latestPeriod
      ? formatPeriodLabel(latestPeriod, { closed: true })
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

  return {
    classId,
    data,
    klass,
    isClassArchived,
    allowed,
    establishment,
    classStudents,
    studentsOpen,
    setStudentsOpen,
    noteEntryOpen,
    setNoteEntryOpen,
    bulletinsOpen,
    setBulletinsOpen,
    annualOpen,
    setAnnualOpen,
    pendingForcePeriod,
    setPendingForcePeriod,
    stats,
    periodsQuery,
    subjectsQuery,
    activeTemplate,
    currentPeriod,
    latestPeriod,
    gradesForPeriod,
    periodCards,
    startNewPeriod,
    periodLabelText,
    studentsWithNotes,
    bulletinsDone,
    bulletinsMissing,
    notesWithoutPeriod: !currentPeriod && !latestPeriod,
    loading: data.loading || establishmentIdsLoading,
  };
}

export type ClassPageModel = ReturnType<typeof useClassPage>;
