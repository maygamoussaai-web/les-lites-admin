/**
 * NOTE POUR CLAUDE :
 * Carte "Résultats de la période" de la fiche élève. Réutilise les hooks et
 * calculs de src/lib/grades.ts (useClassGrades, subjectAverage,
 * weakSubjectsFor, studentPeriodAverage) — aucune règle de calcul n'est
 * redéfinie ici. Le bouton "Historique des notes" pointe vers la route
 * /eleves/$studentId/notes.
 */
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { History, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import {
  PASS_THRESHOLD,
  groupGradesBySubject,
  subjectAverage,
  studentPeriodAverage,
  weakSubjectsFor,
  useClassGrades,
} from "@/lib/grades";

export function StudentGradesCard({ studentId, classId }: { studentId: string; classId: string | null }) {
  const { loading, subjects, activePeriod, grades } = useClassGrades(classId ?? "", !!classId);

  const periodGrades = useMemo(
    () => (activePeriod ? grades.filter((g) => g.period_id === activePeriod.id) : []),
    [grades, activePeriod],
  );

  const bySubject = useMemo(() => groupGradesBySubject(periodGrades, studentId), [periodGrades, studentId]);
  const average = useMemo(() => studentPeriodAverage(periodGrades, studentId), [periodGrades, studentId]);
  const weak = useMemo(() => weakSubjectsFor(periodGrades, studentId, subjects), [periodGrades, studentId, subjects]);

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">
          Notes {activePeriod ? `— Période ${activePeriod.period_number}` : "de la période en cours"}
        </CardTitle>
        <Button variant="ghost" size="sm" className="press" asChild>
          <Link to="/eleves/$studentId/notes" params={{ studentId }}>
            <History className="mr-1.5 h-4 w-4" /> Historique des notes
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!classId ? (
          <p className="text-muted-foreground">Élève non assigné à une classe.</p>
        ) : loading ? (
          <p className="text-muted-foreground">Chargement…</p>
        ) : !activePeriod ? (
          <p className="text-muted-foreground">Aucune période ouverte pour cette classe.</p>
        ) : bySubject.size === 0 ? (
          <p className="text-muted-foreground">Aucune note enregistrée sur cette période.</p>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
              <span className="text-muted-foreground">Moyenne de la période</span>
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
                  const avg = subjectAverage(list);
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
                <AlertTriangle className="h-4 w-4 text-warning" /> Matières à travailler
              </p>
              {weak.length === 0 ? (
                <p className="text-muted-foreground">Aucune — l'élève a la moyenne dans toutes ses matières notées.</p>
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
