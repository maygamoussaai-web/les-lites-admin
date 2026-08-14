import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Building2, RefreshCw } from "lucide-react";
import { acceptInvitation, getInvitationInfo } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { initials } from "@/lib/format";

export const Route = createFileRoute("/invitation/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Activation du compte – Les Élites de Gao" },
      { name: "description", content: "Activez votre compte de personnel administratif du complexe scolaire Les Élites de Gao." },
      { property: "og:title", content: "Activation du compte – Les Élites de Gao" },
      { property: "og:description", content: "Finalisez votre invitation et accédez à l'administration de votre établissement." },
    ],
  }),
  component: Page,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Page() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const accept = useServerFn(acceptInvitation);
  const fetchInfo = useServerFn(getInvitationInfo);
  const [loading, setLoading] = useState(false);
  const [checkingLink, setCheckingLink] = useState(true);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [establishmentName, setEstablishmentName] = useState<string | null>(null);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    password: "",
    confirm_password: "",
    avatar_url: "",
  });

  const loadInfo = async () => {
    setCheckingLink(true);
    setInfoError(null);
    // Le contrôle de connexion Supabase de l'infrastructure peut mettre quelques secondes
    // à se stabiliser après un déploiement — on retente automatiquement avant d'afficher une erreur.
    const attempts = 4;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetchInfo({ data: { token } });
        setEstablishmentName(res.establishment_name);
        setCheckingLink(false);
        return;
      } catch (e) {
        const message = (e as Error).message || "";
        const isInfraGlitch = message.includes("SUPABASE_SERVICE_ROLE_KEY") || message.includes("Lovable Cloud");
        if (isInfraGlitch && i < attempts - 1) {
          await sleep(1500);
          continue;
        }
        setInfoError(isInfraGlitch ? "Le service est momentanément indisponible. Réessayez dans quelques secondes." : message);
        setCheckingLink(false);
        return;
      }
    }
  };

  useEffect(() => {
    loadInfo();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm_password) {
      toast.error("Les mots de passe ne correspondent pas.");
      return;
    }
    setLoading(true);
    try {
      await accept({
        data: {
          token,
          email: form.email.trim(),
          password: form.password,
          first_name: form.first_name,
          last_name: form.last_name,
          phone: form.phone || null,
          avatar_url: form.avatar_url || null,
        },
      });
      const { error } = await supabase.auth.signInWithPassword({ email: form.email.trim(), password: form.password });
      if (error) {
        toast.success("Compte activé. Connectez-vous.");
        navigate({ to: "/auth" });
        return;
      }
      toast.success("Compte activé");
      navigate({ to: "/tableau-de-bord" });
    } catch (error) {
      toast.error((error as Error).message || "Activation impossible");
    }
    setLoading(false);
  };

  if (checkingLink) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Vérification du lien…</p>
        </div>
      </div>
    );
  }

  if (infoError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">Lien invalide</CardTitle>
            <CardDescription>{infoError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={loadInfo}>
              <RefreshCw className="mr-2 h-4 w-4" /> Réessayer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md duration-300 animate-in fade-in slide-in-from-bottom-2">
        <CardHeader>
          <div className="mb-2 flex items-center gap-3">
            <Avatar className="h-14 w-14 border-2 border-accent">
              {form.avatar_url && <AvatarImage src={form.avatar_url} alt="Photo de profil" />}
              <AvatarFallback className="bg-primary/10 text-base font-semibold text-primary">
                {initials(form.first_name || "?", form.last_name || "")}
              </AvatarFallback>
            </Avatar>
            <div>
              <CardTitle className="font-display text-xl">Activation de votre compte</CardTitle>
              <CardDescription>Personnel administratif — Les Élites de Gao</CardDescription>
            </div>
          </div>
          {establishmentName && (
            <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-medium text-foreground">
              <Building2 className="h-4 w-4 text-[oklch(0.55_0.15_85)]" />
              Établissement assigné : {establishmentName}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="first_name">Prénom</Label>
                <Input id="first_name" required className="mt-1.5" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="last_name">Nom</Label>
                <Input id="last_name" required className="mt-1.5" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="phone">Téléphone</Label>
              <Input id="phone" className="mt-1.5" placeholder="+223 ..." value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="avatar_url">Photo de profil (URL)</Label>
              <Input id="avatar_url" className="mt-1.5" placeholder="https://…" value={form.avatar_url} onChange={(e) => set("avatar_url", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="email">Adresse e-mail</Label>
              <Input id="email" type="email" required className="mt-1.5" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="password">Mot de passe</Label>
                <Input id="password" type="password" required minLength={8} className="mt-1.5" value={form.password} onChange={(e) => set("password", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="confirm_password">Confirmer</Label>
                <Input id="confirm_password" type="password" required minLength={8} className="mt-1.5" value={form.confirm_password} onChange={(e) => set("confirm_password", e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">8 caractères minimum.</p>
            <Button type="submit" className="shine-gold w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Activer mon compte"}
            </Button>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" /> Votre accès sera limité à l'établissement défini par le Directeur Général.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}