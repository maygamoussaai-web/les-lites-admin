/**
 * Dialogue d'assignation d'un enseignant à un établissement.
 * Deux modes : choisir un enseignant déjà présent dans l'app, ou en créer un nouveau.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { writeAudit } from "@/lib/data";
import { describeError } from "@/lib/errors";
import type { SchoolData } from "@/lib/school-data";

type Data = SchoolData;
type Mode = "existing" | "new";
type PayMethod = "hourly" | "fixed_salary";

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
  const [mode, setMode] = useState<Mode>("existing");
  const [teacherId, setTeacherId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [domain, setDomain] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PayMethod>("hourly");
  const [hourlyRate, setHourlyRate] = useState("");
  const [salaryAmount, setSalaryAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const assignedIds = new Set(
    data.assignments
      .filter((a) => a.establishment_id === establishmentId)
      .map((a) => a.teacher_id),
  );
  const available = data.teachers.filter((t) => !assignedIds.has(t.id));

  const canSubmit =
    mode === "existing"
      ? Boolean(teacherId)
      : Boolean(firstName.trim() && lastName.trim());

  const reset = () => {
    setMode("existing");
    setTeacherId("");
    setFirstName("");
    setLastName("");
    setPhone("");
    setDomain("");
    setHourlyRate("");
    setSalaryAmount("");
    setPaymentMethod("hourly");
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      let finalTeacherId = teacherId;

      if (mode === "new") {
        const teacherRow = {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim() || null,
          domain: domain.trim() || null,
        };
        const { data: created, error: tErr } = await supabase
          .from("teachers")
          .insert(teacherRow)
          .select("id")
          .single();
        if (tErr) throw tErr;
        if (!created?.id) throw new Error("Création enseignant échouée");
        finalTeacherId = created.id;
        await writeAudit("create", "teachers" as never, created.id, teacherRow);
      }

      const assignmentRow = {
        teacher_id: finalTeacherId,
        establishment_id: establishmentId,
        payment_method: paymentMethod as string,
        hourly_rate: paymentMethod === "hourly" ? Number(hourlyRate) || 0 : 0,
        salary_amount: paymentMethod === "fixed_salary" ? Number(salaryAmount) || 0 : 0,
      };
      const { error: aErr } = await supabase.from("teacher_assignments").insert(assignmentRow);
      if (aErr) throw aErr;
      await writeAudit("create", "teacher_assignments" as never, null, {
        teacher_id: finalTeacherId,
        establishment_id: establishmentId,
      });

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["teachers"] }),
        qc.invalidateQueries({ queryKey: ["teacher_assignments"] }),
      ]);

      toast.success(mode === "new" ? "Enseignant créé et assigné" : "Enseignant assigné");
      reset();
      onClose();
    } catch (e) {
      toast.error(describeError(e, "Assignation impossible"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="flex max-h-[min(90vh,640px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="shrink-0 space-y-1.5 border-b border-border px-6 pb-4 pt-6 text-left">
          <DialogTitle>Assigner un enseignant</DialogTitle>
          <DialogDescription>
            Choisissez un enseignant déjà présent dans le complexe, ou créez-en un nouveau.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1">
            <button
              type="button"
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition",
                mode === "existing"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setMode("existing")}
            >
              Existant
            </button>
            <button
              type="button"
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition",
                mode === "new"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setMode("new")}
            >
              Nouveau
            </button>
          </div>

          {/* Hauteur mini stable pour éviter le saut de scroll au changement d'onglet */}
          <div className="mt-4 min-h-[11.5rem] space-y-4">
            {mode === "existing" ? (
              <div>
                <Label className="mb-1.5 block text-sm">Enseignant</Label>
                <Select value={teacherId || ""} onValueChange={setTeacherId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner" />
                  </SelectTrigger>
                  <SelectContent>
                    {available.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.last_name} {t.first_name}
                        {t.domain ? ` · ${t.domain}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {available.length === 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Aucun enseignant disponible. Passez sur l’onglet{" "}
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => setMode("new")}
                    >
                      Nouveau
                    </button>{" "}
                    pour en créer un.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="mb-1.5 block text-sm">
                      Prénom<span className="ml-0.5 text-destructive">*</span>
                    </Label>
                    <Input
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Amadou"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-sm">
                      Nom<span className="ml-0.5 text-destructive">*</span>
                    </Label>
                    <Input
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Traoré"
                      autoComplete="off"
                    />
                  </div>
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm">Téléphone</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+223 …"
                    inputMode="tel"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm">Domaine / matière</Label>
                  <Input
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="Mathématiques, Français…"
                  />
                </div>
              </div>
            )}

            <div>
              <Label className="mb-1.5 block text-sm">Mode de paiement</Label>
              <Select
                value={paymentMethod}
                onValueChange={(v) => setPaymentMethod(v as PayMethod)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Tarif horaire</SelectItem>
                  <SelectItem value="fixed_salary">Salaire fixe</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {paymentMethod === "hourly" ? (
              <div>
                <Label className="mb-1.5 block text-sm">Tarif horaire (FCFA)</Label>
                <Input
                  type="number"
                  min={0}
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                />
              </div>
            ) : (
              <div>
                <Label className="mb-1.5 block text-sm">Salaire fixe (FCFA)</Label>
                <Input
                  type="number"
                  min={0}
                  value={salaryAmount}
                  onChange={(e) => setSalaryAmount(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:space-x-0">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Annuler
          </Button>
          <Button onClick={submit} disabled={!canSubmit || busy}>
            {busy ? "…" : mode === "new" ? "Créer et assigner" : "Assigner"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
