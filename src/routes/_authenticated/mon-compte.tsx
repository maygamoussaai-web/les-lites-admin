/**
 * Mon compte — profil, sécurité, session.
 * Layout type « account settings » (Stripe / Linear) : en-tête identité + sections claires.
 */
import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  LogOut, Camera, Loader2, Shield, User, Mail, Phone, Building2, KeyRound, Check,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useRows } from "@/lib/data";
import { useAdminProfile } from "@/hooks/use-auth";
import { roleLabel, initials } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";
import { describeError } from "@/lib/errors";
import { PasswordField } from "@/components/app/password-field";
import { compressImage } from "@/lib/image";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/mon-compte")({
  head: () => ({
    meta: [
      { title: "Mon compte – Les Élites de Gao" },
      {
        name: "description",
        content:
          "Gérez vos informations personnelles, votre mot de passe et votre session sur l'administration Les Élites de Gao.",
      },
      { property: "og:title", content: "Mon compte – Les Élites de Gao" },
      {
        property: "og:description",
        content: "Informations personnelles et sécurité du compte administrateur.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  const { profile, user } = useAdminProfile();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: establishments = [] } = useRows<Tables<"establishments">>("establishments");

  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", avatar_url: "" });
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [uploading, setUploading] = useState(false);

  const establishmentName =
    establishments.find((e) => e.id === profile?.establishment_id)?.name ?? "Tout le complexe";
  const fullName = [form.first_name, form.last_name].filter(Boolean).join(" ") || "—";
  const isDG = profile?.role === "director_general";

  useEffect(() => {
    if (profile) {
      setForm({
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone: profile.phone ?? "",
        avatar_url: profile.avatar_url ?? "",
      });
    }
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("admin_profiles")
        .update({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          phone: form.phone.trim() || null,
          avatar_url: form.avatar_url || null,
        })
        .eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin_profile"] });
      toast.success("Profil mis à jour");
    },
    onError: (e: Error) => toast.error(describeError(e, "Enregistrement impossible")),
  });

  const uploadAvatar = async (rawFile: File) => {
    if (!user) return;
    if (rawFile.size > 15 * 1024 * 1024) {
      toast.error("L'image dépasse 15 Mo.");
      return;
    }
    setUploading(true);
    try {
      const file = await compressImage(rawFile);
      const path = `${user.id}/avatar-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, {
        upsert: true,
        contentType: file.type,
      });
      if (uploadError) throw uploadError;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error: updateError } = await supabase
        .from("admin_profiles")
        .update({ avatar_url: pub.publicUrl })
        .eq("id", user.id);
      if (updateError) throw updateError;
      setForm((f) => ({ ...f, avatar_url: pub.publicUrl }));
      qc.invalidateQueries({ queryKey: ["admin_profile"] });
      toast.success("Photo de profil mise à jour");
    } catch (e) {
      const msg = (e as Error).message || "";
      toast.error(
        msg.includes("Failed to fetch")
          ? "Connexion trop lente ou interrompue. Réessayez."
          : msg || "Envoi de la photo impossible",
      );
    }
    setUploading(false);
  };

  const changePassword = useMutation({
    mutationFn: async () => {
      if (password.length < 8) throw new Error("8 caractères minimum.");
      if (password !== passwordConfirm) throw new Error("Les mots de passe ne correspondent pas.");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    onSuccess: () => {
      setPassword("");
      setPasswordConfirm("");
      toast.success("Mot de passe modifié");
    },
    onError: (e: Error) => toast.error(describeError(e, "Modification impossible")),
  });

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const passwordOk =
    password.length >= 8 && passwordConfirm.length >= 8 && password === passwordConfirm;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="Mon compte"
        description="Identité, sécurité et session — tout ce qui concerne votre accès."
      />

      {/* ——— En-tête identité ——— */}
      <section className="relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
        <div
          className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent"
          aria-hidden
        />
        <div className="relative flex flex-col items-center gap-5 px-6 pb-8 pt-10 sm:flex-row sm:items-end sm:px-8">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="group relative shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Changer la photo de profil"
          >
            <Avatar className="h-24 w-24 border-4 border-background shadow-md ring-1 ring-border/50">
              {form.avatar_url ? (
                <AvatarImage src={form.avatar_url} alt={fullName} className="object-cover" />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-2xl font-semibold tracking-tight text-primary">
                {initials(form.first_name, form.last_name)}
              </AvatarFallback>
            </Avatar>
            <span
              className={cn(
                "absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full",
                "bg-primary text-primary-foreground shadow-md ring-2 ring-background",
                "transition-transform group-hover:scale-105",
              )}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadAvatar(file);
                e.target.value = "";
              }}
            />
          </button>

          <div className="min-w-0 flex-1 text-center sm:pb-1 sm:text-left">
            <h2 className="truncate font-display text-2xl font-semibold tracking-tight text-foreground">
              {fullName}
            </h2>
            <p className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted-foreground sm:justify-start">
              <span className="inline-flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span className="truncate">{user?.email ?? "—"}</span>
              </span>
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <Badge
                variant={isDG ? "default" : "secondary"}
                className="rounded-md px-2.5 py-0.5 text-xs font-medium"
              >
                {roleLabel(profile?.role)}
              </Badge>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground">
                <Building2 className="h-3 w-3 shrink-0" />
                {establishmentName}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ——— Profil ——— */}
      <Card className="overflow-hidden border-border/60 shadow-sm">
        <CardHeader className="border-b border-border/50 bg-muted/20 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <User className="h-4 w-4" />
            </span>
            <div>
              <CardTitle className="text-base font-semibold">Informations personnelles</CardTitle>
              <CardDescription className="text-xs">
                Ces informations apparaissent dans l&apos;administration et les audits.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="first_name">Prénom</Label>
              <Input
                id="first_name"
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                autoComplete="given-name"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last_name">Nom</Label>
              <Input
                id="last_name"
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                autoComplete="family-name"
                className="h-10"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone" className="inline-flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              Téléphone
            </Label>
            <Input
              id="phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              autoComplete="tel"
              placeholder="+223 …"
              className="h-10"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email" className="inline-flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              Adresse e-mail
            </Label>
            <Input
              id="email"
              value={user?.email ?? ""}
              readOnly
              disabled
              className="h-10 bg-muted/40"
            />
            <p className="text-[11px] text-muted-foreground">
              L&apos;e-mail sert d&apos;identifiant de connexion et ne peut pas être modifié ici.
            </p>
          </div>

          <Separator />

          <div className="flex justify-end">
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !form.first_name.trim() || !form.last_name.trim()}
              className="min-w-[140px]"
            >
              {save.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ——— Sécurité ——— */}
      <Card className="overflow-hidden border-border/60 shadow-sm">
        <CardHeader className="border-b border-border/50 bg-muted/20 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <Shield className="h-4 w-4" />
            </span>
            <div>
              <CardTitle className="text-base font-semibold">Sécurité</CardTitle>
              <CardDescription className="text-xs">
                Mot de passe fort recommandé, notamment après la première connexion.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="space-y-4">
            <PasswordField
              id="new_password"
              label="Nouveau mot de passe"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              minLength={8}
            />
            <PasswordField
              id="confirm_password"
              label="Confirmer le mot de passe"
              value={passwordConfirm}
              onChange={setPasswordConfirm}
              autoComplete="new-password"
              minLength={8}
            />
            <p className="text-[11px] text-muted-foreground">
              8 caractères minimum. Les deux champs doivent être identiques.
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() => changePassword.mutate()}
              disabled={!passwordOk || changePassword.isPending}
              className="min-w-[180px]"
            >
              {changePassword.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="mr-2 h-4 w-4" />
              )}
              Modifier le mot de passe
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ——— Session ——— */}
      <Card className="overflow-hidden border-border/60 shadow-sm">
        <CardHeader className="border-b border-border/50 bg-muted/20 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <LogOut className="h-4 w-4" />
            </span>
            <div>
              <CardTitle className="text-base font-semibold">Session</CardTitle>
              <CardDescription className="text-xs">
                Déconnexion de cet appareil. Vous devrez vous reconnecter pour revenir.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Se déconnecter
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Se déconnecter ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Vous devrez ressaisir votre mot de passe pour accéder de nouveau à
                  l&apos;administration.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={() => void signOut()}>Se déconnecter</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
