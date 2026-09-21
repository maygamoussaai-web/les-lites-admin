/**
 * Bibliothèque de l'élève — page dédiée (demande d'origine).
 * Une page par élève : bulletins générés + pièces jointes, ajout, ouverture, téléchargement.
 */
import { Link, createFileRoute, useParams } from "@tanstack/react-router";
import { ArrowLeft, Library, ShieldAlert, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StudentDocuments } from "@/components/school/student-documents";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData } from "@/lib/school-data";

export const Route = createFileRoute("/_authenticated/eleves/$studentId/bibliotheque")({
  head: () => ({
    meta: [
      { title: "Bibliothèque élève – Les Élites de Gao" },
      {
        name: "description",
        content:
          "Bibliothèque personnelle de l'élève : bulletins, actes, photos et documents.",
      },
    ],
  }),
  component: BibliothequePage,
});

function BibliothequePage() {
  const { studentId } = useParams({ from: "/_authenticated/eleves/$studentId/bibliotheque" });
  const { isDG, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const data = useSchoolData();
  const resolved =
    data.students.find((s) => s.id === studentId) ??
    data.studentsById.get(studentId) ??
    null;

  const allowed =
    resolved && (isDG || establishmentIds.includes(resolved.establishment_id));

  if (!data.loading && !establishmentIdsLoading && (!resolved || !allowed)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Élève introuvable"
        description="Cet élève n'existe pas ou vous n'y avez pas accès."
      />
    );
  }

  if (!resolved) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const klass = data.classes.find((c) => c.id === resolved.class_id);
  const establishment = data.establishments.find((e) => e.id === resolved.establishment_id);

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link to="/eleves/$studentId" params={{ studentId: resolved.id }}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour à la fiche
        </Link>
      </Button>

      <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-primary/5 p-5 sm:p-6">
        <span
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              <Library className="h-3.5 w-3.5" />
              Bibliothèque
            </p>
            <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {resolved.last_name} {resolved.first_name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {klass?.name ?? "Classe non assignée"}
              {establishment ? ` · ${establishment.name}` : ""}
            </p>
          </div>
          <p className="inline-flex max-w-xs items-start gap-2 rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            Bulletins de classe, actes et pièces — tout au même endroit pour cet élève.
          </p>
        </div>
      </div>

      <StudentDocuments
        studentId={resolved.id}
        establishmentId={resolved.establishment_id}
      />
    </div>
  );
}
