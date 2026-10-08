import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Share2, UserPlus, Link2, Clock, Building2, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog } from "@/components/app/record-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const TOKEN_STORE_KEY = "eg-invite-tokens";

function loadTokenMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(TOKEN_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveToken(invitationId: string, token: string) {
  if (typeof window === "undefined") return;
  const map = loadTokenMap();
  map[invitationId] = token;
  try {
    localStorage.setItem(TOKEN_STORE_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

function removeStoredToken(invitationId: string) {
  if (typeof window === "undefined") return;
  const map = loadTokenMap();
  delete map[invitationId];
  try {
    localStorage.setItem(TOKEN_STORE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function inviteUrlFromToken(token: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/invitation/${token}`;
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
  toast.success("Lien copié dans le presse-papiers");
}

async function shareInvite(url: string, establishmentName: string) {
  const title = "Invitation – Les Élites de Gao";
  const text = `Vous êtes invité(e) à rejoindre l'administration de ${establishmentName || "notre établissement"}. Activez votre compte via ce lien :`;
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }
  await copyText(url);
}

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
  const [tokenMapVersion, setTokenMapVersion] = useState(0);
  const tokenMap = useMemo(() => {
    void tokenMapVersion;
    return loadTokenMap();
  }, [tokenMapVersion, invitations]);

  /** Liens encore utilisables : non acceptés et non expirés. */
  const pending = useMemo(
    () =>
      invitations.filter((i) => !i.accepted_at && new Date(i.expires_at).getTime() > Date.now()),
    [invitations],
  );

  const invite = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const establishmentId = String(values["establishment_id"] ?? "");
      if (!establishmentId) throw new Error("Établissement requis");
      const token = generateInvitationToken();
      const tokenHash = await sha256Hex(token);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("invitations")
        .insert({
          establishment_id: establishmentId,
          token_hash: tokenHash,
          expires_at: expiresAt,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (data?.id) saveToken(data.id, token);
      return { id: data.id as string, url: inviteUrlFromToken(token) };
    },
    onSuccess: () => {
      setTokenMapVersion((v) => v + 1);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["invitations"] });
      toast.success("Invitation créée — le lien est visible ci-dessous jusqu'à utilisation.");
    },
    onError: (e: Error) => toast.error(describeError(e, "Opération impossible")),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invitations").delete().eq("id", id);
      if (error) throw error;
      removeStoredToken(id);
    },
    onSuccess: () => {
      setTokenMapVersion((v) => v + 1);
      qc.invalidateQueries({ queryKey: ["invitations"] });
      toast.success("Invitation révoquée");
    },
    onError: (e: Error) => toast.error(describeError(e, "Révocation impossible")),
  });

  const regenerate = useMutation({
    mutationFn: async (invitation: Tables<"invitations">) => {
      const token = generateInvitationToken();
      const tokenHash = await sha256Hex(token);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from("invitations")
        .update({ token_hash: tokenHash, expires_at: expiresAt, accepted_at: null })
        .eq("id", invitation.id);
      if (error) throw error;
      saveToken(invitation.id, token);
      return inviteUrlFromToken(token);
    },
    onSuccess: async (url) => {
      setTokenMapVersion((v) => v + 1);
      qc.invalidateQueries({ queryKey: ["invitations"] });
      await copyText(url);
      toast.success("Nouveau lien généré et copié");
    },
    onError: (e: Error) => toast.error(describeError(e, "Régénération impossible")),
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

  return (
    <>
      <PageHeader
        title="Personnel administratif"
        description="Gérez les comptes de l'équipe. Les accès se créent uniquement par invitation du Directeur Général — un lien unique, valable jusqu'à son utilisation."
        actions={
          isDG ? (
            <Button onClick={() => setOpen(true)} className="press">
              <UserPlus className="mr-2 h-4 w-4" />
              Inviter un membre
            </Button>
          ) : undefined
        }
      />

      {isDG && (
        <Card className="mb-6 overflow-hidden border-border/80 shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/30 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="font-display text-lg flex items-center gap-2">
                  <Link2 className="h-5 w-5 text-primary" />
                  Invitations en attente
                </CardTitle>
                <CardDescription className="mt-1.5 max-w-2xl text-sm leading-relaxed">
                  Chaque lien reste visible tant qu'il n'a pas été utilisé. Dès que le collègue active
                  son compte, l'invitation disparaît automatiquement de cette liste. Vous pouvez
                  copier le lien ou le partager directement via les applications de votre téléphone.
                </CardDescription>
              </div>
              <Badge variant="secondary" className="tabular-nums">
                {pending.length} en cours
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {pending.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <UserPlus className="h-5 w-5 text-primary" />
                </div>
                <p className="text-sm font-medium text-foreground">Aucune invitation en attente</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cliquez sur « Inviter un membre » pour générer un lien d'activation sécurisé.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {pending.map((inv) => {
                  const est = establishments.find((e) => e.id === inv.establishment_id);
                  const token = tokenMap[inv.id];
                  const url = token ? inviteUrlFromToken(token) : null;
                  const estName = est?.name ?? "Établissement";
                  return (
                    <li
                      key={inv.id}
                      className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {estName}
                          </span>
                          <Badge variant="outline" className="text-[10px] font-normal">
                            Non utilisé
                          </Badge>
                        </div>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          Expire le {formatDateTime(inv.expires_at)}
                        </p>
                        {url ? (
                          <code className="mt-1 block max-w-full truncate rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">
                            {url}
                          </code>
                        ) : (
                          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                            Lien non disponible sur cet appareil — régénérez-le pour l'afficher.
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        {url ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="press h-9"
                              onClick={() => void copyText(url)}
                              aria-label="Copier le lien"
                            >
                              <Copy className="mr-1.5 h-3.5 w-3.5" />
                              Copier
                            </Button>
                            <Button
                              size="sm"
                              variant="default"
                              className="press h-9"
                              onClick={() => void shareInvite(url, estName)}
                              aria-label="Partager le lien"
                            >
                              <Share2 className="mr-1.5 h-3.5 w-3.5" />
                              Partager
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="press h-9"
                            disabled={regenerate.isPending}
                            onClick={() => regenerate.mutate(inv)}
                          >
                            <Link2 className="mr-1.5 h-3.5 w-3.5" />
                            Régénérer le lien
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9 text-muted-foreground hover:text-destructive"
                          disabled={revoke.isPending}
                          onClick={() => {
                            if (confirm("Révoquer cette invitation ? Le lien ne fonctionnera plus.")) {
                              revoke.mutate(inv.id);
                            }
                          }}
                          aria-label="Révoquer l'invitation"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden border-border/80 shadow-sm">
        <CardHeader className="border-b border-border/60 pb-3">
          <CardTitle className="font-display text-base">Équipe administrative</CardTitle>
          <CardDescription className="text-xs">
            Cliquez sur un membre pour ouvrir sa fiche (rôle, établissements, accès).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            rows={profiles}
            loading={profilesQ.isPending}
            onRowClick={(r) => navigate({ to: "/personnel/$id", params: { id: r.id } })}
            emptyLabel="Aucun membre pour le moment. Invitez la première personne de l'équipe."
          />
        </CardContent>
      </Card>

      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title="Inviter un membre de l'équipe"
        description="Choisissez l'établissement d'affectation. Un lien sécurisé sera généré : votre collègue l'utilisera pour créer son compte. Le lien reste visible ici jusqu'à son activation."
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
