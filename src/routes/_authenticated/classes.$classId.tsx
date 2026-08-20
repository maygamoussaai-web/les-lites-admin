import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Trophy, TrendingDown, Users, GraduationCap, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData } from "@/lib/school-data";
import { generalAverage } from "@/lib/school";
import { formatNumber } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/classes/$classId")({
  head: () => ({
    meta: [
      { title: "Résultats de classe – Les Élites de Gao" },
      { name: "description", content: "Statistiques de résultats d'une classe : meilleure et plus faible moyenne, taux de réussite." },
    ],
  }),
  component: Page,
});

function Page() {
  const { classId } = Route.useParams();
  const { isDG, establishmentIds } = useAdminProfile();
  const data = useSchoolData();

  const klass = data.classes.find((c) => c.id === classId);
  const allowed = klass && (isDG || establishmentIds.includes(klass.establishment_id));

  const rows = useMemo(() => {
    if (!klass) return [];
    return data.students
      .filter((s) => s.class_id === klass.id)
      .map((s) => ({ student: s, average: generalAverage(s) }))
      .sort((a, b) => {
        if (a.average === null && b.average === null) return 0;
        if (a.average === null) return 1;
        if (b.average === null) return -1;
        return b.average - a.average;
      });
  }, [data.students, klass]);

  const withAverage = rows.filter((r) => r.average !== null) as { student: (typeof rows)[number]["student"]; average: number }[];
  const highest = withAverage.length ? withAverage.reduce((a, b) => (b.average > a.average ? b : a)) : null;
  const lowest = withAverage.length ? withAverage.reduce((a, b) => (b.average < a.average ? b : a)) : null;
  const passing = withAverage.filter((r) => r.average >= 10).length;
  const classAverage = withAverage.length
    ? withAverage.reduce((acc, r) => acc + r.average, 0) / withAverage.length
    : null;

  if (!data.loading && (!klass || !allowed)) {
    return (
      <EmptyState icon={AlertTriangle} title="Accès refusé" description="Cette classe n'existe pas ou vous n'y avez pas accès." />
    );
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link to="/etablissements/$id" params={{ id: klass?.establishment_id ?? "" }}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour à l'établissement
        </Link>
      </Button>

      <PageHeader
        eyebrow="Résultats"
        title={klass?.name ?? "Classe"}
        description="Moyenne générale calculée sur les trimestres déjà renseignés pour chaque élève."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Plus haute moyenne"
          value={highest ? formatNumber(highest.average, 2) : "—"}
          icon={Trophy}
          tone="success"
        />
        <StatCard
          label="Plus basse moyenne"
          value={lowest ? formatNumber(lowest.average, 2) : "—"}
          icon={TrendingDown}
          tone="destructive"
          delay={60}
        />
        <StatCard
          label="Élèves admis (≥ 10)"
          value={`${passing} / ${withAverage.length}`}
          icon={GraduationCap}
          tone="accent"
          delay={120}
        />
        <StatCard
          label="Moyenne de la classe"
          value={classAverage !== null ? formatNumber(classAverage, 2) : "—"}
          icon={Users}
          delay={180}
        />
      </div>

      {(highest || lowest) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {highest && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Meilleure moyenne</p>
              <p className="mt-1 font-display text-lg font-semibold text-foreground">
                {highest.student.last_name} {highest.student.first_name}
              </p>
              <p className="text-sm text-muted-foreground">{formatNumber(highest.average, 2)} / 20</p>
            </div>
          )}
          {lowest && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Moyenne la plus faible</p>
              <p className="mt-1 font-display text-lg font-semibold text-foreground">
                {lowest.student.last_name} {lowest.student.first_name}
              </p>
              <p className="text-sm text-muted-foreground">{formatNumber(lowest.average, 2)} / 20</p>
            </div>
          )}
        </div>
      )}

      {rows.length === 0 && !data.loading ? (
        <EmptyState icon={Users} title="Aucun élève" description="Cette classe n'a pas encore d'élève." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">Élève</th>
                <th className="p-3">T1</th>
                <th className="p-3">T2</th>
                <th className="p-3">T3</th>
                <th className="p-3">Moyenne générale</th>
                <th className="p-3">Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, index) => (
                <tr key={r.student.id} className="animate-rise border-t border-border" style={{ animationDelay: `${Math.min(index, 15) * 30}ms` }}>
                  <td className="p-3 text-muted-foreground">{index + 1}</td>
                  <td className="p-3 font-medium">
                    {r.student.last_name} {r.student.first_name}
                  </td>
                  <td className="p-3">{r.student.term1_average ?? "—"}</td>
                  <td className="p-3">{r.student.term2_average ?? "—"}</td>
                  <td className="p-3">{r.student.term3_average ?? "—"}</td>
                  <td className="p-3 font-medium">{r.average !== null ? formatNumber(r.average, 2) : "—"}</td>
                  <td className="p-3">
                    {r.average === null ? (
                      <Badge variant="outline">Incomplet</Badge>
                    ) : r.average >= 10 ? (
                      <Badge>Admis</Badge>
                    ) : (
                      <Badge variant="destructive">Non admis</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}