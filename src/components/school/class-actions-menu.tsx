/**
 * Menu ⋮ de la page classe : modifier, renouveler, supprimer.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSaveRow, useDeleteRow, writeAudit } from "@/lib/data";
import { formatFCFA } from "@/lib/format";
import type { SchoolData } from "@/lib/school-data";
import type { ClassRow } from "@/lib/school";
import { describeError } from "@/lib/errors";

export function ClassActionsMenu({
  klass,
  data,
}: {
  klass: ClassRow;
  data: SchoolData;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const save = useSaveRow("classes", "Classe");
  const remove = useDeleteRow("classes", "Classe");
  const [editOpen, setEditOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renewBusy, setRenewBusy] = useState(false);

  const plans = data.feePlans.filter((p) => p.establishment_id === klass.establishment_id);
  const studentIds = data.students.filter((s) => s.class_id === klass.id).map((s) => s.id);

  const fields: Field[] = [
    { name: "name", label: "Nom de la classe", required: true, colSpan: 2 },
    { name: "capacity", label: "Capacité", type: "number" },
    {
      name: "fee_plan_id",
      label: "Modèle de scolarité",
      type: "select",
      options: plans.map((p) => ({ value: p.id, label: `${p.name} — ${formatFCFA(p.total_amount)}` })),
    },
  ];

  const renewClass = async () => {
    setRenewBusy(true);
    try {
      if (studentIds.length) {
        const { error: closeError } = await supabase
          .from("student_enrollments")
          .update({ ended_at: new Date().toISOString() })
          .in("student_id", studentIds)
          .is("ended_at", null);
        if (closeError) throw closeError;
        const { error: studError } = await supabase.from("students").update({ class_id: null }).in("id", studentIds);
        if (studError) throw studError;
      }
      await writeAudit("update", "classes", klass.id, { renewed: true, students_removed: studentIds.length });
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["student_enrollments"] });
      toast.success(`Classe « ${klass.name} » renouvelée`);
      setRenewOpen(false);
    } catch (e) {
      toast.error(describeError(e, "Renouvellement impossible"));
    } finally {
      setRenewBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="press h-9 w-9" aria-label="Actions de la classe">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" /> Modifier la classe
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRenewOpen(true)}>
            <RotateCcw className="mr-2 h-4 w-4" /> Renouveler la classe
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" /> Supprimer la classe
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RecordDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Modifier la classe"
        fields={fields}
        initial={klass}
        submitting={save.isPending}
        onSubmit={(values) => save.mutate({ id: klass.id, values }, { onSuccess: () => setEditOpen(false) })}
      />

      <AlertDialog open={renewOpen} onOpenChange={setRenewOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Renouveler la classe « {klass.name} » ?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Les {studentIds.length} élève(s) seront retirés de cette classe. Vous les retrouverez dans l’onglet
                Élèves (Non assignée) pour les réaffecter. Leur scolarité de l’année est close et conservée.
              </span>
              <span className="block rounded-md border border-[oklch(0.75_0.15_80)]/40 bg-[oklch(0.75_0.15_80)]/10 px-3 py-2 text-xs font-medium text-[oklch(0.5_0.13_70)]">
                ⚠️ Vérifiez les échéances du modèle de scolarité avant de continuer.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={renewBusy}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={renewClass} disabled={renewBusy}>
              {renewBusy ? "Renouvellement…" : "Renouveler"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la classe {klass.name} ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est définitive. Assurez-vous qu’aucun élève actif n’y est rattaché.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                remove.mutate(klass.id, {
                  onSuccess: () => navigate({ to: "/etablissements/$id", params: { id: klass.establishment_id } }),
                })
              }
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
