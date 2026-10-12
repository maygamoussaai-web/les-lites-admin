import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Bot, User } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAdminProfile } from "@/hooks/use-auth";
import { useRows } from "@/lib/data";
import {
  auditActionLabel,
  auditEntityLabel,
  auditLogSummary,
  auditLogTitle,
  formatDateTime,
} from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/historique/$logId")({
  head: () => ({
    meta: [{ title: "Détail action – Les Élites de Gao" }],
  }),
  component: DetailPage,
});

function DetailPage() {
  const { logId } = Route.useParams();
  const { isDG } = useAdminProfile();
  const { data: establishments = [] } = useRows<Tables<"establishments">>("establishments", {
    order: { column: "name" },
  });
  const { data: admins = [] } = useRows<Tables<"admin_profiles">>("admin_profiles");

  const { data: log, isLoading, error } = useQuery({
    queryKey: ["audit_log", logId],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("id", logId)
        .maybeSingle();
      if (err) throw err;
      return data as Tables<"audit_logs"> | null;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Journal" title="Chargement…" description="" />
        <div className="h-40 animate-pulse rounded-xl bg-muted/40" />
      </div>
    );
  }

  if (error || !log) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Journal" title="Action introuvable" description="" />
        <Button asChild variant="outline">
          <Link to="/historique">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour à l'historique
          </Link>
        </Button>
      </div>
    );
  }

  const meta = (log.metadata ?? {}) as Record<string, unknown>;
  const viaAi = !!meta.via_ai;
  const tool = (meta.tool ?? meta.tool_name) as string | undefined;
  const actor = admins.find((a) => a.id === log.actor_id);
  const est = establishments.find((e) => e.id === log.establishment_id);

  // Résoudre l'entité liée si possible
  const entityLinks: { label: string; to: string; params?: Record<string, string> }[] = [];
  if (log.entity_type === "students" && log.entity_id) {
    entityLinks.push({ label: "Fiche élève", to: "/eleves/$studentId", params: { studentId: log.entity_id } });
  } else if (log.entity_type === "teachers" && log.entity_id) {
    entityLinks.push({ label: "Fiche enseignant", to: "/enseignants/$teacherId", params: { teacherId: log.entity_id } });
  } else if (log.entity_type === "classes" && log.entity_id) {
    entityLinks.push({ label: "Fiche classe", to: "/classes/$classId", params: { classId: log.entity_id } });
  } else if (log.entity_type === "establishments" && log.entity_id) {
    entityLinks.push({ label: "Établissement", to: "/etablissements/$id", params: { id: log.entity_id } });
  }

  const metaEntries = Object.entries(meta).filter(([k]) => !["via_ai"].includes(k));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link to="/historique">
            <ArrowLeft className="h-4 w-4" />
            Historique
          </Link>
        </Button>
      </div>

      <PageHeader
        eyebrow={viaAi ? "Action Assistant IA" : "Action manuelle"}
        title={auditLogTitle(log)}
        description={formatDateTime(log.created_at)}
      />

      <div className="grid gap-4 rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{auditActionLabel(log.action)}</Badge>
          <Badge variant="outline">{auditEntityLabel(log.entity_type)}</Badge>
          {viaAi && (
            <Badge className="bg-primary/15 text-primary hover:bg-primary/20">
              <Bot className="mr-1 h-3 w-3" />
              Assistant IA
            </Badge>
          )}
          {!viaAi && (
            <Badge variant="outline">
              <User className="mr-1 h-3 w-3" />
              Manuel
            </Badge>
          )}
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Auteur</dt>
            <dd className="font-medium">
              {actor ? `${actor.last_name} ${actor.first_name}` : "Direction générale"}
            </dd>
          </div>
          {isDG && est && (
            <div>
              <dt className="text-xs text-muted-foreground">Établissement</dt>
              <dd className="font-medium">{est.name}</dd>
            </div>
          )}
          {tool && (
            <div>
              <dt className="text-xs text-muted-foreground">Outil IA</dt>
              <dd className="font-mono text-sm font-medium">{tool}</dd>
            </div>
          )}
          {log.entity_id && (
            <div>
              <dt className="text-xs text-muted-foreground">Identifiant entité</dt>
              <dd className="break-all font-mono text-xs">{log.entity_id}</dd>
            </div>
          )}
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Résumé</dt>
            <dd className="font-medium">{auditLogSummary(log)}</dd>
          </div>
        </dl>

        {metaEntries.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Détails techniques
            </p>
            <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/30">
              <table className="w-full text-left text-xs">
                <tbody>
                  {metaEntries.map(([k, v]) => (
                    <tr key={k} className="border-b border-border/40 last:border-0">
                      <th className="w-1/3 px-3 py-2 font-medium text-muted-foreground">{k}</th>
                      <td className="px-3 py-2 font-mono break-all">
                        {typeof v === "object" ? JSON.stringify(v) : String(v ?? "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {entityLinks.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {entityLinks.map((l) => (
              <Button key={l.to} asChild variant="outline" size="sm">
                <Link to={l.to as never} params={l.params as never}>
                  {l.label}
                </Link>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
