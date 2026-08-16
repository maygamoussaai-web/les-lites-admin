import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Trash2, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRows } from "@/lib/data";
import { deleteStaffAccount } from "@/lib/admin.functions";
import { useAdminProfile } from "@/hooks/use-auth";
import { roleLabel, formatDateTime, initials, auditActionLabel, auditEntityLabel } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/personnel/$id")({
  head: () => ({
    meta: [
      { title: "Fiche personnel – Les Élites de Gao" },
      { name: "description", content: "Détails d'un compte de personnel administratif et journal de ses actions." },
    ],
  }),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isDG } = useAdminProfile();
  const removeAccount = useServerFn(deleteStaffAccount);

  const { data: establishments = [] } = useRows<Tables<"establishments">>("establishments");
  const { data: profiles = [], isLoading } = useRows<Tables<"admin_profiles">>("admin_profiles", { eq: { id } });
  const profile = profiles[0];

  const { data: logs = [], isLoading: logsLoading } = useRows<Tables<"audit_logs">>("audit_logs", {
    eq: { actor_id: id },
    order: { column: "created_at", ascending: false },
    limit: 100,
  });

  const remove = useMutation({
    mutationFn: async () => {
      await removeAccount({ data: { profile_id: id } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin_profiles"] });
      toast.success("Compte supprimé");
      navigate({ to: "/personnel" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isDG) {
    return <EmptyState icon={ShieldAlert} title="Accès refusé" description="Seul le Directeur Général peut consulter cette page." />;
  }

  if (!isLoading && !profile) {
    return <EmptyState icon={ShieldAlert} title="Compte introuvable" description="Ce membre du personnel n'existe pas ou a été supprimé." />;
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={() => navigate({ to: "/personnel" })}>
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour au personnel
      </Button>

      <PageHeader
        title={profile ? `${profile.last_name} ${profile.first_name}` : "Chargement…"}
        description="Informations du compte et journal de ses actions récentes."
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit">
          <CardHeader className="items-center text-center">
            <Avatar className="h-20 w-20 border-2 border-accent">
              {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt="" />}
              <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
                {initials(profile?.first_name, profile?.last_name)}
              </AvatarFallback>
            </Avatar>
            <CardTitle className="mt-2 text-lg">{profile?.last_name} {profile?.first_name}</CardTitle>
            <Badge variant={profile?.role === "director_general" ? "default" : "secondary"}>{roleLabel(profile?.role)}</Badge>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Établissement</span>
              <span className="font-medium">{establishments.find((e) => e.id === profile?.establishment_id)?.name ?? "Tout le complexe"}</span>
            </div>
            <div className="flex justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Téléphone</span>
              <span className="font-medium">{profile?.phone ?? "—"}</span>
            </div>
            <div className="flex justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Statut</span>
              <span className="font-medium">{profile?.is_active ? "Actif" : "Désactivé"}</span>
            </div>
            <div className="flex justify-between pb-2">
              <span className="text-muted-foreground">Créé le</span>
              <span className="font-medium">{formatDateTime(profile?.created_at)}</span>
            </div>

            {profile?.role !== "director_general" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full">
                    <Trash2 className="mr-2 h-4 w-4" /> Supprimer ce compte
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Supprimer ce compte ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {profile?.first_name} {profile?.last_name} ne pourra plus se connecter et disparaîtra de la liste
                      de connexion du personnel. Cette action est définitive.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction onClick={() => remove.mutate()}>Supprimer</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Journal d'actions</CardTitle>
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : logs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune action enregistrée pour ce compte.</p>
            ) : (
              <ol className="space-y-3">
                {logs.map((log, index) => (
                  <li
                    key={log.id}
                    className="animate-rise flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-sm"
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {auditActionLabel(log.action)} · {auditEntityLabel(log.entity_type)}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(log.created_at)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}