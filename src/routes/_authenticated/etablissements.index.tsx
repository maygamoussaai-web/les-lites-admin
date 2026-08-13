import { createFileRoute } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EstablishmentCard } from "@/components/app/establishment-card";
import { EmptyState } from "@/components/app/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useSchoolData, useEstablishmentStats } from "@/lib/school-data";

export const Route = createFileRoute("/_authenticated/etablissements/")({
  head: () => ({
    meta: [
      { title: "Établissements – Les Élites de Gao" },
      {
        name: "description",
        content: "Les quatre établissements du complexe Les Élites de Gao : université, lycée, collège et fondamentale.",
      },
      { property: "og:title", content: "Établissements – Les Élites de Gao" },
      {
        property: "og:description",
        content: "Accédez à la gestion complète de chaque établissement : classes, scolarité, enseignants et finance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const data = useSchoolData();
  const stats = useEstablishmentStats(data);

  return (
    <>
      <PageHeader
        eyebrow="Structure"
        title="Établissements"
        description="Ouvrez un établissement pour gérer ses classes, sa scolarité, ses enseignants et sa finance."
      />
      {data.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : data.establishments.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Aucun établissement accessible"
          description="Votre compte n'est rattaché à aucun établissement. Contactez la direction générale."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
    </>
  );
}