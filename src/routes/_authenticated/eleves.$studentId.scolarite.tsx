import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Receipt, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData } from "@/lib/school-data";
import { sum } from "@/lib/school";
import { formatFCFA, formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/eleves/$studentId/scolarite")({
  head: () => ({
    meta: [
      { title: "Fiche de scolarité – Les Élites de Gao" },
      { name: "description", content: "Historique des périodes de scolarité et des paiements d'un élève." },
    ],
  }),
  component: Page,
});

function Page() {
  const { studentId } = Route.useParams();
  const { isDG, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const data = useSchoolData();

  const student = data.students.find((s) => s.id === studentId);
  const allowed = student && (isDG || establishmentIds.includes(student.establishment_id));

  const periods = data.enrollments
    .filter((e) => e.student_id === studentId)
    .map((e) => {
      const paid = sum(data.tuitionPayments.filter((p) => p.enrollment_id === e.id).map((p) => Number(p.amount)));
      const total = Number(e.total_amount);
      const closed = total > 0 && paid >= total;
      return { enrollment: e, paid, total, closed };
    })
    .sort((a, b) => b.enrollment.started_at.localeCompare(a.enrollment.started_at));

  if (!data.loading && !establishmentIdsLoading && (!student || !allowed)) {
    return (
      <EmptyState icon={ShieldAlert} title="Élève introuvable" description="Cet élève n'existe pas ou vous n'y avez pas accès." />
    );
  }
  if (!student) return null;

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link to="/eleves/$studentId" params={{ studentId: student.id }}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour à la fiche
        </Link>
      </Button>

      <PageHeader
        eyebrow="Fiche de scolarité"
        title={`${student.last_name} ${student.first_name}`}
        description="Historique de chaque période d'inscription et de son paiement — figé au moment de l'inscription."
      />

      {periods.length === 0 ? (
        <EmptyState icon={Receipt} title="Aucune période" description="Aucune période de scolarité enregistrée pour cet élève." />
      ) : (
        <div className="space-y-3">
          {periods.map(({ enrollment, paid, total, closed }, index) => {
            const rate = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
            return (
              <div
                key={enrollment.id}
                className="animate-rise rounded-xl border border-border bg-card p-4"
                style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-display font-semibold text-foreground">
                      {enrollment.establishment_name} — {enrollment.class_name}
                      {enrollment.ended_at === null ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">(actuelle)</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Du {formatDate(enrollment.started_at)}
                      {enrollment.ended_at ? ` au ${formatDate(enrollment.ended_at)}` : ""}
                    </p>
                  </div>
                  {closed ? (
                    <Badge className="bg-success text-success-foreground">Bouclé</Badge>
                  ) : (
                    <Badge variant="destructive">Non bouclé</Badge>
                  )}
                </div>
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Payé</span>
                    <span className="font-medium text-foreground">
                      {formatFCFA(paid)} / {formatFCFA(total)}
                    </span>
                  </div>
                  <Progress value={rate} className="h-2" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}