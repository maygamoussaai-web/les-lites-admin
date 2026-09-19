import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Banknote, UserPlus, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useSaveRow, writeAudit } from "@/lib/data";
import { teacherDue, sum, type TeacherAssignment } from "@/lib/school";
import { formatFCFA } from "@/lib/format";
import { describeError } from "@/lib/errors";
import { AssignTeacherDialog } from "@/components/school/assign-teacher-dialog";
import type { SchoolData } from "@/lib/school-data";

type Data = SchoolData;

function TeacherPaymentDialog({
  open, onClose, assignment, teacherName, establishmentId, data,
}: {
  open: boolean;
  onClose: () => void;
  assignment: TeacherAssignment | null;
  teacherName: string;
  establishmentId: string;
  data: Data;
}) {
  const savePayment = useSaveRow("teacher_payments", "Paiement");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  const due = assignment ? teacherDue(assignment, data.sessions, data.sessionCompletions) : 0;
  const paidSoFar = assignment
    ? sum(data.teacherPayments.filter((p) => p.teacher_id === assignment.teacher_id && p.establishment_id === establishmentId).map((p) => Number(p.amount)))
    : 0;
  const remaining = Math.max(0, due - paidSoFar);
  const amountNum = Number(amount || 0);
  const canSubmit = !!assignment && amountNum > 0 && amountNum <= remaining && !savePayment.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Paiement — {teacherName}</DialogTitle>
          <DialogDescription>Reste dû : {formatFCFA(remaining)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-sm">Montant (FCFA)</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
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
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              if (!assignment) return;
              savePayment.mutate(
                {
                  id: null,
                  values: {
                    teacher_id: assignment.teacher_id,
                    establishment_id: establishmentId,
                    amount: amountNum,
                    paid_at: paidAt,
                    note: note || null,
                  },
                },
                {
                  onSuccess: () => {
                    setAmount("");
                    setNote("");
                    onClose();
                  },
                },
              );
            }}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TeachersTab({
  establishmentId, data, isDG,
}: {
  establishmentId: string;
  data: Data;
  isDG: boolean;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [payFor, setPayFor] = useState<TeacherAssignment | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const assignments = data.assignments.filter((a) => a.establishment_id === establishmentId);

  const remove = async (a: TeacherAssignment) => {
    setBusyId(a.id);
    try {
      const sessionIds = data.sessions.filter((s) => s.assignment_id === a.id).map((s) => s.id);
      if (sessionIds.length) {
        await supabase.from("teacher_session_completions").delete().in("session_id", sessionIds);
        await supabase.from("teacher_sessions").delete().eq("assignment_id", a.id);
      }
      const { error } = await supabase.from("teacher_assignments").delete().eq("id", a.id);
      if (error) throw error;
      await writeAudit("delete", "teacher_assignments", a.id, { establishment_id: establishmentId });
      toast.success("Enseignant retiré");
    } catch (e) {
      toast.error(describeError(e, "Retrait impossible"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="press" onClick={() => setAssignOpen(true)}>
          <UserPlus className="mr-1.5 h-4 w-4" /> Assigner un enseignant
        </Button>
      </div>
      {assignments.length === 0 ? (
        <EmptyState icon={UserPlus} title="Aucun enseignant" description="Assignez le premier enseignant à cet établissement." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assignments.map((a) => {
            const t = data.teachers.find((x) => x.id === a.teacher_id);
            const due = teacherDue(a, data.sessions, data.sessionCompletions);
            const paid = sum(
              data.teacherPayments
                .filter((p) => p.teacher_id === a.teacher_id && p.establishment_id === establishmentId)
                .map((p) => Number(p.amount)),
            );
            return (
              <Card key={a.id} className="animate-rise">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        to="/enseignants/$teacherId"
                        params={{ teacherId: a.teacher_id }}
                        className="font-display font-semibold hover:underline"
                      >
                        {t ? `${t.last_name} ${t.first_name}` : "—"}
                      </Link>
                      <Badge variant="outline" className="mt-1 block w-fit">
                        {a.payment_method === "fixed_salary" ? "Salaire fixe" : "Tarif horaire"}
                      </Badge>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" disabled={busyId === a.id}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Retirer cet enseignant ?</AlertDialogTitle>
                          <AlertDialogDescription>L'affectation sera supprimée. L'historique des paiements reste conservé.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annuler</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void remove(a)}>Retirer</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><p className="text-xs text-muted-foreground">Dû</p><p className="font-medium">{formatFCFA(due)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Payé</p><p className="font-medium">{formatFCFA(paid)}</p></div>
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
      <AssignTeacherDialog open={assignOpen} onClose={() => setAssignOpen(false)} establishmentId={establishmentId} data={data} />
      <TeacherPaymentDialog
        open={!!payFor}
        onClose={() => setPayFor(null)}
        assignment={payFor}
        teacherName={payFor ? (() => {
          const t = data.teachers.find((x) => x.id === payFor.teacher_id);
          return t ? `${t.last_name} ${t.first_name}` : "Enseignant";
        })() : ""}
        establishmentId={establishmentId}
        data={data}
      />
    </div>
  );
}
