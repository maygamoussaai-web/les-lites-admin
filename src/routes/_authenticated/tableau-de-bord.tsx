import { createFileRoute } from "@tanstack/react-router";
import { Building2, Users, UserCog, GraduationCap, Wallet, Banknote } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRows } from "@/lib/data";
import { formatFCFA, establishmentTypeLabel } from "@/lib/format";
import { useAdminProfile } from "@/hooks/use-auth";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/tableau-de-bord")({
  head: () => ({
    meta: [
      { title: "Tableau de bord – Les Élites de Gao" },
      { name: "description", content: "Vue d'ensemble du complexe scolaire Les Élites de Gao : effectifs, classes, scolarité et paiements." },
      { property: "og:title", content: "Tableau de bord – Les Élites de Gao" },
      { property: "og:description", content: "Indicateurs clés du complexe scolaire Les Élites de Gao." },
    ],
  }),
  component: Page,
});

function Page() {
  const { profile } = useAdminProfile();
  const { data: establishments = [] } = useRows<Tables<"establishments">>("establishments", { order: { column: "name" } });
  const { data: classes = [] } = useRows<Tables<"classes">>("classes");
  const { data: students = [] } = useRows<Tables<"students">>("students");
  const { data: teachers = [] } = useRows<Tables<"teachers">>("teachers");
  const { data: tuition = [] } = useRows<Tables<"student_tuition">>("student_tuition");
  const { data: payments = [] } = useRows<Tables<"student_payments">>("student_payments");

  const due = tuition.reduce((s, t) => s + Number(t.amount_due ?? 0), 0);
  const paid = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0);

  return (
    <>
      <PageHeader
        title={`Bonjour ${profile?.first_name ?? ""}`.trim()}
        description="Vue d'ensemble du complexe scolaire Les Élites de Gao."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Établissements" value={establishments.length} icon={Building2} />
        <StatCard label="Classes" value={classes.length} icon={GraduationCap} />
        <StatCard label="Élèves" value={students.length} icon={Users} />
        <StatCard label="Enseignants" value={teachers.length} icon={UserCog} />
        <StatCard label="Scolarité attendue" value={formatFCFA(due)} icon={Wallet} />
        <StatCard label="Encaissé" value={formatFCFA(paid)} hint={`Reste ${formatFCFA(Math.max(due - paid, 0))}`} icon={Banknote} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Établissements du complexe</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {establishments.map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-4">
              <p className="font-medium text-foreground">{e.name}</p>
              <p className="text-xs text-muted-foreground">{establishmentTypeLabel(e.type)}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {classes.filter((c) => c.establishment_id === e.id).length} classe(s)
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
