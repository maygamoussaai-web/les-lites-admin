/**
 * Dialogue rapide : paiement de scolarité (tableau de bord).
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
import { sum } from "@/lib/school";
import type { SchoolData } from "@/lib/school-data";

type Data = SchoolData;

export function QuickTuitionPaymentDialog({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: Data;
}) {
  const savePayment = useSaveRow("tuition_payments", "Paiement");
  const [establishmentId, setEstablishmentId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setEstablishmentId(data.establishments[0]?.id ?? "");
    setAmount("");
    setPaidAt(new Date().toISOString().slice(0, 10));
    setMethod("cash");
    setNote("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const students = data.students.filter((s) => s.establishment_id === establishmentId);

  useEffect(() => {
    setStudentId(students[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [establishmentId]);

  const student = students.find((s) => s.id === studentId) ?? null;
  const enrollment = student ? data.activeEnrollmentByStudent.get(student.id) : undefined;
  const expected = enrollment ? Number(enrollment.total_amount) : 0;
  const paidSoFar = enrollment
    ? sum(
        data.tuitionPayments
          .filter((p) => p.enrollment_id === enrollment.id)
          .map((p) => Number(p.amount)),
      )
    : 0;
  const remaining = Math.max(0, expected - paidSoFar);
  const hasPlan = expected > 0;
  const amountNum = Number(amount || 0);
  const exceeds = hasPlan && amountNum > remaining;
  const canSubmit =
    !!establishmentId &&
    !!studentId &&
    !!enrollment &&
    amountNum > 0 &&
    !exceeds &&
    !savePayment.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enregistrer un paiement de scolarité</DialogTitle>
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
              Élève<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select value={studentId} onValueChange={setStudentId} disabled={!students.length}>
              <SelectTrigger>
                <SelectValue placeholder={students.length ? "Sélectionner" : "Aucun élève"} />
              </SelectTrigger>
              <SelectContent>
                {students.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.last_name} {s.first_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {student ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {enrollment
                  ? hasPlan
                    ? `Reste dû : ${formatFCFA(remaining)}`
                    : "Aucun modèle de scolarité associé à cette période."
                  : "Cet élève n'a pas de période de scolarité active."}
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
              disabled={!enrollment}
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
          <Button
            disabled={!canSubmit}
            onClick={() =>
              savePayment.mutate(
                {
                  values: {
                    student_id: studentId,
                    enrollment_id: enrollment!.id,
                    amount: amountNum,
                    paid_at: paidAt,
                    method,
                    note: note || null,
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
