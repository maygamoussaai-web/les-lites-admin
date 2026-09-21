/**
 * Bibliothèque de l'élève — page dédiée aux documents (bulletins, pièces…).
 */
import { Link, createFileRoute, useParams } from "@tanstack/react-router";
import { ArrowLeft, Library, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { StudentDocuments } from "@/components/school/student-documents";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData } from "@/lib/school-data";

export const Route = createFileRoute("/_authenticated/eleves/$studentId/bibliotheque")({
  head: () => ({
    meta: [
      { title: "Bibliothèque élève – Les Élites de Gao" },
      {
        name: "description",
        content: "Documents et bulletins de l'élève : téléchargement, ajout, organisation.",
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
  if (!resolved) return null;

  const klass = data.classes.find((c) => c.id === resolved.class_id);
  const establishment = data.establishments.find((e) => e.id === resolved.establishment_id);

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link to="/eleves/$studentId" params={{ studentId: resolved.id }}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour à la fiche
        </Link>
      </Button>

      <PageHeader
        eyebrow="Bibliothèque"
        title={`${resolved.last_name} ${resolved.first_name}`}
        description={`${klass?.name ?? "Non assigné"} · ${establishment?.name ?? "—"} — bulletins, pièces et documents.`}
      />

      <div className="mb-3 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
        <Library className="h-4 w-4 shrink-0 text-primary" />
        <p>
          Les bulletins générés depuis la classe apparaissent ici automatiquement. Vous pouvez aussi
          ajouter d&apos;autres documents (acte de naissance, photo, diplôme…).
        </p>
      </div>

      <StudentDocuments studentId={resolved.id} establishmentId={resolved.establishment_id} />
    </>
  );
}
