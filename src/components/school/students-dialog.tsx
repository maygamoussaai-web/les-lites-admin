import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, Users, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { useSaveRow, useArchiveRow } from "@/lib/data";
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
  const archive = useArchiveRow("students", "Élève");
  const [open, setOpen] = useState(false);

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
      key: "goto",
      header: "",
      className: "text-right",
      cell: (s) => (
        <Link
          to="/eleves/$studentId"
          params={{ studentId: s.id }}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Ouvrir la fiche de l'élève"
        >
          <ArrowRight className="h-4 w-4" />
        </Link>
      ),
    },
  ];

  return (
    <Dialog open={!!klass} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-display">Élèves — {klass?.name}</DialogTitle>
          <DialogDescription>
            {students.length} élève(s) sur une capacité de {klass?.capacity ?? 0}. Cliquez sur la flèche pour ouvrir la
            fiche complète d'un élève (modifier, transférer, supprimer, résultats).
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button className="press" size="sm" onClick={() => setOpen(true)}>
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
          title="Nouvel élève"
          description="La fiche complète (résultats, scolarité, transfert) est accessible depuis la liste après création."
          fields={fields}
          submitting={save.isPending}
          onSubmit={(values) =>
            save.mutate(
              {
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
      </DialogContent>
    </Dialog>
  );
}