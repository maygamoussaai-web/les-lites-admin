import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSchoolData } from "@/lib/school-data";
import { formatFCFA } from "@/lib/format";
import { describeError } from "@/lib/errors";
import { downloadPaymentReceipt } from "@/lib/payment-receipt";

export function PayDialog({
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
  enrollment: ReturnType<typeof useSchoolData>["activeEnrollmentByStudent"] extends Map<string, infer V>
    ? V | undefined
    : never;
  paid: number;
  totalDue: number;
}) {
  const qc = useQueryClient();
  const school = useSchoolData();
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
      const remainingAfter = Math.max(0, totalDue - paid - amountNum);
      const estName =
        school.establishments.find((e) => e.id === student.establishment_id)?.name ?? "";
      const receiptPayload = {
        studentName: `${student.last_name} ${student.first_name}`,
        establishmentName: estName,
        amount: amountNum,
        paidAt,
        method,
        note: note || null,
        paidBefore: paid,
        totalDue,
        remainingAfter,
      };
      toast.success("Paiement enregistré", {
        action: {
          label: "Télécharger le reçu",
          onClick: () => {
            void downloadPaymentReceipt(receiptPayload).catch((err) =>
              toast.error(describeError(err, "Reçu impossible")),
            );
          },
        },
        duration: 12_000,
      });
      // Téléchargement auto du reçu
      try {
        await downloadPaymentReceipt(receiptPayload);
      } catch {
        /* toast action reste disponible */
      }
      setAmount("");
      setNote("");
      onClose();
    } catch (e) {
      toast.error(describeError(e, "Enregistrement impossible"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Paiement — {student.last_name} {student.first_name}
          </DialogTitle>
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
                Dépassement du reste dû ({formatFCFA(remaining)}).
              </p>
            ) : null}
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">Date</Label>
            <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">Moyen</Label>
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
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
