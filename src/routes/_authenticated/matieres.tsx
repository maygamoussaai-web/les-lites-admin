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
import { useAdminProfile } from "@/hooks/use-auth";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/matieres")({
  head: () => ({
    meta: [
      { title: "Matières – Les Élites de Gao" },
      { name: "description", content: "Référentiel des matières enseignées dans le complexe scolaire Les Élites de Gao." },
      { property: "og:title", content: "Matières – Les Élites de Gao" },
      { property: "og:description", content: "Gérez le catalogue des matières du complexe scolaire." },
    ],
  }),
  component: Page,
});

type Row = Tables<"subjects">;

const fields: Field[] = [
  { name: "name", label: "Matière", required: true, colSpan: 2 },
  { name: "code", label: "Code", placeholder: "MATH" },
  { name: "is_active", label: "Active", type: "switch" },
  { name: "description", label: "Description", type: "textarea" },
];

function Page() {
  const { isDG } = useAdminProfile();
  const { data = [], isLoading } = useRows<Row>("subjects", { order: { column: "name" } });
  const save = useSaveRow("subjects", "Matière");
  const remove = useDeleteRow("subjects", "Matière");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  const columns: Column<Row>[] = [
    { key: "name", header: "Matière", cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "code", header: "Code", cell: (r) => r.code ?? "—" },
    { key: "status", header: "Statut", cell: (r) => (r.is_active ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>) },
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
        title="Matières"
        description="Catalogue commun des matières, réutilisé par toutes les classes du complexe."
        actions={
          isDG ? (
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Nouvelle matière
            </Button>
          ) : null
        }
      />
      <DataTable columns={columns} rows={data} loading={isLoading} />
      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Modifier la matière" : "Nouvelle matière"}
        fields={fields}
        initial={editing}
        submitting={save.isPending}
        onSubmit={(values) => save.mutate({ id: editing?.id, values }, { onSuccess: () => setOpen(false) })}
      />
    </>
  );
}
