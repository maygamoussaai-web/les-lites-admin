import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatFCFA } from "@/lib/format";
import { describeError } from "@/lib/errors";
import { teacherDue, sum, type TeacherAssignment } from "@/lib/school";
import { useSchoolData } from "@/lib/school-data";

export function TeacherPayDialog({
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
      toast.error(describeError(e, "Enregistrement impossible"));
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
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button disabled={!canSubmit} onClick={submit}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
