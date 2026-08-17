import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  Plus,
  GraduationCap,
  Users,
  Wallet,
  AlertTriangle,
  Banknote,
  Trash2,
  Archive,
  Maximize2,
  Minimize2,
  ArrowLeft,
  Pencil,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { RowActions } from "@/components/app/row-actions";
import { EmptyState } from "@/components/app/empty-state";
import { StudentsDialog } from "@/components/school/students-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData, useEstablishmentStats } from "@/lib/school-data";
import { useSaveRow, useDeleteRow, useArchiveRow, writeAudit } from "@/lib/data";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatFCFA, formatDate, establishmentTypeLabel } from "@/lib/format";
import {
  lateStatus,
  sum,
  teacherDue,
  validatedHours,
  weekdayLabel,
  expectedTuition,
  WEEKDAYS,
  formatDuration,
  PERIODS,
  periodStart,
  type ClassRow,
  type TeacherAssignment,
  type Period,
} from "@/lib/school";

export const Route = createFileRoute("/_authenticated/etablissements/$id")({
  head: () => ({
    meta: [
      { title: "Gestion de l'établissement – Les Élites de Gao" },
      { name: "description", content: "Classes, élèves, scolarité, enseignants et finance de l'établissement." },
      { property: "og:title", content: "Gestion de l'établissement – Les Élites de Gao" },
      { property: "og:description", content: "Pilotez les classes, la scolarité, les enseignants et la finance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  const { isDG, profile } = useAdminProfile();
  const data = useSchoolData();
  const stats = useEstablishmentStats(data);
  const est = data.establishments.find((e) => e.id === id);
  const s = stats.get(id);
  const allowed = isDG || profile?.establishment_id === id;

  if (!data.loading && (!est || !allowed)) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Accès refusé"
        description="Vous n'avez pas accès à cet établissement."
      />
    );
  }

  return (
    <>
      {isDG && (
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
          <Link to="/etablissements">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour aux établissements
          </Link>
        </Button>
      )}

      <PageHeader
        eyebrow={est ? establishmentTypeLabel(est.type) : "Établissement"}
        title={est?.name ?? "Établissement"}
        description="Classes, élèves, scolarité, enseignants et finance de cet établissement."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Élèves" value={s?.students ?? 0} icon={Users} loading={data.loading} />
        <StatCard label="Classes" value={s?.classes ?? 0} icon={GraduationCap} tone="accent" loading={data.loading} delay={60} />
        <StatCard label="Encaissé" value={formatFCFA(s?.collected ?? 0)} icon={Wallet} tone="success" loading={data.loading} delay={120} />
        <StatCard label="Retardataires" value={s?.lateStudents ?? 0} icon={AlertTriangle} tone="destructive" loading={data.loading} delay={180} />
      </div>

      <Tabs defaultValue="classes" className="animate-fade-soft">
        <TabsList>
          <TabsTrigger value="classes">Classes</TabsTrigger>
          <TabsTrigger value="scolarite">Scolarité</TabsTrigger>
          <TabsTrigger value="profs">Enseignants</TabsTrigger>
          <TabsTrigger value="finance">Finance</TabsTrigger>
        </TabsList>
        <TabsContent value="classes" className="mt-4">
          <ClassesTab establishmentId={id} data={data} />
        </TabsContent>
        <TabsContent value="scolarite" className="mt-4">
          <TuitionTab establishmentId={id} data={data} />
        </TabsContent>
        <TabsContent value="profs" className="mt-4">
          <TeachersTab establishmentId={id} data={data} isDG={isDG} />
        </TabsContent>
        <TabsContent value="finance" className="mt-4">
          <FinanceTab establishmentId={id} data={data} />
        </TabsContent>
      </Tabs>
    </>
  );
}

type Data = ReturnType<typeof useSchoolData>;

function ClassesTab({ establishmentId, data }: { establishmentId: string; data: Data }) {
  const save = useSaveRow("classes", "Classe");
  const remove = useDeleteRow("classes", "Classe");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClassRow | null>(null);
  const [viewing, setViewing] = useState<ClassRow | null>(null);

  const rows = data.classes.filter((c) => c.establishment_id === establishmentId);
  const plans = data.feePlans.filter((p) => p.establishment_id === establishmentId);

  const fields: Field[] = [
    { name: "name", label: "Nom de la classe", required: true, colSpan: 2, placeholder: "6ème A" },
    { name: "capacity", label: "Capacité", type: "number", defaultValue: 40 },
    {
      name: "fee_plan_id",
      label: "Modèle de scolarité",
      type: "select",
      options: plans.map((p) => ({ value: p.id, label: `${p.name} — ${formatFCFA(p.total_amount)}` })),
    },
    { name: "is_active", label: "Active", type: "switch" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          className="press"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Nouvelle classe
        </Button>
      </div>

      {rows.length === 0 && !data.loading ? (
        <EmptyState icon={GraduationCap} title="Aucune classe" description="Créez la première classe de cet établissement." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c, index) => {
            const effectif = data.students.filter((s) => s.class_id === c.id).length;
            const plan = plans.find((p) => p.id === c.fee_plan_id);
            const fillRate = c.capacity > 0 ? Math.min(100, Math.round((effectif / c.capacity) * 100)) : 0;
            return (
              <Card
                key={c.id}
                className="card-lift animate-rise panel-gradient overflow-hidden"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <GraduationCap className="h-4.5 w-4.5" />
                      </span>
                      <CardTitle className="truncate font-display text-base">{c.name}</CardTitle>
                    </div>
                    {c.is_active ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Effectif</span>
                      <span className="font-medium text-foreground">
                        {effectif} / {c.capacity}
                      </span>
                    </div>
                    <Progress value={fillRate} className="h-1.5" />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs">
                    <span className="text-muted-foreground">Modèle de scolarité</span>
                    <span className="font-medium text-foreground">{plan?.name ?? "Aucun"}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" className="press flex-1" onClick={() => setViewing(c)}>
                      <Users className="mr-1.5 h-4 w-4" /> Élèves
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="press"
                      onClick={() => {
                        setEditing(c);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="outline" className="press text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Supprimer la classe {c.name} ?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Cette action est définitive. Assurez-vous qu'aucun élève actif n'y est rattaché.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annuler</AlertDialogCancel>
                          <AlertDialogAction onClick={() => remove.mutate(c.id)}>Supprimer</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Modifier la classe" : "Nouvelle classe"}
        fields={fields}
        initial={editing}
        submitting={save.isPending}
        onSubmit={(values) =>
          save.mutate(
            { id: editing?.id, values: { ...values, establishment_id: establishmentId } },
            { onSuccess: () => setOpen(false) },
          )
        }
      />
      <StudentsDialog klass={viewing} data={data} onClose={() => setViewing(null)} />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Scolarité                                                               */
/* ---------------------------------------------------------------------- */

type TrancheDraft = { id: string; label: string; amount: string; due_date: string };

function newTrancheDraft(index: number): TrancheDraft {
  return { id: crypto.randomUUID(), label: `${index}ᵉ tranche`, amount: "", due_date: "" };
}

function PlanDialog({
  open,
  onClose,
  editingPlan,
  installments,
  establishmentId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editingPlan: Data["feePlans"][number] | null;
  installments: Data["installments"];
  establishmentId: string;
  onSaved: () => void;
}) {
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [total, setTotal] = useState("");
  const [tranches, setTranches] = useState<TrancheDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editingPlan?.name ?? "");
    setTotal(editingPlan ? String(editingPlan.total_amount) : "");
    if (editingPlan) {
      const existing = installments
        .filter((i) => i.fee_plan_id === editingPlan.id)
        .sort((a, b) => a.position - b.position)
        .map((i) => ({ id: i.id, label: i.label, amount: String(i.amount), due_date: i.due_date }));
      setTranches(existing.length ? existing : [newTrancheDraft(1)]);
    } else {
      setTranches([newTrancheDraft(1)]);
    }
    setSubmitting(false);
  }, [open, editingPlan]); // eslint-disable-line react-hooks/exhaustive-deps

  const trancheSum = sum(tranches.map((t) => Number(t.amount || 0)));
  const totalNum = Number(total || 0);
  const sumMatches = tranches.length > 0 && totalNum > 0 && trancheSum === totalNum;
  const tranchesValid = tranches.every((t) => t.label.trim() && t.amount !== "" && t.due_date);
  const canSubmit = !!name.trim() && totalNum > 0 && tranchesValid && sumMatches && !submitting;

  const addTranche = () => setTranches((prev) => [...prev, newTrancheDraft(prev.length + 1)]);
  const removeTranche = (id: string) => setTranches((prev) => prev.filter((t) => t.id !== id));
  const updateTranche = (id: string, patch: Partial<TrancheDraft>) =>
    setTranches((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  // Enregistre le modèle et toutes ses tranches comme une seule action : un seul
  // message de succès à la fin, un seul point d'échec géré, pas de notifications
  // séparées par tranche.
  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      let planId = editingPlan?.id ?? null;

      if (planId) {
        const { error } = await supabase
          .from("fee_plans")
          .update({ name: name.trim(), total_amount: totalNum })
          .eq("id", planId);
        if (error) throw error;
      } else {
        const { data: created, error } = await supabase
          .from("fee_plans")
          .insert({ name: name.trim(), total_amount: totalNum, establishment_id: establishmentId })
          .select()
          .single();
        if (error) throw error;
        planId = created.id;
      }
      if (!planId) throw new Error("Modèle non créé");

      if (editingPlan) {
        const existingIds = new Set(
          installments.filter((i) => i.fee_plan_id === editingPlan.id).map((i) => i.id),
        );
        const keptIds = new Set(tranches.filter((t) => existingIds.has(t.id)).map((t) => t.id));
        const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
        if (toDelete.length) {
          const { error } = await supabase.from("fee_plan_installments").delete().in("id", toDelete);
          if (error) throw error;
        }
      }

      let position = 1;
      for (const t of tranches) {
        const isExisting = !!editingPlan && installments.some((i) => i.id === t.id && i.fee_plan_id === editingPlan.id);
        const payload = {
          fee_plan_id: planId,
          label: t.label.trim(),
          amount: Number(t.amount),
          due_date: t.due_date,
          position: position++,
        };
        if (isExisting) {
          const { error } = await supabase.from("fee_plan_installments").update(payload).eq("id", t.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("fee_plan_installments").insert(payload);
          if (error) throw error;
        }
      }

      await writeAudit(editingPlan ? "update" : "create", "fee_plans", planId, {
        name: name.trim(),
        total_amount: totalNum,
        tranches: tranches.length,
      });

      qc.invalidateQueries({ queryKey: ["fee_plans"] });
      qc.invalidateQueries({ queryKey: ["fee_plan_installments"] });
      toast.success(editingPlan ? "Modèle de scolarité modifié" : "Modèle de scolarité créé");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message || "Enregistrement impossible");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editingPlan ? "Modifier le modèle" : "Nouveau modèle de scolarité"}</DialogTitle>
          <DialogDescription>
            Définissez le montant total et ses tranches — la somme des tranches doit être égale au montant total.
            Tout est enregistré en une seule fois.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">
              Nom du modèle<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input value={name} placeholder="Scolarité 6ème" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">
              Montant total (FCFA)<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input type="number" step="any" value={total} onChange={(e) => setTotal(e.target.value)} />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Tranches</p>
            <Button size="sm" variant="outline" className="press" onClick={addTranche}>
              <Plus className="mr-1.5 h-4 w-4" /> Ajouter une tranche
            </Button>
          </div>
          <div className="space-y-2">
            {tranches.map((t) => (
              <div key={t.id} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2 rounded-lg border border-border/70 p-2">
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">Libellé</Label>
                  <Input value={t.label} onChange={(e) => updateTranche(t.id, { label: e.target.value })} />
                </div>
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">Montant</Label>
                  <Input type="number" step="any" value={t.amount} onChange={(e) => updateTranche(t.id, { amount: e.target.value })} />
                </div>
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">Échéance</Label>
                  <Input type="date" value={t.due_date} onChange={(e) => updateTranche(t.id, { due_date: e.target.value })} />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => removeTranche(t.id)}
                  disabled={tranches.length <= 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <p className={sumMatches ? "text-sm text-muted-foreground" : "text-sm font-medium text-destructive"}>
            Somme des tranches : {formatFCFA(trancheSum)}
            {totalNum > 0 ? ` / ${formatFCFA(totalNum)}` : ""}
            {!sumMatches && totalNum > 0 ? " — la somme doit être égale au montant total" : ""}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? "Enregistrement..." : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({
  open,
  onClose,
  students,
  defaultStudentId,
  establishmentId,
  data,
}: {
  open: boolean;
  onClose: () => void;
  students: Data["students"];
  defaultStudentId: string | null;
  establishmentId: string;
  data: Data;
}) {
  const savePayment = useSaveRow("tuition_payments", "Paiement");
  const [studentId, setStudentId] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");

  const establishmentClasses = data.classes.filter((c) => c.establishment_id === establishmentId);

  useEffect(() => {
    if (!open) return;
    const preset = students.find((s) => s.id === defaultStudentId) ?? null;
    setStudentId(preset?.id ?? students[0]?.id ?? "");
    setClassFilter(preset?.class_id ?? "");
    setSearch("");
    setAmount("");
    setPaidAt(new Date().toISOString().slice(0, 10));
    setMethod("cash");
    setNote("");
  }, [open, defaultStudentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredStudents = useMemo(() => {
    const term = search.trim().toLowerCase();
    return students.filter((s) => {
      if (classFilter && s.class_id !== classFilter) return false;
      if (term && !`${s.first_name} ${s.last_name}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [students, classFilter, search]);

  const student = students.find((s) => s.id === studentId) ?? null;
  const expected = student ? expectedTuition(student, data.classes, data.feePlans) : 0;
  const paidSoFar = student
    ? sum(data.tuitionPayments.filter((p) => p.student_id === student.id).map((p) => Number(p.amount)))
    : 0;
  const remaining = Math.max(0, expected - paidSoFar);
  const hasPlan = expected > 0;
  const amountNum = Number(amount || 0);
  const exceeds = hasPlan && amountNum > remaining;
  const canSubmit = !!studentId && amountNum > 0 && !exceeds && !savePayment.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enregistrer un paiement de scolarité</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-sm">Classe</Label>
            <Select value={classFilter || "all"} onValueChange={(v) => setClassFilter(v === "all" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Toutes les classes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les classes</SelectItem>
                {establishmentClasses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">Rechercher un élève</Label>
            <Input placeholder="Nom, prénom…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">
              Élève<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner" />
              </SelectTrigger>
              <SelectContent>
                {filteredStudents.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">Aucun élève ne correspond.</div>
                ) : (
                  filteredStudents.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.last_name} {s.first_name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {student ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {hasPlan ? `Reste dû : ${formatFCFA(remaining)}` : "Aucun modèle de scolarité associé à la classe de cet élève."}
              </p>
            ) : null}
          </div>
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
          <Button
            disabled={!canSubmit}
            onClick={() =>
              savePayment.mutate(
                {
                  values: {
                    student_id: studentId,
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

function TuitionTab({ establishmentId, data }: { establishmentId: string; data: Data }) {
  const removePlan = useDeleteRow("fee_plans", "Modèle de scolarité");
  const [planOpen, setPlanOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Data["feePlans"][number] | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payStudent, setPayStudent] = useState<string | null>(null);

  const plans = data.feePlans.filter((p) => p.establishment_id === establishmentId);
  const students = data.students.filter((s) => s.establishment_id === establishmentId);

  const studentRows = useMemo(
    () =>
      students
        .map((student) => {
          const klass = data.classes.find((c) => c.id === student.class_id);
          const plan = plans.find((p) => p.id === klass?.fee_plan_id);
          const insts = data.installments.filter((i) => i.fee_plan_id === klass?.fee_plan_id);
          const paid = sum(data.tuitionPayments.filter((p) => p.student_id === student.id).map((p) => Number(p.amount)));
          const status = lateStatus(paid, insts);
          const expected = plan ? Number(plan.total_amount) : 0;
          return {
            id: student.id,
            student,
            klass,
            plan,
            paid,
            expected,
            remaining: Math.max(0, expected - paid),
            status,
          };
        })
        .sort((a, b) =>
          `${a.student.last_name}${a.student.first_name}`.localeCompare(`${b.student.last_name}${b.student.first_name}`),
        ),
    [students, plans, data],
  );

  const late = studentRows.filter((r) => r.status.isLate);

  const openPayment = (studentId: string | null) => {
    setPayStudent(studentId);
    setPayOpen(true);
  };

  const planColumns: Column<Data["feePlans"][number]>[] = [
    { key: "name", header: "Modèle", cell: (p) => <span className="font-medium">{p.name}</span> },
    { key: "total", header: "Montant total", cell: (p) => formatFCFA(p.total_amount) },
    {
      key: "tranches",
      header: "Tranches",
      cell: (p) => `${data.installments.filter((i) => i.fee_plan_id === p.id).length} tranche(s)`,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (p) => (
        <RowActions
          onEdit={() => {
            setEditingPlan(p);
            setPlanOpen(true);
          }}
          onDelete={() => removePlan.mutate(p.id)}
        />
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Modèles de scolarité</h3>
          <Button
            className="press"
            size="sm"
            onClick={() => {
              setEditingPlan(null);
              setPlanOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Nouveau modèle
          </Button>
        </div>
        {plans.length === 0 && !data.loading ? (
          <EmptyState icon={Wallet} title="Aucun modèle" description="Définissez un montant annuel et ses tranches." />
        ) : (
          <DataTable columns={planColumns} rows={plans} loading={data.loading} />
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-lg font-semibold">Élèves en retard de paiement</h3>
        {late.length === 0 ? (
          <EmptyState icon={Wallet} title="Aucun retard" description="Toutes les tranches échues sont réglées." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3">Élève</th>
                  <th className="p-3">Classe</th>
                  <th className="p-3">Déjà payé</th>
                  <th className="p-3">Montant en retard</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {late.map(({ student, klass, paid, status }, index) => (
                  <tr
                    key={student.id}
                    className="animate-rise border-t border-border"
                    style={{ animationDelay: `${index * 40}ms` }}
                  >
                    <td className="p-3 font-medium">
                      {student.last_name} {student.first_name}
                    </td>
                    <td className="p-3">{klass?.name ?? "—"}</td>
                    <td className="p-3">{formatFCFA(paid)}</td>
                    <td className="p-3">
                      <Badge variant="destructive">{formatFCFA(status.overdueAmount)}</Badge>
                    </td>
                    <td className="p-3 text-right">
                      <Button size="sm" variant="outline" className="press" onClick={() => openPayment(student.id)}>
                        <Banknote className="mr-1.5 h-4 w-4" /> Encaisser
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Tous les élèves</h3>
          <Button
            size="sm"
            variant="outline"
            className="press"
            onClick={() => openPayment(students[0]?.id ?? null)}
            disabled={!students.length}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Enregistrer un paiement
          </Button>
        </div>
        {studentRows.length === 0 && !data.loading ? (
          <EmptyState icon={Users} title="Aucun élève" description="Cet établissement n'a pas encore d'élève." />
        ) : (
          <DataTable
            loading={data.loading}
            rows={studentRows}
            columns={[
              {
                key: "name",
                header: "Élève",
                cell: (r) => (
                  <span className="font-medium">
                    {r.student.last_name} {r.student.first_name}
                  </span>
                ),
              },
              { key: "class", header: "Classe", cell: (r) => r.klass?.name ?? "—" },
              { key: "plan", header: "Modèle", cell: (r) => r.plan?.name ?? "—" },
              { key: "paid", header: "Payé", cell: (r) => formatFCFA(r.paid) },
              { key: "remaining", header: "Reste dû", cell: (r) => formatFCFA(r.remaining) },
              {
                key: "status",
                header: "Statut",
                cell: (r) =>
                  !r.plan ? (
                    <Badge variant="outline">Sans modèle</Badge>
                  ) : r.status.isLate ? (
                    <Badge variant="destructive">En retard</Badge>
                  ) : (
                    <Badge>À jour</Badge>
                  ),
              },
              {
                key: "actions",
                header: "",
                className: "text-right",
                cell: (r) => (
                  <Button size="sm" variant="ghost" className="press" onClick={() => openPayment(r.student.id)}>
                    <Banknote className="mr-1.5 h-4 w-4" /> Encaisser
                  </Button>
                ),
              },
            ]}
          />
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-lg font-semibold">Derniers encaissements</h3>
        <DataTable
          rows={data.tuitionPayments.filter((p) => p.establishment_id === establishmentId).slice(0, 15)}
          loading={data.loading}
          emptyLabel="Aucun paiement enregistré."
          columns={[
            {
              key: "student",
              header: "Élève",
              cell: (p) => {
                const st = data.studentsById.get(p.student_id);
                return st ? `${st.last_name} ${st.first_name}` : "—";
              },
            },
            { key: "amount", header: "Montant", cell: (p) => formatFCFA(p.amount) },
            { key: "date", header: "Date", cell: (p) => formatDate(p.paid_at) },
            { key: "method", header: "Moyen", cell: (p) => p.method },
          ]}
        />
      </section>

      <PlanDialog
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        editingPlan={editingPlan}
        installments={data.installments}
        establishmentId={establishmentId}
        onSaved={() => setPlanOpen(false)}
      />

      <PaymentDialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        students={students}
        defaultStudentId={payStudent}
        establishmentId={establishmentId}
        data={data}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Enseignants                                                             */
/* ---------------------------------------------------------------------- */

type SessionDraft = { id: string; name: string; weekday: string; duration_minutes: string };

function newSessionDraft(): SessionDraft {
  return { id: crypto.randomUUID(), name: "", weekday: "1", duration_minutes: "60" };
}

function TeacherDialog({
  open,
  onClose,
  establishmentId,
}: {
  open: boolean;
  onClose: () => void;
  establishmentId: string;
}) {
  const saveTeacher = useSaveRow("teachers", "Enseignant");
  const saveAssignment = useSaveRow("teacher_assignments", "Affectation");
  const saveSession = useSaveRow("teacher_sessions", "Séance");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [domain, setDomain] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"fixed_salary" | "hourly">("fixed_salary");
  const [salaryAmount, setSalaryAmount] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [sessions, setSessions] = useState<SessionDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFirstName("");
    setLastName("");
    setPhone("");
    setDomain("");
    setPaymentMethod("fixed_salary");
    setSalaryAmount("");
    setHourlyRate("");
    setSessions([]);
    setSubmitting(false);
  }, [open]);

  const changePaymentMethod = (v: string) => {
    const val = v as "fixed_salary" | "hourly";
    setPaymentMethod(val);
    if (val === "fixed_salary") setSessions([]);
  };

  const addSession = () => setSessions((prev) => [...prev, newSessionDraft()]);
  const removeSession = (id: string) => setSessions((prev) => prev.filter((s) => s.id !== id));
  const updateSession = (id: string, patch: Partial<SessionDraft>) =>
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const paymentValid =
    paymentMethod === "fixed_salary" ? Number(salaryAmount) > 0 : Number(hourlyRate) > 0;
  const sessionsValid = sessions.every((s) => s.name.trim() && s.weekday !== "" && Number(s.duration_minutes) > 0);
  const canSubmit = !!firstName.trim() && !!lastName.trim() && paymentValid && sessionsValid && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const teacherRow = await saveTeacher.mutateAsync({
        values: { first_name: firstName.trim(), last_name: lastName.trim(), phone: phone || null, domain: domain || null },
      });
      const teacherId = (teacherRow as { id?: string } | null)?.id;
      if (!teacherId) throw new Error("Enseignant non créé");

      const assignmentRow = await saveAssignment.mutateAsync({
        values: {
          teacher_id: teacherId,
          establishment_id: establishmentId,
          payment_method: paymentMethod,
          salary_amount: paymentMethod === "fixed_salary" ? Number(salaryAmount) : 0,
          hourly_rate: paymentMethod === "hourly" ? Number(hourlyRate) : 0,
        },
      });
      const assignmentId = (assignmentRow as { id?: string } | null)?.id;

      if (assignmentId && paymentMethod === "hourly" && sessions.length) {
        await Promise.all(
          sessions.map((s) =>
            saveSession.mutateAsync({
              values: {
                name: s.name.trim(),
                weekday: Number(s.weekday),
                duration_minutes: Number(s.duration_minutes),
                assignment_id: assignmentId,
              },
            }),
          ),
        );
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nouvel enseignant</DialogTitle>
          <DialogDescription>
            La fiche, la méthode de rémunération et l'emploi du temps sont créés en une seule fois pour cet établissement.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-sm">
              Prénom<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">
              Nom<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">Téléphone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">Domaine</Label>
            <Input value={domain} placeholder="Mathématiques" onChange={(e) => setDomain(e.target.value)} />
          </div>

          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">
              Méthode de rémunération<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select value={paymentMethod} onValueChange={changePaymentMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed_salary">Salaire fixe</SelectItem>
                <SelectItem value="hourly">Tarif horaire</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {paymentMethod === "fixed_salary" ? (
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block text-sm">
                Salaire mensuel (FCFA)<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input type="number" step="any" value={salaryAmount} onChange={(e) => setSalaryAmount(e.target.value)} />
            </div>
          ) : (
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block text-sm">
                Tarif horaire (FCFA)<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input type="number" step="any" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
            </div>
          )}
        </div>

        {paymentMethod === "hourly" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Emploi du temps (optionnel, modifiable ensuite)</p>
              <Button size="sm" variant="outline" className="press" onClick={addSession}>
                <Plus className="mr-1.5 h-4 w-4" /> Ajouter une séance
              </Button>
            </div>
            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune séance ajoutée pour l'instant.</p>
            ) : (
              <div className="space-y-2">
                {sessions.map((s) => (
                  <div key={s.id} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2 rounded-lg border border-border/70 p-2">
                    <div>
                      <Label className="mb-1 block text-xs text-muted-foreground">Intitulé</Label>
                      <Input value={s.name} placeholder="Maths 6ème A" onChange={(e) => updateSession(s.id, { name: e.target.value })} />
                    </div>
                    <div>
                      <Label className="mb-1 block text-xs text-muted-foreground">Jour</Label>
                      <Select value={s.weekday} onValueChange={(v) => updateSession(s.id, { weekday: v })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WEEKDAYS.map((d) => (
                            <SelectItem key={d.value} value={String(d.value)}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="mb-1 block text-xs text-muted-foreground">Durée (min)</Label>
                      <Input
                        type="number"
                        value={s.duration_minutes}
                        onChange={(e) => updateSession(s.id, { duration_minutes: e.target.value })}
                      />
                    </div>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeSession(s.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeacherPaymentDialog({
  open,
  onClose,
  assignment,
  teacherName,
  establishmentId,
  data,
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

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setPaidAt(new Date().toISOString().slice(0, 10));
    setNote("");
  }, [open, assignment?.id]);

  const due = assignment ? teacherDue(assignment, data.sessions) : 0;
  const paidSoFar = assignment
    ? sum(
        data.teacherPayments
          .filter((p) => p.teacher_id === assignment.teacher_id && p.establishment_id === establishmentId)
          .map((p) => Number(p.amount)),
      )
    : 0;
  const remaining = Math.max(0, due - paidSoFar);
  const amountNum = Number(amount || 0);
  const exceeds = amountNum > remaining;
  const canSubmit = !!assignment && amountNum > 0 && !exceeds && !savePayment.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Paiement enseignant — {teacherName}</DialogTitle>
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

function TeachersTab({
  establishmentId,
  data,
  isDG,
}: {
  establishmentId: string;
  data: Data;
  isDG: boolean;
}) {
  const archiveTeacher = useArchiveRow("teachers", "Enseignant");
  const saveAssignment = useSaveRow("teacher_assignments", "Affectation");
  const saveSession = useSaveRow("teacher_sessions", "Séance");
  const removeSession = useDeleteRow("teacher_sessions", "Séance");

  const [teacherOpen, setTeacherOpen] = useState(false);
  const [assignmentEdit, setAssignmentEdit] = useState<TeacherAssignment | null>(null);
  const [sessionFor, setSessionFor] = useState<TeacherAssignment | null>(null);
  const [payFor, setPayFor] = useState<TeacherAssignment | null>(null);

  const assignments = data.assignments.filter(
    (a) => a.establishment_id === establishmentId && data.teachers.some((t) => t.id === a.teacher_id),
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      {isDG ? (
        <div className="flex justify-end">
          <Button className="press" onClick={() => setTeacherOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Nouvel enseignant
          </Button>
        </div>
      ) : null}

      {assignments.length === 0 && !data.loading ? (
        <EmptyState
          icon={Users}
          title="Aucun enseignant affecté"
          description={isDG ? "Créez une fiche enseignant et affectez-la à cet établissement." : "La direction générale doit affecter des enseignants."}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {assignments.map((a, index) => {
            const teacher = data.teachers.find((t) => t.id === a.teacher_id);
            const sessions = data.sessions.filter((sx) => sx.assignment_id === a.id);
            const due = teacherDue(a, data.sessions);
            const paid = sum(
              data.teacherPayments
                .filter((p) => p.teacher_id === a.teacher_id && p.establishment_id === establishmentId)
                .map((p) => Number(p.amount)),
            );
            return (
              <Card key={a.id} className="card-lift animate-rise panel-gradient" style={{ animationDelay: `${index * 60}ms` }}>
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="font-display text-base">
                      {teacher ? `${teacher.last_name} ${teacher.first_name}` : "Enseignant"}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">{teacher?.domain ?? "—"} · {teacher?.phone ?? "—"}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={a.payment_method === "fixed_salary" ? "secondary" : "outline"}>
                      {a.payment_method === "fixed_salary" ? "Salaire fixe" : "Tarif horaire"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => toggleCollapsed(a.id)}
                      aria-label={collapsed.has(a.id) ? "Agrandir" : "Réduire"}
                    >
                      {collapsed.has(a.id) ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </CardHeader>
                {!collapsed.has(a.id) && (
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Heures validées</p>
                      <p className="font-medium">{validatedHours(a.id, data.sessions).toFixed(1)} h</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Dû</p>
                      <p className="font-medium">{formatFCFA(due)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Payé</p>
                      <p className="font-medium">{formatFCFA(paid)}</p>
                    </div>
                  </div>

                  {a.payment_method === "hourly" && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Emploi du temps</p>
                      {sessions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Aucune séance planifiée.</p>
                      ) : (
                        sessions.map((sx) => (
                          <label
                            key={sx.id}
                            className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2 text-sm transition-colors hover:bg-muted/60"
                          >
                            <Checkbox
                              checked={sx.is_done}
                              onCheckedChange={(v) => saveSession.mutate({ id: sx.id, values: { is_done: !!v } })}
                            />
                            <span className="flex-1 truncate">
                              {sx.name} · {weekdayLabel(sx.weekday)} · {formatDuration(sx.duration_minutes)}
                            </span>
                            <Button variant="ghost" size="sm" onClick={() => removeSession.mutate(sx.id)}>
                              Retirer
                            </Button>
                          </label>
                        ))
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {a.payment_method === "hourly" && (
                      <Button size="sm" variant="outline" className="press" onClick={() => setSessionFor(a)}>
                        <Plus className="mr-1.5 h-4 w-4" /> Séance
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="press" onClick={() => setAssignmentEdit(a)}>
                      Rémunération
                    </Button>
                    <Button size="sm" className="press" onClick={() => setPayFor(a)}>
                      <Banknote className="mr-1.5 h-4 w-4" /> Payer
                    </Button>
                    {isDG && teacher ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => archiveTeacher.mutate(teacher.id)}
                      >
                        <Archive className="mr-1.5 h-4 w-4" /> Archiver la fiche
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <TeacherDialog open={teacherOpen} onClose={() => setTeacherOpen(false)} establishmentId={establishmentId} />

      <RecordDialog
        open={!!assignmentEdit}
        onOpenChange={(v) => !v && setAssignmentEdit(null)}
        title="Méthode de rémunération"
        fields={[
          {
            name: "payment_method",
            label: "Méthode",
            type: "select",
            required: true,
            colSpan: 2,
            options: [
              { value: "fixed_salary", label: "Salaire fixe" },
              { value: "hourly", label: "Tarif horaire" },
            ],
          },
          { name: "salary_amount", label: "Salaire mensuel (FCFA)", type: "number" },
          { name: "hourly_rate", label: "Tarif horaire (FCFA)", type: "number" },
        ]}
        initial={assignmentEdit}
        submitting={saveAssignment.isPending}
        onSubmit={(values) =>
          saveAssignment.mutate(
            {
              id: assignmentEdit?.id,
              values: {
                payment_method: values['payment_method'],
                salary_amount: values['salary_amount'] ?? 0,
                hourly_rate: values['hourly_rate'] ?? 0,
              },
            },
            { onSuccess: () => setAssignmentEdit(null) },
          )
        }
      />

      <RecordDialog
        open={!!sessionFor}
        onOpenChange={(v) => !v && setSessionFor(null)}
        title="Nouvelle séance"
        fields={[
          { name: "name", label: "Intitulé", required: true, colSpan: 2, placeholder: "Maths 6ème A" },
          {
            name: "weekday",
            label: "Jour",
            type: "select",
            required: true,
            options: WEEKDAYS.map((d) => ({ value: String(d.value), label: d.label })),
          },
          { name: "duration_minutes", label: "Durée (minutes)", type: "number", required: true, defaultValue: 60 },
        ]}
        submitting={saveSession.isPending}
        onSubmit={(values) =>
          saveSession.mutate(
            {
              values: {
                name: values['name'],
                weekday: Number(values['weekday']),
                duration_minutes: Number(values['duration_minutes']),
                assignment_id: sessionFor!.id,
              },
            },
            { onSuccess: () => setSessionFor(null) },
          )
        }
      />

      <TeacherPaymentDialog
        open={!!payFor}
        onClose={() => setPayFor(null)}
        assignment={payFor}
        teacherName={
          payFor
            ? (() => {
                const t = data.teachers.find((x) => x.id === payFor.teacher_id);
                return t ? `${t.last_name} ${t.first_name}` : "Enseignant";
              })()
            : ""
        }
        establishmentId={establishmentId}
        data={data}
      />
    </div>
  );
}

const financeChartConfig: ChartConfig = {
  recettes: { label: "Recettes", color: "oklch(0.7 0.15 155)" },
  depenses: { label: "Dépenses", color: "oklch(0.65 0.2 25)" },
};

const WEEKDAY_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTH_SHORT = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

function buildPeriodBuckets(period: Period, since: string) {
  const now = new Date();
  const start = new Date(`${since}T00:00:00`);
  const buckets: { key: string; label: string }[] = [];
  if (period === "year") {
    for (let m = start.getMonth(); m <= now.getMonth(); m++) {
      buckets.push({ key: `${now.getFullYear()}-${String(m + 1).padStart(2, "0")}`, label: MONTH_SHORT[m] ?? "" });
    }
  } else {
    const cursor = new Date(start);
    while (cursor <= now) {
      const key = cursor.toISOString().slice(0, 10);
      const label = period === "week" ? (WEEKDAY_SHORT[(cursor.getDay() + 6) % 7] ?? "") : String(cursor.getDate());
      buckets.push({ key, label });
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return buckets;
}

function bucketKeyFor(period: Period, dateStr: string) {
  return period === "year" ? dateStr.slice(0, 7) : dateStr.slice(0, 10);
}

function FinanceTab({ establishmentId, data }: { establishmentId: string; data: Data }) {
  const [period, setPeriod] = useState<Period>("month");
  const since = periodStart(period);
  const stats = useEstablishmentStats(data, since).get(establishmentId);

  const payments = data.tuitionPayments.filter((p) => p.establishment_id === establishmentId && p.paid_at >= since);
  const teacherPayments = data.teacherPayments.filter(
    (p) => p.establishment_id === establishmentId && p.paid_at >= since,
  );
  const revenue = sum(payments.map((p) => Number(p.amount)));
  const expenses = sum(teacherPayments.map((p) => Number(p.amount)));

  const chartData = useMemo(() => {
    const buckets = buildPeriodBuckets(period, since);
    return buckets.map((b) => ({
      label: b.label,
      recettes: sum(
        payments.filter((p) => bucketKeyFor(period, p.paid_at) === b.key).map((p) => Number(p.amount)),
      ),
      depenses: sum(
        teacherPayments.filter((p) => bucketKeyFor(period, p.paid_at) === b.key).map((p) => Number(p.amount)),
      ),
    }));
  }, [period, since, payments, teacherPayments]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {PERIODS.map((p) => (
            <Button
              key={p.value}
              size="sm"
              variant={period === p.value ? "default" : "ghost"}
              className="press"
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Recettes scolarité" value={formatFCFA(revenue)} icon={Wallet} tone="success" />
        <StatCard label="Dépenses enseignants" value={formatFCFA(expenses)} icon={Banknote} tone="destructive" delay={60} />
        <StatCard label="Solde" value={formatFCFA(revenue - expenses)} icon={Wallet} delay={120} />
        <StatCard label="Impayés" value={formatFCFA(stats?.outstanding ?? 0)} icon={AlertTriangle} tone="accent" delay={180} />
      </div>

      <Card className="animate-rise panel-gradient">
        <CardHeader>
          <CardTitle className="font-display text-base">Recettes vs dépenses</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={financeChartConfig} className="aspect-auto h-64 w-full">
            <BarChart data={chartData}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="recettes" fill="var(--color-recettes)" radius={4} />
              <Bar dataKey="depenses" fill="var(--color-depenses)" radius={4} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <DataTable
        rows={teacherPayments.slice(0, 15)}
        emptyLabel="Aucun paiement enseignant sur la période."
        columns={[
          {
            key: "teacher",
            header: "Enseignant",
            cell: (p) => {
              const t = data.teachersById.get(p.teacher_id);
              return t ? `${t.last_name} ${t.first_name}` : "—";
            },
          },
          { key: "amount", header: "Montant", cell: (p) => formatFCFA(p.amount) },
          { key: "date", header: "Date", cell: (p) => formatDate(p.paid_at) },
        ]}
      />
    </div>
  );
}