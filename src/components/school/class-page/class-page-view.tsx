/**
 * UI page classe — pure présentation à partir de useClassPage().
 */
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft, Users, Plus, FileBarChart, FileText, RotateCcw, GraduationCap, Trophy, TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StudentsDialog } from "@/components/school/students-dialog";
import { NoteEntryDialog } from "@/components/school/note-entry-dialog";
import { ClassActionsMenu } from "@/components/school/class-actions-menu";
import { BulletinWalkthroughDialog, AnnualBulletinDialog } from "@/components/school/bulletin-helpers";
import { StudentGroupCard, ClassReportsSection } from "@/components/school/class-results-helpers";
import { GradesIntegrityCard } from "@/components/school/grades-integrity-card";
import { ReportTemplateManager } from "@/components/school/report-template-manager";
import { PeriodComparisonChart } from "@/components/school/period-comparison-chart";
import { formatDateTime } from "@/lib/format";
import { useClassPage } from "./use-class-page";

function StatCard({
  label, value, hint, icon: Icon,
}: {
  label: string; value: string; hint: string; icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

export function ClassPageView() {
  const {
    classId, data, klass, isClassArchived, establishment, classStudents,
    currentPeriod, latestPeriod, periodsQuery, subjectsQuery, gradesForPeriod, periodCards,
    stats, periodLabelText, studentsWithNotes, bulletinsDone, bulletinsMissing, notesWithoutPeriod,
    studentsOpen, setStudentsOpen, noteEntryOpen, setNoteEntryOpen,
    bulletinsOpen, setBulletinsOpen, annualOpen, setAnnualOpen,
    pendingForcePeriod, setPendingForcePeriod, startNewPeriod, activeTemplate,
  } = useClassPage();

  if (!klass) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Classe introuvable.</div>
    );
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link
          to={isClassArchived ? "/archives" : "/etablissements/$id"}
          params={isClassArchived ? ({} as never) : { id: klass.establishment_id }}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {isClassArchived ? "Retour aux archives" : "Retour à l'établissement"}
        </Link>
      </Button>

      {isClassArchived && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          Génération archivée — consultation seule. Aucune modification possible.
        </div>
      )}

      {!currentPeriod && latestPeriod && !isClassArchived && (
        <div className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Aucune période ouverte. Démarrez une nouvelle période pour saisir des notes.
        </div>
      )}

      {currentPeriod && bulletinsMissing > 0 && !isClassArchived && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
          {bulletinsMissing} élève(s) noté(s) sans bulletin sur la période en cours.
        </div>
      )}

      {notesWithoutPeriod && !isClassArchived && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          Des notes existent hors période ouverte.
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                {klass.name}
                {isClassArchived ? " · Archivée" : ""}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {establishment?.name ?? "—"}
                {" · "}
                {currentPeriod
                  ? `Période ${currentPeriod.period_number} en cours · démarrée le ${formatDateTime(currentPeriod.started_at)}`
                  : latestPeriod
                    ? `Dernière période : ${latestPeriod.period_number} (clôturée)`
                    : "Aucune période en cours"}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="outline" size="sm" className="press" onClick={() => setStudentsOpen(true)}>
                <Users className="mr-1.5 h-4 w-4" /> {isClassArchived ? "Voir les élèves" : "Élèves"}
              </Button>
              {!isClassArchived && (
                <Button size="sm" className="press" onClick={() => setNoteEntryOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Note
                </Button>
              )}
              {!isClassArchived && (
                <Button
                  variant="outline"
                  size="sm"
                  className="press"
                  onClick={() => {
                    if (!(currentPeriod ?? latestPeriod)) {
                      toast.message("Saisissez une note pour ouvrir une période, ou démarrez-en une.");
                      return;
                    }
                    setBulletinsOpen(true);
                  }}
                >
                  <FileBarChart className="mr-1.5 h-4 w-4" /> Bulletins
                  {studentsWithNotes.size > 0 && (
                    <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
                      {bulletinsDone}/{studentsWithNotes.size}
                    </span>
                  )}
                </Button>
              )}
              {!isClassArchived && (
                <Button variant="outline" size="sm" className="press" onClick={() => setAnnualOpen(true)}>
                  <FileText className="mr-1.5 h-4 w-4" /> Annuel
                </Button>
              )}
              {!isClassArchived && (
                <Button variant="outline" size="sm" className="press" onClick={() => void startNewPeriod()}>
                  <RotateCcw className="mr-1.5 h-4 w-4" /> Nouvelle période
                </Button>
              )}
              {!isClassArchived && <ClassActionsMenu klass={klass} data={data} />}
            </div>
          </div>
        </div>
        <div className="grid gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Moyenne de classe"
            value={stats.classAverage != null ? stats.classAverage.toFixed(2) : "—"}
            hint={
              stats.source === "bulletin"
                ? "Bulletins validés"
                : stats.source === "modele_live"
                  ? "Formules du modèle (live)"
                  : periodLabelText
            }
            icon={GraduationCap}
          />
          <StatCard
            label="Admis / excellent"
            value={`${stats.passing.length} / ${stats.excellent.length}`}
            hint={`sur ${stats.withAvg.length} élève(s) noté(s)`}
            icon={Trophy}
          />
          <StatCard
            label="En difficulté"
            value={String(stats.struggling.length)}
            hint={
              stats.lowest
                ? `Plus bas : ${stats.lowest.average.toFixed(2)}`
                : stats.withAvg.length
                  ? "Aucun"
                  : "En attente de notes"
            }
            icon={TrendingDown}
          />
          <StatCard
            label="Effectif"
            value={String(classStudents?.length ?? 0)}
            hint={
              stats.highest
                ? `1er : ${stats.highest.student.last_name} (${stats.highest.average.toFixed(2)})`
                : periodLabelText
            }
            icon={Users}
          />
        </div>
      </div>

      <div className="mb-6 mt-4 grid gap-4 lg:grid-cols-2">
        <StudentGroupCard
          title="Meilleurs moyennes"
          tone="success"
          students={
            stats.withAvg.length
              ? stats.withAvg.slice(0, 5).map((r, i) => ({
                  id: r.student.id,
                  name: `${r.student.last_name} ${r.student.first_name}`,
                  value: r.average.toFixed(2),
                  rank: i + 1,
                }))
              : []
          }
        />
        <StudentGroupCard
          title="Classement complet"
          tone="success"
          emptyLabel="Aucune moyenne calculée pour le moment"
          students={
            stats.withAvg.length
              ? stats.withAvg.map((r, i) => ({
                  id: r.student.id,
                  name: `${r.student.last_name} ${r.student.first_name}`,
                  value: r.average.toFixed(2),
                  rank: i + 1,
                }))
              : []
          }
        />
      </div>

      {!isClassArchived && currentPeriod && (
        <GradesIntegrityCard
          students={classStudents}
          subjects={subjectsQuery.data ?? []}
          grades={gradesForPeriod}
          natures={activeTemplate?.gradeNatures ?? ["evaluation", "composition"]}
          natureLabels={activeTemplate?.natureLabels ?? { evaluation: "Note d'évaluation", composition: "Note de composition" }}
          periodLabel={periodLabelText}
        />
      )}

      {!isClassArchived && (
        <ReportTemplateManager
          classId={classId}
          establishmentId={klass.establishment_id}
          className={klass.name}
        />
      )}

      <PeriodComparisonChart
        classId={classId}
        title="Comparaison des périodes"
        subtitle="La classe a-t-elle progressé, stagné ou régressé ?"
      />

      <ClassReportsSection classId={classId} readOnly={isClassArchived} />

      {!isClassArchived && (
        <NoteEntryDialog
          open={noteEntryOpen}
          onClose={() => setNoteEntryOpen(false)}
          classId={classId}
          establishmentId={klass.establishment_id}
          students={classStudents}
          subjects={subjectsQuery.data ?? []}
          currentPeriod={currentPeriod}
          subjectLabels={activeTemplate?.subjectLabels}
          allowedNatures={activeTemplate?.gradeNatures}
          natureLabels={activeTemplate?.natureLabels}
          existingGrades={gradesForPeriod}
        />
      )}

      <StudentsDialog
        klass={studentsOpen ? klass : null}
        data={data}
        onClose={() => setStudentsOpen(false)}
        readOnly={isClassArchived}
      />

      {!isClassArchived && (
        <BulletinWalkthroughDialog
          open={bulletinsOpen}
          onClose={() => setBulletinsOpen(false)}
          klass={klass}
          establishmentName={establishment?.name ?? ""}
          students={classStudents}
          period={currentPeriod ?? latestPeriod}
          subjects={subjectsQuery.data ?? []}
          grades={gradesForPeriod}
          alreadyGeneratedIds={periodCards
            .filter((c) => !!c.document_id)
            .map((c) => c.student_id)}
        />
      )}

      {!isClassArchived && (
        <AnnualBulletinDialog
          open={annualOpen}
          onClose={() => setAnnualOpen(false)}
          klass={klass}
          establishmentName={establishment?.name ?? ""}
          students={classStudents}
          periods={periodsQuery.data ?? []}
          subjects={subjectsQuery.data ?? []}
        />
      )}

      <AlertDialog open={pendingForcePeriod && !isClassArchived} onOpenChange={setPendingForcePeriod}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clôturer sans tous les bulletins ?</AlertDialogTitle>
            <AlertDialogDescription>
              Des élèves ont des notes sans bulletin généré. Vous pouvez générer les bulletins
              d'abord, ou forcer la nouvelle période.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => void startNewPeriod(true)}>Forcer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
