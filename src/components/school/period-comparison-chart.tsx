/**
 * Comparaison visuelle des moyennes par période.
 * Sources : bulletins validés uniquement (general_average).
 */
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { TrendingDown, TrendingUp, Minus, LineChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatNumber } from "@/lib/format";
import { useRows } from "@/lib/data";
import type { GradePeriod, StudentReportCard } from "@/lib/grades";

type Trend = "progress" | "stable" | "regress" | "none";

function trendOf(delta: number | null): Trend {
  if (delta === null) return "none";
  if (Math.abs(delta) < 0.05) return "stable";
  return delta > 0 ? "progress" : "regress";
}

const TREND_UI: Record<
  Trend,
  { label: string; className: string; Icon: typeof TrendingUp }
> = {
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
    label: "Pas encore comparable",
    className: "bg-muted text-muted-foreground border-border",
    Icon: LineChart,
  },
};

const chartConfig = {
  moyenne: { label: "Moyenne", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

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
    let lastDelta: number | null = null;
    if (pts.length >= 2) {
      lastDelta = (pts[pts.length - 1].moyenne as number) - (pts[pts.length - 2].moyenne as number);
    }
    return { points: pts, lastDelta, trend: trendOf(lastDelta) };
  }, [periodsQ.data, cardsQ.data, studentId]);

  const ui = TREND_UI[trend];
  const heading = title ?? (studentId ? "Évolution de l'élève" : "Évolution de la classe");
  const sub =
    subtitle ??
    (studentId
      ? "Moyennes de bulletin d'une période à l'autre"
      : "Moyenne de classe (bulletins) d'une période à l'autre");

  return (
    <Card className="overflow-hidden border-border/80">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <LineChart className="h-4 w-4 text-primary" />
            {heading}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{sub}</p>
        </div>
        <Badge variant="outline" className={`gap-1 ${ui.className}`}>
          <ui.Icon className="h-3.5 w-3.5" />
          {ui.label}
          {lastDelta !== null ? ` · ${lastDelta > 0 ? "+" : ""}${formatNumber(lastDelta, 2)}` : ""}
        </Badge>
      </CardHeader>
      <CardContent>
        {points.length < 1 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Les moyennes apparaîtront ici dès qu'un bulletin aura été généré.
          </p>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-[16/7] w-full">
            <AreaChart data={points} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="fillMoyenne" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-moyenne)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-moyenne)" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis domain={[0, 20]} tickLine={false} axisLine={false} width={28} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => `${formatNumber(Number(value), 2)} / 20`}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="moyenne"
                stroke="var(--color-moyenne)"
                fill="url(#fillMoyenne)"
                strokeWidth={2.4}
                dot={{ r: 4, strokeWidth: 2 }}
                connectNulls
              />
            </AreaChart>
          </ChartContainer>
        )}
        {points.length >= 2 && (
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {points.map((p, i) => {
              const prev = i > 0 ? (points[i - 1].moyenne as number) : null;
              const d = prev === null || p.moyenne === null ? null : (p.moyenne as number) - prev;
              const t = trendOf(d);
              const T = TREND_UI[t];
              return (
                <li key={p.label} className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-center">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {p.label}{p.closed ? "" : " · en cours"}
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums">
                    {p.moyenne === null ? "—" : formatNumber(p.moyenne as number, 2)}
                  </p>
                  {d !== null && (
                    <p className={`text-[11px] ${T.className.split(" ")[1] ?? ""}`}>
                      {d > 0 ? "+" : ""}{formatNumber(d, 2)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
