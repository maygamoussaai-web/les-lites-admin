import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { writeAudit } from "@/lib/data";
import { describeError } from "@/lib/errors";
import type { SchoolData } from "@/lib/school-data";

type Data = SchoolData;

export function AssignTeacherDialog({
  open,
  onClose,
  establishmentId,
  data,
}: {
  open: boolean;
  onClose: () => void;
  establishmentId: string;
  data: Data;
}) {
  const qc = useQueryClient();
  const [teacherId, setTeacherId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"hourly" | "fixed_salary">("hourly");
  const [hourlyRate, setHourlyRate] = useState("");
  const [fixedSalary, setFixedSalary] = useState("");
  const [busy, setBusy] = useState(false);

  const assignedIds = new Set(
    data.assignments.filter((a) => a.establishment_id === establishmentId).map((a) => a.teacher_id),
  );
  const available = data.teachers.filter((t) => !assignedIds.has(t.id));

  const submit = async () => {
    if (!teacherId) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("teacher_assignments").insert({
        teacher_id: teacherId,
        establishment_id: establishmentId,
        payment_method: paymentMethod,
        hourly_rate: paymentMethod === "hourly" ? Number(hourlyRate) || 0 : null,
        fixed_salary: paymentMethod === "fixed_salary" ? Number(fixedSalary) || 0 : null,
      });
      if (error) throw error;
      await writeAudit("create", "teacher_assignments" as never, null, {
        teacher_id: teacherId,
        establishment_id: establishmentId,
      });
      qc.invalidateQueries({ queryKey: ["teacher_assignments"] });
      toast.success("Enseignant assigné");
      setTeacherId("");
      setHourlyRate("");
      setFixedSalary("");
      onClose();
    } catch (e) {
      toast.error(describeError(e, "Assignation impossible"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assigner un enseignant</DialogTitle>
          <DialogDescription>Choisissez l'enseignant et le mode de rémunération.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block text-sm">Enseignant</Label>
            <Select value={teacherId || undefined} onValueChange={setTeacherId}>
              <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
              <SelectContent>
                {available.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.last_name} {t.first_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {available.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">Tous les enseignants sont déjà assignés ici.</p>
            )}
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">Mode de paiement</Label>
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as "hourly" | "fixed_salary")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Tarif horaire</SelectItem>
                <SelectItem value="fixed_salary">Salaire fixe</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {paymentMethod === "hourly" ? (
            <div>
              <Label className="mb-1.5 block text-sm">Tarif horaire (FCFA)</Label>
              <Input type="number" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
            </div>
          ) : (
            <div>
              <Label className="mb-1.5 block text-sm">Salaire fixe (FCFA)</Label>
              <Input type="number" value={fixedSalary} onChange={(e) => setFixedSalary(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} disabled={!teacherId || busy}>{busy ? "…" : "Assigner"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
