import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { DataTable } from "@/components/app/data-table";
import { formatFCFA, formatDate } from "@/lib/format";
import type { Period } from "@/lib/school";
import type { SchoolData } from "@/lib/school-data";
import { useEstablishmentStats } from "@/lib/school-data";

type Data = SchoolData;

const financeChartConfig: ChartConfig = {
  recettes: { label: "Recettes", color: "oklch(0.7 0.15 155)" },
  depenses: { label: "Dépenses", color: "oklch(0.65 0.2 25)" },
};

const WEEKDAY_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTH_SHORT = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

function buildPeriodBuckets(period: Period, since: string) {
  const now = new Date();
  const start = new Date(`${since}T00:00:00`);
  const buckets: { key: string; label: string }[] = [];
  if (period === "year") {
    for (let m = start.getMonth(); m <= now.getMonth(); m++) {
      buckets.push({ key: `${now.getFullYear()}-${String(m + 1).padStart(2, "0")}`, label: MONTH_SHORT[m] ?? "" });
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
      buckets.push({ key: cursor.toISOString().slice(0, 10), label: WEEKDAY_SHORT[day] ?? "" });
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return buckets;
}

function bucketKeyFor(period: Period, dateStr: string) {
  if (period === "year") return dateStr.slice(0, 7);
  return dateStr.slice(0, 10);
}

export function FinanceTab({ establishmentId, data }: { establishmentId: string; data: Data }) {
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

  const chartData = useMemo(() => {
    const buckets = buildPeriodBuckets(period, since);
    const map = new Map(buckets.map((b) => [b.key, { ...b, recettes: 0, depenses: 0 }]));
    for (const p of payments) {
      const key = bucketKeyFor(period, p.paid_at);
      const row = map.get(key);
      if (row) row.recettes += Number(p.amount);
    }
    for (const p of data.teacherPayments.filter((p) => p.establishment_id === establishmentId && p.paid_at >= since)) {
      const key = bucketKeyFor(period, p.paid_at);
      const row = map.get(key);
      if (row) row.depenses += Number(p.amount);
    }
    return [...map.values()];
  }, [period, since, payments, data.teacherPayments, establishmentId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["week", "month", "year"] as Period[]).map((p) => (
          <Button key={p} size="sm" variant={period === p ? "default" : "outline"} onClick={() => setPeriod(p)}>
            {p === "week" ? "7 jours" : p === "month" ? "Mois" : "Année"}
          </Button>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Flux</CardTitle></CardHeader>
        <CardContent>
          <ChartContainer config={financeChartConfig} className="aspect-auto h-64 w-full">
            <BarChart data={chartData}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="recettes" fill="var(--color-recettes)" radius={4} />
              <Bar dataKey="depenses" fill="var(--color-depenses)" radius={4} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Recettes scolarité</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{formatFCFA(stats?.revenue ?? 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Retards</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{formatFCFA(stats?.overdue ?? 0)}</CardContent>
        </Card>
      </div>
      <DataTable
        columns={[
          { key: "student", header: "Élève", cell: (p) => {
            const s = data.students.find((x) => x.id === p.student_id);
            return s ? `${s.last_name} ${s.first_name}` : "—";
          }},
          { key: "amount", header: "Montant", cell: (p) => formatFCFA(p.amount) },
          { key: "date", header: "Date", cell: (p) => formatDate(p.paid_at) },
        ]}
        rows={payments.slice(0, 50)}
        emptyLabel="Aucun paiement sur la période."
      />
    </div>
  );
}
