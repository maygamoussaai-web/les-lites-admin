import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { RowActions } from "@/components/app/row-actions";
import { Button } from "@/components/ui/button";
import { useRows, useSaveRow, useDeleteRow } from "@/lib/data";
import { formatFCFA, formatDate } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/paiements-enseignants")({
  head: () => ({
    meta: [
      { title: "Paiements enseignants – Les Élites de Gao" },
      { name: "description", content: "Historique des rémunérations versées aux enseignants du complexe Les Élites de Gao." },
      { property: "og:title", content: "Paiements enseignants – Les Élites de Gao" },
      { property: "og:description", content: "Enregistrez et suivez les paiements des enseignants par période." },
    ],
  }),
  component: Page,
});

function Page() {
  const { data: teachers = [] } = useRows<Tables<"teachers">>("teachers", { order: { column: "last_name" } });
  const { data: establishments = [] } = useRows<Tables<"establishments">>("establishments");
  const { data: years = [] } = useRows<Tables<"academic_years">>("academic_years");
  const { data = [], isLoading } = useRows<Tables<"teacher_payments">>("teacher_payments", { order: { column: "payment_date", ascending: false } });
  const save = useSaveRow("teacher_payments", "Paiement enseignant");
  const remove = useDeleteRow("teacher_payments", "Paiement enseignant");
  const [open, setOpen] = useState(false);
  const activeYear = years.find((y) => y.is_active);

  const fields: Field[] = [
    { name: "teacher_id", label: "Enseignant", type: "select", required: true, colSpan: 2, options: teachers.map((t) => ({ value: t.id, label: `${t.last_name} ${t.first_name}` })) },
    { name: "establishment_id", label: "Établissement", type: "select", options: establishments.map((e) => ({ value: e.id, label: e.name })) },
    { name: "amount", label: "Montant (FCFA)", type: "number", required: true },
    { name: "period_start", label: "Période du", type: "date" },
    { name: "period_end", label: "au", type: "date" },
    { name: "payment_date", label: "Date de paiement", type: "date", required: true, defaultValue: new Date().toISOString().slice(0, 10) },
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
    { name: "note", label: "Note", type: "textarea", colSpan: 2 },
  ];

  const columns: Column<Tables<"teacher_payments">>[] = [
    { key: "teacher", header: "Enseignant", cell: (r) => { const t = teachers.find((x) => x.id === r.teacher_id); return t ? `${t.last_name} ${t.first_name}` : "—"; } },
    { key: "amount", header: "Montant", cell: (r) => formatFCFA(Number(r.amount)) },
    { key: "period", header: "Période", cell: (r) => `${formatDate(r.period_start)} → ${formatDate(r.period_end)}` },
    { key: "date", header: "Payé le", cell: (r) => formatDate(r.payment_date) },
    { key: "method", header: "Moyen", cell: (r) => r.payment_method ?? "—" },
    { key: "actions", header: "", className: "text-right", cell: (r) => <RowActions onDelete={() => remove.mutate(r.id)} /> },
  ];

  const total = data.reduce((s, p) => s + Number(p.amount ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Paiements enseignants"
        description={`Total versé : ${formatFCFA(total)}`}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Nouveau paiement
          </Button>
        }
      />
      <DataTable columns={columns} rows={data} loading={isLoading} emptyLabel="Aucun paiement enregistré." />
      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title="Nouveau paiement enseignant"
        fields={fields}
        submitting={save.isPending}
        onSubmit={(values) => save.mutate({ values: { ...values, academic_year_id: activeYear?.id ?? null } }, { onSuccess: () => setOpen(false) })}
      />
    </>
  );
}
