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
  BarChart3,
  RotateCcw,
  Receipt,
  UserPlus,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { RowActions } from "@/components/app/row-actions";
import { EmptyState } from "@/components/app/empty-state";
import { StudentsDialog } from "@/components/school/students-dialog";
import { ClassesTab } from "@/components/school/classes-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useSaveRow, useDeleteRow, useArchiveRow, writeAudit, useRows } from "@/lib/data";
import { formatFCFA, formatDate, establishmentTypeLabel } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  lateStatus,
  sum,
  teacherDue,
  validatedHours,
  weekdayLabel,
  WEEKDAYS,
  formatDuration,
  PERIODS,
  periodStart,
  currentWeekStart,
  type ClassRow,
  type Installment,
  type TeacherAssignment,
  type Period,
  type TeacherSessionCompletion,
} from "@/lib/school";

export const Route = createFileRoute("/_authenticated/etablissements/$id")({
  head: () => ({
    meta: [
      { title: "Gestion de l'établissement – Les Élites de Gao" },
      { name: "description", content: "Classes, élèves, scolarité, enseignants et finance de l'établissement." },
    ],
  }),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  const { isDG, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const data = useSchoolData();
  const stats = useEstablishmentStats(data);
  const est = data.establishments.find((e) => e.id === id);
  const s = stats.get(id);
  const allowed = isDG || establishmentIds.includes(id);

  if (!data.loading && !establishmentIdsLoading && (!est || !allowed)) {
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

/* ---------------------------------------------------------------------- */
/* Scolarité                                                               */
/* ---------------------------------------------------------------------- */

type TrancheDraft = { id: string; label: string; amount: string; due_date: string };

function newTrancheDraft(index: number): TrancheDraft {
  return { id: crypto.randomUUID(), label: `${index}ᵉ tranche`, amount: "", due_date: "" };
}

function TuitionTab({ establishmentId, data }: { establishmentId: string; data: Data }) {
  const save = useSaveRow("fee_plans", "Modèle de scolarité");
  const remove = useDeleteRow("fee_plans", "Modèle");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<(typeof data.feePlans)[0] | null>(null);
  const [tranches, setTranches] = useState<TrancheDraft[]>([newTrancheDraft(1)]);

  const plans = data.feePlans.filter((p) => p.establishment_id === establishmentId);

  const openCreate = () => {
    setEditing(null);
    setTranches([newTrancheDraft(1)]);
    setOpen(true);
  };

  const openEdit = (plan: (typeof data.feePlans)[0]) => {
    setEditing(plan);
    const inst = data.installments
      .filter((i) => i.fee_plan_id === plan.id)
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        id: i.id,
        label: i.label,
        amount: String(i.amount),
        due_date: i.due_date ?? "",
      }));
    setTranches(inst.length ? inst : [newTrancheDraft(1)]);
    setOpen(true);
  };

  const fields: Field[] = [
    { name: "name", label: "Nom du modèle", required: true, colSpan: 2 },
    { name: "total_amount", label: "Montant total (FCFA)", type: "number", required: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="press" onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" /> Nouveau modèle
        </Button>
      </div>
      {plans.length === 0 && !data.loading ? (
        <EmptyState icon={Receipt} title="Aucun modèle" description="Créez un modèle de scolarité avec ses tranches." />
      ) : (
        <DataTable
          columns={[
            { key: "name", header: "Nom", cell: (p) => p.name },
            { key: "total", header: "Total", cell: (p) => formatFCFA(Number(p.total_amount)) },
            {
              key: "actions",
              header: "",
              className: "text-right",
              cell: (p) => (
                <RowActions
                  onEdit={() => openEdit(p)}
                  onDelete={() => remove.mutate(p.id)}
                />
              ),
            },
          ]}
          rows={plans}
          loading={data.loading}
        />
      )}
      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Modifier le modèle" : "Nouveau modèle"}
        fields={fields}
        initial={editing ?? undefined}
        submitting={save.isPending}
        onSubmit={(values) =>
          save.mutate(
            { id: editing?.id, values: { ...values, establishment_id: establishmentId } },
            { onSuccess: () => setOpen(false) },
          )
        }
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Enseignants                                                             */
/* ---------------------------------------------------------------------- */

function AssignTeacherDialog({
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
  const subjectsQ = useRows<{ id: string; name: string }>("class_subjects", {
    eq: { establishment_id: establishmentId },
    order: { column: "name", ascending: true },
  });
  const subjectOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of subjectsQ.data ?? []) {
      const key = s.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(s.name.trim());
    }
    return out;
  }, [subjectsQ.data]);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [teacherId, setTeacherId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [domain, setDomain] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"fixed_salary" | "hourly">("fixed_salary");
  const [salaryAmount, setSalaryAmount] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("existing");
    setTeacherId("");
    setFirstName("");
    setLastName("");
    setPhone("");
    setDomain("");
    setPaymentMethod("fixed_salary");
    setSalaryAmount("");
    setHourlyRate("");
    setSubmitting(false);
  }, [open]);

  const alreadyAssignedIds = new Set(
    data.assignments.filter((a) => a.establishment_id === establishmentId).map((a) => a.teacher_id),
  );
  const availableTeachers = data.teachers.filter((t) => !alreadyAssignedIds.has(t.id));

  const paymentValid = paymentMethod === "fixed_salary" ? Number(salaryAmount) > 0 : Number(hourlyRate) > 0;
  const canSubmit =
    mode === "existing"
      ? !!teacherId && paymentValid && !submitting
      : !!firstName.trim() && !!lastName.trim() && !!domain.trim() && paymentValid && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      let finalTeacherId = teacherId;
      if (mode === "new") {
        const { data: created, error } = await supabase
          .from("teachers")
          .insert({
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            phone: phone || null,
            domain: domain || null,
          })
          .select()
          .single();
        if (error) throw error;
        finalTeacherId = created.id;
      }

      const { error: assignError } = await supabase.from("teacher_assignments").insert({
        teacher_id: finalTeacherId,
        establishment_id: establishmentId,
        payment_method: paymentMethod,
        salary_amount: paymentMethod === "fixed_salary" ? Number(salaryAmount) : null,
        hourly_rate: paymentMethod === "hourly" ? Number(hourlyRate) : null,
      });
      if (assignError) throw assignError;

      qc.invalidateQueries({ queryKey: ["teachers"] });
      qc.invalidateQueries({ queryKey: ["teacher_assignments"] });
      toast.success("Enseignant assigné");
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Assignation impossible");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assigner un enseignant</DialogTitle>
          <DialogDescription>Choisir un enseignant existant ou en créer un nouveau.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            variant={mode === "existing" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("existing")}
          >
            Existant
          </Button>
          <Button variant={mode === "new" ? "default" : "outline"} size="sm" onClick={() => setMode("new")}>
            Nouvel enseignant
          </Button>
        </div>

        {mode === "existing" ? (
          <div>
            <Label className="mb-1.5 block text-sm">
              Enseignant<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select value={teacherId} onValueChange={setTeacherId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner" />
              </SelectTrigger>
              <SelectContent>
                {availableTeachers.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    Tous les enseignants du complexe sont déjà assignés ici.
                  </div>
                ) : (
                  availableTeachers.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.last_name} {t.first_name} {t.domain ? `— ${t.domain}` : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        ) : (
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
              <Label className="mb-1.5 block text-sm">
                Matière<span className="ml-0.5 text-destructive">*</span>
              </Label>
              {subjectOptions.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Aucune matière. Importez d&apos;abord un modèle de bulletin pour une classe de cet établissement.
                </p>
              ) : (
                <Select value={domain || undefined} onValueChange={setDomain}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir une matière du plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjectOptions.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">
              Méthode de rémunération<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as "fixed_salary" | "hourly")}
            >
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
            <div>
              <Label className="mb-1.5 block text-sm">Salaire (FCFA)</Label>
              <Input type="number" value={salaryAmount} onChange={(e) => setSalaryAmount(e.target.value)} />
            </div>
          ) : (
            <div>
              <Label className="mb-1.5 block text-sm">Tarif horaire (FCFA)</Label>
              <Input type="number" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? "Enregistrement…" : "Assigner"}
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
  const [assignOpen, setAssignOpen] = useState(false);
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
      <div className="flex justify-end">
        <Button className="press" onClick={() => setAssignOpen(true)}>
          <UserPlus className="mr-1.5 h-4 w-4" /> Assigner un enseignant
        </Button>
      </div>

      {assignments.length === 0 && !data.loading ? (
        <EmptyState
          icon={Users}
          title="Aucun enseignant affecté"
          description="Assignez un enseignant déjà présent dans le complexe, ou créez-en un nouveau."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {assignments.map((a, index) => {
            const teacher = data.teachers.find((t) => t.id === a.teacher_id);
            const due = teacherDue(a, data.sessions, data.sessionCompletions);
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
                    <p className="text-xs text-muted-foreground">
                      {teacher?.domain ?? "—"} · {teacher?.phone ?? "—"}
                    </p>
                  </div>
                  <Badge variant={a.payment_method === "fixed_salary" ? "secondary" : "outline"}>
                    {a.payment_method === "fixed_salary" ? "Salaire fixe" : "Tarif horaire"}
                  </Badge>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Dû</p>
                    <p className="font-medium">{formatFCFA(due)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Payé</p>
                    <p className="font-medium">{formatFCFA(paid)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Heures</p>
                    <p className="font-medium">
                      {validatedHours(a.id, data.sessions, data.sessionCompletions).toFixed(1)} h
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AssignTeacherDialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        establishmentId={establishmentId}
        data={data}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Finance                                                                 */
/* ---------------------------------------------------------------------- */

function FinanceTab({ establishmentId, data }: { establishmentId: string; data: Data }) {
  const payments = data.tuitionPayments.filter((p) => p.establishment_id === establishmentId);

  return (
    <div className="space-y-4">
      <DataTable
        columns={[
          {
            key: "student",
            header: "Élève",
            cell: (p) => {
              const s = data.students.find((x) => x.id === p.student_id);
              return s ? `${s.last_name} ${s.first_name}` : "—";
            },
          },
          { key: "amount", header: "Montant", cell: (p) => formatFCFA(Number(p.amount)) },
          { key: "date", header: "Date", cell: (p) => formatDate(p.paid_at) },
        ]}
        rows={payments}
        loading={data.loading}
      />
    </div>
  );
}
