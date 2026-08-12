import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog } from "@/components/app/record-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useRows } from "@/lib/data";
import { generateInvitationToken, sha256Hex } from "@/lib/invitations";
import { roleLabel, formatDateTime } from "@/lib/format";
import { useAdminProfile } from "@/hooks/use-auth";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/personnel")({
  head: () => ({
    meta: [
      { title: "Personnel administratif – Les Élites de Gao" },
      { name: "description", content: "Comptes administratifs du complexe Les Élites de Gao, invitations, rôles et établissements rattachés." },
      { property: "og:title", content: "Personnel administratif – Les Élites de Gao" },
      { property: "og:description", content: "Invitez et gérez les accès du personnel administratif." },
    ],
  }),
  component: Page,
});

function Page() {
  const { isDG, user } = useAdminProfile();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const { data: establishments = [] } = useRows<Tables<"establishments">>("establishments", { order: { column: "name" } });
  const { data = [], isLoading } = useRows<Tables<"admin_profiles">>("admin_profiles", { order: { column: "last_name" } });
  const { data: invitations = [] } = useRows<Tables<"invitations">>("invitations", {
    order: { column: "created_at", ascending: false },
    enabled: isDG,
  });

  const invite = useMutation({
    mutationFn: async (values: Record<string, any>) => {
      const token = generateInvitationToken();
      const token_hash = await sha256Hex(token);
      const days = Number(values['days'] ?? 7) || 7;
      const { error } = await supabase.from("invitations").insert({
        token_hash,
        establishment_id: values['establishment_id'],
        invited_by: user?.id ?? null,
        expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      });
      if (error) throw error;
      await supabase.from("audit_logs").insert({
        actor_id: user?.id ?? null,
        action: "invitation_created",
        entity_type: "invitations",
        establishment_id: values['establishment_id'],
        metadata: {},
      });
      return `${window.location.origin}/invitation/${token}`;
    },
    onSuccess: (url) => {
      setLink(url);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["invitations"] });
      toast.success("Invitation générée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("admin_profiles").update({ is_active }).eq("id", id);
      if (error) throw error;
      await supabase.from("audit_logs").insert({
        actor_id: user?.id ?? null,
        action: is_active ? "admin_activated" : "admin_deactivated",
        entity_type: "admin_profiles",
        entity_id: id,
        metadata: {},
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin_profiles"] });
      toast.success("Accès mis à jour");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: Column<Tables<"admin_profiles">>[] = [
    {
      key: "name",
      header: "Membre",
      cell: (r) => (
        <div>
          <p className="font-medium">{r.last_name} {r.first_name}</p>
          <p className="text-xs text-muted-foreground">{r.phone ?? "—"}</p>
        </div>
      ),
    },
    { key: "role", header: "Rôle", cell: (r) => <Badge variant={r.role === "director_general" ? "default" : "secondary"}>{roleLabel(r.role)}</Badge> },
    { key: "est", header: "Établissement", cell: (r) => establishments.find((e) => e.id === r.establishment_id)?.name ?? "Tout le complexe" },
    {
      key: "active",
      header: "Accès",
      cell: (r) =>
        isDG && r.role !== "director_general" ? (
          <Switch
            checked={!!r.is_active}
            aria-label={`Activer l'accès de ${r.first_name} ${r.last_name}`}
            onCheckedChange={(v) => toggleActive.mutate({ id: r.id, is_active: v })}
          />
        ) : (
          <span className="text-sm">{r.is_active ? "Actif" : "Désactivé"}</span>
        ),
    },
    { key: "created", header: "Créé le", cell: (r) => formatDateTime(r.created_at) },
  ];

  const pending = invitations.filter((i) => !i.accepted_at && new Date(i.expires_at) > new Date());

  return (
    <>
      <PageHeader
        title="Personnel administratif"
        description="Les comptes sont créés uniquement sur invitation du Directeur Général."
        actions={isDG ? <Button onClick={() => setOpen(true)}><UserPlus className="mr-2 h-4 w-4" />Inviter</Button> : undefined}
      />

      {link && (
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lien d'invitation</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs">{link}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { navigator.clipboard.writeText(link); toast.success("Lien copié"); }}
            >
              <Copy className="mr-2 h-4 w-4" /> Copier
            </Button>
          </CardContent>
        </Card>
      )}

      <DataTable columns={columns} rows={data} loading={isLoading} emptyLabel="Aucun compte." />

      {isDG && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Invitations en attente ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {pending.length === 0 ? (
              <p className="text-muted-foreground">Aucune invitation en attente.</p>
            ) : (
              pending.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                  <span>{establishments.find((e) => e.id === i.establishment_id)?.name ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">Expire le {formatDateTime(i.expires_at)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title="Inviter un membre du personnel"
        description="Le lien généré permet d'activer un compte rattaché à un seul établissement."
        submitting={invite.isPending}
        onSubmit={(v) => invite.mutate(v)}
        fields={[
          {
            name: "establishment_id",
            label: "Établissement",
            type: "select",
            required: true,
            colSpan: 2,
            options: establishments.map((e) => ({ value: e.id, label: e.name })),
          },
          { name: "days", label: "Validité (jours)", type: "number", defaultValue: 7, colSpan: 2 },
        ]}
      />
    </>
  );
}
