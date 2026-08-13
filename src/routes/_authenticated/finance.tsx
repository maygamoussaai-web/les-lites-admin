import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Wallet, Banknote, AlertTriangle, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { DataTable } from "@/components/app/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSchoolData, useEstablishmentStats } from "@/lib/school-data";
import { formatFCFA, formatDate } from "@/lib/format";
import { PERIODS, periodStart, sum, type Period } from "@/lib/school";

export const Route = createFileRoute("/_authenticated/finance")({
  head: () => ({
    meta: [
      { title: "Finance globale – Les Élites de Gao" },
      { name: "description", content: "Recettes, dépenses et impayés consolidés des quatre établissements du complexe." },
      { property: "og:title", content: "Finance globale – Les Élites de Gao" },
      { property: "og:description", content: "Suivi financier consolidé : encaissements, paiements enseignants et impayés." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const [period, setPeriod] = useState<Period>("month");
  const since = periodStart(period);
  const data = useSchoolData();
  const stats = useEstablishmentStats(data, since);

  const revenue = sum(data.tuitionPayments.filter((p) => p.paid_at >= since).map((p) => Number(p.amount)));
  const expenses = sum(data.teacherPayments.filter((p) => p.paid_at >= since).map((p) => Number(p.amount)));
  const outstanding = [...stats.values()].reduce((acc, s) => acc + s.outstanding, 0);

  return (
    <>
      <PageHeader
        eyebrow="Direction générale"
        title="Finance du complexe"
        description="Recettes de scolarité, dépenses enseignants et impayés, par période et par établissement."
        actions={
          <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
            {PERIODS.map((p) => (
              <Button
                key={p.value}
                size="sm"
                variant={period === p.value ? "default" : "ghost"}
                className="press"
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Recettes" value={formatFCFA(revenue)} icon={Wallet} tone="success" loading={data.loading} />
        <StatCard label="Dépenses enseignants" value={formatFCFA(expenses)} icon={Banknote} tone="destructive" loading={data.loading} delay={60} />
        <StatCard label="Solde de la période" value={formatFCFA(revenue - expenses)} icon={TrendingUp} loading={data.loading} delay={120} />
        <StatCard label="Impayés cumulés" value={formatFCFA(outstanding)} icon={AlertTriangle} tone="accent" loading={data.loading} delay={180} />
      </div>

      <Card className="animate-rise panel-gradient">
        <CardHeader>
          <CardTitle className="font-display text-base">Répartition par établissement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.establishments.map((est) => {
            const s = stats.get(est.id);
            const max = Math.max(1, ...[...stats.values()].map((v) => v.collected));
            return (
              <div key={est.id}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{est.name}</span>
                  <span className="font-medium">{formatFCFA(s?.collected ?? 0)}</span>
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-700"
                    style={{ width: `${Math.round(((s?.collected ?? 0) / max) * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <DataTable
        rows={data.tuitionPayments.filter((p) => p.paid_at >= since).slice(0, 20)}
        loading={data.loading}
        emptyLabel="Aucun encaissement sur la période."
        columns={[
          {
            key: "student",
            header: "Élève",
            cell: (p) => {
              const st = data.students.find((s) => s.id === p.student_id);
              return st ? `${st.last_name} ${st.first_name}` : "—";
            },
          },
          {
            key: "est",
            header: "Établissement",
            cell: (p) => data.establishments.find((e) => e.id === p.establishment_id)?.name ?? "—",
          },
          { key: "amount", header: "Montant", cell: (p) => formatFCFA(p.amount) },
          { key: "date", header: "Date", cell: (p) => formatDate(p.paid_at) },
        ]}
      />
    </>
  );
}
