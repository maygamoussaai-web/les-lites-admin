import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, GraduationCap, Search } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { RowActions } from "@/components/app/row-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRows, useSaveRow, useDeleteRow } from "@/lib/data";
import { formatDate } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/eleves")({
  head: () => ({
    meta: [
      { title: "Élèves – Les Élites de Gao" },
      { name: "description", content: "Dossiers des élèves et inscriptions par classe du complexe Les Élites de Gao." },
      { property: "og:title", content: "Élèves – Les Élites de Gao" },
      { property: "og:description", content: "Gérez les dossiers élèves, matricules, tuteurs et inscriptions." },
    ],
  }),
  component: Page,
});

type Row = Tables<"students">;

const GENDERS = [
  { value: "M", label: "Masculin" },
  { value: "F", label: "Féminin" },
];

const STATUSES = [
  { value: "active", label: "Actif" },
  { value: "inactive", label: "Inactif" },
  { value: "graduated", label: "Diplômé" },
  { value: "transferred", label: "Transféré" },
];

const fields: Field[] = [
  { name: "first_name", label: "Prénom", required: true },
  { name: "last_name", label: "Nom", required: true },
  { name: "matricule", label: "Matricule" },
  { name: "date_of_birth", label: "Date de naissance", type: "date" },
  { name: "gender", label: "Sexe", type: "select", options: GENDERS },
  { name: "phone", label: "Téléphone" },
  { name: "guardian_name", label: "Tuteur / Parent" },
  { name: "guardian_phone", label: "Téléphone du tuteur" },
  { name: "address", label: "Adresse", colSpan: 2 },
  { name: "status", label: "Statut", type: "select", defaultValue: "active", options: STATUSES },
];

function Page() {
  const { data = [], isLoading } = useRows<Row>("students", { order: { column: "last_name" } });
  const save = useSaveRow("students", "Élève");
  const remove = useDeleteRow("students", "Élève");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [enrollFor, setEnrollFor] = useState<Row | null>(null);
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((s) =>
      `${s.first_name} ${s.last_name} ${s.matricule ?? ""}`.toLowerCase().includes(q),
    );
  }, [data, search]);

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Élève",
      cell: (r) => (
        <div>
          <p className="font-medium">
            {r.last_name} {r.first_name}
          </p>
          <p className="text-xs text-muted-foreground">{r.matricule ?? "Sans matricule"}</p>
        </div>
      ),
    },
    { key: "dob", header: "Naissance", cell: (r) => formatDate(r.date_of_birth) },
    { key: "gender", header: "Sexe", cell: (r) => GENDERS.find((g) => g.value === r.gender)?.label ?? "—" },
    {
      key: "guardian",
      header: "Tuteur",
      cell: (r) => (
        <div className="text-sm">
          <p>{r.guardian_name ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{r.guardian_phone ?? ""}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Statut",
      cell: (r) => <Badge variant={r.status === "active" ? "default" : "outline"}>{STATUSES.find((s) => s.value === r.status)?.label ?? r.status}</Badge>,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label="Inscriptions" onClick={() => setEnrollFor(r)}>
            <GraduationCap className="h-4 w-4" />
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
        title="Élèves"
        description="Dossiers élèves du complexe et inscriptions par classe."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Nouvel élève
          </Button>
        }
      />
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Rechercher un élève ou un matricule" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <DataTable columns={columns} rows={rows} loading={isLoading} emptyLabel="Aucun élève enregistré." />
      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Modifier l'élève" : "Nouvel élève"}
        fields={fields}
        initial={editing}
        submitting={save.isPending}
        onSubmit={(values) => save.mutate({ id: editing?.id, values }, { onSuccess: () => setOpen(false) })}
      />
      <EnrollmentsDialog student={enrollFor} onClose={() => setEnrollFor(null)} />
    </>
  );
}

function EnrollmentsDialog({ student, onClose }: { student: Row | null; onClose: () => void }) {
  const { data: classes = [] } = useRows<Tables<"classes">>("classes", { order: { column: "name" } });
  const { data: years = [] } = useRows<Tables<"academic_years">>("academic_years", { order: { column: "name", ascending: false } });
  const { data: enrollments = [], isLoading } = useRows<Tables<"student_enrollments">>("student_enrollments", {
    eq: { student_id: student?.id },
    enabled: !!student,
  });
  const save = useSaveRow("student_enrollments", "Inscription");
  const remove = useDeleteRow("student_enrollments", "Inscription");
  const [open, setOpen] = useState(false);

  const activeYear = years.find((y) => y.is_active);

  const fields: Field[] = [
    {
      name: "class_id",
      label: "Classe",
      type: "select",
      required: true,
      colSpan: 2,
      options: classes.map((c) => ({ value: c.id, label: c.name })),
    },
    { name: "enrollment_date", label: "Date d'inscription", type: "date", required: true, defaultValue: new Date().toISOString().slice(0, 10) },
    {
      name: "status",
      label: "Statut",
      type: "select",
      defaultValue: "active",
      options: [
        { value: "active", label: "En cours" },
        { value: "completed", label: "Terminée" },
        { value: "transferred", label: "Transféré" },
        { value: "cancelled", label: "Annulée" },
      ],
    },
    { name: "transfer_reason", label: "Motif de transfert", type: "textarea" },
  ];

  const columns: Column<Tables<"student_enrollments">>[] = [
    { key: "class", header: "Classe", cell: (r) => classes.find((c) => c.id === r.class_id)?.name ?? "—" },
    { key: "year", header: "Année", cell: (r) => years.find((y) => y.id === r.academic_year_id)?.name ?? "—" },
    { key: "date", header: "Inscription", cell: (r) => formatDate(r.enrollment_date) },
    { key: "status", header: "Statut", cell: (r) => <Badge variant="secondary">{r.status}</Badge> },
    { key: "actions", header: "", className: "text-right", cell: (r) => <RowActions onDelete={() => remove.mutate(r.id)} /> },
  ];

  return (
    <Dialog open={!!student} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Inscriptions — {student?.last_name} {student?.first_name}
          </DialogTitle>
        </DialogHeader>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Inscrire dans une classe
          </Button>
        </div>
        <DataTable columns={columns} rows={enrollments} loading={isLoading} emptyLabel="Aucune inscription." />
        <RecordDialog
          open={open}
          onOpenChange={setOpen}
          title="Nouvelle inscription"
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
                  student_id: student!.id,
                  establishment_id: klass.establishment_id,
                  academic_year_id: klass.academic_year_id,
                },
              },
              { onSuccess: () => setOpen(false) },
            );
          }}
        />
        <p className="text-xs text-muted-foreground">Année active : {activeYear?.name ?? "non définie"}</p>
      </DialogContent>
    </Dialog>
  );
}
