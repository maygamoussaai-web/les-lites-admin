import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileBarChart, Download, Trash2, Eye, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { writeAudit, useRows } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { canvasToPdfBlob, downloadBlob } from "@/lib/pdf-export";
import type { GradePeriod, ClassReport } from "@/lib/grades";

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
  bestSubject: { subject: { id: string; name: string }; avg: number } | null;
  worstSubject: { subject: { id: string; name: string }; avg: number } | null;
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
    <Card className="animate-rise panel-gradient">
      <CardHeader>
        <CardTitle className="font-display text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.student.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <Link
                to="/eleves/$studentId"
                params={{ studentId: r.student.id }}
                className="font-medium hover:underline"
              >
                {r.student.last_name} {r.student.first_name}
              </Link>
              {r.weakSubjects.length > 0 && (
                <p className="truncate text-xs text-muted-foreground">{r.weakSubjects.join(", ")}</p>
              )}
            </div>
            <Badge variant={tone === "destructive" ? "destructive" : "secondary"} className="tabular-nums">
              {r.average.toFixed(2)}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
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
  stats: ClassStats | null;
}) {
  const qc = useQueryClient();
  const reportsQuery = useRows<ClassReport>("class_reports", {
    eq: { class_id: classId },
    order: { column: "generated_at", ascending: false },
  });
  const reports = reportsQuery.data ?? [];

  const generate = async () => {
    if (!period || !stats) {
      toast.error("Aucune période ou statistiques disponibles.");
      return;
    }
    try {
      const canvas = renderClassReportCanvas({
        establishmentName,
        className,
        periodNumber: period.period_number,
        stats,
      });
      const blob = await canvasToPdfBlob(canvas);
      const path = `${establishmentId}/class-reports/${classId}-p${period.period_number}-${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage.from("student-documents").upload(path, blob, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (upErr) throw upErr;
      const { error } = await supabase.from("class_reports").insert({
        class_id: classId,
        establishment_id: establishmentId,
        period_id: period.id,
        file_path: path,
        generated_at: new Date().toISOString(),
      });
      if (error) throw error;
      await writeAudit("create", "class_reports" as never, null, { class_id: classId });
      qc.invalidateQueries({ queryKey: ["class_reports"] });
      toast.success("Rapport de classe généré");
    } catch (e) {
      toast.error((e as Error).message || "Génération impossible");
    }
  };

  const download = async (report: ClassReport) => {
    try {
      const { data, error } = await supabase.storage.from("student-documents").createSignedUrl(report.file_path, 300);
      if (error || !data) throw error ?? new Error("Lien indisponible");
      const res = await fetch(data.signedUrl);
      downloadBlob(await res.blob(), `Rapport-${className}.pdf`);
    } catch (e) {
      toast.error((e as Error).message || "Téléchargement impossible");
    }
  };

  const remove = async (report: ClassReport) => {
    try {
      await supabase.storage.from("student-documents").remove([report.file_path]);
      const { error } = await supabase.from("class_reports").delete().eq("id", report.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["class_reports"] });
      toast.success("Rapport supprimé");
    } catch (e) {
      toast.error((e as Error).message || "Suppression impossible");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Rapports de classe</CardTitle>
        <Button size="sm" variant="outline" onClick={generate} disabled={!period || !stats}>
          <FileBarChart className="mr-1.5 h-4 w-4" /> Générer
        </Button>
      </CardHeader>
      <CardContent>
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun rapport généré.</p>
        ) : (
          <div className="space-y-2">
            {reports.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{formatDateTime(r.generated_at)}</span>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => download(r)}>
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(r)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function renderClassReportCanvas({
  establishmentName,
  className,
  periodNumber,
  stats,
}: {
  establishmentName: string;
  className: string;
  periodNumber: number;
  stats: ClassStats;
}): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111827";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(establishmentName, 60, 60);
  ctx.font = "20px sans-serif";
  ctx.fillText(`Rapport de classe — ${className} — Période ${periodNumber}`, 60, 100);
  let y = 160;
  ctx.font = "16px sans-serif";
  ctx.fillText(
    `Moyenne : ${stats.classAverage != null ? stats.classAverage.toFixed(2) : "—"}`,
    60,
    y,
  );
  y += 40;
  ctx.fillText(`Réussite : ${stats.passing.length}/${stats.withAvg.length}`, 60, y);
  return canvas;
}
