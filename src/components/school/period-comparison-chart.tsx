/**
 * Comparaison simple des moyennes par période (bulletins validés uniquement).
 */
import { useMemo } from "react";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import { useRows } from "@/lib/data";
import type { GradePeriod, StudentReportCard } from "@/lib/grades";

type Trend = "progress" | "stable" | "regress" | "none";

function trendOf(delta: number | null): Trend {
  if (delta === null) return "none";
  if (Math.abs(delta) < 0.05) return "stable";
  return delta > 0 ? "progress" : "regress";
}

const TREND_UI: Record<Trend, { label: string; className: string; Icon: typeof TrendingUp }> = {
  progress: {
    label: "Progression",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    Icon: TrendingUp,
  },
  stable: {
    label: "Égale",
    className: "bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/30",
    Icon: Minus,
  },
  regress: {
    label: "Régression",
    className: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
    Icon: TrendingDown,
  },
  none: {
    label: "—",
    className: "bg-muted text-muted-foreground border-border",
    Icon: Minus,
  },
};

export function PeriodComparisonChart({
  classId,
  studentId,
  title,
  subtitle,
}: {
  classId: string | null;
  studentId?: string;
  title?: string;
  subtitle?: string;
}) {
  const periodsQ = useRows<GradePeriod>("grade_periods", {
    eq: classId ? { class_id: classId } : {},
    enabled: !!classId,
    order: { column: "period_number" },
  });
  const cardsQ = useRows<StudentReportCard>("student_report_cards", {
    eq: studentId ? { student_id: studentId } : classId ? { class_id: classId } : {},
    enabled: !!classId,
  });

  const { points, lastDelta, trend } = useMemo(() => {
    const periods = [...(periodsQ.data ?? [])].sort((a, b) => a.period_number - b.period_number);
    const cards = cardsQ.data ?? [];
    const pts = periods
      .map((p) => {
        const relevant = studentId
          ? cards.filter((c) => c.period_id === p.id && c.student_id === studentId)
          : cards.filter((c) => c.period_id === p.id);
        const vals = relevant
          .map((c) => (c.general_average == null ? null : Number(c.general_average)))
          .filter((v): v is number => v !== null && Number.isFinite(v));
        const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        return {
          label: `P${p.period_number}`,
          period: p.period_number,
          closed: !!p.ended_at,
          moyenne: avg === null ? null : Number(avg.toFixed(2)),
          n: vals.length,
        };
      })
      .filter((p) => p.moyenne !== null);
    let delta: number | null = null;
    if (pts.length >= 2) {
      delta = (pts[pts.length - 1].moyenne as number) - (pts[pts.length - 2].moyenne as number);
    }
    return { points: pts, lastDelta: delta, trend: trendOf(delta) };
  }, [periodsQ.data, cardsQ.data, studentId]);

  const ui = TREND_UI[trend];
  const heading = title ?? "Comparaison des périodes";
  const sub =
    subtitle ??
    (studentId
      ? "Moyenne de l'élève à chaque période (bulletins)"
      : "Moyenne de classe à chaque période (bulletins)");

  const maxAvg = points.reduce((m, p) => Math.max(m, p.moyenne ?? 0), 0) || 20;
  const n = points.length;
  const cols = Math.min(n, 6);
  // Barres plus fines dès 5–6 périodes pour tenir sur une seule ligne
  const barMaxW = n >= 6 ? "1.65rem" : n >= 5 ? "2rem" : n >= 4 ? "2.5rem" : "3rem";
  const barH = n >= 5 ? "h-24" : "h-28";
  const gapClass = n >= 5 ? "gap-2" : "gap-3";
  const labelSize = n >= 5 ? "text-[10px]" : "text-[11px]";
  const avgSize = n >= 5 ? "text-base" : "text-lg";

  return (
    <Card className="border-border/80">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base">{heading}</CardTitle>
          <p className="text-xs text-muted-foreground">{sub}</p>
        </div>
        {points.length >= 2 && (
          <Badge variant="outline" className={`gap-1 ${ui.className}`}>
            <ui.Icon className="h-3.5 w-3.5" />
            {ui.label}
            {lastDelta !== null ? ` · ${lastDelta > 0 ? "+" : ""}${formatNumber(lastDelta, 2)}` : ""}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {points.length < 1 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Les moyennes apparaîtront dès qu'un bulletin sera généré.
          </p>
        ) : (
          <div
            className={`grid ${gapClass}`}
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {points.map((p, i) => {
              const prev = i > 0 ? (points[i - 1].moyenne as number) : null;
              const d = prev === null || p.moyenne === null ? null : (p.moyenne as number) - prev;
              const heightPct = p.moyenne === null ? 0 : Math.max(8, (p.moyenne / maxAvg) * 100);
              return (
                <div key={p.label} className="flex flex-col items-center gap-1.5">
                  <div className={`flex ${barH} w-full items-end justify-center rounded-lg bg-muted/30 px-1 pb-1`}>
                    <div
                      className="w-full rounded-t-md bg-primary/80 transition-all"
                      style={{ height: `${heightPct}%`, maxWidth: barMaxW }}
                      title={p.moyenne === null ? "—" : formatNumber(p.moyenne, 2)}
                    />
                  </div>
                  <p className={`${labelSize} font-medium uppercase tracking-wide text-muted-foreground`}>
                    {p.label}
                    {!p.closed ? " · en cours" : ""}
                  </p>
                  <p className={`${avgSize} font-semibold tabular-nums`}>
                    {p.moyenne === null ? "—" : formatNumber(p.moyenne, 2)}
                  </p>
                  {d !== null && (
                    <p
                      className={`text-[10px] tabular-nums ${
                        d > 0 ? "text-emerald-600" : d < 0 ? "text-rose-600" : "text-muted-foreground"
                      }`}
                    >
                      {d > 0 ? "+" : ""}
                      {formatNumber(d, 2)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
