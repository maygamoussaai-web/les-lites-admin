import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, BookOpen } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { RowActions } from "@/components/app/row-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRows, useSaveRow, useDeleteRow } from "@/lib/data";
import { formatNumber } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/classes")({
  head: () => ({
    meta: [
      { title: "Classes – Les Élites de Gao" },
      { name: "description", content: "Organisation des classes par établissement et par année académique." },
      { property: "og:title", content: "Classes – Les Élites de Gao" },
      { property: "og:description", content: "Créez les classes et configurez leurs matières, coefficients et barèmes." },
    ],
  }),
  component: Page,
});

type Row = Tables<"classes">;
type Config = Tables<"class_subject_configs">;

function Page() {
  const { data: establishments = [] } = useRows<Tables<"establishments">>("establishments", { order: { column: "name" } });
  const { data: years = [] } = useRows<Tables<"academic_years">>("academic_years", { order: { column: "name", ascending: false } });
  const { data = [], isLoading } = useRows<Row>("classes", { order: { column: "name" } });
  const save = useSaveRow("classes", "Classe");
  const remove = useDeleteRow("classes", "Classe");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [configClass, setConfigClass] = useState<Row | null>(null);

  const estName = (id: string) => establishments.find((e) => e.id === id)?.name ?? "—";
  const yearName = (id: string) => years.find((y) => y.id === id)?.name ?? "—";
  const activeYear = years.find((y) => y.is_active);

  const fields: Field[] = useMemo(
    () => [
      { name: "name", label: "Nom de la classe", required: true, placeholder: "6ème A", colSpan: 2 },
      {
        name: "establishment_id",
        label: "Établissement",
        type: "select",
        required: true,
        options: establishments.map((e) => ({ value: e.id, label: e.name })),
      },
      {
        name: "academic_year_id",
        label: "Année académique",
        type: "select",
        required: true,
        defaultValue: activeYear?.id,
        options: years.map((y) => ({ value: y.id, label: y.name })),
      },
      { name: "level", label: "Niveau", placeholder: "6ème" },
      { name: "section", label: "Section", placeholder: "A" },
      { name: "description", label: "Description", type: "textarea" },
      { name: "is_active", label: "Active", type: "switch" },
    ],
    [establishments, years, activeYear?.id],
  );

  const columns: Column<Row>[] = [
    { key: "name", header: "Classe", cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "est", header: "Établissement", cell: (r) => estName(r.establishment_id) },
    { key: "year", header: "Année", cell: (r) => yearName(r.academic_year_id) },
    { key: "level", header: "Niveau", cell: (r) => r.level ?? "—" },
    { key: "status", header: "Statut", cell: (r) => (r.is_active ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>) },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label="Matières" onClick={() => setConfigClass(r)}>
            <BookOpen className="h-4 w-4" />
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
        title="Classes"
        description="Chaque classe appartient à un établissement et à une année académique."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Nouvelle classe
          </Button>
        }
      />
      <DataTable columns={columns} rows={data} loading={isLoading} />
      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Modifier la classe" : "Nouvelle classe"}
        fields={fields}
        initial={editing}
        submitting={save.isPending}
        onSubmit={(values) => save.mutate({ id: editing?.id, values }, { onSuccess: () => setOpen(false) })}
      />
      <ClassSubjectsDialog klass={configClass} onClose={() => setConfigClass(null)} />
    </>
  );
}

function ClassSubjectsDialog({ klass, onClose }: { klass: Row | null; onClose: () => void }) {
  const { data: subjects = [] } = useRows<Tables<"subjects">>("subjects", { order: { column: "name" } });
  const { data: configs = [], isLoading } = useRows<Config>("class_subject_configs", {
    eq: { class_id: klass?.id },
    enabled: !!klass,
  });
  const save = useSaveRow("class_subject_configs", "Configuration");
  const remove = useDeleteRow("class_subject_configs", "Configuration");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Config | null>(null);

  const fields: Field[] = [
    {
      name: "subject_id",
      label: "Matière",
      type: "select",
      required: true,
      colSpan: 2,
      options: subjects.map((s) => ({ value: s.id, label: s.name })),
    },
    { name: "coefficient", label: "Coefficient", type: "number", required: true, defaultValue: 1 },
    { name: "grading_scale", label: "Barème", type: "number", required: true, defaultValue: 20 },
    {
      name: "calculation_method",
      label: "Méthode de calcul",
      type: "select",
      defaultValue: "weighted_average",
      options: [
        { value: "weighted_average", label: "Moyenne pondérée" },
        { value: "simple_average", label: "Moyenne simple" },
      ],
    },
    { name: "is_active", label: "Active", type: "switch" },
  ];

  const columns: Column<Config>[] = [
    { key: "subject", header: "Matière", cell: (r) => subjects.find((s) => s.id === r.subject_id)?.name ?? "—" },
    { key: "coef", header: "Coefficient", cell: (r) => formatNumber(r.coefficient, 2) },
    { key: "scale", header: "Barème", cell: (r) => formatNumber(r.grading_scale, 0) },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (r) => (
        <RowActions
          onEdit={() => {
            setEditing(r);
            setOpen(true);
          }}
          onDelete={() => remove.mutate(r.id)}
        />
      ),
    },
  ];

  return (
    <Dialog open={!!klass} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Matières de la classe {klass?.name}</DialogTitle>
        </DialogHeader>
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Ajouter une matière
          </Button>
        </div>
        <DataTable columns={columns} rows={configs} loading={isLoading} emptyLabel="Aucune matière configurée." />
        <RecordDialog
          open={open}
          onOpenChange={setOpen}
          title={editing ? "Modifier la configuration" : "Ajouter une matière"}
          fields={fields}
          initial={editing}
          submitting={save.isPending}
          onSubmit={(values) =>
            save.mutate(
              { id: editing?.id, values: { ...values, class_id: klass!.id } },
              { onSuccess: () => setOpen(false) },
            )
          }
        />
      </DialogContent>
    </Dialog>
  );
}
