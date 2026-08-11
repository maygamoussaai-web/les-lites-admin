import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { Badge } from "@/components/ui/badge";
import { useRows } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({
    meta: [
      { title: "Journal d'audit – Les Élites de Gao" },
      { name: "description", content: "Traçabilité des opérations administratives réalisées dans l'application Les Élites de Gao." },
      { property: "og:title", content: "Journal d'audit – Les Élites de Gao" },
      { property: "og:description", content: "Historique horodaté des créations, modifications et suppressions." },
    ],
  }),
  component: Page,
});

type Row = Tables<"audit_logs">;

const actionLabels: Record<string, string> = {
  create: "Création",
  update: "Modification",
  delete: "Suppression",
};

function Page() {
  const { data = [], isLoading } = useRows<Row>("audit_logs", {
    order: { column: "created_at", ascending: false },
    limit: 200,
  });

  const columns: Column<Row>[] = [
    { key: "date", header: "Date", cell: (r) => formatDateTime(r.created_at) },
    {
      key: "action",
      header: "Action",
      cell: (r) => (
        <Badge variant={r.action === "delete" ? "destructive" : "secondary"}>
          {actionLabels[r.action] ?? r.action}
        </Badge>
      ),
    },
    { key: "entity", header: "Objet", cell: (r) => <span className="font-medium">{r.entity_type}</span> },
    { key: "id", header: "Référence", cell: (r) => <span className="text-xs text-muted-foreground">{r.entity_id ?? "—"}</span> },
  ];

  return (
    <>
      <PageHeader title="Journal d'audit" description="Les 200 dernières opérations enregistrées dans l'application." />
      <DataTable columns={columns} rows={data} loading={isLoading} emptyLabel="Aucune opération enregistrée." />
    </>
  );
}
