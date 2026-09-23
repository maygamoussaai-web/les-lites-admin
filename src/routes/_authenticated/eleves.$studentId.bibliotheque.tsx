/**
 * Bibliothèque de l'élève — page dédiée.
 * Documents regroupés par classe, plus récents en haut, actions sous chaque fichier.
 */
import { Link, createFileRoute, useParams } from "@tanstack/react-router";
import { ArrowLeft, Library, ShieldAlert } from "lucide-react";
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
        content: "Bibliothèque personnelle de l'élève : bulletins et documents par classe.",
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
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  const klass = data.classes.find((c) => c.id === resolved.class_id);
  const establishment = data.establishments.find((e) => e.id === resolved.establishment_id);

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground" asChild>
        <Link to="/eleves/$studentId" params={{ studentId: resolved.id }}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Fiche élève
        </Link>
      </Button>

      <header className="space-y-1.5">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
          <Library className="h-3.5 w-3.5" />
          Bibliothèque
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
          {resolved.last_name} {resolved.first_name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {[klass?.name, establishment?.name].filter(Boolean).join(" · ") || "—"}
        </p>
      </header>

      <StudentDocuments
        studentId={resolved.id}
        establishmentId={resolved.establishment_id}
        classId={resolved.class_id}
      />
    </div>
  );
}
