import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { acceptInvitation } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

function Page() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const accept = useServerFn(acceptInvitation);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", email: "", password: "" });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await accept({ data: { ...form, token } });
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Activation de votre compte</CardTitle>
          <CardDescription>
            Complétez vos informations pour rejoindre l'administration du complexe Les Élites de Gao.
          </CardDescription>
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
              <Label htmlFor="email">Adresse e-mail</Label>
              <Input id="email" type="email" required className="mt-1.5" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="password">Mot de passe</Label>
              <Input id="password" type="password" required minLength={8} className="mt-1.5" value={form.password} onChange={(e) => set("password", e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">8 caractères minimum.</p>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
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
