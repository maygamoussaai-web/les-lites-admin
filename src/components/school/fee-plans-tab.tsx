/**
 * Gestion des modèles de scolarité d'un établissement (grilles + tranches).
 * Les modifications n'affectent que les futures périodes d'inscription.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Banknote,
  Calendar,
  Pencil,
  Plus,
  Trash2,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { supabase } from "@/integrations/supabase/client";
import { writeAudit } from "@/lib/data";
import { formatFCFA, formatDate } from "@/lib/format";
import { describeError } from "@/lib/errors";
import type { SchoolData } from "@/lib/school-data";
import type { FeePlan, Installment } from "@/lib/school";
import { cn } from "@/lib/utils";

type PlanForm = { name: string; total_amount: string };
type InstForm = { label: string; amount: string; due_date: string };

const emptyPlan = (): PlanForm => ({ name: "", total_amount: "" });
const emptyInst = (): InstForm => ({
  label: "",
  amount: "",
  due_date: new Date().toISOString().slice(0, 10),
});

export function FeePlansTab({
  establishmentId,
  data,
}: {
  establishmentId: string;
  data: SchoolData;
}) {
  const qc = useQueryClient();
  const plans = useMemo(
    () =>
      data.feePlans
        .filter((p) => p.establishment_id === establishmentId)
        .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [data.feePlans, establishmentId],
  );

  const installmentsByPlan = useMemo(() => {
    const map = new Map<string, Installment[]>();
    for (const i of data.installments) {
      const list = map.get(i.fee_plan_id) ?? [];
      list.push(i);
      map.set(i.fee_plan_id, list);
    }
    for (const [id, list] of map) {
      list.sort(
        (a, b) =>
          (Number(a.position) || 0) - (Number(b.position) || 0) ||
          String(a.due_date).localeCompare(String(b.due_date)),
      );
      map.set(id, list);
    }
    return map;
  }, [data.installments]);

  const classesUsing = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of data.classes) {
      if (c.establishment_id !== establishmentId || !c.fee_plan_id) continue;
      map.set(c.fee_plan_id, (map.get(c.fee_plan_id) ?? 0) + 1);
    }
    return map;
  }, [data.classes, establishmentId]);

  const [planOpen, setPlanOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<FeePlan | null>(null);
  const [planForm, setPlanForm] = useState<PlanForm>(emptyPlan());
  const [planBusy, setPlanBusy] = useState(false);

  const [instOpen, setInstOpen] = useState(false);
  const [instPlanId, setInstPlanId] = useState<string | null>(null);
  const [editingInst, setEditingInst] = useState<Installment | null>(null);
  const [instForm, setInstForm] = useState<InstForm>(emptyInst());
  const [instBusy, setInstBusy] = useState(false);

  const [deletePlan, setDeletePlan] = useState<FeePlan | null>(null);
  const [deleteInst, setDeleteInst] = useState<Installment | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["fee_plans"] });
    qc.invalidateQueries({ queryKey: ["fee_plan_installments"] });
  };

  const openCreatePlan = () => {
    setEditingPlan(null);
    setPlanForm(emptyPlan());
    setPlanOpen(true);
  };

  const openEditPlan = (p: FeePlan) => {
    setEditingPlan(p);
    setPlanForm({ name: p.name, total_amount: String(p.total_amount) });
    setPlanOpen(true);
  };

  const savePlan = async () => {
    const name = planForm.name.trim();
    const total = Number(planForm.total_amount);
    if (!name) {
      toast.error("Nom du modèle requis");
      return;
    }
    if (!Number.isFinite(total) || total < 0) {
      toast.error("Montant total invalide");
      return;
    }
    setPlanBusy(true);
    try {
      if (editingPlan) {
        const { error } = await supabase
          .from("fee_plans")
          .update({ name, total_amount: total })
          .eq("id", editingPlan.id);
        if (error) throw error;
        await writeAudit("update", "fee_plans" as never, editingPlan.id, { name, total_amount: total });
        toast.success("Modèle mis à jour — les périodes déjà figées ne changent pas");
      } else {
        const { data: created, error } = await supabase
          .from("fee_plans")
          .insert({
            establishment_id: establishmentId,
            name,
            total_amount: total,
          })
          .select("id")
          .single();
        if (error) throw error;
        await writeAudit("create", "fee_plans" as never, created?.id ?? null, { name, total_amount: total });
        toast.success("Modèle créé — ajoutez les tranches");
      }
      invalidate();
      setPlanOpen(false);
    } catch (e) {
      toast.error(describeError(e, "Enregistrement du modèle impossible"));
    } finally {
      setPlanBusy(false);
    }
  };

  const confirmDeletePlan = async () => {
    if (!deletePlan) return;
    const used = classesUsing.get(deletePlan.id) ?? 0;
    if (used > 0) {
      toast.error(
        `Ce modèle est lié à ${used} classe(s). Changez d'abord le modèle de ces classes.`,
      );
      setDeletePlan(null);
      return;
    }
    setDeleteBusy(true);
    try {
      const { error: instErr } = await supabase
        .from("fee_plan_installments")
        .delete()
        .eq("fee_plan_id", deletePlan.id);
      if (instErr) throw instErr;
      const { error } = await supabase.from("fee_plans").delete().eq("id", deletePlan.id);
      if (error) throw error;
      await writeAudit("delete", "fee_plans" as never, deletePlan.id, {});
      toast.success("Modèle supprimé");
      invalidate();
      setDeletePlan(null);
    } catch (e) {
      toast.error(describeError(e, "Suppression impossible"));
    } finally {
      setDeleteBusy(false);
    }
  };

  const openCreateInst = (planId: string) => {
    setInstPlanId(planId);
    setEditingInst(null);
    setInstForm(emptyInst());
    setInstOpen(true);
  };

  const openEditInst = (inst: Installment) => {
    setInstPlanId(inst.fee_plan_id);
    setEditingInst(inst);
    setInstForm({
      label: inst.label,
      amount: String(inst.amount),
      due_date: inst.due_date,
    });
    setInstOpen(true);
  };

  const saveInst = async () => {
    if (!instPlanId) return;
    const label = instForm.label.trim();
    const amount = Number(instForm.amount);
    const due_date = instForm.due_date;
    if (!label) {
      toast.error("Libellé de tranche requis");
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Montant de tranche invalide");
      return;
    }
    if (!due_date) {
      toast.error("Date d'échéance requise");
      return;
    }
    setInstBusy(true);
    try {
      const existing = installmentsByPlan.get(instPlanId) ?? [];
      if (editingInst) {
        const { error } = await supabase
          .from("fee_plan_installments")
          .update({ label, amount, due_date })
          .eq("id", editingInst.id);
        if (error) throw error;
        await writeAudit("update", "fee_plan_installments" as never, editingInst.id, {
          label,
          amount,
          due_date,
        });
        toast.success("Tranche mise à jour — périodes figées inchangées");
      } else {
        const position =
          existing.length > 0
            ? Math.max(...existing.map((i) => Number(i.position) || 0)) + 1
            : 1;
        const { data: created, error } = await supabase
          .from("fee_plan_installments")
          .insert({
            fee_plan_id: instPlanId,
            label,
            amount,
            due_date,
            position,
          })
          .select("id")
          .single();
        if (error) throw error;
        await writeAudit("create", "fee_plan_installments" as never, created?.id ?? null, {
          label,
          amount,
          due_date,
        });
        toast.success("Tranche ajoutée");
      }
      invalidate();
      setInstOpen(false);
    } catch (e) {
      toast.error(describeError(e, "Enregistrement de la tranche impossible"));
    } finally {
      setInstBusy(false);
    }
  };

  const confirmDeleteInst = async () => {
    if (!deleteInst) return;
    setDeleteBusy(true);
    try {
      const { error } = await supabase
        .from("fee_plan_installments")
        .delete()
        .eq("id", deleteInst.id);
      if (error) throw error;
      await writeAudit("delete", "fee_plan_installments" as never, deleteInst.id, {});
      toast.success("Tranche supprimée");
      invalidate();
      setDeleteInst(null);
    } catch (e) {
      toast.error(describeError(e, "Suppression impossible"));
    } finally {
      setDeleteBusy(false);
    }
  };

  const sumInstallments = (planId: string) =>
    (installmentsByPlan.get(planId) ?? []).reduce((a, i) => a + Number(i.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">
            Modèles de scolarité
          </h2>
          <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">
            Chaque modèle fige montant et tranches pour les <strong>nouvelles</strong> périodes.
            Les élèves déjà inscrits gardent leur snapshot d'origine (immunité tarifaire).
          </p>
        </div>
        <Button type="button" className="press shrink-0" onClick={openCreatePlan}>
          <Plus className="mr-1.5 h-4 w-4" />
          Nouveau modèle
        </Button>
      </div>

      {plans.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title="Aucun modèle de scolarité"
          description="Créez un modèle (ex. Primaire annuel) avec ses tranches d'échéance, puis associez-le aux classes."
          action={
            <Button type="button" onClick={openCreatePlan}>
              <Plus className="mr-1.5 h-4 w-4" />
              Créer le premier modèle
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {plans.map((plan) => {
            const insts = installmentsByPlan.get(plan.id) ?? [];
            const sum = sumInstallments(plan.id);
            const used = classesUsing.get(plan.id) ?? 0;
            const mismatch =
              insts.length > 0 && Math.abs(sum - Number(plan.total_amount)) > 0.01;

            return (
              <Card
                key={plan.id}
                className="overflow-hidden border-border/80 bg-card/80 shadow-sm"
              >
                <CardHeader className="space-y-1 border-b border-border/60 bg-muted/20 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="font-display text-base">{plan.name}</CardTitle>
                      <CardDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className="font-semibold tabular-nums text-foreground">
                          {formatFCFA(plan.total_amount)}
                        </span>
                        <span>
                          {insts.length} tranche{insts.length !== 1 ? "s" : ""}
                        </span>
                        {used > 0 ? (
                          <span className="text-primary">
                            {used} classe{used > 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span>Non assigné</span>
                        )}
                      </CardDescription>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Modifier le modèle"
                        onClick={() => openEditPlan(plan)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        aria-label="Supprimer le modèle"
                        onClick={() => setDeletePlan(plan)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {mismatch && (
                    <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-900 dark:text-amber-100">
                      Somme des tranches ({formatFCFA(sum)}) ≠ total du modèle (
                      {formatFCFA(plan.total_amount)}).
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-2 p-3">
                  {insts.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border/80 px-3 py-4 text-center text-sm text-muted-foreground">
                      Aucune tranche — ajoutez les échéances (1er trimestre, etc.).
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {insts.map((inst) => (
                        <li
                          key={inst.id}
                          className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-2.5 py-2 text-sm"
                        >
                          <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-foreground">{inst.label}</p>
                            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              Échéance {formatDate(inst.due_date)}
                            </p>
                          </div>
                          <span className="shrink-0 tabular-nums text-xs font-semibold">
                            {formatFCFA(inst.amount)}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() => openEditInst(inst)}
                            aria-label="Modifier la tranche"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-destructive"
                            onClick={() => setDeleteInst(inst)}
                            aria-label="Supprimer la tranche"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="press mt-1 w-full"
                    onClick={() => openCreateInst(plan.id)}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Ajouter une tranche
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingPlan ? "Modifier le modèle" : "Nouveau modèle de scolarité"}
            </DialogTitle>
            <DialogDescription>
              Le total et les tranches s'appliquent uniquement aux inscriptions ou
              renouvellements futurs.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label className="mb-1.5 block text-sm">
                Nom<span className="text-destructive">*</span>
              </Label>
              <Input
                value={planForm.name}
                onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ex. Secondaire — année 2026"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">
                Montant total (FCFA)<span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min={0}
                step="any"
                value={planForm.total_amount}
                onChange={(e) => setPlanForm((f) => ({ ...f, total_amount: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPlanOpen(false)}>
              Annuler
            </Button>
            <Button type="button" disabled={planBusy} onClick={() => void savePlan()}>
              {planBusy ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={instOpen} onOpenChange={setInstOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingInst ? "Modifier la tranche" : "Nouvelle tranche"}</DialogTitle>
            <DialogDescription>
              Date d'échéance utilisée pour le calcul automatique du retard.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label className="mb-1.5 block text-sm">
                Libellé<span className="text-destructive">*</span>
              </Label>
              <Input
                value={instForm.label}
                onChange={(e) => setInstForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Ex. 1er trimestre"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block text-sm">
                  Montant<span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={instForm.amount}
                  onChange={(e) => setInstForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-sm">
                  Échéance<span className="text-destructive">*</span>
                </Label>
                <Input
                  type="date"
                  value={instForm.due_date}
                  onChange={(e) => setInstForm((f) => ({ ...f, due_date: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInstOpen(false)}>
              Annuler
            </Button>
            <Button type="button" disabled={instBusy} onClick={() => void saveInst()}>
              {instBusy ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletePlan} onOpenChange={(o) => !o && setDeletePlan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {deletePlan?.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les périodes d'élèves déjà figées ne sont pas touchées. Impossible si une classe
              utilise encore ce modèle.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className={cn("bg-destructive text-destructive-foreground hover:bg-destructive/90")}
              disabled={deleteBusy}
              onClick={() => void confirmDeletePlan()}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteInst} onOpenChange={(o) => !o && setDeleteInst(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la tranche « {deleteInst?.label} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              N'affecte que les futures inscriptions. Les snapshots élèves restent intacts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className={cn("bg-destructive text-destructive-foreground hover:bg-destructive/90")}
              disabled={deleteBusy}
              onClick={() => void confirmDeleteInst()}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
