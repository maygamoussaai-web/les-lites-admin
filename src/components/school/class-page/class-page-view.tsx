/**
 * UI page classe — pure présentation à partir de useClassPage().
 */
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft, Trophy, TrendingDown, Users, GraduationCap,
  Plus, RotateCcw, FileBarChart, FileText, Download,
} from "lucide-react";
import { StatCard } from "@/components/app/stat-card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StudentsDialog } from "@/components/school/students-dialog";
import { ReportTemplateManager } from "@/components/school/report-template-manager";
import { NoteEntryDialog } from "@/components/school/note-entry-dialog";
import { ClassActionsMenu } from "@/components/school/class-actions-menu";
import { BulletinWalkthroughDialog, AnnualBulletinDialog } from "@/components/school/bulletin-helpers";
import { StudentGroupCard, ClassReportsSection } from "@/components/school/class-results-helpers";
import { PeriodComparisonChart } from "@/components/school/period-comparison-chart";
import { GradesIntegrityCard } from "@/components/school/grades-integrity-card";
import { formatDateTime } from "@/lib/format";
import { PASS_THRESHOLD, EXCELLENT_THRESHOLD } from "@/lib/grades";
import { describeError } from "@/lib/errors";
import { downloadPeriodBulletinsZip } from "@/lib/bulletin-zip";
import type { ClassPageModel } from "./use-class-page";

export function ClassPageView(m: ClassPageModel) {
  const {
    classId, data, klass, isClassArchived, establishment, classStudents,
    studentsOpen, setStudentsOpen, noteEntryOpen, setNoteEntryOpen,
    bulletinsOpen, setBulletinsOpen, zipBusy, setZipBusy,
    annualOpen, setAnnualOpen, pendingForcePeriod, setPendingForcePeriod,
    stats, periodsQuery, subjectsQuery, activeTemplate,
    currentPeriod, latestPeriod, gradesForPeriod, periodCards,
    startNewPeriod, periodLabelText, studentsWithNotes,
    bulletinsDone, bulletinsMissing, notesWithoutPeriod,
  } = m;

  if (!klass) return null;

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
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-muted/40 px-3 py-2.5 text-sm"
        >
          <p className="text-muted-foreground">
            <strong className="text-foreground">Classe archivée</strong>
            {" "}— consultation des notes, bulletins et stats conservés. Les actions de saisie sont désactivées.
          </p>
          <Button variant="outline" size="sm" className="press shrink-0" asChild>
            <Link to="/archives">Voir les archives</Link>
          </Button>
        </div>
      )}

      {!currentPeriod && latestPeriod && !isClassArchived && (
        <div className="mb-4 rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Période {latestPeriod.period_number} clôturée. La prochaine période s'ouvrira automatiquement
          à la <strong className="text-foreground">première note</strong> enregistrée.
        </div>
      )}

      {currentPeriod && bulletinsMissing > 0 && !isClassArchived && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm"
        >
          <p className="text-amber-900 dark:text-amber-100">
            <strong>{bulletinsMissing}</strong> élève(s) ont des notes sans bulletin pour la période{" "}
            {currentPeriod.period_number}
            {bulletinsDone > 0 ? ` · ${bulletinsDone} déjà généré(s)` : ""}.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="press shrink-0 border-amber-600/40"
            onClick={() => setBulletinsOpen(true)}
          >
            Compléter les bulletins
          </Button>
        </div>
      )}

      {notesWithoutPeriod && !isClassArchived && (
        <div
          role="status"
          className="mb-3 rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground"
        >
          Aucune période active. La première note ouvrira automatiquement une période.
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card to-primary/[0.04] shadow-sm">
        <div className="border-b border-border/60 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {establishment?.name ?? "Classe"}
                {isClassArchived ? " · Archivée" : ""}
              </p>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {klass.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                {currentPeriod
                  ? `Période ${currentPeriod.period_number} en cours · démarrée le ${formatDateTime(currentPeriod.started_at)}`
                  : latestPeriod
                    ? `Dernière période : ${latestPeriod.period_number} (clôturée)`
                    : "Aucune période en cours"}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="outline" size="sm" className="press" onClick={() => setStudentsOpen(true)}>
                <Users className="mr-1.5 h-4 w-4" /> Élèves
              </Button>
              {!isClassArchived && (
                <Button size="sm" className="press" onClick={() => setNoteEntryOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Note
                </Button>
              )}
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
              {bulletinsDone > 0 && (currentPeriod ?? latestPeriod) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="press"
                  disabled={zipBusy}
                  onClick={() => {
                    const per = currentPeriod ?? latestPeriod;
                    if (!per) return;
                    void (async () => {
                      setZipBusy(true);
                      const toastId = toast.loading("Préparation du ZIP des bulletins…");
                      try {
                        const n = await downloadPeriodBulletinsZip({
                          classId,
                          periodId: per.id,
                          periodNumber: per.period_number,
                          className: klass.name,
                          students: classStudents.map((s) => ({
                            id: s.id,
                            first_name: s.first_name,
                            last_name: s.last_name,
                          })),
                          onProgress: (done, total) => {
                            toast.loading(`ZIP ${done}/${total}…`, { id: toastId });
                          },
                        });
                        toast.success(`${n} bulletin(s) dans le ZIP`, { id: toastId });
                      } catch (e) {
                        toast.error(describeError(e, "ZIP impossible"), { id: toastId });
                      } finally {
                        setZipBusy(false);
                      }
                    })();
                  }}
                >
                  <Download className="mr-1.5 h-4 w-4" />
                  {zipBusy ? "ZIP…" : "ZIP bulletins"}
                </Button>
              )}
              <Button variant="outline" size="sm" className="press" onClick={() => setAnnualOpen(true)}>
                <FileText className="mr-1.5 h-4 w-4" /> Annuel
              </Button>
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
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Répartition</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span>Réussite (≥ {PASS_THRESHOLD})</span>
                <span>
                  {stats.withAvg.length
                    ? Math.round((stats.passing.length / stats.withAvg.length) * 100)
                    : 0}
                  %
                </span>
              </div>
              <Progress
                value={
                  stats.withAvg.length
                    ? (stats.passing.length / stats.withAvg.length) * 100
                    : 0
                }
              />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span>Excellence (≥ {EXCELLENT_THRESHOLD})</span>
                <span>
                  {stats.withAvg.length
                    ? Math.round((stats.excellent.length / stats.withAvg.length) * 100)
                    : 0}
                  %
                </span>
              </div>
              <Progress
                value={
                  stats.withAvg.length
                    ? (stats.excellent.length / stats.withAvg.length) * 100
                    : 0
                }
              />
            </div>
            {stats.bestSubject ? (
              <p className="text-sm text-muted-foreground">
                Meilleure matière : <strong>{stats.bestSubject.subject.name}</strong>{" "}
                ({stats.bestSubject.avg.toFixed(2)})
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Meilleure matière : —</p>
            )}
            {stats.worstSubject ? (
              <p className="text-sm text-muted-foreground">
                Matière à renforcer : <strong>{stats.worstSubject.subject.name}</strong>{" "}
                ({stats.worstSubject.avg.toFixed(2)})
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Matière à renforcer : —</p>
            )}
            {!stats.withAvg.length && (
              <p className="text-xs text-muted-foreground">
                Saisissez des notes ou générez les bulletins pour afficher les stats.
              </p>
            )}
          </CardContent>
        </Card>
        <StudentGroupCard
          title="Classement"
          emptyLabel="Aucun classement pour le moment"
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

      <ClassReportsSection classId={classId} />

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

      <AnnualBulletinDialog
        open={annualOpen}
        onClose={() => setAnnualOpen(false)}
        klass={klass}
        establishmentName={establishment?.name ?? ""}
        students={classStudents}
        periods={periodsQuery.data ?? []}
        subjects={subjectsQuery.data ?? []}
      />

      <AlertDialog open={pendingForcePeriod} onOpenChange={setPendingForcePeriod}>
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
