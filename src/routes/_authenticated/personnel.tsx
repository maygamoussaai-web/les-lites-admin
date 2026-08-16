import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, UserPlus, RefreshCw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog } from "@/components/app/record-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useRows } from "@/lib/data";
import { createInvitation, renewInvitation, revokeInvitation } from "@/lib/admin.functions";
import { roleLabel, formatDateTime, initials } from "@/lib/format";
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
  const { isDG } = useAdminProfile();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [lastLink, setLastLink] = useState<string | null>(null);
  const invitationFn = useServerFn(createInvitation);
  const renewFn = useServerFn(renewInvitation);
  const revokeFn = useServerFn(revokeInvitation);

  const { data: establishments = [] } = useRows<Tables<"establishments">>("establishments", { order: { column: "name" } });
  const { data = [], isLoading } = useRows<Tables<"admin_profiles">>("admin_profiles", { order: { column: "last_name" } });
  const { data: invitations = [] } = useRows<Tables<"invitations">>("invitations", {
    order: { column: "created_at", ascending: false },
    enabled: isDG,
  });

  const invite = useMutation({
    mutationFn: async (values: Record<string, any>) => {
      const days = Number(values['days'] ?? 7) || 7;
      const res = await invitationFn({ data: { establishment_id: values['establishment_id'] as string, days } });
      return { id: res.id, url: `${window.location.origin}/activation?token=${res.token}` };
    },
    onSuccess: ({ id, url }) => {
      setLinks((l) => ({ ...l, [id]: url }));
      setLastLink(url);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["invitations"] });
      toast.success("Invitation générée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renew = useMutation({
    mutationFn: async (id: string) => {
      const res = await renewFn({ data: { id, days: 7 } });
      return { id, url: `${window.location.origin}/activation?token=${res.token}` };
    },
    onSuccess: ({ id, url }) => {
      setLinks((l) => ({ ...l, [id]: url }));
      setLastLink(url);
      qc.invalidateQueries({ queryKey: ["invitations"] });
      void navigator.clipboard.writeText(url).catch(() => undefined);
      toast.success("Nouveau lien généré et copié");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      await revokeFn({ data: { id } });
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invitations"] });
      toast.success("Invitation révoquée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = (url: string) => {
    void navigator.clipboard.writeText(url).catch(() => undefined);
    toast.success("Lien copié");
  };

  const columns: Column<Tables<"admin_profiles">>[] = [
    {
      key: "name",
      header: "Membre",
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="h-8 w-8 border border-border">
            {r.avatar_url && <AvatarImage src={r.avatar_url} alt="" />}
            <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
              {initials(r.first_name, r.last_name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">{r.last_name} {r.first_name}</p>
            <p className="text-xs text-muted-foreground">{r.phone ?? "—"}</p>
          </div>
        </div>
      ),
    },
    { key: "role", header: "Rôle", cell: (r) => <Badge variant={r.role === "director_general" ? "default" : "secondary"}>{roleLabel(r.role)}</Badge> },
    { key: "est", header: "Établissement", cell: (r) => establishments.find((e) => e.id === r.establishment_id)?.name ?? "Tout le complexe" },
    { key: "active", header: "Accès", cell: (r) => <span className="text-sm">{r.is_active ? "Actif" : "Désactivé"}</span> },
    { key: "created", header: "Créé le", cell: (r) => formatDateTime(r.created_at) },
  ];

  const pending = invitations.filter((i) => !i.accepted_at && new Date(i.expires_at) > new Date());

  return (
    <>
      <PageHeader
        title="Personnel administratif"
        description="Les comptes sont créés uniquement sur invitation du Directeur Général. Cliquez sur un membre pour voir sa fiche."
        actions={isDG ? <Button onClick={() => setOpen(true)}><UserPlus className="mr-2 h-4 w-4" />Inviter</Button> : undefined}
      />

      {lastLink && (
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lien d'invitation</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs">{lastLink}</code>
            <Button variant="outline" size="sm" onClick={() => copy(lastLink)}>
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
                <div key={i.id} className="space-y-2 rounded-md border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{establishments.find((e) => e.id === i.establishment_id)?.name ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">Expire le {formatDateTime(i.expires_at)}</span>
                  </div>
                  {links[i.id] ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-1.5 text-xs">{links[i.id]}</code>
                      <Button size="sm" variant="outline" onClick={() => copy(links[i.id]!)}>
                        <Copy className="mr-2 h-4 w-4" /> Copier
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Le lien n'est affiché qu'une seule fois. Générez-en un nouveau pour le transmettre.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={renew.isPending} onClick={() => renew.mutate(i.id)}>
                      <RefreshCw className="mr-2 h-4 w-4" /> Nouveau lien
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={revoke.isPending} onClick={() => revoke.mutate(i.id)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Révoquer
                    </Button>
                  </div>
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