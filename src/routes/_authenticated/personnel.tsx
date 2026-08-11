import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useRows } from "@/lib/data";
import { roleLabel, formatDateTime } from "@/lib/format";
import { useAdminProfile } from "@/hooks/use-auth";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/personnel")({
  head: () => ({
    meta: [
      { title: "Personnel administratif – Les Élites de Gao" },
      { name: "description", content: "Comptes administratifs du complexe Les Élites de Gao, rôles et établissements rattachés." },
      { property: "og:title", content: "Personnel administratif – Les Élites de Gao" },
      { property: "og:description", content: "Consultez les comptes du personnel et leurs droits d'accès." },
    ],
  }),
  component: Page,
});

function Page() {
  const { isDG } = useAdminProfile();
  const { data: establishments = [] } = useRows<Tables<"establishments">>("establishments");
  const { data = [], isLoading } = useRows<Tables<"admin_profiles">>("admin_profiles", { order: { column: "last_name" } });

  const columns: Column<Tables<"admin_profiles">>[] = [
    {
      key: "name",
      header: "Membre",
      cell: (r) => (
        <div>
          <p className="font-medium">
            {r.last_name} {r.first_name}
          </p>
          <p className="text-xs text-muted-foreground">{r.phone ?? "—"}</p>
        </div>
      ),
    },
    { key: "role", header: "Rôle", cell: (r) => <Badge variant={r.role === "director_general" ? "default" : "secondary"}>{roleLabel(r.role)}</Badge> },
    { key: "est", header: "Établissement", cell: (r) => establishments.find((e) => e.id === r.establishment_id)?.name ?? "Tout le complexe" },
    { key: "active", header: "Statut", cell: (r) => (r.is_active ? "Actif" : "Désactivé") },
    { key: "created", header: "Créé le", cell: (r) => formatDateTime(r.created_at) },
  ];

  return (
    <>
      <PageHeader title="Personnel administratif" description="Comptes ayant accès à l'administration du complexe." />
      {!isDG && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Seul le Directeur Général peut modifier les rôles et les rattachements du personnel.
          </CardContent>
        </Card>
      )}
      <DataTable columns={columns} rows={data} loading={isLoading} emptyLabel="Aucun compte." />
      <p className="text-xs text-muted-foreground">
        Un nouveau membre crée son compte depuis la page de connexion ; il reçoit le rôle « Personnel » par défaut.
      </p>
    </>
  );
}
