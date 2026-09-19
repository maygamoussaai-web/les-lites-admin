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
  tone,
}: {
  title: string;
  rows: AveragedStudent[];
  tone: "destructive" | "success";
}) {
  if (!rows.length) return null;
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
  ctx.font = "bold 40px sans-serif";
  ctx.fillText(`Rapport — ${className}`, 60, 140);
  ctx.fillStyle = "#374151";
  ctx.font = "22px sans-serif";
  ctx.fillText(`Période ${period.period_number}`, 60, 190);
  let y = 260;
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(
    `Moyenne : ${stats.classAverage != null ? stats.classAverage.toFixed(2) : "—"}`,
    60,
    y,
  );
  y += 40;
  ctx.fillText(`Réussite : ${stats.passing.length}/${stats.withAvg.length}`, 60, y);
  return canvas;
}

export function ClassReportsSection({
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
  stats: ClassStatsLike | null;
}) {
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const reportsQuery = useSupabaseRows<ClassReport>("class_reports", { class_id: classId }, "generated_at", false);
  const activeReports = reportsQuery.data.filter((r) => !r.archived_at);

  const generate = async () => {
    if (!period || !stats) return;
    setGenerating(true);
    try {
      const canvas = renderClassReportCanvas({ establishmentName, className, period, stats });
      const blob = await canvasToPdfBlob(canvas);
      const path = `${establishmentId}/${classId}/rapport-p${period.period_number}-${Date.now()}.pdf`;
      const { error: up } = await supabase.storage.from("student-documents").upload(path, blob, {
        contentType: "application/pdf",
      });
      if (up) throw up;
      const { error } = await supabase.from("class_reports").insert({
        class_id: classId,
        establishment_id: establishmentId,
        period_id: period.id,
        file_path: path,
        generated_at: new Date().toISOString(),
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["class_reports"] });
      toast.success("Rapport généré");
    } catch (e) {
      toast.error(describeError(e, "Génération impossible"));
    } finally {
      setGenerating(false);
    }
  };

  const view = async (r: ClassReport) => {
    const { data, error } = await supabase.storage.from("student-documents").createSignedUrl(r.file_path, 300);
    if (error || !data) {
      toast.error("Lien indisponible");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const download = async (r: ClassReport) => {
    const { data, error } = await supabase.storage.from("student-documents").createSignedUrl(r.file_path, 300);
    if (error || !data) {
      toast.error("Lien indisponible");
      return;
    }
    const res = await fetch(data.signedUrl);
    downloadBlob(await res.blob(), `Rapport-${className}.pdf`);
  };

  const remove = async (r: ClassReport) => {
    const { error } = await supabase
      .from("class_reports")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["class_reports"] });
    toast.success("Rapport archivé");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Rapports de classe</CardTitle>
        <Button size="sm" className="press" onClick={() => void generate()} disabled={generating || !period || !stats}>
          {generating ? "…" : "Générer"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {activeReports.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun rapport actif.</p>
        ) : (
          <ul className="space-y-2">
            {activeReports.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDateTime(r.generated_at)}
                </span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" aria-label="Voir" onClick={() => void view(r)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Télécharger" onClick={() => void download(r)}>
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Archiver" onClick={() => void remove(r)}>
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
