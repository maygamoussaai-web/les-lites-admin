import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Connexion – Les Élites de Gao Administration" },
      {
        name: "description",
        content:
          "Espace d'administration du complexe scolaire Les Élites de Gao : gestion des élèves, enseignants, notes et scolarité.",
      },
      { property: "og:title", content: "Connexion – Les Élites de Gao Administration" },
      {
        property: "og:description",
        content: "Accès réservé au personnel administratif du complexe scolaire Les Élites de Gao.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    navigate({ to: "/tableau-de-bord" });
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setLoading(false);
      toast.error(error.message);
      return;
    }
    if (!data.session) {
      setLoading(false);
      toast.info("Compte créé. Confirmez votre adresse e-mail puis connectez-vous.");
      return;
    }
    const { error: profileError } = await supabase.from("admin_profiles").insert({
      id: data.user!.id,
      first_name: firstName,
      last_name: lastName,
      phone: phone || null,
      role: "staff",
    });
    setLoading(false);
    if (profileError) { toast.error(profileError.message); return; }
    toast.success("Compte administrateur créé");
    navigate({ to: "/tableau-de-bord" });
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-md bg-sidebar-primary font-display text-base font-bold text-sidebar-primary-foreground">
            EG
          </span>
          <div>
            <p className="font-display text-lg font-semibold">Les Élites de Gao</p>
            <p className="text-sm text-sidebar-foreground/70">Complexe scolaire — Gao, Mali</p>
          </div>
        </div>
        <div className="max-w-md space-y-4">
          <h2 className="font-display text-3xl font-semibold leading-tight">
            Une administration unifiée pour l'Université, le Lycée, le Collège et la Fondamentale.
          </h2>
          <p className="text-sm text-sidebar-foreground/80">
            Élèves, enseignants, évaluations, scolarité et paiements — dans un seul espace sécurisé,
            utilisable même avec une connexion instable.
          </p>
        </div>
        <p className="flex items-center gap-2 text-xs text-sidebar-foreground/60">
          <ShieldCheck className="h-4 w-4" /> Accès strictement réservé au personnel autorisé.
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">Espace administration</CardTitle>
            <CardDescription>Connectez-vous pour accéder à la gestion du complexe.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Connexion</TabsTrigger>
                <TabsTrigger value="signup">Créer un compte</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form className="space-y-4 pt-4" onSubmit={signIn}>
                  <div>
                    <Label htmlFor="email">Adresse e-mail</Label>
                    <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" />
                  </div>
                  <div>
                    <Label htmlFor="password">Mot de passe</Label>
                    <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Se connecter"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form className="space-y-4 pt-4" onSubmit={signUp}>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="firstName">Prénom</Label>
                      <Input id="firstName" required value={firstName} onChange={(e) => setFirstName(e.target.value)} className="mt-1.5" />
                    </div>
                    <div>
                      <Label htmlFor="lastName">Nom</Label>
                      <Input id="lastName" required value={lastName} onChange={(e) => setLastName(e.target.value)} className="mt-1.5" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="phone">Téléphone</Label>
                    <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1.5" placeholder="+223 ..." />
                  </div>
                  <div>
                    <Label htmlFor="email2">Adresse e-mail</Label>
                    <Input id="email2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" />
                  </div>
                  <div>
                    <Label htmlFor="password2">Mot de passe</Label>
                    <Input id="password2" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Le tout premier compte créé devient automatiquement Directeur Général. Les comptes
                    suivants sont créés comme personnel et doivent être habilités par le Directeur Général.
                  </p>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Créer le compte"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
