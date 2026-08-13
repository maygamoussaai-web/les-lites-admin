import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Users, GraduationCap, Wallet, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { EstablishmentCard } from "@/components/app/establishment-card";
import { ProgressRing } from "@/components/app/progress-ring";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData, useEstablishmentStats } from "@/lib/school-data";
import { formatFCFA } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/tableau-de-bord")({
  head: () => ({
    meta: [
      { title: "Tableau de bord – Les Élites de Gao" },
      {
        name: "description",
        content: "Vue d'ensemble du complexe scolaire Les Élites de Gao : effectifs, classes et recouvrement.",
      },
      { property: "og:title", content: "Tableau de bord – Les Élites de Gao" },
      {
        property: "og:description",
        content: "Pilotage global des quatre établissements : élèves, classes, scolarité encaissée et retards.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { isDG, profile, loading: authLoading } = useAdminProfile();
  const navigate = useNavigate();
  const data = useSchoolData();
  const stats = useEstablishmentStats(data);

  useEffect(() => {
    if (authLoading || isDG) return;
    if (profile?.establishment_id) {
      navigate({ to: "/etablissements/$id", params: { id: profile.establishment_id }, replace: true });
    }
  }, [authLoading, isDG, profile?.establishment_id, navigate]);

  const totals = [...stats.values()].reduce(
    (acc, s) => ({
      students: acc.students + s.students,
      classes: acc.classes + s.classes,
      expected: acc.expected + s.expected,
      collected: acc.collected + s.collected,
      late: acc.late + s.lateStudents,
    }),
    { students: 0, classes: 0, expected: 0, collected: 0, late: 0 },
  );

  return (
    <>
      <PageHeader
        eyebrow="Complexe scolaire"
        title="Tableau de bord"
        description="Situation consolidée des quatre établissements : effectifs, classes et recouvrement de la scolarité."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Élèves inscrits" value={totals.students} icon={Users} loading={data.loading} delay={0} />
        <StatCard label="Classes ouvertes" value={totals.classes} icon={GraduationCap} tone="accent" loading={data.loading} delay={60} />
        <StatCard
          label="Scolarité encaissée"
          value={formatFCFA(totals.collected)}
          hint={`Attendu : ${formatFCFA(totals.expected)}`}
          icon={Wallet}
          tone="success"
          loading={data.loading}
          delay={120}
        />
        <StatCard
          label="Élèves en retard"
          value={totals.late}
          hint="Tranches échues non réglées"
          icon={AlertTriangle}
          tone="destructive"
          loading={data.loading}
          delay={180}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-foreground">Établissements</h2>
          {data.loading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-64 rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {data.establishments.map((est, index) => {
                const s = stats.get(est.id);
                return (
                  <EstablishmentCard
                    key={est.id}
                    establishment={est}
                    students={s?.students ?? 0}
                    classes={s?.classes ?? 0}
                    collected={s?.collected ?? 0}
                    expected={s?.expected ?? 0}
                    delay={index * 80}
                  />
                );
              })}
            </div>
          )}
        </div>

        <Card className="animate-rise panel-gradient h-fit">
          <CardHeader>
            <CardTitle className="font-display text-base">Taux de recouvrement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <ProgressRing
              value={totals.collected}
              max={totals.expected}
              label="Encaissé"
              caption={`${formatFCFA(totals.collected)} encaissés sur ${formatFCFA(totals.expected)} attendus`}
            />
            <div className="hairline" />
            <div className="space-y-3">
              {data.establishments.map((est) => {
                const s = stats.get(est.id);
                const ratio = s && s.expected > 0 ? Math.round((s.collected / s.expected) * 100) : 0;
                return (
                  <div key={est.id}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate text-muted-foreground">{est.name}</span>
                      <span className="font-medium text-foreground">{ratio}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-700"
                        style={{ width: `${ratio}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
