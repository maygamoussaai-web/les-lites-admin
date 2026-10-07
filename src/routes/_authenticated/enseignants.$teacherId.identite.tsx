import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Pencil, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSaveRow } from "@/lib/data";
import { useSchoolData } from "@/lib/school-data";

export const Route = createFileRoute("/_authenticated/enseignants/$teacherId/identite")({
  head: () => ({
    meta: [
      { title: "Identité enseignant – Les Élites de Gao" },
      { name: "description", content: "Identité et coordonnées de l'enseignant." },
    ],
  }),
  component: Page,
});

function Page() {
  const { teacherId } = Route.useParams();
  const { isDG, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const data = useSchoolData();
  const save = useSaveRow("teachers", "Enseignant");
  const [editOpen, setEditOpen] = useState(false);

  const teacher = data.teachers.find((t) => t.id === teacherId);
  const assignments = data.assignments.filter((a) => a.teacher_id === teacherId);
  const allowed =
    teacher &&
    assignments.length > 0 &&
    (isDG || assignments.some((a) => establishmentIds.includes(a.establishment_id)));

  if (!data.loading && !establishmentIdsLoading && (!teacher || !allowed)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Enseignant introuvable"
        description="Cet enseignant n'existe pas ou vous n'y avez pas accès."
      />
    );
  }
  if (!teacher) return null;

  const editFields: Field[] = [
    { name: "first_name", label: "Prénom", required: true },
    { name: "last_name", label: "Nom", required: true },
    { name: "phone", label: "Téléphone" },
    { name: "domain", label: "Domaine" },
  ];

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link to="/enseignants/$teacherId" params={{ teacherId: teacher.id }}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour à la fiche
        </Link>
      </Button>

      <PageHeader
        eyebrow="Identité"
        title={`${teacher.last_name} ${teacher.first_name}`}
        description="Coordonnées et informations personnelles"
        actions={
          <Button className="press" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-1.5 h-4 w-4" /> Modifier
          </Button>
        }
      />

      <Card className="max-w-md border-border/80 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Coordonnées</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 text-sm">
          <Row label="Prénom" value={teacher.first_name} />
          <Row label="Nom" value={teacher.last_name} />
          <Row label="Téléphone" value={teacher.phone ?? "—"} />
          <Row label="Domaine" value={teacher.domain ?? "—"} />
        </CardContent>
      </Card>

      <RecordDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Modifier l'identité"
        fields={editFields}
        initial={teacher}
        submitting={save.isPending}
        onSubmit={(values) =>
          save.mutate({ id: teacher.id, values }, { onSuccess: () => setEditOpen(false) })
        }
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/50 py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}
