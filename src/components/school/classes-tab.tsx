/**
 * Onglet Classes — cartes compactes (nom + effectif) + renouveler.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, BarChart3, RotateCcw, Trash2, GraduationCap } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { supabase } from "@/integrations/supabase/client";
import { useSaveRow, useDeleteRow, writeAudit } from "@/lib/data";
import type { SchoolData } from "@/lib/school-data";
import type { ClassRow } from "@/lib/school";
import { formatFCFA } from "@/lib/format";
import { StudentsDialog } from "@/components/school/students-dialog";

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
  ];

  const renewingStudentIds = renewing
    ? data.students.filter((s) => s.class_id === renewing.id).map((s) => s.id)
    : [];

  const renewClass = async () => {
    if (!renewing) return;
    setRenewBusy(true);
    try {
      if (renewingStudentIds.length) {
        const { error: closeError } = await supabase
          .from("student_enrollments")
          .update({ ended_at: new Date().toISOString() })
          .in("student_id", renewingStudentIds)
          .is("ended_at", null);
        if (closeError) throw closeError;

        const { error: studError } = await supabase
          .from("students")
          .update({ class_id: null })
          .in("id", renewingStudentIds);
        if (studError) throw studError;
      }

      await writeAudit("update", "classes", renewing.id, {
        renewed: true,
        students_removed: renewingStudentIds.length,
      });
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["student_enrollments"] });
      toast.success(`Classe "${renewing.name}" renouvelée`);
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
        <EmptyState
          icon={GraduationCap}
          title="Aucune classe"
          description="Créez la première classe de cet établissement."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((c, index) => {
            const effectif = data.students.filter((s) => s.class_id === c.id).length;
            return (
              <Card
                key={c.id}
                className="card-lift animate-rise group cursor-pointer border-border/70 transition-colors hover:border-primary/40"
                style={{ animationDelay: `${index * 40}ms` }}
                onClick={() => setViewing(c)}
              >
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-semibold text-foreground">{c.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
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
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 press text-destructive hover:text-destructive"
                          title="Supprimer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Supprimer la classe {c.name} ?</AlertDialogTitle>
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
        initial={editing}
        submitting={save.isPending}
        onSubmit={(values) =>
          save.mutate(
            { id: editing?.id ?? null, values: { ...values, establishment_id: establishmentId } },
            { onSuccess: () => setOpen(false) },
          )
        }
      />
      <StudentsDialog klass={viewing} data={data} onClose={() => setViewing(null)} />

      <AlertDialog open={!!renewing} onOpenChange={(v) => !v && setRenewing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Renouveler la classe &quot;{renewing?.name}&quot; ?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Les {renewingStudentIds.length} élève(s) de cette classe en seront retirés — vous les retrouverez
                dans l&apos;onglet « Élèves » (filtre Classe : Non assignée) pour les réaffecter. Leur scolarité de
                cette année sera close et conservée dans leur fiche de scolarité. Le nom de la classe et son modèle
                de scolarité sont conservés.
              </span>
              <span className="block rounded-md border border-[oklch(0.75_0.15_80)]/40 bg-[oklch(0.75_0.15_80)]/10 px-3 py-2 text-xs font-medium text-[oklch(0.5_0.13_70)]">
                ⚠️ Pensez à vérifier/mettre à jour les échéances du modèle de scolarité avant de continuer.
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
    </div>
  );
}
