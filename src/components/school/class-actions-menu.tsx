/**
 * Menu ⋮ de la page classe : modifier, renouveler, archiver (mot de passe).
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
import { PasswordField, verifyCurrentPassword } from "@/components/app/password-field";
import { supabase } from "@/integrations/supabase/client";
import { useSaveRow, writeAudit } from "@/lib/data";
import { formatFCFA } from "@/lib/format";
import type { SchoolData } from "@/lib/school-data";
import type { ClassRow } from "@/lib/school";
import { describeError } from "@/lib/errors";
import { checkOpenPeriodBulletins, closeAndStartNextPeriod } from "@/lib/period-lifecycle";

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
  const [editOpen, setEditOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renewBusy, setRenewBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [warnMissing, setWarnMissing] = useState(false);

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

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["students"] });
    qc.invalidateQueries({ queryKey: ["classes"] });
    qc.invalidateQueries({ queryKey: ["student_enrollments"] });
    qc.invalidateQueries({ queryKey: ["grade_periods"] });
  };

  const renewClass = async (force = false) => {
    setRenewBusy(true);
    try {
      const check = await checkOpenPeriodBulletins(klass.id);
      if (check.missingBulletins && !force) {
        setWarnMissing(true);
        toast.message("Des notes existent sans bulletin. Générez-les ou confirmez.");
        return;
      }
      if (check.hasOpenPeriod) {
        await closeAndStartNextPeriod(klass.id, klass.establishment_id);
      }

      const year = new Date().getFullYear();
      const archivedName = `${klass.name} · génération ${year}`;
      const { error: archErr } = await supabase
        .from("classes")
        .update({ is_active: false, name: archivedName })
        .eq("id", klass.id);
      if (archErr) throw archErr;

      const { data: created, error: creErr } = await supabase
        .from("classes")
        .insert({
          establishment_id: klass.establishment_id,
          name: klass.name,
          capacity: klass.capacity,
          fee_plan_id: klass.fee_plan_id,
          is_active: true,
        })
        .select("id")
        .single();
      if (creErr || !created) throw creErr ?? new Error("Création génération impossible");

      if (studentIds.length) {
        await supabase
          .from("student_enrollments")
          .update({ ended_at: new Date().toISOString() })
          .in("student_id", studentIds)
          .is("ended_at", null);
        await supabase.from("students").update({ class_id: null }).in("id", studentIds);
      }

      await writeAudit("update", "classes", klass.id, {
        renewed: true,
        archived_as: archivedName,
        new_class_id: created.id,
      });
      invalidateAll();
      toast.success(`Classe renouvelée — « ${archivedName} » archivée`);
      setRenewOpen(false);
      setWarnMissing(false);
      navigate({ to: "/classes/$classId", params: { classId: created.id } });
    } catch (e) {
      toast.error(describeError(e, "Renouvellement impossible"));
    } finally {
      setRenewBusy(false);
    }
  };

  const deleteClass = async () => {
    if (!password.trim()) {
      toast.error("Saisissez votre mot de passe pour confirmer.");
      return;
    }
    setDeleteBusy(true);
    try {
      const ok = await verifyCurrentPassword(password);
      if (!ok) {
        toast.error("Mot de passe incorrect.");
        return;
      }
      const check = await checkOpenPeriodBulletins(klass.id);
      if (check.missingBulletins && !warnMissing) {
        setWarnMissing(true);
        toast.message("Notes sans bulletin — confirmez une seconde fois pour archiver.");
        return;
      }
      if (check.hasOpenPeriod) {
        await closeAndStartNextPeriod(klass.id, klass.establishment_id);
      }
      if (studentIds.length) {
        await supabase.from("students").update({ class_id: null }).in("id", studentIds);
      }
      const { error } = await supabase.from("classes").update({ is_active: false }).eq("id", klass.id);
      if (error) throw error;
      await writeAudit("update", "classes", klass.id, { archived: true });
      invalidateAll();
      toast.success(`Classe « ${klass.name} » archivée`);
      setDeleteOpen(false);
      setPassword("");
      navigate({ to: "/etablissements/$id", params: { id: klass.establishment_id } });
    } catch (e) {
      toast.error(describeError(e, "Archivage impossible"));
    } finally {
      setDeleteBusy(false);
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
            <Trash2 className="mr-2 h-4 w-4" /> Archiver la classe
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

      <AlertDialog
        open={renewOpen}
        onOpenChange={(v) => {
          setRenewOpen(v);
          if (!v) setWarnMissing(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Renouveler la classe « {klass.name} » ?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                La génération actuelle est archivée. Une nouvelle classe active est créée.
                Les {studentIds.length} élève(s) passent en non assignés.
              </span>
              {warnMissing && (
                <span className="block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                  Notes sans bulletin — générez-les ou confirmez.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={renewBusy}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => void renewClass(warnMissing)} disabled={renewBusy}>
              {renewBusy ? "Renouvellement…" : warnMissing ? "Renouveler sans bulletins" : "Renouveler"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(v) => {
          setDeleteOpen(v);
          if (!v) {
            setPassword("");
            setWarnMissing(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archiver la classe {klass.name} ?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                La classe ira dans Archives → Anciennes classes. Confirmez avec votre mot de passe.
              </span>
              <PasswordField value={password} onChange={setPassword} label="Votre mot de passe" />
              {warnMissing && (
                <span className="block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                  Notes sans bulletin — confirmez une seconde fois.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteClass()} disabled={deleteBusy}>
              {deleteBusy ? "Archivage…" : "Archiver"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
