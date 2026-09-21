import { useState } from "react";
import { useNavigate, Link, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Pencil, ArrowRightLeft, Trash2, ShieldAlert, Receipt, Wallet, IdCard, Library } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentPhoto } from "@/components/school/student-photo";
import { StudentGradesCard } from "@/components/school/student-grades";
import { supabase } from "@/integrations/supabase/client";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSaveRow, useArchiveRow, writeAudit } from "@/lib/data";
import { useSchoolData } from "@/lib/school-data";
import { lateStatus, sum, type Installment } from "@/lib/school";
import { formatDate, formatFCFA } from "@/lib/format";
import { describeError } from "@/lib/errors";
import { PayDialog } from "@/components/school/student-pay-dialog";
import { Row } from "@/components/school/student-fiche-helpers";

export function StudentFichePage() {
  const { studentId } = useParams({ from: "/_authenticated/eleves/$studentId/" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isDG, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const data = useSchoolData();
  const save = useSaveRow("students", "Élève");
  const archive = useArchiveRow("students", "Élève");
  const [editOpen, setEditOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const student = data.students.find((s) => s.id === studentId);
  const allowed = student && (isDG || establishmentIds.includes(student.establishment_id));

  if (!data.loading && !establishmentIdsLoading && (!student || !allowed)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Élève introuvable"
        description="Cet élève n'existe pas, a été archivé, ou vous n'y avez pas accès."
      />
    );
  }
  if (!student) return null;

  const establishment = data.establishments.find((e) => e.id === student.establishment_id);
  const klass = data.classes.find((c) => c.id === student.class_id);
  const enrollment = data.activeEnrollmentByStudent.get(student.id);
  const installments = (enrollment?.installments_snapshot as unknown as Installment[]) ?? [];
  const paid = enrollment
    ? sum(data.tuitionPayments.filter((p) => p.enrollment_id === enrollment.id).map((p) => Number(p.amount)))
    : 0;
  const totalDue = enrollment ? Number(enrollment.total_amount) : 0;
  const late = installments.length ? lateStatus(paid, installments) : null;

  const editFields: Field[] = [
    { name: "first_name", label: "Prénom", required: true },
    { name: "last_name", label: "Nom", required: true },
    { name: "gender", label: "Sexe", type: "select", required: true, options: [
      { value: "M", label: "Masculin" }, { value: "F", label: "Féminin" },
    ]},
    { name: "date_of_birth", label: "Date de naissance", type: "date" },
    { name: "parent_phone_1", label: "Téléphone parent 1" },
    { name: "parent_phone_2", label: "Téléphone parent 2" },
  ];

  const classOptions = data.classes
    .filter((c) => c.id !== student.class_id)
    .map((c) => ({
      value: c.id,
      label: `${data.establishments.find((e) => e.id === c.establishment_id)?.name ?? ""} — ${c.name}`,
    }));

  const transferStudent = async (values: Record<string, any>) => {
    const target = data.classes.find((c) => c.id === values["class_id"]);
    if (!target) return;
    setTransferring(true);
    try {
      const { error: studentError } = await supabase
        .from("students")
        .update({ class_id: target.id, establishment_id: target.establishment_id })
        .eq("id", student.id);
      if (studentError) throw studentError;
      const targetEstablishment = data.establishments.find((e) => e.id === target.establishment_id);
      const targetPlan = data.feePlans.find((p) => p.id === target.fee_plan_id);
      const targetInstallments = data.installments.filter((i) => i.fee_plan_id === target.fee_plan_id);
      const targetSnapshot = targetInstallments.map((i) => ({
        label: i.label, amount: i.amount, due_date: i.due_date, position: i.position,
      }));
      if (enrollment && paid === 0) {
        const { error } = await supabase.from("student_enrollments").update({
          establishment_id: target.establishment_id, class_id: target.id,
          establishment_name: targetEstablishment?.name ?? "", class_name: target.name,
          fee_plan_id: target.fee_plan_id, total_amount: targetPlan ? Number(targetPlan.total_amount) : 0,
          installments_snapshot: targetSnapshot as never, started_at: new Date().toISOString(),
        }).eq("id", enrollment.id);
        if (error) throw error;
      } else {
        if (enrollment) {
          const { error } = await supabase.from("student_enrollments")
            .update({ ended_at: new Date().toISOString() }).eq("id", enrollment.id);
          if (error) throw error;
        }
        const { error } = await supabase.from("student_enrollments").insert({
          student_id: student.id, establishment_id: target.establishment_id, class_id: target.id,
          establishment_name: targetEstablishment?.name ?? "", class_name: target.name,
          fee_plan_id: target.fee_plan_id, total_amount: targetPlan ? Number(targetPlan.total_amount) : 0,
          installments_snapshot: targetSnapshot as never,
        });
        if (error) throw error;
      }
      await supabase.from("student_transfers").insert({
        student_id: student.id, from_class_id: student.class_id, from_establishment_id: student.establishment_id,
        to_class_id: target.id, to_establishment_id: target.establishment_id,
      });
      await writeAudit("update", "students", student.id, { transferred_to_class_id: target.id });
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["student_enrollments"] });
      toast.success(student.class_id ? "Élève transféré" : "Élève assigné");
      setTransferOpen(false);
      navigate({ to: "/etablissements/$id", params: { id: target.establishment_id } });
    } catch (e) {
      toast.error(describeError(e, "Opération impossible"));
    } finally {
      setTransferring(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit"
        onClick={() => navigate({ to: "/etablissements/$id", params: { id: student.establishment_id } })}>
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour à {establishment?.name ?? "l'établissement"}
      </Button>
      <PageHeader
        eyebrow={klass?.name ?? "Élève"}
        title={`${student.last_name} ${student.first_name}`}
        description={`${establishment?.name ?? "—"} · Inscrit le ${formatDate(student.enrolled_at)}`}
      />
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border/70 bg-card p-4">
        <StudentPhoto studentId={student.id} establishmentId={student.establishment_id}
          photoUrl={student.photo_url ?? null} firstName={student.first_name} lastName={student.last_name} compact />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-semibold">{student.last_name} {student.first_name}</p>
          <p className="text-sm text-muted-foreground">{klass?.name ?? "Classe non assignée"} · {establishment?.name ?? "—"}</p>
        </div>
        <Button variant="outline" size="sm" className="press" asChild>
          <Link to="/eleves/$studentId/identite" params={{ studentId: student.id }}>
            <IdCard className="mr-1.5 h-4 w-4" /> Identité
          </Link>
        </Button>
        <Button variant="outline" size="sm" className="press" asChild>
          <Link to="/eleves/$studentId/bibliotheque" params={{ studentId: student.id }}>
            <Library className="mr-1.5 h-4 w-4" /> Bibliothèque
          </Link>
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Scolarité</CardTitle>
            <Button variant="ghost" size="sm" className="press" asChild>
              <Link to="/eleves/$studentId/scolarite" params={{ studentId: student.id }}>
                <Receipt className="mr-1.5 h-4 w-4" /> Détail
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            {enrollment ? (
              <>
                <Row label="Payé" value={formatFCFA(paid)} />
                <Row label="Total" value={formatFCFA(totalDue)} />
                <Row label="Statut" value={late ? (late.isLate
                  ? <Badge variant="destructive">Retard {formatFCFA(late.overdueAmount)}</Badge>
                  : <Badge className="bg-success text-success-foreground">À jour</Badge>) : "—"} />
                <Button size="sm" className="press w-full" onClick={() => setPayOpen(true)}>
                  <Wallet className="mr-1.5 h-4 w-4" /> Paiement
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">Aucune période active.</p>
            )}
          </CardContent>
        </Card>
        <StudentGradesCard studentId={student.id} classId={student.class_id} />
        <Card className="lg:col-span-2 border-primary/20 bg-gradient-to-br from-card to-primary/5">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Library className="h-4 w-4 text-primary" /> Bibliothèque de l&apos;élève
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Bulletins générés, actes, photos et autres pièces. Page dédiée pour tout gérer.
              </p>
            </div>
            <Button size="sm" className="press" asChild>
              <Link to="/eleves/$studentId/bibliotheque" params={{ studentId: student.id }}>
                Ouvrir la bibliothèque
              </Link>
            </Button>
          </CardHeader>
        </Card>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="press" onClick={() => setEditOpen(true)}><Pencil className="mr-1.5 h-4 w-4" /> Modifier</Button>
        <Button variant="outline" className="press" onClick={() => setTransferOpen(true)}>
          <ArrowRightLeft className="mr-1.5 h-4 w-4" /> {student.class_id ? "Transférer" : "Assigner"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="press"><Trash2 className="mr-1.5 h-4 w-4" /> Supprimer</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer {student.first_name} {student.last_name} ?</AlertDialogTitle>
              <AlertDialogDescription>L'élève disparaîtra de la liste. L'historique reste conservé.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={async () => {
                if (enrollment) {
                  await supabase.from("student_enrollments").update({ ended_at: new Date().toISOString() }).eq("id", enrollment.id)
                    .then(() => qc.invalidateQueries({ queryKey: ["student_enrollments"] }));
                }
                archive.mutate(student.id, {
                  onSuccess: () => navigate({ to: "/etablissements/$id", params: { id: student.establishment_id } }),
                });
              }}>Supprimer</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <RecordDialog open={editOpen} onOpenChange={setEditOpen} title="Modifier l'élève" fields={editFields}
        initial={student} submitting={save.isPending}
        onSubmit={(values) => save.mutate({ id: student.id, values }, { onSuccess: () => setEditOpen(false) })} />
      <RecordDialog open={transferOpen} onOpenChange={setTransferOpen}
        title={student.class_id ? `Transférer ${student.first_name}` : `Assigner ${student.first_name}`}
        description="Nouvelle période de scolarité pour la classe de destination."
        fields={[{ name: "class_id", label: "Classe", type: "select", required: true, colSpan: 2, options: classOptions }]}
        submitting={transferring} onSubmit={transferStudent} />
      <PayDialog open={payOpen} onClose={() => setPayOpen(false)} student={student}
        enrollment={enrollment} paid={paid} totalDue={totalDue} />
    </>
  );
}
