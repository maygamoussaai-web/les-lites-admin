import { useMemo, useState } from "react";
import { Plus, Users, ArrowRightLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { RowActions } from "@/components/app/row-actions";
import { EmptyState } from "@/components/app/empty-state";
import { useSaveRow, useDeleteRow } from "@/lib/data";
import { formatDate, formatNumber, formatFCFA } from "@/lib/format";
import { annualAverage, lateStatus, sum, type ClassRow, type Student } from "@/lib/school";
import type { SchoolData } from "@/lib/school-data";

export function StudentsDialog({
  klass,
  data,
  onClose,
}: {
  klass: ClassRow | null;
  data: SchoolData;
  onClose: () => void;
}) {
  const save = useSaveRow("students", "Élève");
  const remove = useDeleteRow("students", "Élève");
  const saveTransfer = useSaveRow("student_transfers", "Transfert");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [transferring, setTransferring] = useState<Student | null>(null);

  const students = useMemo(
    () => data.students.filter((s) => s.class_id === klass?.id),
    [data.students, klass?.id],
  );

  const installments = useMemo(
    () => data.installments.filter((i) => i.fee_plan_id === klass?.fee_plan_id),
    [data.installments, klass?.fee_plan_id],
  );

  const fields: Field[] = [
    { name: "first_name", label: "Prénom", required: true },
    { name: "last_name", label: "Nom", required: true },
    {
      name: "gender",
      label: "Sexe",
      type: "select",
      required: true,
      defaultValue: "M",
      options: [
        { value: "M", label: "Masculin" },
        { value: "F", label: "Féminin" },
      ],
    },
    { name: "date_of_birth", label: "Date de naissance", type: "date" },
    { name: "parent_phone_1", label: "Téléphone parent 1", placeholder: "+223 ..." },
    { name: "parent_phone_2", label: "Téléphone parent 2", placeholder: "+223 ..." },
    { name: "term1_average", label: "Moyenne trimestre 1", type: "number", help: "Sur 20, saisie manuelle" },
    { name: "term2_average", label: "Moyenne trimestre 2", type: "number" },
    { name: "term3_average", label: "Moyenne trimestre 3", type: "number" },
  ];

  const paidOf = (studentId: string) =>
    sum(data.tuitionPayments.filter((p) => p.student_id === studentId).map((p) => Number(p.amount)));

  const columns: Column<Student>[] = [
    {
      key: "name",
      header: "Élève",
      cell: (s) => (
        <div>
          <p className="font-medium text-foreground">
            {s.last_name} {s.first_name}
          </p>
          <p className="text-xs text-muted-foreground">
            {s.gender === "F" ? "Féminin" : "Masculin"} · {formatDate(s.date_of_birth)}
          </p>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Parents",
      cell: (s) => (
        <div className="text-sm">
          <p>{s.parent_phone_1 ?? "—"}</p>
          {s.parent_phone_2 ? <p className="text-xs text-muted-foreground">{s.parent_phone_2}</p> : null}
        </div>
      ),
    },
    {
      key: "averages",
      header: "Moyennes T1 / T2 / T3",
      cell: (s) => (
        <span className="text-sm tabular-nums">
          {[s.term1_average, s.term2_average, s.term3_average]
            .map((v) => (v === null ? "—" : formatNumber(v, 2)))
            .join(" / ")}
        </span>
      ),
    },
    {
      key: "annual",
      header: "Moyenne annuelle",
      cell: (s) => {
        const avg = annualAverage(s);
        return avg === null ? (
          <span className="text-sm text-muted-foreground">Incomplète</span>
        ) : (
          <Badge variant={avg >= 10 ? "default" : "destructive"} className="tabular-nums">
            {formatNumber(avg, 2)}
          </Badge>
        );
      },
    },
    {
      key: "tuition",
      header: "Scolarité",
      cell: (s) => {
        const paid = paidOf(s.id);
        if (!installments.length) return <span className="text-sm text-muted-foreground">Aucun modèle</span>;
        const late = lateStatus(paid, installments);
        return late.isLate ? (
          <Badge variant="destructive">Retard {formatFCFA(late.overdueAmount)}</Badge>
        ) : (
          <Badge className="bg-success text-success-foreground">À jour</Badge>
        );
      },
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (s) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Transférer"
            className="press"
            onClick={() => setTransferring(s)}
          >
            <ArrowRightLeft className="h-4 w-4" />
          </Button>
          <RowActions
            onEdit={() => {
              setEditing(s);
              setOpen(true);
            }}
            onDelete={() => remove.mutate(s.id)}
          />
        </div>
      ),
    },
  ];

  return (
    <Dialog open={!!klass} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-display">Élèves — {klass?.name}</DialogTitle>
          <DialogDescription>
            {students.length} élève(s) sur une capacité de {klass?.capacity ?? 0}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button
            className="press"
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Ajouter un élève
          </Button>
        </div>

        {students.length === 0 ? (
          <EmptyState icon={Users} title="Aucun élève dans cette classe" description="Ajoutez le premier élève pour démarrer." />
        ) : (
          <DataTable columns={columns} rows={students} />
        )}

        <RecordDialog
          open={open}
          onOpenChange={setOpen}
          title={editing ? "Modifier l'élève" : "Nouvel élève"}
          description="La moyenne annuelle est calculée automatiquement dès que les trois trimestres sont renseignés."
          fields={fields}
          initial={editing}
          submitting={save.isPending}
          onSubmit={(values) =>
            save.mutate(
              {
                id: editing?.id,
                values: {
                  ...values,
                  class_id: klass!.id,
                  establishment_id: klass!.establishment_id,
                },
              },
              { onSuccess: () => setOpen(false) },
            )
          }
        />

        <TransferDialog
          student={transferring}
          data={data}
          onClose={() => setTransferring(null)}
          onTransfer={(student, toClassId, toEstablishmentId) => {
            save.mutate(
              {
                id: student.id,
                values: { class_id: toClassId, establishment_id: toEstablishmentId },
              },
              {
                onSuccess: () => {
                  saveTransfer.mutate({
                    values: {
                      student_id: student.id,
                      from_class_id: student.class_id,
                      from_establishment_id: student.establishment_id,
                      to_class_id: toClassId,
                      to_establishment_id: toEstablishmentId,
                    },
                  });
                  setTransferring(null);
                },
              },
            );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  student,
  data,
  onClose,
  onTransfer,
}: {
  student: Student | null;
  data: SchoolData;
  onClose: () => void;
  onTransfer: (student: Student, toClassId: string, toEstablishmentId: string) => void;
}) {
  const options = data.classes
    .filter((c) => c.id !== student?.class_id)
    .map((c) => ({
      value: c.id,
      label: `${data.establishments.find((e) => e.id === c.establishment_id)?.name ?? ""} — ${c.name}`,
    }));

  return (
    <RecordDialog
      open={!!student}
      onOpenChange={(v) => !v && onClose()}
      title={`Transférer ${student?.first_name ?? ""} ${student?.last_name ?? ""}`}
      description="Le transfert conserve l'historique de l'élève."
      fields={[{ name: "class_id", label: "Nouvelle classe", type: "select", required: true, colSpan: 2, options }]}
      onSubmit={(values) => {
        const target = data.classes.find((c) => c.id === values['class_id']);
        if (student && target) onTransfer(student, target.id, target.establishment_id);
      }}
    />
  );
}
