/**
 * Finance globale du complexe — design soigné, lisible mobile + desktop.
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Wallet, Banknote, AlertTriangle, TrendingUp, Building2, ArrowDownRight, ArrowUpRight,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { DataTable } from "@/components/app/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSchoolData, useEstablishmentStats } from "@/lib/school-data";
import { formatFCFA, formatDate } from "@/lib/format";
import { PERIODS, periodStart, sum, type Period } from "@/lib/school";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/finance")({
  head: () => ({
    meta: [
      { title: "Finance globale – Les Élites de Gao" },
      {
        name: "description",
        content: "Recettes, dépenses et impayés consolidés des établissements du complexe.",
      },
      { property: "og:title", content: "Finance globale – Les Élites de Gao" },
      {
        property: "og:description",
        content: "Suivi financier consolidé : encaissements, paiements enseignants et impayés.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FinancePage,
});

const teacherChartConfig: ChartConfig = {
  montant: { label: "Paiements", color: "hsl(var(--primary))" },
};

function shortName(name: string, max = 14) {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1)}…`;
}

function FinancePage() {
  const [period, setPeriod] = useState<Period>("month");
  const [establishmentFilter, setEstablishmentFilter] = useState<string>("all");
  const since = periodStart(period);
  const data = useSchoolData();
  const stats = useEstablishmentStats(data, since);

  const establishments = useMemo(
    () =>
      establishmentFilter === "all"
        ? data.establishments
        : data.establishments.filter((e) => e.id === establishmentFilter),
    [data.establishments, establishmentFilter],
  );
  const establishmentIds = useMemo(
    () => new Set(establishments.map((e) => e.id)),
    [establishments],
  );

  const scopedTuitionPayments = useMemo(
    () =>
      data.tuitionPayments.filter(
        (p) => p.paid_at >= since && establishmentIds.has(p.establishment_id),
      ),
    [data.tuitionPayments, since, establishmentIds],
  );
  const scopedTeacherPayments = useMemo(
    () =>
      data.teacherPayments.filter(
        (p) => p.paid_at >= since && establishmentIds.has(p.establishment_id),
      ),
    [data.teacherPayments, since, establishmentIds],
  );

  const revenue = sum(scopedTuitionPayments.map((p) => Number(p.amount)));
  const expenses = sum(scopedTeacherPayments.map((p) => Number(p.amount)));
  const balance = revenue - expenses;
  const outstanding = establishments.reduce(
    (acc, e) => acc + (stats.get(e.id)?.outstanding ?? 0),
    0,
  );

  const revenueByEst = useMemo(() => {
    return establishments
      .map((est) => ({
        id: est.id,
        name: est.name,
        amount: sum(
          scopedTuitionPayments
            .filter((p) => p.establishment_id === est.id)
            .map((p) => Number(p.amount)),
        ),
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [establishments, scopedTuitionPayments]);

  const maxRevenue = Math.max(1, ...revenueByEst.map((r) => r.amount));

  const teacherChartData = useMemo(
    () =>
      establishments.map((est) => ({
        name: shortName(est.name, 12),
        fullName: est.name,
        montant: sum(
          scopedTeacherPayments
            .filter((p) => p.establishment_id === est.id)
            .map((p) => Number(p.amount)),
        ),
      })),
    [establishments, scopedTeacherPayments],
  );

  const periodLabel = PERIODS.find((p) => p.value === period)?.label ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Direction générale"
        title="Finance du complexe"
        description="Recettes de scolarité, dépenses enseignants et impayés — par période et par établissement."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <Select value={establishmentFilter} onValueChange={setEstablishmentFilter}>
          <SelectTrigger className="h-10 w-full border-border/80 bg-card sm:w-[240px]">
            <Building2 className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            <SelectValue placeholder="Établissement" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les établissements</SelectItem>
            {data.establishments.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex w-full gap-1 rounded-xl border border-border/80 bg-card p-1 sm:w-auto">
          {PERIODS.map((p) => (
            <Button
              key={p.value}
              size="sm"
              variant={period === p.value ? "default" : "ghost"}
              className={cn(
                "press flex-1 sm:flex-none",
                period === p.value && "shadow-sm",
              )}
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Recettes"
          value={formatFCFA(revenue)}
          icon={Wallet}
          tone="success"
          loading={data.loading}
        />
        <StatCard
          label="Dépenses enseignants"
          value={formatFCFA(expenses)}
          icon={Banknote}
          tone="destructive"
          loading={data.loading}
          delay={40}
        />
        <StatCard
          label="Solde de la période"
          value={formatFCFA(balance)}
          icon={TrendingUp}
          tone={balance >= 0 ? "success" : "destructive"}
          loading={data.loading}
          delay={80}
        />
        <StatCard
          label="Impayés cumulés"
          value={formatFCFA(outstanding)}
          icon={AlertTriangle}
          tone="accent"
          loading={data.loading}
          delay={120}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <ArrowUpRight className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Entrées · {periodLabel}
            </p>
            <p className="truncate text-lg font-semibold tabular-nums text-foreground">
              {formatFCFA(revenue)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400">
            <ArrowDownRight className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sorties · {periodLabel}
            </p>
            <p className="truncate text-lg font-semibold tabular-nums text-foreground">
              {formatFCFA(expenses)}
            </p>
          </div>
        </div>
      </div>

      <Card className="overflow-hidden border-border/80 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base">Recettes par établissement</CardTitle>
          <CardDescription>
            Encaissements de scolarité sur la période sélectionnée
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {revenueByEst.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Aucun établissement à afficher.
            </p>
          ) : (
            revenueByEst.map((row) => {
              const pct = Math.round((row.amount / maxRevenue) * 100);
              return (
                <div key={row.id} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {row.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatFCFA(row.amount)}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted/80">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500/80 to-emerald-400 transition-[width] duration-700 ease-out"
                      style={{ width: `${row.amount === 0 ? 0 : Math.max(pct, 4)}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/80 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base">
            Paiements enseignants
          </CardTitle>
          <CardDescription>Répartition des dépenses enseignants par établissement</CardDescription>
        </CardHeader>
        <CardContent>
          {teacherChartData.every((d) => d.montant === 0) ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/20 text-center">
              <Banknote className="h-6 w-6 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                Aucun paiement enseignant sur cette période.
              </p>
            </div>
          ) : (
            <ChartContainer config={teacherChartConfig} className="aspect-auto h-64 w-full">
              <BarChart
                data={teacherChartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 28 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  interval={0}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
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
                      labelFormatter={(_, payload) => {
                        const full = payload?.[0]?.payload?.fullName;
                        return full ? String(full) : "";
                      }}
                    />
                  }
                />
                <Bar
                  dataKey="montant"
                  fill="var(--color-montant)"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={48}
                />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/80 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base">Derniers encaissements</CardTitle>
          <CardDescription>
            {scopedTuitionPayments.length} paiement
            {scopedTuitionPayments.length > 1 ? "s" : ""} sur la période
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0 sm:px-0">
          <DataTable
            rows={scopedTuitionPayments.slice(0, 25)}
            loading={data.loading}
            emptyLabel="Aucun encaissement sur la période."
            columns={[
              {
                key: "student",
                header: "Élève",
                cell: (p) => {
                  const st = data.studentsById.get(p.student_id);
                  return st ? `${st.last_name} ${st.first_name}` : "—";
                },
              },
              {
                key: "est",
                header: "Établissement",
                cell: (p) =>
                  data.establishments.find((e) => e.id === p.establishment_id)?.name ?? "—",
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
              {
                key: "date",
                header: "Date",
                cell: (p) => formatDate(p.paid_at),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
