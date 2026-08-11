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
import { formatDate } from "@/lib/format";
import { useAdminProfile } from "@/hooks/use-auth";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/annees")({
  head: () => ({
    meta: [
      { title: "Années académiques – Les Élites de Gao" },
      { name: "description", content: "Création et suivi des années académiques du complexe Les Élites de Gao." },
      { property: "og:title", content: "Années académiques – Les Élites de Gao" },
      { property: "og:description", content: "Définissez l'année académique active du complexe scolaire." },
    ],
  }),
  component: Page,
});

type Row = Tables<"academic_years">;

const fields: Field[] = [
  { name: "name", label: "Libellé", required: true, placeholder: "2025-2026", colSpan: 2 },
  { name: "start_date", label: "Début", type: "date" },
  { name: "end_date", label: "Fin", type: "date" },
  { name: "is_active", label: "Année active", type: "switch" },
];

function Page() {
  const { isDG } = useAdminProfile();
  const { data = [], isLoading } = useRows<Row>("academic_years", { order: { column: "name", ascending: false } });
  const save = useSaveRow("academic_years", "Année académique");
  const remove = useDeleteRow("academic_years", "Année académique");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  const columns: Column<Row>[] = [
    { key: "name", header: "Année", cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "start", header: "Début", cell: (r) => formatDate(r.start_date) },
    { key: "end", header: "Fin", cell: (r) => formatDate(r.end_date) },
    { key: "status", header: "Statut", cell: (r) => (r.is_active ? <Badge>Active</Badge> : <Badge variant="outline">Clôturée</Badge>) },
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
        title="Années académiques"
        description="L'année active sert de référence par défaut aux classes, inscriptions et paiements."
        actions={
          isDG ? (
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Nouvelle année
            </Button>
          ) : null
        }
      />
      <DataTable columns={columns} rows={data} loading={isLoading} />
      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Modifier l'année" : "Nouvelle année académique"}
        fields={fields}
        initial={editing}
        submitting={save.isPending}
        onSubmit={(values) => save.mutate({ id: editing?.id, values }, { onSuccess: () => setOpen(false) })}
      />
    </>
  );
}
