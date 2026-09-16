import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { ArrowLeft, Pencil, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentPhoto } from "@/components/school/student-photo";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSaveRow } from "@/lib/data";
import { useSchoolData } from "@/lib/school-data";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/eleves/$studentId/identite")({
  head: () => ({
    meta: [
      { title: "Identité élève – Les Élites de Gao" },
      { name: "description", content: "Identité et informations personnelles de l'élève." },
    ],
  }),
  component: Page,
});

function Page() {
  const { studentId } = Route.useParams();
  const navigate = useNavigate();
  const { isDG, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const data = useSchoolData();
  const save = useSaveRow("students", "Élève");
  const [editOpen, setEditOpen] = useState(false);

  const student = data.students.find((s) => s.id === studentId);
  const allowed = student && (isDG || establishmentIds.includes(student.establishment_id));

  if (!data.loading && !establishmentIdsLoading && (!student || !allowed)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Élève introuvable"
        description="Cet élève n'existe pas, a été archivé, ou vous n'y avez pas accès."
      />
    );
  }
  if (!student) return null;

  const establishment = data.establishments.find((e) => e.id === student.establishment_id);
  const klass = data.classes.find((c) => c.id === student.class_id);

  const editFields: Field[] = [
    { name: "first_name", label: "Prénom", required: true },
    { name: "last_name", label: "Nom", required: true },
    {
      name: "gender",
      label: "Sexe",
      type: "select",
      required: true,
      options: [
        { value: "M", label: "Masculin" },
        { value: "F", label: "Féminin" },
      ],
    },
    { name: "date_of_birth", label: "Date de naissance", type: "date" },
    { name: "parent_phone_1", label: "Téléphone parent 1" },
    { name: "parent_phone_2", label: "Téléphone parent 2" },
  ];

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link to="/eleves/$studentId" params={{ studentId: student.id }}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour à la fiche
        </Link>
      </Button>

      <PageHeader
        eyebrow="Identité et informations"
        title={`${student.last_name} ${student.first_name}`}
        description={`${establishment?.name ?? "—"} · ${klass?.name ?? "Classe non assignée"}`}
        actions={
          <Button className="press" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-1.5 h-4 w-4" /> Modifier
          </Button>
        }
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Identité</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <StudentPhoto
            studentId={student.id}
            establishmentId={student.establishment_id}
            photoUrl={student.photo_url ?? null}
            firstName={student.first_name}
            lastName={student.last_name}
          />
          <Row label="Sexe" value={student.gender === "F" ? "Féminin" : "Masculin"} />
          <Row label="Date de naissance" value={formatDate(student.date_of_birth)} />
          <Row label="Téléphone parent 1" value={student.parent_phone_1 ?? "—"} />
          <Row label="Téléphone parent 2" value={student.parent_phone_2 ?? "—"} />
          <Row label="Date d'inscription" value={formatDate(student.enrolled_at)} />
          <Row
            label="Classe actuelle"
            value={klass ? klass.name : <Badge variant="outline">Non assignée</Badge>}
          />
          <Row label="Établissement" value={establishment?.name ?? "—"} />
        </CardContent>
      </Card>

      <RecordDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Modifier l'identité"
        fields={editFields}
        initial={student}
        submitting={save.isPending}
        onSubmit={(values) =>
          save.mutate({ id: student.id, values }, { onSuccess: () => setEditOpen(false) })
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
