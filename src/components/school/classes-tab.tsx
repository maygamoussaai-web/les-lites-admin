/**
 * Onglet Classes d'un établissement — cartes compactes (nom + effectif).
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Users,
  Pencil,
  BarChart3,
  RotateCcw,
} from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useSaveRow, useDeleteRow, writeAudit } from "@/lib/data";
import type { SchoolData } from "@/lib/school-data";
import type { ClassRow } from "@/lib/school";
import { formatFCFA } from "@/lib/format";
import { StudentsDialog } from "@/components/school/students-dialog";
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
import { Trash2 } from "lucide-react";

type Data = SchoolData;

export function ClassesTab({ establishmentId, data }: { establishmentId: string; data: Data }) {
  const save = useSaveRow("classes", "Classe");
  const remove = useDeleteRow("classes", "Classe");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClassRow | null>(null);
  const [viewing, setViewing] = useState<ClassRow | null>(null);
  const [renewing, setRenewing] = useState<ClassRow | null>(null);
  const [renewBusy, setRenewBusy] = useState(false);

  const rows = useMemo(
    () => data.classes.filter((c) => c.establishment_id === establishmentId),
    [data.classes, establishmentId],
  );

  const fields: Field[] = [
    { name: "name", label: "Nom de la classe", required: true },
    { name: "capacity", label: "Capacité", type: "number", required: true, defaultValue: "40" },
    {
      name: "fee_plan_id",
      label: "Modèle de scolarité",
      type: "select",
      options: data.feePlans
        .filter((p) => p.establishment_id === establishmentId)
        .map((p) => ({ value: p.id, label: `${p.name} (${formatFCFA(Number(p.total_amount))})` })),
    },
  ];

  const renewingStudentIds = useMemo(
    () => (renewing ? data.students.filter((s) => s.class_id === renewing.id).map((s) => s.id) : []),
    [data.students, renewing],
  );

  const renewClass = async () => {
    if (!renewing) return;
    setRenewBusy(true);
    try {
      if (renewingStudentIds.length) {
        const { error } = await supabase
          .from("students")
          .update({ class_id: null })
          .in("id", renewingStudentIds);
        if (error) throw error;
      }
      await writeAudit("update", "classes", renewing.id, { renewed: true, students_cleared: renewingStudentIds.length });
      qc.invalidateQueries({ queryKey: ["students"] });
      toast.success(
        renewingStudentIds.length
          ? `Classe renouvelée — ${renewingStudentIds.length} élève(s) retirés`
          : "Classe renouvelée",
      );
      setRenewing(null);
    } catch (e) {
      toast.error((e as Error).message || "Renouvellement impossible");
    } finally {
      setRenewBusy(false);
    }
  };

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
        <EmptyState icon={Users} title="Aucune classe" description="Créez la première classe de cet établissement." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((c, index) => {
            const effectif = data.students.filter((s) => s.class_id === c.id).length;
            return (
              <Card
                key={c.id}
                className="card-lift animate-rise cursor-pointer panel-gradient"
                style={{ animationDelay: `${index * 40}ms` }}
                onClick={() => setViewing(c)}
              >
                <CardContent className="flex items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-semibold text-foreground">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {effectif} élève{effectif > 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button size="icon" variant="ghost" className="h-8 w-8 press" asChild title="Résultats">
                      <Link to="/classes/$classId" params={{ classId: c.id }}>
                        <BarChart3 className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 press text-[oklch(0.6_0.15_60)]"
                      title="Renouveler"
                      onClick={() => setRenewing(c)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 press"
                      title="Modifier"
                      onClick={() => {
                        setEditing(c);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8 press text-destructive" title="Supprimer">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Supprimer {c.name} ?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Cette action est définitive. Assurez-vous qu&apos;aucun élève actif n&apos;y est rattaché.
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
        initial={editing ?? undefined}
        submitting={save.isPending}
        onSubmit={(values) =>
          save.mutate(
            {
              id: editing?.id,
              values: { ...values, establishment_id: establishmentId },
            },
            { onSuccess: () => setOpen(false) },
          )
        }
      />

      <StudentsDialog klass={viewing} data={data} onClose={() => setViewing(null)} />

      <AlertDialog open={!!renewing} onOpenChange={(v) => !v && setRenewing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Renouveler la classe « {renewing?.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les {renewingStudentIds.length} élève(s) de cette classe en seront retirés — vous les retrouverez
              dans la liste des élèves non assignés. Les historiques (notes, scolarité) restent conservés.
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
    </div>
  );
}
