import { useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Pencil, ArrowRightLeft, Trash2, ShieldAlert, Receipt, Wallet } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentDocuments } from "@/components/school/student-documents";
import { supabase } from "@/integrations/supabase/client";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSaveRow, useArchiveRow, writeAudit } from "@/lib/data";
import { useSchoolData } from "@/lib/school-data";
import { annualAverage, lateStatus, sum, type Installment } from "@/lib/school";
import { formatDate, formatFCFA, formatNumber } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/eleves/$studentId/")({
  head: () => ({
    meta: [
      { title: "Fiche élève – Les Élites de Gao" },
      { name: "description", content: "Profil complet d'un élève : identité, scolarité et résultats." },
    ],
  }),
  component: Page,
});

function Page() {
  const { studentId } = Route.useParams();
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
  const avg = annualAverage(student);

  const editFields: Field[] = [
    { name: "first_name", label: "Prénom", required: true },
    { name: "last_name", label: "Nom", required: true },
    {
      name: "gender",
      label: "Sexe",
      type: "select",
      required: true,
      options: [
        { value: "M", label: "Masculin" },
        { value: "F", label: "Féminin" },
      ],
    },
    { name: "date_of_birth", label: "Date de naissance", type: "date" },
    { name: "parent_phone_1", label: "Téléphone parent 1" },
    { name: "parent_phone_2", label: "Téléphone parent 2" },
    { name: "term1_average", label: "Moyenne trimestre 1", type: "number" },
    { name: "term2_average", label: "Moyenne trimestre 2", type: "number" },
    { name: "term3_average", label: "Moyenne trimestre 3", type: "number" },
  ];

  const classOptions = data.classes
    .filter((c) => c.id !== student.class_id)
    .map((c) => ({
      value: c.id,
      label: `${data.establishments.find((e) => e.id === c.establishment_id)?.name ?? ""} — ${c.name}`,
    }));

  // Transfert (ou première affectation si l'élève n'a pas de classe) : si la
  // période active n'a AUCUN paiement, elle est redirigée vers la nouvelle
  // classe (pas de trace fantôme) — sinon elle est close et une nouvelle
  // période démarre.
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
        label: i.label,
        amount: i.amount,
        due_date: i.due_date,
        position: i.position,
      }));

      if (enrollment && paid === 0) {
        const { error: redirectError } = await supabase
          .from("student_enrollments")
          .update({
            establishment_id: target.establishment_id,
            class_id: target.id,
            establishment_name: targetEstablishment?.name ?? "",
            class_name: target.name,
            fee_plan_id: target.fee_plan_id,
            total_amount: targetPlan ? Number(targetPlan.total_amount) : 0,
            installments_snapshot: targetSnapshot as never,
            started_at: new Date().toISOString(),
          })
          .eq("id", enrollment.id);
        if (redirectError) throw redirectError;
      } else {
        if (enrollment) {
          const { error: closeError } = await supabase
            .from("student_enrollments")
            .update({ ended_at: new Date().toISOString() })
            .eq("id", enrollment.id);
          if (closeError) throw closeError;
        }
        const { error: enrollError } = await supabase.from("student_enrollments").insert({
          student_id: student.id,
          establishment_id: target.establishment_id,
          class_id: target.id,
          establishment_name: targetEstablishment?.name ?? "",
          class_name: target.name,
          fee_plan_id: target.fee_plan_id,
          total_amount: targetPlan ? Number(targetPlan.total_amount) : 0,
          installments_snapshot: targetSnapshot as never,
        });
        if (enrollError) throw enrollError;
      }

      await supabase.from("student_transfers").insert({
        student_id: student.id,
        from_class_id: student.class_id,
        from_establishment_id: student.establishment_id,
        to_class_id: target.id,
        to_establishment_id: target.establishment_id,
      });
      await writeAudit("update", "students", student.id, { transferred_to_class_id: target.id });

      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["student_enrollments"] });
      toast.success(student.class_id ? "Élève transféré" : "Élève assigné");
      setTransferOpen(false);
      navigate({ to: "/etablissements/$id", params: { id: target.establishment_id } });
    } catch (e) {
      toast.error((e as Error).message || "Opération impossible");
    } finally {
      setTransferring(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit"
        onClick={() => navigate({ to: "/etablissements/$id", params: { id: student.establishment_id } })}
      >
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour à {establishment?.name ?? "l'établissement"}
      </Button>

      <PageHeader
        eyebrow={klass?.name ?? "Élève"}
        title={`${student.last_name} ${student.first_name}`}
        description={`${establishment?.name ?? "—"} · Inscrit le ${formatDate(student.enrolled_at)}`}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identité</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <Row label="Sexe" value={student.gender === "F" ? "Féminin" : "Masculin"} />
            <Row label="Date de naissance" value={formatDate(student.date_of_birth)} />
            <Row label="Téléphone parent 1" value={student.parent_phone_1 ?? "—"} />
            <Row label="Téléphone parent 2" value={student.parent_phone_2 ?? "—"} />
            <Row label="Date d'inscription" value={formatDate(student.enrolled_at)} />
            <Row label="Classe actuelle" value={klass ? klass.name : <Badge variant="outline">Non assignée</Badge>} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Scolarité (période en cours)</CardTitle>
            <Button variant="ghost" size="sm" className="press" asChild>
              <Link to="/eleves/$studentId/scolarite" params={{ studentId: student.id }}>
                <Receipt className="mr-1.5 h-4 w-4" /> Fiche de scolarité
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            {enrollment ? (
              <>
                <Row label="Payé" value={formatFCFA(paid)} />
                <Row label="Total attendu" value={formatFCFA(totalDue)} />
                <Row
                  label="Statut"
                  value={
                    late ? (
                      late.isLate ? (
                        <Badge variant="destructive">Retard {formatFCFA(late.overdueAmount)}</Badge>
                      ) : (
                        <Badge className="bg-success text-success-foreground">À jour</Badge>
                      )
                    ) : (
                      "Aucun modèle"
                    )
                  }
                />
                <Button size="sm" className="press w-full" onClick={() => setPayOpen(true)}>
                  <Wallet className="mr-1.5 h-4 w-4" /> Enregistrer un paiement de scolarité
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">Aucune période active — assignez l'élève à une classe.</p>
            )}
          </CardContent>
        </Card>

       <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Résultats</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Trimestre 1" value={student.term1_average} />
            <Metric label="Trimestre 2" value={student.term2_average} />
            <Metric label="Trimestre 3" value={student.term3_average} />
            <Metric label="Moyenne annuelle" value={avg} highlight />
          </CardContent>
        </Card>

        <StudentDocuments studentId={student.id} establishmentId={student.establishment_id} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button className="press" onClick={() => setEditOpen(true)}>
          <Pencil className="mr-1.5 h-4 w-4" /> Modifier
        </Button>
        <Button variant="outline" className="press" onClick={() => setTransferOpen(true)}>
          <ArrowRightLeft className="mr-1.5 h-4 w-4" /> {student.class_id ? "Transférer l'élève" : "Assigner l'élève"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="press">
              <Trash2 className="mr-1.5 h-4 w-4" /> Supprimer l'élève
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Supprimer {student.first_name} {student.last_name} ?
              </AlertDialogTitle>
              <AlertDialogDescription>
                L'élève disparaîtra de la liste de sa classe. Son historique (paiements, transferts, résultats) reste
                conservé.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (enrollment) {
                    await supabase
                      .from("student_enrollments")
                      .update({ ended_at: new Date().toISOString() })
                      .eq("id", enrollment.id)
                      .then(() => qc.invalidateQueries({ queryKey: ["student_enrollments"] }));
                  }
                  archive.mutate(student.id, {
                    onSuccess: () =>
                      navigate({ to: "/etablissements/$id", params: { id: student.establishment_id } }),
                  });
                }}
              >
                Supprimer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <RecordDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Modifier l'élève"
        fields={editFields}
        initial={student}
        submitting={save.isPending}
        onSubmit={(values) => save.mutate({ id: student.id, values }, { onSuccess: () => setEditOpen(false) })}
      />

      <RecordDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        title={student.class_id ? `Transférer ${student.first_name} ${student.last_name}` : `Assigner ${student.first_name} ${student.last_name}`}
        description="Une nouvelle période de scolarité sera ouverte pour la classe de destination ; l'ancienne reste consultable dans la fiche de scolarité."
        fields={[{ name: "class_id", label: "Classe", type: "select", required: true, colSpan: 2, options: classOptions }]}
        submitting={transferring}
        onSubmit={transferStudent}
      />

      <PayDialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        student={student}
        enrollment={enrollment}
        paid={paid}
        totalDue={totalDue}
      />
    </>
  );
}

function PayDialog({
  open,
  onClose,
  student,
  enrollment,
  paid,
  totalDue,
}: {
  open: boolean;
  onClose: () => void;
  student: NonNullable<ReturnType<typeof useSchoolData>["students"][number]>;
  enrollment: ReturnType<typeof useSchoolData>["activeEnrollmentByStudent"] extends Map<string, infer V> ? V | undefined : never;
  paid: number;
  totalDue: number;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const remaining = Math.max(0, totalDue - paid);
  const amountNum = Number(amount || 0);
  const exceeds = totalDue > 0 && amountNum > remaining;
  const canSubmit = !!enrollment && amountNum > 0 && !exceeds && !submitting;

  const submit = async () => {
    if (!canSubmit || !enrollment) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("tuition_payments").insert({
        student_id: student.id,
        enrollment_id: enrollment.id,
        amount: amountNum,
        paid_at: paidAt,
        method,
        note: note || null,
        establishment_id: student.establishment_id,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["tuition_payments"] });
      toast.success("Paiement enregistré");
      setAmount("");
      setNote("");
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Enregistrement impossible");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Paiement de scolarité — {student.last_name} {student.first_name}</DialogTitle>
          <DialogDescription>Reste dû : {formatFCFA(remaining)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-sm">
              Montant (FCFA)<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {exceeds ? (
              <p className="mt-1 text-xs font-medium text-destructive">
                Le montant dépasse le reste dû ({formatFCFA(remaining)}).
              </p>
            ) : null}
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">Date</Label>
            <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">Moyen de paiement</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Espèces</SelectItem>
                <SelectItem value="mobile_money">Mobile money</SelectItem>
                <SelectItem value="bank">Banque</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: number | null; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={highlight ? "mt-1 font-display text-xl font-semibold text-primary" : "mt-1 text-lg font-semibold"}>
        {value === null || value === undefined ? "—" : formatNumber(value, 2)}
      </p>
    </div>
  );
}