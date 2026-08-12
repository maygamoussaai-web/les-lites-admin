import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Loader2, ShieldCheck, Crown, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { initDirectorGeneral, DG_EMAIL } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

type Mode = null | "dg" | "staff";

function AuthPage() {
  const navigate = useNavigate();
  const initDG = useServerFn(initDirectorGeneral);
  const [mode, setMode] = useState<Mode>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      toast.error("Identifiants incorrects ou compte non autorisé.");
      return;
    }
    navigate({ to: "/tableau-de-bord" });
  };

  const initialise = async () => {
    setLoading(true);
    try {
      const result = await initDG({ data: { password } });
      if (result.created) {
        toast.success("Compte Directeur Général initialisé. Connectez-vous puis changez le mot de passe.");
        setEmail(result.email);
      } else {
        toast.info("Le compte Directeur Général existe déjà.");
      }
    } catch (error) {
      toast.error((error as Error).message || "Initialisation impossible");
    }
    setLoading(false);
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
        <div className="w-full max-w-md space-y-6 duration-300 animate-in fade-in slide-in-from-bottom-2">
          <div className="text-center lg:hidden">
            <p className="font-display text-xl font-semibold text-foreground">LES ÉLITES DE GAO</p>
            <p className="text-sm text-muted-foreground">Administration du complexe scolaire</p>
          </div>

          {mode === null ? (
            <Card>
              <CardHeader className="text-center">
                <CardTitle className="font-display text-2xl">LES ÉLITES DE GAO</CardTitle>
                <CardDescription>Administration du complexe scolaire</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <button
                  type="button"
                  onClick={() => { setMode("dg"); setEmail(DG_EMAIL); }}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-primary hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Crown className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-medium text-foreground">Directeur Général</span>
                    <span className="block text-xs text-muted-foreground">Accès complet au complexe</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("staff"); setEmail(""); }}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-primary hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Users className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-medium text-foreground">Personnel administratif</span>
                    <span className="block text-xs text-muted-foreground">Accès à l'établissement assigné</span>
                  </span>
                </button>
                <p className="pt-2 text-center text-xs text-muted-foreground">
                  Aucune inscription publique : les comptes du personnel sont créés uniquement sur invitation du
                  Directeur Général.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <Button variant="ghost" size="sm" className="mb-2 w-fit -ml-2" onClick={() => setMode(null)}>
                  <ArrowLeft className="mr-1 h-4 w-4" /> Retour
                </Button>
                <CardTitle className="text-xl">
                  {mode === "dg" ? "Connexion Directeur Général" : "Connexion Personnel administratif"}
                </CardTitle>
                <CardDescription>
                  {mode === "dg"
                    ? "Compte unique de direction du complexe."
                    : "Utilisez l'adresse e-mail définie lors de l'activation de votre invitation."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={signIn}>
                  <div>
                    <Label htmlFor="email">Adresse e-mail</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="password">Mot de passe</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Se connecter"}
                  </Button>
                </form>

                {mode === "dg" && (
                  <div className="mt-6 rounded-lg border border-dashed border-border p-3">
                    <p className="text-xs text-muted-foreground">
                      Première mise en service uniquement : si le compte de direction n'existe pas encore, saisissez
                      le mot de passe initial ci-dessus puis initialisez le compte. Le mot de passe est confié à
                      Supabase Auth, jamais stocké dans la base.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full"
                      disabled={loading || password.length < 6}
                      onClick={initialise}
                    >
                      Initialiser le compte Directeur Général
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
