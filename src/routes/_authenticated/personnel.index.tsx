import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog } from "@/components/app/record-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useRows } from "@/lib/data";
import { generateInvitationToken, sha256Hex } from "@/lib/invitations";
import { roleLabel, formatDateTime, initials } from "@/lib/format";
import { useAdminProfile } from "@/hooks/use-auth";
import type { Tables } from "@/integrations/supabase/types";
import { describeError } from "@/lib/errors";

export const Route = createFileRoute("/_authenticated/personnel/")({
  head: () => ({
    meta: [
      { title: "Personnel – Les Élites de Gao" },
      { name: "description", content: "Comptes administratifs et invitations." },
    ],
  }),
  component: Page,
});

function Page() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isDG } = useAdminProfile();
  const profilesQ = useRows<Tables<"admin_profiles">>("admin_profiles", {
    order: { column: "last_name" },
  });
  const membershipsQ = useRows<Tables<"admin_profile_establishments">>("admin_profile_establishments");
  const establishmentsQ = useRows<Tables<"establishments">>("establishments", {
    order: { column: "name" },
  });
  const invitationsQ = useRows<Tables<"invitations">>("invitations", {
    order: { column: "created_at", ascending: false },
  });

  const profiles = profilesQ.data ?? [];
  const establishments = establishmentsQ.data ?? [];
  const invitations = invitationsQ.data ?? [];
  const membershipsByProfile = new Map<string, string[]>();
  for (const m of membershipsQ.data ?? []) {
    const list = membershipsByProfile.get(m.profile_id) ?? [];
    list.push(m.establishment_id);
    membershipsByProfile.set(m.profile_id, list);
  }

  const [open, setOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const establishmentId = String(values["establishment_id"] ?? "");
      if (!establishmentId) throw new Error("Établissement requis");
      const token = generateInvitationToken();
      const tokenHash = await sha256Hex(token);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase.from("invitations").insert({
        establishment_id: establishmentId,
        token_hash: tokenHash,
        expires_at: expiresAt,
      });
      if (error) throw error;
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      return `${origin}/invitation/${token}`;
    },
    onSuccess: (url) => {
      setInviteUrl(url);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["invitations"] });
      toast.success("Invitation générée");
    },
    onError: (e: Error) => toast.error(describeError(e, "Opération impossible")),
  });

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
            <p className="font-medium text-foreground">
              {r.last_name} {r.first_name}
            </p>
            <p className="text-xs text-muted-foreground">{r.phone ?? "—"}</p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Rôle",
      cell: (r) => (
        <Badge variant={r.role === "director_general" ? "default" : "secondary"}>
          {roleLabel(r.role)}
        </Badge>
      ),
    },
    {
      key: "est",
      header: "Établissement(s)",
      cell: (r) => {
        if (r.role === "director_general") return "Tout le complexe";
        const ids = membershipsByProfile.get(r.id) ?? [];
        const names = ids
          .map((eid) => establishments.find((e) => e.id === eid)?.name)
          .filter(Boolean) as string[];
        if (names.length === 0) return "Aucun";
        if (names.length === 1) return names[0];
        return `${names[0]} +${names.length - 1}`;
      },
    },
    {
      key: "active",
      header: "Accès",
      cell: (r) => <span className="text-sm">{r.is_active ? "Actif" : "Désactivé"}</span>,
    },
    {
      key: "created",
      header: "Créé le",
      cell: (r) => formatDateTime(r.created_at),
    },
  ];

  const pending = invitations.filter((i) => !i.accepted_at && new Date(i.expires_at) > new Date());

  return (
    <>
      <PageHeader
        title="Personnel administratif"
        description="Les comptes sont créés uniquement sur invitation du Directeur Général. Cliquez sur un membre pour voir sa fiche."
        actions={
          isDG ? (
            <Button onClick={() => setOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Inviter
            </Button>
          ) : undefined
        }
      />

      {inviteUrl && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lien d'invitation</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <code className="flex-1 break-all rounded-md bg-background px-2 py-1 text-xs">{inviteUrl}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(inviteUrl);
                toast.success("Lien copié");
              }}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Copier
            </Button>
          </CardContent>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={profiles}
        loading={profilesQ.isPending}
        onRowClick={(r) => navigate({ to: "/personnel/$id", params: { id: r.id } })}
        emptyLabel="Aucun membre pour le moment."
      />

      {isDG && pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invitations en attente ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {pending.map((i) => {
              const est = establishments.find((e) => e.id === i.establishment_id);
              return (
                <div key={i.id} className="flex justify-between border-b border-border/50 pb-1.5 last:border-0">
                  <span>{est?.name ?? "—"}</span>
                  <span className="text-muted-foreground">Expire le {formatDateTime(i.expires_at)}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title="Inviter un membre"
        description="Le destinataire utilisera le lien pour créer son compte."
        fields={[
          {
            name: "establishment_id",
            label: "Établissement",
            type: "select",
            required: true,
            colSpan: 2,
            options: establishments.map((e) => ({ value: e.id, label: e.name })),
          },
        ]}
        submitting={invite.isPending}
        onSubmit={(values) => invite.mutate(values)}
      />
    </>
  );
}
