import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Users, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { supabase } from "@/integrations/supabase/client";
import { writeAudit } from "@/lib/data";
import { formatFCFA } from "@/lib/format";
import { lateStatus, sum, type ClassRow, type Installment, type Student } from "@/lib/school";
import type { SchoolData } from "@/lib/school-data";
import { describeError } from "@/lib/errors";

export function StudentsDialog({
  klass,
  data,
  onClose,
  readOnly = false,
}: {
  klass: ClassRow | null;
  data: SchoolData;
  onClose: () => void;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isClassArchived = !!(klass && klass.is_active === false);
  const locked = readOnly || isClassArchived;

  const students = useMemo(() => {
    if (!klass) return [];
    if (isClassArchived) {
      const ids = new Set(
        (data.enrollments ?? []).filter((e) => e.class_id === klass.id).map((e) => e.student_id),
      );
      const list: Student[] = [];
      for (const id of ids) {
        const s =
          data.students.find((x) => x.id === id) ??
          data.archivedStudents?.find((x) => x.id === id) ??
          (data.studentsById?.get(id) as Student | undefined);
        if (s) list.push(s);
      }
      return list.sort((a, b) =>
        `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`),
      );
    }
    return data.students.filter((s) => s.class_id === klass.id);
  }, [data.students, data.archivedStudents, data.studentsById, data.enrollments, klass, isClassArchived]);

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

  const createStudent = async (values: Record<string, any>) => {
    if (!klass || locked) return;
    setSubmitting(true);
    try {
      const { data: created, error } = await supabase
        .from("students")
        .insert({ ...values, class_id: klass.id, establishment_id: klass.establishment_id } as never)
        .select()
        .single();
      if (error) throw error;

      const establishment = data.establishments.find((e) => e.id === klass.establishment_id);
      const plan = data.feePlans.find((p) => p.id === klass.fee_plan_id);
      const planInstallments = data.installments.filter((i) => i.fee_plan_id === klass.fee_plan_id);

      const { error: enrollError } = await supabase.from("student_enrollments").insert({
        student_id: created.id,
        establishment_id: klass.establishment_id,
        class_id: klass.id,
        establishment_name: establishment?.name ?? "",
        class_name: klass.name,
        fee_plan_id: klass.fee_plan_id,
        total_amount: plan ? Number(plan.total_amount) : 0,
        installments_snapshot: planInstallments.map((i) => ({
          label: i.label,
          amount: i.amount,
          due_date: i.due_date,
          position: i.position,
        })) as never,
      });
      if (enrollError) throw enrollError;

      await writeAudit("create", "students", created.id, { class_id: klass.id });
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["student_enrollments"] });
      toast.success("Élève ajouté");
      setOpen(false);
    } catch (e) {
      toast.error(describeError(e, "Ajout impossible"));
    } finally {
      setSubmitting(false);
    }
  };

  const columns: Column<Student>[] = [
    {
      key: "name",
      header: "Élève",
      cell: (s) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 border border-border">
            {s.photo_url ? <AvatarImage src={s.photo_url} alt={`${s.last_name} ${s.first_name}`} /> : null}
            <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
              {initials(s.first_name, s.last_name)}
            </AvatarFallback>
          </Avatar>
          <p className="font-medium text-foreground">
            {s.last_name} {s.first_name}
          </p>
        </div>
      ),
    },
    {
      key: "tuition",
      header: "Scolarité",
      cell: (s) => {
        const enrollment = data.activeEnrollmentByStudent.get(s.id);
        if (!enrollment) return <span className="text-sm text-muted-foreground">—</span>;
        const paid = sum(
          data.tuitionPayments.filter((p) => p.enrollment_id === enrollment.id).map((p) => Number(p.amount)),
        );
        const installments = (enrollment.installments_snapshot as unknown as Installment[]) ?? [];
        if (!installments.length) return <span className="text-sm text-muted-foreground">—</span>;
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
            {students.length} élève(s)
            {!locked ? ` sur une capacité de ${klass?.capacity ?? 0}` : " (classe archivée — consultation)"}.
            {" "}
            Cliquez sur la flèche pour ouvrir la fiche.
          </DialogDescription>
        </DialogHeader>

        {!locked && (
          <div className="flex justify-end">
            <Button className="press" size="sm" onClick={() => setOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Ajouter un élève
            </Button>
          </div>
        )}

        {students.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Aucun élève dans cette classe"
            description={locked ? "Aucun élève associé à cette classe archivée." : "Ajoutez le premier élève pour démarrer."}
          />
        ) : (
          <DataTable columns={columns} rows={students} />
        )}

        {!locked && (
          <RecordDialog
            open={open}
            onOpenChange={setOpen}
            title="Nouvel élève"
            description="La fiche complète (résultats, scolarité, transfert) est accessible depuis la liste après création."
            fields={fields}
            submitting={submitting}
            onSubmit={createStudent}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
