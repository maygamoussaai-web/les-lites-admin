/**
 * HISTORIQUE DES NOTES D'UN ELEVE.
 * Periodes closes = lecture seule (pas de modification / suppression).
 */
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Pencil, Trash2, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData } from "@/lib/school-data";
import { writeAudit } from "@/lib/data";
import { describeError } from "@/lib/errors";
import { formatDate, formatNumber } from "@/lib/format";
import {
  PASS_THRESHOLD,
  to20,
  studentPeriodAverage,
  useClassGrades,
  type Grade,
} from "@/lib/grades";

export const Route = createFileRoute("/_authenticated/eleves/$studentId/notes")({
  head: () => ({
    meta: [
      { title: "Historique des notes – Les Elites de Gao" },
      { name: "description", content: "Toutes les notes d'un eleve, periode par periode." },
    ],
  }),
  component: Page,
});

function Page() {
  const { studentId } = Route.useParams();
  const navigate = useNavigate();
  const { isDG, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const data = useSchoolData();

  const student = data.students.find((s) => s.id === studentId);
  const allowed = student && (isDG || establishmentIds.includes(student.establishment_id));
  const classId = student?.class_id ?? null;

  const { loading, subjects, periods, grades } = useClassGrades(classId ?? "", !!classId);

  const subjectName = useMemo(
    () => new Map(subjects.map((s) => [s.id, s.name])),
    [subjects],
  );

  const byPeriod = useMemo(() => {
    const mine = grades.filter((g) => g.student_id === studentId);
    return [...periods]
      .sort((a, b) => b.period_number - a.period_number)
      .map((p) => ({
        period: p,
        grades: mine
          .filter((g) => g.period_id === p.id)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
        average: studentPeriodAverage(mine.filter((g) => g.period_id === p.id), studentId),
      }));
  }, [grades, periods, studentId]);

  if (!data.loading && !establishmentIdsLoading && (!student || !allowed)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Eleve introuvable"
        description="Cet eleve n'existe pas ou vous n'y avez pas acces."
      />
    );
  }
  if (!student) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit"
        onClick={() => navigate({ to: "/eleves/$studentId", params: { studentId } })}
      >
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour a la fiche
      </Button>

      <PageHeader
        eyebrow="Historique"
        title={`Notes — ${student.last_name} ${student.first_name}`}
        description="Les periodes closes sont en lecture seule : notes et moyennes non modifiables. Seule la periode en cours peut etre editee."
      />

      {!classId ? (
        <EmptyState icon={ShieldAlert} title="Aucune classe" description="Assignez l'eleve a une classe pour saisir des notes." />
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : byPeriod.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="Aucune periode" description="Aucune periode scolaire n'a encore ete ouverte pour cette classe." />
      ) : (
        <div className="space-y-4">
          {byPeriod.map(({ period, grades: list, average }) => (
            <Card key={period.id}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Periode {period.period_number}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Du {formatDate(period.started_at)}{" "}
                    {period.ended_at ? `au ${formatDate(period.ended_at)}` : "— en cours"}
                    {period.ended_at ? " · lecture seule" : ""}
                  </p>
                </div>
                <Badge
                  variant={average !== null && average < PASS_THRESHOLD ? "destructive" : "default"}
                  className="tabular-nums"
                >
                  Moyenne {average === null ? "—" : `${formatNumber(average, 2)} / 20`}
                </Badge>
              </CardHeader>
              <CardContent>
                {list.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucune note sur cette periode.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {list.map((g) => (
                      <GradeRow
                        key={g.id}
                        grade={g}
                        subject={subjectName.get(g.subject_id) ?? "Matiere"}
                        locked={period.ended_at !== null}
                      />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function GradeRow({ grade, subject, locked }: { grade: Grade; subject: string; locked?: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(grade.value));
  const [scale, setScale] = useState(String(grade.scale));
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["grades"] });

  const save = async () => {
    if (locked) {
      toast.error("Cette periode est close : modification impossible.");
      return;
    }
    const v = Number(value);
    const s = Number(scale);
    if (!(s > 0) || !(v >= 0) || v > s) {
      toast.error("Note invalide : elle doit etre comprise entre 0 et le bareme.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from("grades").update({ value: v, scale: s }).eq("id", grade.id);
      if (error) throw error;
      await writeAudit("update", "grades" as never, grade.id, { value: v, scale: s });
      refresh();
      toast.success("Note modifiee");
      setOpen(false);
    } catch (e) {
      toast.error(describeError(e, "Modification impossible", "grades"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (locked) {
      toast.error("Cette periode est close : suppression impossible.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from("grades").delete().eq("id", grade.id);
      if (error) throw error;
      await writeAudit("delete", "grades" as never, grade.id, {});
      refresh();
      toast.success("Note supprimee");
    } catch (e) {
      toast.error(describeError(e, "Suppression impossible", "grades"));
    } finally {
      setBusy(false);
    }
  };

  const normalized = to20(Number(grade.value), Number(grade.scale));

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{subject}</p>
        <p className="text-xs text-muted-foreground">
          {grade.nature === "composition" ? "Composition" : `Evaluation ${grade.sequence_number}`} ·{" "}
          {formatDate(grade.created_at)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="tabular-nums text-sm font-semibold text-foreground">
          {formatNumber(Number(grade.value), 2)} / {formatNumber(Number(grade.scale), 0)}
        </span>
        <Badge variant={normalized < PASS_THRESHOLD ? "destructive" : "outline"} className="tabular-nums">
          {formatNumber(normalized, 2)} /20
        </Badge>
        {locked ? (
          <Badge variant="secondary" className="text-[10px]">
            Periode close
          </Badge>
        ) : (
          <>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(true)} aria-label="Modifier la note">
              <Pencil className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Supprimer la note">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Supprimer cette note ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    La note de {subject} sera definitivement supprimee et les moyennes recalculees.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction disabled={busy} onClick={() => void remove()}>
                    Supprimer
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Modifier la note — {subject}</DialogTitle>
            <DialogDescription>
              {grade.nature === "composition" ? "Composition" : "Evaluation"} · la moyenne est recalculee immediatement.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-sm">Note obtenue</Label>
              <Input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">Bareme</Label>
              <Input type="number" step="any" value={scale} onChange={(e) => setScale(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button disabled={busy || locked} onClick={() => void save()}>
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
