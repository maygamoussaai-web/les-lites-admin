/**
 * Cartes résultats + section rapports de classe.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, Download, Eye, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useRows } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { canvasToPdfBlob, downloadBlob } from "@/lib/pdf-export";
import type { ClassReport, GradePeriod } from "@/lib/grades";
import { describeError } from "@/lib/errors";

type StudentRef = { id: string; first_name: string; last_name: string };
type AveragedStudent = { student: StudentRef; average: number; weakSubjects: string[] };

export interface ClassStatsLike {
  withAvg: AveragedStudent[];
  passing: AveragedStudent[];
  excellent: AveragedStudent[];
  struggling: AveragedStudent[];
  classAverage: number | null;
  highest: AveragedStudent | null;
  lowest: AveragedStudent | null;
}

export function StudentGroupCard({
  title,
  rows,
  students,
  tone = "success",
}: {
  title: string;
  /** Liste classée (fiche classe) */
  students?: { id: string; name: string; value: string; rank: number }[];
  /** Liste AveragedStudent (autres vues) */
  rows?: AveragedStudent[];
  tone?: "destructive" | "success";
}) {
  if (students && students.length > 0) {
    return (
      <Card className="animate-rise">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {students.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-6 shrink-0 tabular-nums text-muted-foreground">{s.rank}.</span>
                <Link
                  to="/eleves/$studentId"
                  params={{ studentId: s.id }}
                  className="min-w-0 truncate font-medium hover:underline"
                >
                  {s.name}
                </Link>
              </div>
              <Badge variant="default" className="tabular-nums shrink-0">
                {s.value}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!rows?.length) return null;
  return (
    <Card className="animate-rise">
      <CardHeader>
        <CardTitle className="font-display text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={r.student.id} className="flex items-center justify-between gap-2 text-sm">
            <Link
              to="/eleves/$studentId"
              params={{ studentId: r.student.id }}
              className="min-w-0 truncate font-medium hover:underline"
            >
              {r.student.last_name} {r.student.first_name}
            </Link>
            <Badge variant={tone === "destructive" ? "destructive" : "default"} className="tabular-nums shrink-0">
              {r.average.toFixed(2)}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function useSupabaseRows<T extends { id: string }>(
  table: Parameters<typeof useRows>[0],
  eq: Record<string, string> | null,
  orderColumn: string,
  ascending = true,
) {
  const q = useRows<T>(table, {
    eq: eq ?? {},
    enabled: !!eq,
    order: { column: orderColumn, ascending },
  });
  return { data: q.data ?? [], isLoading: q.isLoading };
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
  stats: ClassStatsLike;
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
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(`Rapport — ${className}`, 60, 140);
  ctx.font = "20px sans-serif";
  ctx.fillStyle = "#444";
  ctx.fillText(`Période ${period.period_number}`, 60, 180);
  let y = 240;
  ctx.font = "22px sans-serif";
  ctx.fillStyle = "#12266B";
  ctx.fillText(
    `Moyenne : ${stats.classAverage != null ? stats.classAverage.toFixed(2) : "—"}`,
    60,
    y,
  );
  y += 40;
  ctx.fillText(`Réussite : ${stats.passing.length}/${stats.withAvg.length}`, 60, y);
  y += 50;
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText("Classement", 60, y);
  y += 36;
  ctx.font = "18px sans-serif";
  for (const [i, r] of stats.withAvg.slice(0, 20).entries()) {
    ctx.fillText(
      `${i + 1}. ${r.student.last_name} ${r.student.first_name} — ${r.average.toFixed(2)}`,
      60,
      y,
    );
    y += 28;
    if (y > 1650) break;
  }
  return canvas;
}

export function ClassReportsSection({ classId }: { classId: string }) {
  const qc = useQueryClient();
  const reportsQuery = useSupabaseRows<ClassReport>("class_reports", { class_id: classId }, "created_at", false);
  const periodsQuery = useSupabaseRows<GradePeriod>("grade_periods", { class_id: classId }, "period_number");
  const activeReports = reportsQuery.data;
  const [busyId, setBusyId] = useState<string | null>(null);

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      const { error } = await supabase.from("class_reports").delete().eq("id", id);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["class_reports"] });
      toast.success("Rapport supprimé");
    } catch (e) {
      toast.error(describeError(e, "Suppression impossible"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" /> Rapports de classe
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {activeReports.length === 0 ? (
          <p className="text-muted-foreground text-xs">Aucun rapport enregistré pour cette classe.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {activeReports.map((r) => {
              const period = periodsQuery.data.find((p) => p.id === r.period_id);
              return (
                <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{r.title ?? `Rapport P${period?.period_number ?? "?"}`}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDateTime(r.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={busyId === r.id}
                      onClick={() => void remove(r.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export async function downloadClassReportPdf(opts: {
  establishmentName: string;
  className: string;
  period: GradePeriod;
  stats: ClassStatsLike;
}) {
  try {
    const canvas = renderClassReportCanvas(opts);
    const blob = await canvasToPdfBlob(canvas);
    downloadBlob(blob, `rapport-${opts.className}-p${opts.period.period_number}.pdf`);
  } catch (e) {
    toast.error(describeError(e, "Export PDF impossible"));
  }
}
