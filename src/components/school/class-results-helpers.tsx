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
  emptyLabel = "Aucun classement pour le moment",
}: {
  title: string;
  /** Liste classée (fiche classe) */
  students?: { id: string; name: string; value: string; rank: number }[];
  /** Liste AveragedStudent (autres vues) */
  rows?: AveragedStudent[];
  tone?: "destructive" | "success";
  /** Message affiché quand la liste est vide (au lieu de masquer la carte). */
  emptyLabel?: string;
}) {
  if (Array.isArray(students)) {
    return (
      <Card className="animate-rise">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {students.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            students.map((s) => (
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
            ))
          )}
        </CardContent>
      </Card>
    );
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <Card className="animate-rise">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="animate-rise">
      <CardHeader>
        <CardTitle className="font-display text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.student.id} className="flex items-center justify-between gap-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-6 shrink-0 tabular-nums text-muted-foreground">{i + 1}.</span>
              <Link
                to="/eleves/$studentId"
                params={{ studentId: r.student.id }}
                className="min-w-0 truncate font-medium hover:underline"
              >
                {r.student.last_name} {r.student.first_name}
              </Link>
            </div>
            <Badge variant={tone === "destructive" ? "destructive" : "default"} className="tabular-nums shrink-0">
              {r.average.toFixed(2)}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
