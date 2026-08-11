import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { RowActions } from "@/components/app/row-actions";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRows, useSaveRow, useDeleteRow } from "@/lib/data";
import { formatFCFA, formatDate } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/scolarite")({
  head: () => ({
    meta: [
      { title: "Scolarité & paiements – Les Élites de Gao" },
      { name: "description", content: "Plans de scolarité, montants dus et encaissements des élèves du complexe Les Élites de Gao." },
      { property: "og:title", content: "Scolarité & paiements – Les Élites de Gao" },
      { property: "og:description", content: "Suivez les frais de scolarité et les règlements par élève." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Scolarité" description="Plans tarifaires, montants dus par élève et encaissements." />
      <Tabs defaultValue="plans">
        <TabsList>
          <TabsTrigger value="plans">Plans tarifaires</TabsTrigger>
          <TabsTrigger value="eleves">Frais par élève</TabsTrigger>
          <TabsTrigger value="paiements">Encaissements</TabsTrigger>
        </TabsList>
        <TabsContent value="plans" className="mt-4">
          <Plans />
        </TabsContent>
        <TabsContent value="eleves" className="mt-4">
          <StudentTuition />
        </TabsContent>
        <TabsContent value="paiements" className="mt-4">
          <Payments />
        </TabsContent>
      </Tabs>
    </>
  );
}

function Plans() {
  const { data: classes = [] } = useRows<Tables<"classes">>("classes", { order: { column: "name" } });
  const { data: years = [] } = useRows<Tables<"academic_years">>("academic_years");
  const { data: establishments = [] } = useRows<Tables<"establishments">>("establishments");
  const { data = [], isLoading } = useRows<Tables<"tuition_plans">>("tuition_plans", { order: { column: "name" } });
  const save = useSaveRow("tuition_plans", "Plan de scolarité");
  const remove = useDeleteRow("tuition_plans", "Plan de scolarité");
  const [open, setOpen] = useState(false);
  const activeYear = years.find((y) => y.is_active);

  const fields: Field[] = [
    { name: "name", label: "Nom du plan", required: true, colSpan: 2 },
    { name: "class_id", label: "Classe", type: "select", required: true, colSpan: 2, options: classes.map((c) => ({ value: c.id, label: c.name })) },
    { name: "total_amount", label: "Montant total (FCFA)", type: "number", required: true, colSpan: 2 },
  ];

  const columns: Column<Tables<"tuition_plans">>[] = [
    { key: "name", header: "Plan", cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "class", header: "Classe", cell: (r) => classes.find((c) => c.id === r.class_id)?.name ?? "Tout l'établissement" },
    { key: "est", header: "Établissement", cell: (r) => establishments.find((e) => e.id === r.establishment_id)?.name ?? "—" },
    { key: "amount", header: "Montant", cell: (r) => formatFCFA(Number(r.total_amount)) },
    { key: "actions", header: "", className: "text-right", cell: (r) => <RowActions onDelete={() => remove.mutate(r.id)} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Nouveau plan
        </Button>
      </div>
      <DataTable columns={columns} rows={data} loading={isLoading} emptyLabel="Aucun plan tarifaire." />
      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title="Nouveau plan de scolarité"
        fields={fields}
        submitting={save.isPending}
        onSubmit={(values) => {
          const klass = classes.find((c) => c.id === values.class_id);
          if (!klass) return;
          save.mutate(
            { values: { ...values, establishment_id: klass.establishment_id, academic_year_id: klass.academic_year_id ?? activeYear?.id } },
            { onSuccess: () => setOpen(false) },
          );
        }}
      />
    </div>
  );
}

function StudentTuition() {
  const { data: students = [] } = useRows<Tables<"students">>("students", { order: { column: "last_name" } });
  const { data: plans = [] } = useRows<Tables<"tuition_plans">>("tuition_plans");
  const { data = [], isLoading } = useRows<Tables<"student_tuition">>("student_tuition");
  const save = useSaveRow("student_tuition", "Frais de scolarité");
  const remove = useDeleteRow("student_tuition", "Frais de scolarité");
  const [open, setOpen] = useState(false);

  const fields: Field[] = [
    { name: "student_id", label: "Élève", type: "select", required: true, colSpan: 2, options: students.map((s) => ({ value: s.id, label: `${s.last_name} ${s.first_name}` })) },
    { name: "tuition_plan_id", label: "Plan", type: "select", required: true, colSpan: 2, options: plans.map((p) => ({ value: p.id, label: `${p.name} — ${formatFCFA(Number(p.total_amount))}` })) },
    { name: "amount_due", label: "Montant dû (FCFA)", type: "number", required: true },
    {
      name: "status",
      label: "Statut",
      type: "select",
      defaultValue: "pending",
      options: [
        { value: "pending", label: "En attente" },
        { value: "partial", label: "Partiel" },
        { value: "paid", label: "Soldé" },
      ],
    },
  ];

  const columns: Column<Tables<"student_tuition">>[] = [
    { key: "student", header: "Élève", cell: (r) => { const s = students.find((x) => x.id === r.student_id); return s ? `${s.last_name} ${s.first_name}` : "—"; } },
    { key: "plan", header: "Plan", cell: (r) => plans.find((p) => p.id === r.tuition_plan_id)?.name ?? "—" },
    { key: "due", header: "Montant dû", cell: (r) => formatFCFA(Number(r.amount_due)) },
    { key: "status", header: "Statut", cell: (r) => r.status },
    { key: "actions", header: "", className: "text-right", cell: (r) => <RowActions onDelete={() => remove.mutate(r.id)} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Affecter un plan
        </Button>
      </div>
      <DataTable columns={columns} rows={data} loading={isLoading} emptyLabel="Aucun frais enregistré." />
      <RecordDialog open={open} onOpenChange={setOpen} title="Affecter un plan à un élève" fields={fields} submitting={save.isPending} onSubmit={(values) => save.mutate({ values }, { onSuccess: () => setOpen(false) })} />
    </div>
  );
}

function Payments() {
  const { data: students = [] } = useRows<Tables<"students">>("students");
  const { data: tuitions = [] } = useRows<Tables<"student_tuition">>("student_tuition");
  const { data = [], isLoading } = useRows<Tables<"student_payments">>("student_payments", { order: { column: "payment_date", ascending: false } });
  const save = useSaveRow("student_payments", "Paiement");
  const remove = useDeleteRow("student_payments", "Paiement");
  const [open, setOpen] = useState(false);

  const label = (id: string) => {
    const t = tuitions.find((x) => x.id === id);
    const s = students.find((x) => x.id === t?.student_id);
    return s ? `${s.last_name} ${s.first_name}` : "—";
  };

  const fields: Field[] = [
    { name: "student_tuition_id", label: "Élève / frais", type: "select", required: true, colSpan: 2, options: tuitions.map((t) => ({ value: t.id, label: `${label(t.id)} — ${formatFCFA(Number(t.amount_due))}` })) },
    { name: "amount", label: "Montant (FCFA)", type: "number", required: true },
    { name: "payment_date", label: "Date", type: "date", required: true, defaultValue: new Date().toISOString().slice(0, 10) },
    {
      name: "payment_method",
      label: "Moyen",
      type: "select",
      defaultValue: "cash",
      options: [
        { value: "cash", label: "Espèces" },
        { value: "mobile_money", label: "Mobile Money" },
        { value: "bank", label: "Banque" },
      ],
    },
    { name: "receipt_number", label: "N° de reçu" },
    { name: "note", label: "Note", type: "textarea", colSpan: 2 },
  ];

  const columns: Column<Tables<"student_payments">>[] = [
    { key: "student", header: "Élève", cell: (r) => label(r.student_tuition_id) },
    { key: "amount", header: "Montant", cell: (r) => formatFCFA(Number(r.amount)) },
    { key: "date", header: "Date", cell: (r) => formatDate(r.payment_date) },
    { key: "method", header: "Moyen", cell: (r) => r.payment_method ?? "—" },
    { key: "receipt", header: "Reçu", cell: (r) => r.receipt_number ?? "—" },
    { key: "actions", header: "", className: "text-right", cell: (r) => <RowActions onDelete={() => remove.mutate(r.id)} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Enregistrer un paiement
        </Button>
      </div>
      <DataTable columns={columns} rows={data} loading={isLoading} emptyLabel="Aucun encaissement." />
      <RecordDialog open={open} onOpenChange={setOpen} title="Nouvel encaissement" fields={fields} submitting={save.isPending} onSubmit={(values) => save.mutate({ values }, { onSuccess: () => setOpen(false) })} />
    </div>
  );
}
