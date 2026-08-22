import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Banknote, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData } from "@/lib/school-data";
import { formatFCFA, formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/enseignants/$teacherId")({
  head: () => ({
    meta: [
      { title: "Fiche de paie – Les Élites de Gao" },
      { name: "description", content: "Historique des paiements d'un enseignant, filtrable par date." },
    ],
  }),
  component: Page,
});

function Page() {
  const { teacherId } = Route.useParams();
  const { isDG, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const data = useSchoolData();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const teacher = data.teachers.find((t) => t.id === teacherId);
  const assignments = data.assignments.filter((a) => a.teacher_id === teacherId);
  const allowed = assignments.length > 0 && (isDG || assignments.some((a) => establishmentIds.includes(a.establishment_id)));

  const payments = data.teacherPayments
    .filter((p) => p.teacher_id === teacherId)
    .filter((p) => (!from || p.paid_at >= from) && (!to || p.paid_at <= to))
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at));

  const total = payments.reduce((acc, p) => acc + Number(p.amount), 0);

  if (!data.loading && !establishmentIdsLoading && (!teacher || !allowed)) {
    return (
      <EmptyState icon={ShieldAlert} title="Enseignant introuvable" description="Cet enseignant n'existe pas ou vous n'y avez pas accès." />
    );
  }
  if (!teacher) return null;

  const primaryEstablishmentId = assignments[0]?.establishment_id;

  return (
    <>
      {primaryEstablishmentId && (
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
          <Link to="/etablissements/$id" params={{ id: primaryEstablishmentId }}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour à l'établissement
          </Link>
        </Button>
      )}

      <PageHeader
        eyebrow="Fiche de paie"
        title={`${teacher.last_name} ${teacher.first_name}`}
        description="Historique de tous les paiements enregistrés pour cet enseignant."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="mb-1.5 block text-xs text-muted-foreground">Du</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="mb-1.5 block text-xs text-muted-foreground">Au</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        {(from || to) && (
          <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>
            Réinitialiser
          </Button>
        )}
        <div className="ml-auto rounded-lg border border-border bg-card px-4 py-2 text-sm">
          <span className="text-muted-foreground">Total sur la période : </span>
          <span className="font-semibold text-foreground">{formatFCFA(total)}</span>
        </div>
      </div>

      {payments.length === 0 ? (
        <EmptyState icon={Banknote} title="Aucun paiement" description="Aucun paiement enregistré pour cette période." />
      ) : (
        <div className="space-y-2">
          {payments.map((p, index) => (
            <div
              key={p.id}
              className="animate-rise flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 text-sm"
              style={{ animationDelay: `${Math.min(index, 15) * 30}ms` }}
            >
              <div>
                <p className="font-medium text-foreground">{formatFCFA(p.amount)}</p>
                {p.note && <p className="text-xs text-muted-foreground">{p.note}</p>}
              </div>
              <span className="text-xs text-muted-foreground">Payé le {formatDate(p.paid_at)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}