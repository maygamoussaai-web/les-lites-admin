/**
 * Carte notes période — moyennes = formules du modèle Excel (moteur writeback).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BookOpen, AlertTriangle, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatNumber } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import {
  PASS_THRESHOLD,
  groupGradesBySubject,
  useClassGrades,
} from "@/lib/grades";
import { buildModelFillData, computeModelAverages } from "@/lib/model-averages";
import type { TemplateMapping } from "@/lib/xlsx-template";

export function StudentGradesCard({ studentId, classId }: { studentId: string; classId: string | null }) {
  const { loading, subjects, activePeriod, grades } = useClassGrades(classId ?? "", !!classId);

  const [templateBuffer, setTemplateBuffer] = useState<ArrayBuffer | null>(null);
  const [templateMapping, setTemplateMapping] = useState<TemplateMapping | null>(null);
  const [templateScale, setTemplateScale] = useState(20);
  const [templateReady, setTemplateReady] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  useEffect(() => {
    if (!classId) {
      setTemplateReady(true);
      setTemplateError("Élève non assigné à une classe.");
      return;
    }
    let cancelled = false;
    (async () => {
      setTemplateReady(false);
      setTemplateError(null);
      try {
        const { data: tpl, error: tplError } = await supabase
          .from("report_templates")
          .select("file_path, mapping, scale, is_active, kind")
          .eq("class_id", classId)
          .eq("is_active", true)
          .order("created_at", { ascending: false });
        if (tplError) throw tplError;
        const periodTpl =
          (tpl ?? []).find((r) => (r.kind ?? "period") === "period") ?? (tpl ?? [])[0];
        if (!periodTpl?.file_path || !periodTpl.mapping) {
          if (!cancelled) {
            setTemplateBuffer(null);
            setTemplateMapping(null);
            setTemplateError("Aucun modèle Excel actif pour cette classe.");
            setTemplateReady(true);
          }
          return;
        }
        const { data: file, error } = await supabase.storage
          .from("report-templates")
          .download(periodTpl.file_path);
        if (error || !file) throw error ?? new Error("Téléchargement du modèle impossible");
        const buffer = await file.arrayBuffer();
        if (cancelled) return;
        setTemplateBuffer(buffer);
        setTemplateMapping(periodTpl.mapping as unknown as TemplateMapping);
        setTemplateScale(Number(periodTpl.scale) || 20);
        setTemplateReady(true);
      } catch (e) {
        if (!cancelled) {
          setTemplateError((e as Error).message || "Modèle indisponible");
          setTemplateReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classId]);

  const periodGrades = useMemo(
    () => (activePeriod ? grades.filter((g) => g.period_id === activePeriod.id) : []),
    [grades, activePeriod],
  );

  const bySubject = useMemo(
    () => groupGradesBySubject(periodGrades, studentId),
    [periodGrades, studentId],
  );

  const modelResult = useMemo(() => {
    if (!templateReady || !templateBuffer || !templateMapping || !activePeriod || bySubject.size === 0) {
      return null;
    }
    try {
      const fill = buildModelFillData({
        establishmentName: "",
        className: "",
        studentFirstName: "",
        studentLastName: "",
        periodNumber: activePeriod.period_number,
        subjects,
        grades: periodGrades,
        studentId,
        headcount: 0,
        scale: templateScale,
        rank: null,
        firstAverage: null,
        lastAverage: null,
      });
      return computeModelAverages(templateBuffer, templateMapping, fill);
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [
    templateReady,
    templateBuffer,
    templateMapping,
    templateScale,
    activePeriod,
    bySubject.size,
    subjects,
    periodGrades,
    studentId,
  ]);

  const average = modelResult?.generalAverage ?? null;
  const weak = useMemo(() => {
    if (!modelResult) return [];
    return Object.entries(modelResult.subjectAverages)
      .filter(([name, avg]) => {
        if (avg === null || avg >= PASS_THRESHOLD) return false;
        const sub = subjects.find((x) => x.name === name);
        if (!sub) return false;
        const list = bySubject.get(sub.id) ?? [];
        return list.some((g) => g.nature === "evaluation") && list.some((g) => g.nature === "composition");
      })
      .map(([name, avg]) => ({ id: name, name, average: avg as number }))
      .sort((a, b) => a.average - b.average);
  }, [modelResult, subjects, bySubject]);

  const gradedSubjects = subjects.filter((s) => bySubject.has(s.id));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base">
          Notes {activePeriod ? `— P${activePeriod.period_number}` : ""}
        </CardTitle>
        <Button variant="ghost" size="sm" className="press h-8" asChild>
          <Link to="/eleves/$studentId/notes" params={{ studentId }}>
            <BookOpen className="mr-1 h-3.5 w-3.5" /> Notes de l'élève
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!classId ? (
          <p className="text-muted-foreground">Élève non assigné à une classe.</p>
        ) : loading || !templateReady ? (
          <p className="text-muted-foreground">Chargement…</p>
        ) : templateError && !templateBuffer ? (
          <p className="text-muted-foreground text-xs">
            {templateError} Importez un modèle de bulletin pour afficher les moyennes (formules Excel).
          </p>
        ) : !activePeriod ? (
          <p className="text-muted-foreground">Aucune période ouverte.</p>
        ) : bySubject.size === 0 ? (
          <p className="text-muted-foreground">Aucune note sur cette période.</p>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
              <span className="text-muted-foreground text-xs">Moyenne (formules modèle)</span>
              <Badge
                variant={average !== null && average < PASS_THRESHOLD ? "destructive" : "default"}
                className="tabular-nums"
              >
                {average === null ? "—" : `${formatNumber(average, 2)} / 20`}
              </Badge>
            </div>

            <Collapsible open={listOpen} onOpenChange={setListOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm" className="w-full justify-between">
                  <span>
                    {gradedSubjects.length} matière{gradedSubjects.length > 1 ? "s" : ""} notée
                    {gradedSubjects.length > 1 ? "s" : ""}
                  </span>
                  <ChevronDown className={`h-4 w-4 transition ${listOpen ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                  {gradedSubjects.map((s) => {
                    const list = bySubject.get(s.id) ?? [];
                    const avg = modelResult?.subjectAverages[s.name] ?? null;
                    return (
                      <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {list.length} note{list.length > 1 ? "s" : ""}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 tabular-nums text-sm font-semibold ${
                            avg !== null && avg < PASS_THRESHOLD ? "text-destructive" : "text-foreground"
                          }`}
                        >
                          {avg === null ? "—" : formatNumber(avg, 2)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CollapsibleContent>
            </Collapsible>

            {weak.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-xs font-medium text-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" /> À travailler
                </p>
                <div className="flex flex-wrap gap-1">
                  {weak.map((w) => (
                    <Badge key={w.id} variant="destructive" className="tabular-nums text-[11px]">
                      {w.name} · {formatNumber(w.average, 2)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <Button className="press w-full" variant="outline" asChild>
          <Link to="/eleves/$studentId/notes" params={{ studentId }}>
            <BookOpen className="mr-1.5 h-4 w-4" /> Notes de l'élève
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
