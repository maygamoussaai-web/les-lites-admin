/**
 * Dialogue rapide : paiement enseignant (tableau de bord).
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSaveRow } from "@/lib/data";
import { formatFCFA } from "@/lib/format";
import { teacherDue, sum } from "@/lib/school";
import type { SchoolData } from "@/lib/school-data";

type Data = SchoolData;

export function QuickTeacherPaymentDialog({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: Data;
}) {
  const savePayment = useSaveRow("teacher_payments", "Paiement");
  const [establishmentId, setEstablishmentId] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setEstablishmentId(data.establishments[0]?.id ?? "");
    setAmount("");
    setPaidAt(new Date().toISOString().slice(0, 10));
    setNote("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const assignments = data.assignments.filter((a) => a.establishment_id === establishmentId);

  useEffect(() => {
    setAssignmentId(assignments[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [establishmentId]);

  const assignment = assignments.find((a) => a.id === assignmentId) ?? null;
  const due = assignment ? teacherDue(assignment, data.sessions, data.sessionCompletions) : 0;
  const paidSoFar = assignment
    ? sum(
        data.teacherPayments
          .filter(
            (p) =>
              p.teacher_id === assignment.teacher_id && p.establishment_id === establishmentId,
          )
          .map((p) => Number(p.amount)),
      )
    : 0;
  const remaining = Math.max(0, due - paidSoFar);
  const amountNum = Number(amount || 0);
  const exceeds = amountNum > remaining;
  const canSubmit = !!assignment && amountNum > 0 && !exceeds && !savePayment.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enregistrer un paiement de prof</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">
              Établissement<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select value={establishmentId} onValueChange={setEstablishmentId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner" />
              </SelectTrigger>
              <SelectContent>
                {data.establishments.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">
              Enseignant<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select
              value={assignmentId}
              onValueChange={setAssignmentId}
              disabled={!assignments.length}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={assignments.length ? "Sélectionner" : "Aucun enseignant affecté"}
                />
              </SelectTrigger>
              <SelectContent>
                {assignments.map((a) => {
                  const t = data.teachers.find((x) => x.id === a.teacher_id);
                  return (
                    <SelectItem key={a.id} value={a.id}>
                      {t ? `${t.last_name} ${t.first_name}` : "Enseignant"}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {assignment ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Reste dû : {formatFCFA(remaining)}
              </p>
            ) : null}
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">
              Montant (FCFA)<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              type="number"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
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
          <Button
            disabled={!canSubmit}
            onClick={() =>
              savePayment.mutate(
                {
                  values: {
                    amount: amountNum,
                    paid_at: paidAt,
                    note: note || null,
                    teacher_id: assignment!.teacher_id,
                    establishment_id: establishmentId,
                  },
                },
                { onSuccess: onClose },
              )
            }
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
