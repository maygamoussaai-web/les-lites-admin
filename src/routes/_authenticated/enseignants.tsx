import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Briefcase } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { RowActions } from "@/components/app/row-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRows, useSaveRow, useDeleteRow } from "@/lib/data";
import { formatFCFA } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/enseignants")({
  head: () => ({
    meta: [
      { title: "Enseignants – Les Élites de Gao" },
      { name: "description", content: "Gestion des enseignants, affectations et modes de rémunération." },
      { property: "og:title", content: "Enseignants – Les Élites de Gao" },
      { property: "og:description", content: "Suivez les enseignants du complexe et leurs affectations par classe et matière." },
    ],
  }),
  component: Page,
});

type Row = Tables<"teachers">;

const fields: Field[] = [
  { name: "first_name", label: "Prénom", required: true },
  { name: "last_name", label: "Nom", required: true },
  { name: "matricule", label: "Matricule" },
  { name: "phone", label: "Téléphone" },
  { name: "email", label: "E-mail" },
  {
    name: "status",
    label: "Statut",
    type: "select",
    defaultValue: "active",
    options: [
      { value: "active", label: "En activité" },
      { value: "inactive", label: "Inactif" },
    ],
  },
  { name: "specialties", label: "Spécialités", colSpan: 2, placeholder: "Mathématiques, Physique" },
  { name: "address", label: "Adresse", colSpan: 2 },
];

function Page() {
  const { data = [], isLoading } = useRows<Row>("teachers", { order: { column: "last_name" } });
  const save = useSaveRow("teachers", "Enseignant");
  const remove = useDeleteRow("teachers", "Enseignant");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [assignFor, setAssignFor] = useState<Row | null>(null);

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Enseignant",
      cell: (r) => (
        <div>
          <p className="font-medium">
            {r.last_name} {r.first_name}
          </p>
          <p className="text-xs text-muted-foreground">{r.matricule ?? "Sans matricule"}</p>
        </div>
      ),
    },
    { key: "phone", header: "Téléphone", cell: (r) => r.phone ?? "—" },
    { key: "email", header: "E-mail", cell: (r) => r.email ?? "—" },
    { key: "spec", header: "Spécialités", cell: (r) => r.specialties ?? "—" },
    { key: "status", header: "Statut", cell: (r) => <Badge variant={r.status === "active" ? "default" : "outline"}>{r.status === "active" ? "En activité" : "Inactif"}</Badge> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label="Affectations" onClick={() => setAssignFor(r)}>
            <Briefcase className="h-4 w-4" />
          </Button>
          <RowActions
            onEdit={() => {
              setEditing(r);
              setOpen(true);
            }}
            onDelete={() => remove.mutate(r.id)}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Enseignants"
        description="Corps enseignant du complexe scolaire et affectations par classe et matière."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Nouvel enseignant
          </Button>
        }
      />
      <DataTable columns={columns} rows={data} loading={isLoading} emptyLabel="Aucun enseignant enregistré." />
      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Modifier l'enseignant" : "Nouvel enseignant"}
        fields={fields}
        initial={editing}
        submitting={save.isPending}
        onSubmit={(values) => save.mutate({ id: editing?.id, values }, { onSuccess: () => setOpen(false) })}
      />
      <AssignmentsDialog teacher={assignFor} onClose={() => setAssignFor(null)} />
    </>
  );
}

function AssignmentsDialog({ teacher, onClose }: { teacher: Row | null; onClose: () => void }) {
  const { data: classes = [] } = useRows<Tables<"classes">>("classes", { order: { column: "name" } });
  const { data: subjects = [] } = useRows<Tables<"subjects">>("subjects", { order: { column: "name" } });
  const { data: years = [] } = useRows<Tables<"academic_years">>("academic_years", { order: { column: "name", ascending: false } });
  const { data: establishments = [] } = useRows<Tables<"establishments">>("establishments", { order: { column: "name" } });
  const { data: assignments = [], isLoading } = useRows<Tables<"teacher_assignments">>("teacher_assignments", {
    eq: { teacher_id: teacher?.id },
    enabled: !!teacher,
  });
  const save = useSaveRow("teacher_assignments", "Affectation");
  const remove = useDeleteRow("teacher_assignments", "Affectation");
  const [open, setOpen] = useState(false);

  const activeYear = years.find((y) => y.is_active);

  const fields: Field[] = [
    { name: "class_id", label: "Classe", type: "select", required: true, colSpan: 2, options: classes.map((c) => ({ value: c.id, label: c.name })) },
    { name: "subject_id", label: "Matière", type: "select", options: subjects.map((s) => ({ value: s.id, label: s.name })) },
    {
      name: "remuneration_type",
      label: "Rémunération",
      type: "select",
      defaultValue: "monthly",
      options: [
        { value: "monthly", label: "Mensuelle" },
        { value: "hourly", label: "Horaire" },
        { value: "per_session", label: "Par séance" },
      ],
    },
    { name: "rate", label: "Montant (FCFA)", type: "number" },
    { name: "start_date", label: "Début", type: "date" },
    { name: "end_date", label: "Fin", type: "date" },
    { name: "is_active", label: "Active", type: "switch" },
  ];

  const columns: Column<Tables<"teacher_assignments">>[] = [
    { key: "class", header: "Classe", cell: (r) => classes.find((c) => c.id === r.class_id)?.name ?? "—" },
    { key: "subject", header: "Matière", cell: (r) => subjects.find((s) => s.id === r.subject_id)?.name ?? "—" },
    { key: "est", header: "Établissement", cell: (r) => establishments.find((e) => e.id === r.establishment_id)?.name ?? "—" },
    { key: "rem", header: "Rémunération", cell: (r) => `${r.remuneration_type} · ${r.rate ? formatFCFA(Number(r.rate)) : "—"}` },
    { key: "actions", header: "", className: "text-right", cell: (r) => <RowActions onDelete={() => remove.mutate(r.id)} /> },
  ];

  return (
    <Dialog open={!!teacher} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Affectations — {teacher?.last_name} {teacher?.first_name}
          </DialogTitle>
        </DialogHeader>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Nouvelle affectation
          </Button>
        </div>
        <DataTable columns={columns} rows={assignments} loading={isLoading} emptyLabel="Aucune affectation." />
        <RecordDialog
          open={open}
          onOpenChange={setOpen}
          title="Nouvelle affectation"
          description="L'établissement et l'année sont déduits de la classe sélectionnée."
          fields={fields}
          submitting={save.isPending}
          onSubmit={(values) => {
            const klass = classes.find((c) => c.id === values.class_id);
            if (!klass) return;
            save.mutate(
              {
                values: {
                  ...values,
                  teacher_id: teacher!.id,
                  establishment_id: klass.establishment_id,
                  academic_year_id: klass.academic_year_id ?? activeYear?.id,
                },
              },
              { onSuccess: () => setOpen(false) },
            );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
