/**
 * Menu ⋮ de la page classe : modifier, renouveler, archiver (mot de passe).
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { checkOpenPeriodBulletins, closeOpenPeriodOnly } from "@/lib/period-lifecycle";

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
  // Nom génération : NomClasse_année civile au moment du renouvellement (ex. TSE_2026).
  const defaultGenerationName = `${klass.name}_${new Date().getFullYear()}`;
  const [generationName, setGenerationName] = useState(defaultGenerationName);

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

  /**
   * Renouvellement = créer une génération figée en Archives, désassigner les élèves.
   * 1) Clôture période notes ouverte (sans en ouvrir une nouvelle sur l'archive)
   * 2) Ferme les scolarités actives (nom de génération sur l'historique)
   * 3) Élèves → class_id null (liste « Sans classe »)
   * 4) Classe actuelle renommée Nom_année + is_active=false → Archives (lecture seule)
   * 5) Nouvelle classe active vide, nom d'origine + même fee_plan reconduit
   */
  const renewClass = async (force = false) => {
    setRenewBusy(true);
    try {
      const check = await checkOpenPeriodBulletins(klass.id);
      if (check.missingBulletins && !force) {
        setWarnMissing(true);
        toast.message("Des notes existent sans bulletin. Générez-les ou confirmez le renouvellement.");
        return;
      }
      if (check.hasOpenPeriod) {
        await closeOpenPeriodOnly(klass.id);
      }

      const generation = (generationName.trim() || defaultGenerationName).replace(/\s+/g, " ").trim();
      const originalName = klass.name;

      if (studentIds.length) {
        const { error: genErr } = await supabase
          .from("student_enrollments")
          .update({ class_name: generation })
          .eq("class_id", klass.id)
          .in("student_id", studentIds)
          .is("ended_at", null);
        if (genErr) throw genErr;
        const { error: closeEnr } = await supabase
          .from("student_enrollments")
          .update({ ended_at: new Date().toISOString() })
          .in("student_id", studentIds)
          .is("ended_at", null);
        if (closeEnr) throw closeEnr;
        const { error: unassignErr } = await supabase
          .from("students")
          .update({ class_id: null })
          .in("id", studentIds);
        if (unassignErr) throw unassignErr;
      }

      // Génération figée en archives (même id → notes, matières, bulletins conservés)
      const { error: archErr } = await supabase
        .from("classes")
        .update({ name: generation, is_active: false })
        .eq("id", klass.id);
      if (archErr) throw archErr;

      // Nouvelle coque active avec le nom d'origine + même modèle de scolarité
      const { data: created, error: createErr } = await supabase
        .from("classes")
        .insert({
          name: originalName,
          establishment_id: klass.establishment_id,
          fee_plan_id: klass.fee_plan_id,
          capacity: klass.capacity ?? 0,
          is_active: true,
        })
        .select("id")
        .single();
      if (createErr) throw createErr;

      await writeAudit("update", "classes", klass.id, {
        renewed: true,
        generation_name: generation,
        archived_class_id: klass.id,
        new_class_id: created?.id ?? null,
        students_unassigned: studentIds.length,
      });
      invalidateAll();
      toast.success(
        studentIds.length
          ? `Génération « ${generation} » archivée — ${studentIds.length} élève(s) sans classe. Nouvelle classe « ${originalName} » créée.`
          : `Génération « ${generation} » archivée. Nouvelle classe « ${originalName} » créée.`,
      );
      setRenewOpen(false);
      setWarnMissing(false);
      if (created?.id) {
        navigate({ to: "/classes/$classId", params: { classId: created.id } });
      } else {
        navigate({ to: "/etablissements/$id", params: { id: klass.establishment_id } });
      }
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
        await closeOpenPeriodOnly(klass.id);
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
                Une <strong>génération figée</strong> sera créée dans Archives (même page classe,
                lecture seule : notes, élèves, scolarité). Les {studentIds.length} élève(s)
                passent en <strong>sans classe</strong> (liste Élèves → filtre non assignés).
                Une <strong>nouvelle classe vide</strong> « {klass.name} » est recréée avec le{" "}
                <strong>même modèle de scolarité</strong> (aucun élève au départ).
                Les documents de cette génération ne resteront visibles que dans les Archives.
              </span>
              <span className="block space-y-1.5 pt-1">
                <Label htmlFor="generation-name" className="text-foreground">
                  Nom de la génération (Archives)
                </Label>
                <Input
                  id="generation-name"
                  value={generationName}
                  onChange={(e) => setGenerationName(e.target.value)}
                  placeholder={defaultGenerationName}
                />
                <span className="block text-xs">
                  Format conseillé : NomClasse_année (ex. {defaultGenerationName}).
                </span>
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
