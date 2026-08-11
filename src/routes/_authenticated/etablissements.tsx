import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { RowActions } from "@/components/app/row-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRows, useSaveRow, useDeleteRow } from "@/lib/data";
import { ESTABLISHMENT_TYPES, establishmentTypeLabel } from "@/lib/format";
import { useAdminProfile } from "@/hooks/use-auth";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/etablissements")({
  head: () => ({
    meta: [
      { title: "Établissements – Les Élites de Gao" },
      { name: "description", content: "Gestion des quatre établissements du complexe scolaire Les Élites de Gao." },
      { property: "og:title", content: "Établissements – Les Élites de Gao" },
      { property: "og:description", content: "Université, Lycée, Collège et Fondamentale du complexe Les Élites de Gao." },
    ],
  }),
  component: Page,
});

type Row = Tables<"establishments">;

const fields: Field[] = [
  { name: "name", label: "Nom", required: true, colSpan: 2 },
  { name: "type", label: "Type", type: "select", required: true, options: ESTABLISHMENT_TYPES.map((t) => ({ ...t })) },
  { name: "phone", label: "Téléphone" },
  { name: "address", label: "Adresse", colSpan: 2 },
  { name: "description", label: "Description", type: "textarea" },
  { name: "is_active", label: "Actif", type: "switch" },
];

function Page() {
  const { isDG } = useAdminProfile();
  const { data = [], isLoading } = useRows<Row>("establishments", { order: { column: "name" } });
  const save = useSaveRow("establishments", "Établissement");
  const remove = useDeleteRow("establishments", "Établissement");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  const columns: Column<Row>[] = [
    { key: "name", header: "Établissement", cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "type", header: "Type", cell: (r) => <Badge variant="secondary">{establishmentTypeLabel(r.type)}</Badge> },
    { key: "phone", header: "Téléphone", cell: (r) => r.phone ?? "—" },
    { key: "address", header: "Adresse", cell: (r) => r.address ?? "—" },
    { key: "status", header: "Statut", cell: (r) => (r.is_active ? <Badge>Actif</Badge> : <Badge variant="outline">Inactif</Badge>) },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (r) =>
        isDG ? (
          <RowActions
            onEdit={() => {
              setEditing(r);
              setOpen(true);
            }}
            onDelete={() => remove.mutate(r.id)}
          />
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Établissements"
        description="Les quatre établissements du complexe scolaire Les Élites de Gao."
        actions={
          isDG ? (
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Nouvel établissement
            </Button>
          ) : null
        }
      />
      <DataTable columns={columns} rows={data} loading={isLoading} />
      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Modifier l'établissement" : "Nouvel établissement"}
        fields={fields}
        initial={editing}
        submitting={save.isPending}
        onSubmit={(values) => save.mutate({ id: editing?.id, values }, { onSuccess: () => setOpen(false) })}
      />
    </>
  );
}
