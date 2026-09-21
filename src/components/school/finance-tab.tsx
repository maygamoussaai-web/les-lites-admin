/**
 * Onglet Finance d'un établissement — flux, KPI et encaissements.
 */
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Banknote, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { DataTable } from "@/components/app/data-table";
import { formatFCFA, formatDate } from "@/lib/format";
import type { Period } from "@/lib/school";
import type { SchoolData } from "@/lib/school-data";
import { useEstablishmentStats } from "@/lib/school-data";
import { cn } from "@/lib/utils";

type Data = SchoolData;

const financeChartConfig: ChartConfig = {
  recettes: { label: "Recettes", color: "hsl(152 60% 42%)" },
  depenses: { label: "Dépenses", color: "hsl(0 70% 55%)" },
};

const WEEKDAY_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTH_SHORT = [
  "Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc",
];

function buildPeriodBuckets(period: Period, since: string) {
  const now = new Date();
  const start = new Date(`${since}T00:00:00`);
  const buckets: { key: string; label: string }[] = [];
  if (period === "year") {
    for (let m = start.getMonth(); m <= now.getMonth(); m++) {
      buckets.push({
        key: `${now.getFullYear()}-${String(m + 1).padStart(2, "0")}`,
        label: MONTH_SHORT[m] ?? "",
      });
    }
  } else if (period === "month") {
    const cursor = new Date(start);
    while (cursor <= now) {
      const key = cursor.toISOString().slice(0, 10);
      buckets.push({ key, label: String(cursor.getDate()) });
      cursor.setDate(cursor.getDate() + 1);
    }
  } else {
    const cursor = new Date(start);
    while (cursor <= now) {
      const day = (cursor.getDay() + 6) % 7;
      buckets.push({
        key: cursor.toISOString().slice(0, 10),
        label: WEEKDAY_SHORT[day] ?? "",
      });
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return buckets;
}

function bucketKeyFor(period: Period, dateStr: string) {
  if (period === "year") return dateStr.slice(0, 7);
  return dateStr.slice(0, 10);
}

export function FinanceTab({
  establishmentId,
  data,
}: {
  establishmentId: string;
  data: Data;
}) {
  const [period, setPeriod] = useState<Period>("month");
  const since = useMemo(() => {
    const d = new Date();
    if (period === "year") d.setMonth(0, 1);
    else if (period === "month") d.setDate(1);
    else d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  }, [period]);

  const stats = useEstablishmentStats(data, since).get(establishmentId);
  const payments = data.tuitionPayments
    .filter((p) => p.establishment_id === establishmentId && p.paid_at >= since)
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at));

  const teacherPaid = useMemo(
    () =>
      data.teacherPayments
        .filter((p) => p.establishment_id === establishmentId && p.paid_at >= since)
        .reduce((acc, p) => acc + Number(p.amount), 0),
    [data.teacherPayments, establishmentId, since],
  );

  const chartData = useMemo(() => {
    const buckets = buildPeriodBuckets(period, since);
    const map = new Map(buckets.map((b) => [b.key, { ...b, recettes: 0, depenses: 0 }]));
    for (const p of payments) {
      const key = bucketKeyFor(period, p.paid_at);
      const row = map.get(key);
      if (row) row.recettes += Number(p.amount);
    }
    for (const p of data.teacherPayments.filter(
      (p) => p.establishment_id === establishmentId && p.paid_at >= since,
    )) {
      const key = bucketKeyFor(period, p.paid_at);
      const row = map.get(key);
      if (row) row.depenses += Number(p.amount);
    }
    return [...map.values()];
  }, [period, since, payments, data.teacherPayments, establishmentId]);

  const hasChartActivity = chartData.some((d) => d.recettes > 0 || d.depenses > 0);
  const collected = stats?.collected ?? 0;
  const outstanding = stats?.outstanding ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">Finance</h2>
          <p className="text-xs text-muted-foreground">
            Recettes de scolarité et paiements enseignants
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border border-border/80 bg-card p-1">
          {(["week", "month", "year"] as Period[]).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? "default" : "ghost"}
              className={cn("press", period === p && "shadow-sm")}
              onClick={() => setPeriod(p)}
            >
              {p === "week" ? "7 jours" : p === "month" ? "Mois" : "Année"}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Wallet className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Recettes
            </p>
            <p className="truncate text-lg font-semibold tabular-nums">{formatFCFA(collected)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400">
            <Banknote className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Dépenses profs
            </p>
            <p className="truncate text-lg font-semibold tabular-nums">{formatFCFA(teacherPaid)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400">
            <Banknote className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Impayés
            </p>
            <p className="truncate text-lg font-semibold tabular-nums">{formatFCFA(outstanding)}</p>
          </div>
        </div>
      </div>

      <Card className="overflow-hidden border-border/80 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base">Flux</CardTitle>
          <CardDescription>Recettes vs dépenses sur la période</CardDescription>
        </CardHeader>
        <CardContent>
          {!hasChartActivity ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/20 text-center">
              <Wallet className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Aucun mouvement sur cette période.</p>
            </div>
          ) : (
            <ChartContainer config={financeChartConfig} className="aspect-auto h-64 w-full">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) =>
                    v >= 1_000_000
                      ? `${(v / 1_000_000).toFixed(1)}M`
                      : v >= 1000
                        ? `${Math.round(v / 1000)}k`
                        : String(v)
                  }
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => formatFCFA(Number(value))}
                    />
                  }
                />
                <Bar dataKey="recettes" fill="var(--color-recettes)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="depenses" fill="var(--color-depenses)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/80 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base">Derniers encaissements</CardTitle>
          <CardDescription>
            {payments.length} paiement{payments.length > 1 ? "s" : ""} sur la période
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <DataTable
            columns={[
              {
                key: "student",
                header: "Élève",
                cell: (p) => {
                  const s = data.studentsById.get(p.student_id) ?? data.students.find((x) => x.id === p.student_id);
                  return s ? `${s.last_name} ${s.first_name}` : "—";
                },
              },
              {
                key: "amount",
                header: "Montant",
                cell: (p) => (
                  <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatFCFA(p.amount)}
                  </span>
                ),
              },
              { key: "date", header: "Date", cell: (p) => formatDate(p.paid_at) },
            ]}
            rows={payments.slice(0, 50)}
            emptyLabel="Aucun paiement sur la période."
          />
        </CardContent>
      </Card>
    </div>
  );
}
