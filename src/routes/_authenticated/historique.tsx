import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { History } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRows } from "@/lib/data";
import { useAdminProfile } from "@/hooks/use-auth";
import { auditActionLabel, auditEntityLabel, formatDateTime } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/historique")({
  head: () => ({
    meta: [
      { title: "Historique – Les Élites de Gao" },
      { name: "description", content: "Journal des actions réalisées sur le complexe scolaire Les Élites de Gao." },
    ],
  }),
  component: Page,
});

function Page() {
 const { isDG, establishmentIds } = useAdminProfile();
  const [establishmentFilter, setEstablishmentFilter] = useState("");

  const { data: establishments = [] } = useRows<Tables<"establishments">>("establishments", { order: { column: "name" } });
  const { data: admins = [] } = useRows<Tables<"admin_profiles">>("admin_profiles");

  const { data: logs = [], isLoading } = useRows<Tables<"audit_logs">>("audit_logs", {
    order: { column: "created_at", ascending: false },
    limit: 300,
    eq: isDG && establishmentFilter ? { establishment_id: establishmentFilter } : undefined,
    enabled: isDG || establishmentIds.length > 0,
  });

  const adminsById = new Map(admins.map((a) => [a.id, a]));

  return (
    <>
      <PageHeader
        eyebrow="Journal"
        title="Historique"
        description={
          isDG
            ? "Toutes les actions réalisées sur le complexe, par tout le personnel."
            : "Les actions réalisées sur votre établissement."
        }
        actions={
          isDG ? (
            <Select value={establishmentFilter || "all"} onValueChange={(v) => setEstablishmentFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Tous les établissements" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les établissements</SelectItem>
                {establishments.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      />

      {!isLoading && logs.length === 0 ? (
        <EmptyState icon={History} title="Aucune action enregistrée" description="Les actions apparaîtront ici au fur et à mesure." />
      ) : (
        <ol className="space-y-2.5">
          {logs.map((log, index) => {
            const actor = adminsById.get(log.actor_id ?? "");
            const est = establishments.find((e) => e.id === log.establishment_id);
            return (
              <li
                key={log.id}
                className="animate-rise flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card px-4 py-3 text-sm shadow-sm"
                style={{ animationDelay: `${Math.min(index, 15) * 30}ms` }}
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {auditActionLabel(log.action)} · {auditEntityLabel(log.entity_type)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {actor ? `${actor.last_name} ${actor.first_name}` : "Direction générale"}
                    {isDG && est ? ` · ${est.name}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 text-xs font-normal text-muted-foreground">
                  {formatDateTime(log.created_at)}
                </Badge>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}