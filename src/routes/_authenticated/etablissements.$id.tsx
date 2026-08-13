import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, GraduationCap, Users, Wallet, AlertTriangle, Banknote, Trash2 } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useSaveRow, useDeleteRow } from "@/lib/data";
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
  type ClassRow,
  type TeacherAssignment,
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

  const columns: Column<ClassRow>[] = [
    { key: "name", header: "Classe", cell: (c) => <span className="font-medium">{c.name}</span> },
    {
      key: "effectif",
      header: "Effectif",
      cell: (c) => `${data.students.filter((s) => s.class_id === c.id).length} / ${c.capacity}`,
    },
    {
      key: "plan",
      header: "Modèle de scolarité",
      cell: (c) => plans.find((p) => p.id === c.fee_plan_id)?.name ?? "—",
    },
    { key: "status", header: "Statut", cell: (c) => (c.is_active ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>) },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (c) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" className="press" onClick={() => setViewing(c)}>
            <Users className="mr-1.5 h-4 w-4" /> Élèves
          </Button>
          <RowActions
            onEdit={() => {
              setEditing(c);
              setOpen(true);
            }}
            onDelete={() => remove.mutate(c.id)}
          />
        </div>
      ),
    },
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
        <DataTable columns={columns} rows={rows} loading={data.loading} />
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
  const savePlan = useSaveRow("fee_plans", "Modèle de scolarité");
  const saveInstallment = useSaveRow("fee_plan_installments", "Tranche");
  const removeInstallment = useDeleteRow("fee_plan_installments", "Tranche");

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

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const planRow = await savePlan.mutateAsync({
        id: editingPlan?.id,
        values: { name: name.trim(), total_amount: totalNum, establishment_id: establishmentId },
      });
      const planId = editingPlan?.id ?? (planRow as { id?: string } | null)?.id;
      if (!planId) throw new Error("Modèle non créé");

      if (editingPlan) {
        const existingIds = new Set(
          installments.filter((i) => i.fee_plan_id === editingPlan.id).map((i) => i.id),
        );
        const keptIds = new Set(tranches.filter((t) => existingIds.has(t.id)).map((t) => t.id));
        for (const oldId of existingIds) {
          if (!keptIds.has(oldId)) await removeInstallment.mutateAsync(oldId);
        }
      }

      let position = 1;
      for (const t of tranches) {
        const isExisting = !!editingPlan && installments.some((i) => i.id === t.id && i.fee_plan_id === editingPlan.id);
        await saveInstallment.mutateAsync({
          id: isExisting ? t.id : undefined,
          values: {
            fee_plan_id: planId,
            label: t.label.trim(),
            amount: Number(t.amount),
            due_date: t.due_date,
            position: position++,
          },
        });
      }
      onSaved();
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
            Enregistrer
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
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setStudentId(defaultStudentId ?? students[0]?.id ?? "");
    setAmount("");
    setPaidAt(new Date().toISOString().slice(0, 10));
    setMethod("cash");
    setNote("");
  }, [open, defaultStudentId]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">
              Élève<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner" />
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
          return { student, klass, plan, paid, expected, remaining: Math.max(0, expected - paid), status };
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
                const st = data.students.find((s) => s.id === p.student_id);
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

function TeachersTab({
  establishmentId,
  data,
  isDG,
}: {
  establishmentId: string;
  data: Data;
  isDG: boolean;
}) {
  const saveTeacher = useSaveRow("teachers", "Enseignant");
  const removeTeacher = useDeleteRow("teachers", "Enseignant");
  const saveAssignment = useSaveRow("teacher_assignments", "Affectation");
  const saveSession = useSaveRow("teacher_sessions", "Séance");
  const removeSession = useDeleteRow("teacher_sessions", "Séance");
  const savePayment = useSaveRow("teacher_payments", "Paiement");

  const [teacherOpen, setTeacherOpen] = useState(false);
  const [assignmentEdit, setAssignmentEdit] = useState<TeacherAssignment | null>(null);
  const [sessionFor, setSessionFor] = useState<TeacherAssignment | null>(null);
  const [payFor, setPayFor] = useState<TeacherAssignment | null>(null);

  const assignments = data.assignments.filter((a) => a.establishment_id === establishmentId);

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
                  <div>
                    <CardTitle className="font-display text-base">
                      {teacher ? `${teacher.last_name} ${teacher.first_name}` : "Enseignant"}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">{teacher?.domain ?? "—"} · {teacher?.phone ?? "—"}</p>
                  </div>
                  <Badge variant={a.payment_method === "fixed_salary" ? "secondary" : "outline"}>
                    {a.payment_method === "fixed_salary" ? "Salaire fixe" : "Tarif horaire"}
                  </Badge>
                </CardHeader>
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

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="press" onClick={() => setSessionFor(a)}>
                      <Plus className="mr-1.5 h-4 w-4" /> Séance
                    </Button>
                    <Button size="sm" variant="outline" className="press" onClick={() => setAssignmentEdit(a)}>
                      Rémunération
                    </Button>
                    <Button size="sm" className="press" onClick={() => setPayFor(a)}>
                      <Banknote className="mr-1.5 h-4 w-4" /> Payer
                    </Button>
                    {isDG && teacher ? (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeTeacher.mutate(teacher.id)}>
                        Supprimer la fiche
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <RecordDialog
        open={teacherOpen}
        onOpenChange={setTeacherOpen}
        title="Nouvel enseignant"
        description="La fiche est créée puis affectée à cet établissement."
        fields={[
          { name: "first_name", label: "Prénom", required: true },
          { name: "last_name", label: "Nom", required: true },
          { name: "phone", label: "Téléphone" },
          { name: "domain", label: "Domaine", placeholder: "Mathématiques" },
        ]}
        submitting={saveTeacher.isPending}
        onSubmit={(values) =>
          saveTeacher.mutate(
            { values },
            {
              onSuccess: (created) => {
                const teacherId = (created as { id?: string } | null)?.id;
                if (teacherId) {
                  saveAssignment.mutate({
                    values: { teacher_id: teacherId, establishment_id: establishmentId, payment_method: "fixed_salary" },
                  });
                }
                setTeacherOpen(false);
              },
            },
          )
        }
      />

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
              { value: "hourly_rate", label: "Tarif horaire" },
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

      <RecordDialog
        open={!!payFor}
        onOpenChange={(v) => !v && setPayFor(null)}
        title="Paiement enseignant"
        fields={[
          { name: "amount", label: "Montant (FCFA)", type: "number", required: true },
          { name: "paid_at", label: "Date", type: "date", defaultValue: new Date().toISOString().slice(0, 10) },
          { name: "note", label: "Note", type: "textarea" },
        ]}
        submitting={savePayment.isPending}
        onSubmit={(values) =>
          savePayment.mutate(
            {
              values: {
                ...values,
                teacher_id: payFor!.teacher_id,
                establishment_id: establishmentId,
              },
            },
            { onSuccess: () => setPayFor(null) },
          )
        }
      />
    </div>
  );
}

function FinanceTab({ establishmentId, data }: { establishmentId: string; data: Data }) {
  const stats = useEstablishmentStats(data).get(establishmentId);
  const payments = data.tuitionPayments.filter((p) => p.establishment_id === establishmentId);
  const teacherPayments = data.teacherPayments.filter((p) => p.establishment_id === establishmentId);
  const revenue = sum(payments.map((p) => Number(p.amount)));
  const expenses = sum(teacherPayments.map((p) => Number(p.amount)));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Recettes scolarité" value={formatFCFA(revenue)} icon={Wallet} tone="success" />
        <StatCard label="Dépenses enseignants" value={formatFCFA(expenses)} icon={Banknote} tone="destructive" delay={60} />
        <StatCard label="Solde" value={formatFCFA(revenue - expenses)} icon={Wallet} delay={120} />
        <StatCard label="Impayés" value={formatFCFA(stats?.outstanding ?? 0)} icon={AlertTriangle} tone="accent" delay={180} />
      </div>
      <DataTable
        rows={teacherPayments.slice(0, 15)}
        emptyLabel="Aucun paiement enseignant."
        columns={[
          {
            key: "teacher",
            header: "Enseignant",
            cell: (p) => {
              const t = data.teachers.find((x) => x.id === p.teacher_id);
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
