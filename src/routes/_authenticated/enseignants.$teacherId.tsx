import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Banknote, ShieldAlert, Pencil, X, Building2, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { supabase } from "@/integrations/supabase/client";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSaveRow, useArchiveRow, writeAudit } from "@/lib/data";
import { useSchoolData } from "@/lib/school-data";
import { teacherDue, sum, type TeacherAssignment } from "@/lib/school";
import { formatFCFA, formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/enseignants/$teacherId")({
  head: () => ({
    meta: [
      { title: "Fiche enseignant – Les Élites de Gao" },
      { name: "description", content: "Fiche complète d'un enseignant : établissements assignés, paiements et historique." },
    ],
  }),
  component: Page,
});

function Page() {
  const { teacherId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isDG, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const data = useSchoolData();
  const saveTeacher = useSaveRow("teachers", "Enseignant");
  const [editOpen, setEditOpen] = useState(false);
  const [payFor, setPayFor] = useState<TeacherAssignment | null>(null);
  const [removing, setRemoving] = useState<TeacherAssignment | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const teacher = data.teachers.find((t) => t.id === teacherId);
  const assignments = data.assignments.filter((a) => a.teacher_id === teacherId);
  const allowed = assignments.length > 0 && (isDG || assignments.some((a) => establishmentIds.includes(a.establishment_id)));

  if (!data.loading && !establishmentIdsLoading && (!teacher || !allowed)) {
    return (
      <EmptyState icon={ShieldAlert} title="Enseignant introuvable" description="Cet enseignant n'existe pas ou vous n'y avez pas accès." />
    );
  }
  if (!teacher) return null;

  const visibleAssignments = isDG ? assignments : assignments.filter((a) => establishmentIds.includes(a.establishment_id));

  const totalDue = sum(visibleAssignments.map((a) => teacherDue(a, data.sessions, data.sessionCompletions)));
  const totalPaid = sum(
    data.teacherPayments
      .filter((p) => p.teacher_id === teacherId && visibleAssignments.some((a) => a.establishment_id === p.establishment_id))
      .map((p) => Number(p.amount)),
  );

  const payments = data.teacherPayments
    .filter((p) => p.teacher_id === teacherId)
    .filter((p) => visibleAssignments.some((a) => a.establishment_id === p.establishment_id))
    .filter((p) => (!from || p.paid_at >= from) && (!to || p.paid_at <= to))
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at));

  const removeFromEstablishment = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      const sessionIds = data.sessions.filter((s) => s.assignment_id === removing.id).map((s) => s.id);
      if (sessionIds.length) {
        await supabase.from("teacher_session_completions").delete().in("session_id", sessionIds);
        await supabase.from("teacher_sessions").delete().eq("assignment_id", removing.id);
      }
      const { error } = await supabase.from("teacher_assignments").delete().eq("id", removing.id);
      if (error) throw error;
      await writeAudit("delete", "teacher_assignments", removing.id, { teacher_id: teacherId });
      qc.invalidateQueries({ queryKey: ["teacher_assignments"] });
      qc.invalidateQueries({ queryKey: ["teacher_sessions"] });
      toast.success("Retiré de l'établissement");
      setRemoving(null);
    } catch (e) {
      toast.error((e as Error).message || "Retrait impossible");
    } finally {
      setRemoveBusy(false);
    }
  };

  const editFields: Field[] = [
    { name: "first_name", label: "Prénom", required: true },
    { name: "last_name", label: "Nom", required: true },
    { name: "phone", label: "Téléphone" },
    { name: "domain", label: "Domaine" },
  ];

  const primaryEstablishmentId = visibleAssignments[0]?.establishment_id;

  return (
    <>
      {primaryEstablishmentId && (
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
          <Link to="/enseignants">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour aux enseignants
          </Link>
        </Button>
      )}

      <PageHeader
        eyebrow="Fiche enseignant"
        title={`${teacher.last_name} ${teacher.first_name}`}
        description={teacher.domain ?? "Aucun domaine renseigné"}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Identité</CardTitle>
            <Button variant="ghost" size="sm" className="press" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1.5 h-4 w-4" /> Modifier
            </Button>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Téléphone</span>
              <span className="font-medium text-foreground">{teacher.phone ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between pb-2">
              <span className="text-muted-foreground">Domaine</span>
              <span className="font-medium text-foreground">{teacher.domain ?? "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{isDG ? "Total (tous établissements)" : "Total"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Dû</span>
              <span className="font-medium text-foreground">{formatFCFA(totalDue)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-muted-foreground">Payé</span>
              <span className="font-medium text-foreground">{formatFCFA(totalPaid)}</span>
            </div>
            <div className="flex items-center justify-between pb-2">
              <span className="text-muted-foreground">Reste dû</span>
              <span className="font-semibold text-foreground">{formatFCFA(Math.max(0, totalDue - totalPaid))}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h3 className="font-display text-lg font-semibold">Établissements assignés</h3>
        {visibleAssignments.length === 0 ? (
          <EmptyState icon={Building2} title="Aucun établissement" description="Cet enseignant n'est assigné nulle part." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleAssignments.map((a) => {
              const est = data.establishments.find((e) => e.id === a.establishment_id);
              const due = teacherDue(a, data.sessions, data.sessionCompletions);
              const paid = sum(
                data.teacherPayments
                  .filter((p) => p.teacher_id === teacherId && p.establishment_id === a.establishment_id)
                  .map((p) => Number(p.amount)),
              );
              return (
                <Card key={a.id} className="animate-rise panel-gradient">
                  <CardContent className="space-y-2.5 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-display font-semibold text-foreground">{est?.name ?? "—"}</p>
                        <Badge variant={a.payment_method === "fixed_salary" ? "secondary" : "outline"} className="mt-1">
                          {a.payment_method === "fixed_salary" ? "Salaire fixe" : "Tarif horaire"}
                        </Badge>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive">
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Retirer de {est?.name} ?</AlertDialogTitle>
                            <AlertDialogDescription>
                              L'enseignant ne sera plus affecté à cet établissement. Son emploi du temps pour cet
                              établissement sera supprimé. L'historique des paiements déjà effectués reste conservé.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuler</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => {
                                setRemoving(a);
                                removeFromEstablishment();
                              }}
                              disabled={removeBusy}
                            >
                              Retirer
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Dû</p>
                        <p className="font-medium">{formatFCFA(due)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Payé</p>
                        <p className="font-medium">{formatFCFA(paid)}</p>
                      </div>
                    </div>
                    <Button size="sm" className="press w-full" onClick={() => setPayFor(a)}>
                      <Banknote className="mr-1.5 h-4 w-4" /> Payer
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="font-display text-lg font-semibold">Historique des paiements</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Du</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Au</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" />
            </div>
            {(from || to) && (
              <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>
                Réinitialiser
              </Button>
            )}
          </div>
        </div>

        {payments.length === 0 ? (
          <EmptyState icon={Banknote} title="Aucun paiement" description="Aucun paiement enregistré pour cette période." />
        ) : (
          <div className="space-y-2">
            {payments.map((p, index) => {
              const est = data.establishments.find((e) => e.id === p.establishment_id);
              return (
                <div
                  key={p.id}
                  className="animate-rise flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 text-sm"
                  style={{ animationDelay: `${Math.min(index, 15) * 30}ms` }}
                >
                  <div>
                    <p className="font-medium text-foreground">{formatFCFA(p.amount)}</p>
                    <p className="text-xs text-muted-foreground">
                      {est?.name ?? "—"}
                      {p.note ? ` · ${p.note}` : ""}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">Payé le {formatDate(p.paid_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <RecordDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Modifier l'enseignant"
        fields={editFields}
        initial={teacher}
        submitting={saveTeacher.isPending}
        onSubmit={(values) => saveTeacher.mutate({ id: teacher.id, values }, { onSuccess: () => setEditOpen(false) })}
      />

      <TeacherPayDialog
        open={!!payFor}
        onClose={() => setPayFor(null)}
        assignment={payFor}
        teacherName={`${teacher.last_name} ${teacher.first_name}`}
        data={data}
      />
    </>
  );
}

function TeacherPayDialog({
  open,
  onClose,
  assignment,
  teacherName,
  data,
}: {
  open: boolean;
  onClose: () => void;
  assignment: TeacherAssignment | null;
  teacherName: string;
  data: ReturnType<typeof useSchoolData>;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setPaidAt(new Date().toISOString().slice(0, 10));
    setNote("");
  }, [open, assignment?.id]);

  const due = assignment ? teacherDue(assignment, data.sessions, data.sessionCompletions) : 0;
  const paidSoFar = assignment
    ? sum(
        data.teacherPayments
          .filter((p) => p.teacher_id === assignment.teacher_id && p.establishment_id === assignment.establishment_id)
          .map((p) => Number(p.amount)),
      )
    : 0;
  const remaining = Math.max(0, due - paidSoFar);
  const amountNum = Number(amount || 0);
  const exceeds = amountNum > remaining;
  const canSubmit = !!assignment && amountNum > 0 && !exceeds && !submitting;

  const submit = async () => {
    if (!canSubmit || !assignment) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("teacher_payments").insert({
        teacher_id: assignment.teacher_id,
        establishment_id: assignment.establishment_id,
        amount: amountNum,
        paid_at: paidAt,
        note: note || null,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["teacher_payments"] });
      toast.success("Paiement enregistré");
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Enregistrement impossible");
    } finally {
      setSubmitting(false);
    }
  };

  const establishment = assignment ? data.establishments.find((e) => e.id === assignment.establishment_id) : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Paiement — {teacherName} ({establishment?.name ?? "—"})
          </DialogTitle>
          <DialogDescription>Reste dû pour cet établissement : {formatFCFA(remaining)}</DialogDescription>
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