import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useRows } from "@/lib/data";
import { useAdminProfile } from "@/hooks/use-auth";
import { roleLabel, initials } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/mon-compte")({
  head: () => ({
    meta: [
      { title: "Mon compte – Les Élites de Gao" },
      { name: "description", content: "Gérez vos informations personnelles, votre mot de passe et votre session sur l'administration Les Élites de Gao." },
      { property: "og:title", content: "Mon compte – Les Élites de Gao" },
      { property: "og:description", content: "Informations personnelles et sécurité du compte administrateur." },
    ],
  }),
  component: Page,
});

function Page() {
  const { profile, user } = useAdminProfile();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: establishments = [] } = useRows<Tables<"establishments">>("establishments");
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", avatar_url: "" });
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (profile)
      setForm({
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone: profile.phone ?? "",
        avatar_url: profile.avatar_url ?? "",
      });
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("admin_profiles")
        .update({
          first_name: form.first_name,
          last_name: form.last_name,
          phone: form.phone || null,
          avatar_url: form.avatar_url || null,
        })
        .eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin_profile"] });
      toast.success("Informations mises à jour");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    onSuccess: () => { setPassword(""); toast.success("Mot de passe modifié"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <>
      <PageHeader title="Mon compte" description="Vos informations, votre sécurité et votre session." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informations personnelles</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2 pt-1">
              <Badge variant={profile?.role === "director_general" ? "default" : "secondary"}>{roleLabel(profile?.role)}</Badge>
              <span>{establishments.find((e) => e.id === profile?.establishment_id)?.name ?? "Tout le complexe"}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 border-2 border-accent">
                {form.avatar_url && <AvatarImage src={form.avatar_url} alt="Photo de profil" />}
                <AvatarFallback className="bg-primary/10 text-base font-semibold text-primary">
                  {initials(form.first_name, form.last_name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <Label htmlFor="avatar_url">Photo de profil (URL)</Label>
                <Input
                  id="avatar_url"
                  placeholder="https://…"
                  className="mt-1.5"
                  value={form.avatar_url}
                  onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="first_name">Prénom</Label>
                <Input id="first_name" className="mt-1.5" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="last_name">Nom</Label>
                <Input id="last_name" className="mt-1.5" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="phone">Téléphone</Label>
              <Input id="phone" className="mt-1.5" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="email">Adresse e-mail</Label>
              <Input id="email" className="mt-1.5" value={user?.email ?? ""} readOnly disabled />
            </div>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Enregistrer</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sécurité</CardTitle>
            <CardDescription>Modifiez votre mot de passe, notamment après la première connexion.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="new_password">Nouveau mot de passe</Label>
              <Input id="new_password" type="password" autoComplete="new-password" minLength={8} className="mt-1.5" value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">8 caractères minimum.</p>
            </div>
            <Button onClick={() => changePassword.mutate()} disabled={password.length < 8 || changePassword.isPending}>
              Modifier le mot de passe
            </Button>
            <div className="border-t border-border pt-4">
              <Button variant="outline" onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4" /> Se déconnecter
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}