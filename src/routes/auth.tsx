import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2, ShieldCheck, Crown, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DG_EMAIL, getDirectorGeneralAccount, listStaffAccounts, getStaffEmail } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { AuroraBackground } from "@/components/app/aurora-background";
import { BrandLogo } from "@/components/app/brand-logo";

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
type StaffAccount = {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  establishment_name: string | null;
};

function AuthPage() {
  const navigate = useNavigate();
  const fetchDG = useServerFn(getDirectorGeneralAccount);
  const fetchStaff = useServerFn(listStaffAccounts);
  const resolveStaffEmail = useServerFn(getStaffEmail);

  const [mode, setMode] = useState<Mode>(null);
  const [selectedStaff, setSelectedStaff] = useState<StaffAccount | null>(null);
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  const dgQuery = useQuery({
    queryKey: ["dg-account"],
    queryFn: () => fetchDG(),
    enabled: mode === "dg",
    staleTime: 60_000,
  });

  const staffQuery = useQuery({
    queryKey: ["staff-accounts"],
    queryFn: () => fetchStaff(),
    enabled: mode === "staff",
    staleTime: 15_000,
  });

  const reset = () => {
    setMode(null);
    setSelectedStaff(null);
    setPassword("");
  };

  const backToStaffList = () => {
    setSelectedStaff(null);
    setPassword("");
  };

// Distingue un vrai échec d'identifiants d'une simple coupure réseau, pour
  // ne pas dire "mot de passe incorrect" à quelqu'un dont la connexion a
  // juste flanché.
  const isNetworkFailure = (message: string) =>
    (typeof navigator !== "undefined" && !navigator.onLine) || /fetch|network|timeout/i.test(message);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigningIn(true);
    try {
      let email: string;
      if (mode === "dg") {
        email = DG_EMAIL;
      } else if (selectedStaff) {
        const res = await resolveStaffEmail({ data: { profile_id: selectedStaff.id } });
        email = res.email;
      } else {
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (isNetworkFailure(error.message)) {
          toast.error("Connexion réseau impossible. Vérifiez votre connexion et réessayez.");
        } else if (/invalid login credentials/i.test(error.message)) {
          toast.error("Mot de passe incorrect. Vérifiez et réessayez.");
        } else {
          toast.error(error.message || "Connexion impossible. Réessayez.");
        }
        setSigningIn(false);
        return;
      }
      toast.success("Connexion réussie");
      navigate({ to: "/tableau-de-bord" });
    } catch (err) {
      const message = (err as Error).message || "";
      if (isNetworkFailure(message)) {
        toast.error("Connexion réseau impossible. Vérifiez votre connexion et réessayez.");
      } else {
        toast.error(message || "Connexion impossible. Réessayez.");
      }
      setSigningIn(false);
    }
  };

  const dg = dgQuery.data;
  const dgName = dg ? `${dg.last_name}` : "MAYGA";

  return (
    <div className="relative grid min-h-screen lg:grid-cols-2">
      <AuroraBackground intense />
      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle />
      </div>
      {/* Panneau de marque */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div
          aria-hidden
          className="aurora-mesh pointer-events-none absolute inset-0 opacity-70"
        />
        <div aria-hidden className="grain pointer-events-none absolute inset-0" />
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[oklch(0.78_0.16_85/18%)] blur-3xl animate-glow-pulse" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-[oklch(0.78_0.16_85/12%)] blur-3xl animate-glow-pulse" style={{ animationDelay: "1.2s" }} />

        <div className="animate-rise relative flex items-center gap-3">
          <BrandLogo size={44} />
          <div>
            <p className="font-display text-lg font-semibold">Les Élites de Gao</p>
            <p className="text-sm text-sidebar-foreground/70">Complexe scolaire — Gao, Mali</p>
          </div>
        </div>

        <div className="stagger relative max-w-md space-y-5">
          <BrandLogo size={132} halo float />
          <h2 className="gold-underline font-display text-3xl font-semibold leading-tight">
            Une administration unifiée pour l'Université, le Lycée, le Collège et la Fondamentale.
          </h2>
          <p className="pt-2 text-sm text-sidebar-foreground/80">
            Élèves, enseignants, évaluations, scolarité et paiements — dans un seul espace sécurisé,
            utilisable même avec une connexion instable.
          </p>
        </div>

        <p className="relative flex items-center gap-2 text-xs text-sidebar-foreground/60">
          <ShieldCheck className="h-4 w-4" /> Accès strictement réservé au personnel autorisé.
        </p>
      </div>

      {/* Panneau de connexion */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 duration-300 animate-in fade-in slide-in-from-bottom-2">
          <div className="flex flex-col items-center gap-3 text-center lg:hidden">
            <BrandLogo size={92} halo float />
            <p className="font-display text-xl font-semibold text-foreground">LES ÉLITES DE GAO</p>
            <p className="text-sm text-muted-foreground">Administration du complexe scolaire</p>
          </div>

          {mode === null && (
            <Card className="glass-panel card-lift animate-rise shadow-xl">
              <CardHeader className="text-center">
                <div className="mb-1 hidden justify-center lg:flex">
                  <BrandLogo size={72} halo />
                </div>
                <CardTitle className="font-display text-2xl">LES ÉLITES DE GAO</CardTitle>
                <CardDescription>Administration du complexe scolaire</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <button
                  type="button"
                  onClick={() => setMode("dg")}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/15 text-accent-foreground">
                    <Crown className="h-5 w-5 text-[oklch(0.55_0.15_85)]" />
                  </span>
                  <span>
                    <span className="block font-medium text-foreground">Directeur Général</span>
                    <span className="block text-xs text-muted-foreground">Accès complet au complexe</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("staff")}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
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
          )}

          {mode === "dg" && (
            <Card className="glass-panel animate-rise shadow-xl">
              <CardHeader>
                <Button variant="ghost" size="sm" className="mb-2 w-fit -ml-2" onClick={reset}>
                  <ArrowLeft className="mr-1 h-4 w-4" /> Retour
                </Button>
                <div className="flex flex-col items-center gap-3 pb-2 text-center">
                  <Avatar className="h-20 w-20 border-2 border-accent shadow-md">
                    {dg?.avatar_url && <AvatarImage src={dg.avatar_url} alt={dgName} />}
                    <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
                      {initials(dg?.first_name, dg?.last_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <CardTitle className="text-xl">
                      {dgQuery.isLoading ? "Bienvenue" : `Bienvenue, M. ${dgName}`}
                    </CardTitle>
                    <CardDescription>Directeur Général — Les Élites de Gao</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={signIn}>
                  <div>
                    <Label htmlFor="password">Mot de passe</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      autoFocus
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                  <Button type="submit" className="shine-gold w-full" disabled={signingIn || password.length === 0}>
                    {signingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : "Se connecter"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {mode === "staff" && !selectedStaff && (
            <Card className="glass-panel animate-rise shadow-xl">
              <CardHeader>
                <Button variant="ghost" size="sm" className="mb-2 w-fit -ml-2" onClick={reset}>
                  <ArrowLeft className="mr-1 h-4 w-4" /> Retour
                </Button>
                <CardTitle className="text-xl">Personnel administratif</CardTitle>
                <CardDescription>Sélectionnez votre compte pour continuer.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {staffQuery.isLoading && (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {staffQuery.isError && (
                  <p className="py-6 text-center text-sm text-destructive">
                    Impossible de charger les comptes. Vérifiez votre connexion.
                  </p>
                )}
                {staffQuery.data && staffQuery.data.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Aucun compte actif. Demandez une invitation au Directeur Général.
                  </p>
                )}
                {staffQuery.data?.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedStaff(s)}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
                  >
                    <Avatar className="h-11 w-11 border border-border">
                      {s.avatar_url && <AvatarImage src={s.avatar_url} alt={`${s.first_name} ${s.last_name}`} />}
                      <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                        {initials(s.first_name, s.last_name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">
                        {s.first_name} {s.last_name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {s.establishment_name ?? "Établissement non assigné"}
                      </span>
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          {mode === "staff" && selectedStaff && (
            <Card className="glass-panel animate-rise shadow-xl">
              <CardHeader>
                <Button variant="ghost" size="sm" className="mb-2 w-fit -ml-2" onClick={backToStaffList}>
                  <ArrowLeft className="mr-1 h-4 w-4" /> Changer de compte
                </Button>
                <div className="flex flex-col items-center gap-3 pb-2 text-center">
                  <Avatar className="h-20 w-20 border-2 border-primary shadow-md">
                    {selectedStaff.avatar_url && (
                      <AvatarImage src={selectedStaff.avatar_url} alt={`${selectedStaff.first_name} ${selectedStaff.last_name}`} />
                    )}
                    <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
                      {initials(selectedStaff.first_name, selectedStaff.last_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <CardTitle className="text-xl">
                      {selectedStaff.first_name} {selectedStaff.last_name}
                    </CardTitle>
                    <CardDescription>{selectedStaff.establishment_name ?? "Personnel administratif"}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={signIn}>
                  <div>
                    <Label htmlFor="staff_password">Mot de passe</Label>
                    <Input
                      id="staff_password"
                      type="password"
                      autoComplete="current-password"
                      autoFocus
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                  <Button type="submit" className="shine-gold w-full" disabled={signingIn || password.length === 0}>
                    {signingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : "Se connecter"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}