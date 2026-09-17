/**
 * Carte resultats periode — moyennes UNIQUEMENT via formules du modele Excel.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { History, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

  useEffect(() => {
    if (!classId) {
      setTemplateReady(true);
      setTemplateError("Eleve non assigne a une classe.");
      return;
    }
    let cancelled = false;
    (async () => {
      setTemplateReady(false);
      setTemplateError(null);
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
            setTemplateBuffer(null);
            setTemplateMapping(null);
            setTemplateError("Aucun modele Excel actif.");
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

  const periodGrades = useMemo(
    () => (activePeriod ? grades.filter((g) => g.period_id === activePeriod.id) : []),
    [grades, activePeriod],
  );

  const bySubject = useMemo(() => groupGradesBySubject(periodGrades, studentId), [periodGrades, studentId]);

  const modelResult = useMemo(() => {
    if (!templateReady || !templateBuffer || !templateMapping || !activePeriod || bySubject.size === 0) {
      return null;
    }
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
      .filter(([, avg]) => avg !== null && avg < PASS_THRESHOLD)
      .map(([name, avg]) => ({ id: name, name, average: avg as number }))
      .sort((a, b) => a.average - b.average);
  }, [modelResult]);

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">
          Notes {activePeriod ? `— Periode ${activePeriod.period_number}` : "de la periode en cours"}
        </CardTitle>
        <Button variant="ghost" size="sm" className="press" asChild>
          <Link to="/eleves/$studentId/notes" params={{ studentId }}>
            <History className="mr-1.5 h-4 w-4" /> Historique des notes
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!classId ? (
          <p className="text-muted-foreground">Eleve non assigne a une classe.</p>
        ) : loading || !templateReady ? (
          <p className="text-muted-foreground">Chargement…</p>
        ) : templateError && !templateBuffer ? (
          <p className="text-muted-foreground">
            {templateError} Importez un modele de bulletin pour calculer les moyennes (formules Excel).
          </p>
        ) : !activePeriod ? (
          <p className="text-muted-foreground">Aucune periode ouverte pour cette classe.</p>
        ) : bySubject.size === 0 ? (
          <p className="text-muted-foreground">Aucune note enregistree sur cette periode.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Moyennes calculees avec les formules du modele Excel (pas celles de l&apos;app).
            </p>
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
              <span className="text-muted-foreground">Moyenne de la periode</span>
              <Badge
                variant={average !== null && average < PASS_THRESHOLD ? "destructive" : "default"}
                className="tabular-nums"
              >
                {average === null ? "—" : `${formatNumber(average, 2)} / 20`}
              </Badge>
            </div>

            <ul className="divide-y divide-border rounded-lg border border-border">
              {subjects
                .filter((s) => bySubject.has(s.id))
                .map((s) => {
                  const list = bySubject.get(s.id) ?? [];
                  const avg = modelResult?.subjectAverages[s.name] ?? null;
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div>
                        <p className="font-medium text-foreground">{s.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {list.length} note(s) · {list.filter((g) => g.nature === "composition").length} composition
                        </p>
                      </div>
                      <span
                        className={`tabular-nums font-semibold ${
                          avg !== null && avg < PASS_THRESHOLD ? "text-destructive" : "text-foreground"
                        }`}
                      >
                        {avg === null ? "—" : formatNumber(avg, 2)}
                      </span>
                    </li>
                  );
                })}
            </ul>

            <div>
              <p className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
                <AlertTriangle className="h-4 w-4 text-warning" /> Matieres a travailler
              </p>
              {weak.length === 0 ? (
                <p className="text-muted-foreground">Aucune — l&apos;eleve a la moyenne dans toutes ses matieres notees.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {weak.map((w) => (
                    <Badge key={w.id} variant="destructive" className="tabular-nums">
                      {w.name} · {formatNumber(w.average, 2)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
