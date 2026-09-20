/**
 * Résultats périodiques d'un élève.
 * Moyennes = bulletins validés (formules modèle) uniquement — jamais inventées.
 */
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { PASS_THRESHOLD, useClassGrades, type GradePeriod, type StudentReportCard } from "@/lib/grades";
import { useRows } from "@/lib/data";

export function PeriodResultsCard({
  studentId,
  classId,
}: {
  studentId: string;
  classId: string | null;
}) {
  const { loading, periods, activePeriod } = useClassGrades(classId ?? "", !!classId);
  const cardsQuery = useRows<StudentReportCard>("student_report_cards", {
    eq: { student_id: studentId },
  });
  const cards = cardsQuery.data ?? [];

  const rows = useMemo(() => {
    const sorted = [...periods].sort((a, b) => a.period_number - b.period_number);
    return sorted.map((p) => {
      const card = cards.find((c) => c.period_id === p.id);
      const average =
        card?.general_average !== null && card?.general_average !== undefined
          ? Number(card.general_average)
          : null;
      return {
        period: p,
        average,
        isActive: activePeriod?.id === p.id,
        isClosed: p.ended_at !== null,
        validated: average !== null,
      };
    });
  }, [periods, cards, activePeriod?.id]);

  const annual =
    rows.filter((r) => r.average !== null).length > 0
      ? rows
          .filter((r) => r.average !== null)
          .reduce((a, r) => a + (r.average as number), 0) /
        rows.filter((r) => r.average !== null).length
      : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base">Résultats périodiques</CardTitle>
        <Button variant="ghost" size="sm" className="press h-8" asChild>
          <Link to="/eleves/$studentId/notes" params={{ studentId }}>
            Détail
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {!classId ? (
          <p className="text-xs text-muted-foreground">Élève non assigné à une classe.</p>
        ) : loading ? (
          <p className="text-xs text-muted-foreground">Chargement…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucune période créée pour cette classe.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {rows.map(({ period, average, isActive, isClosed, validated }) => (
              <PeriodBox
                key={period.id}
                period={period}
                average={average}
                isActive={isActive}
                isClosed={isClosed}
                validated={validated}
              />
            ))}
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-center">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Annuelle
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                {annual === null ? "—" : formatNumber(annual, 2)}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PeriodBox({
  period,
  average,
  isActive,
  isClosed,
  validated,
}: {
  period: GradePeriod;
  average: number | null;
  isActive: boolean;
  isClosed: boolean;
  validated: boolean;
}) {
  const failed = average !== null && average < PASS_THRESHOLD;
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-center ${
        isActive
          ? "border-primary/40 bg-primary/5"
          : isClosed
            ? "border-border bg-muted/30"
            : "border-border bg-card"
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        P{period.period_number}
        {isActive ? " · en cours" : isClosed ? " · close" : ""}
      </p>
      <p
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          failed ? "text-destructive" : "text-foreground"
        }`}
      >
        {average === null ? "—" : formatNumber(average, 2)}
      </p>
      {validated && (
        <Badge variant="secondary" className="mt-1 text-[10px]">
          Bulletin
        </Badge>
      )}
    </div>
  );
}
