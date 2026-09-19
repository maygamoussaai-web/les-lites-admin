import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Users, Plus, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { StudentsDialog } from "@/components/school/students-dialog";
import { ReportTemplateManager } from "@/components/school/report-template-manager";
import { NoteEntryDialog } from "@/components/school/note-entry-dialog";
import { useActiveReportTemplate } from "@/lib/report-template";
import { ClassActionsMenu } from "@/components/school/class-actions-menu";
import { BulletinWalkthroughDialog, AnnualBulletinDialog } from "@/components/school/bulletin-helpers";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData } from "@/lib/school-data";
import { useRows } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import type { ClassSubject, GradePeriod, Grade } from "@/lib/grades";

export const Route = createFileRoute("/_authenticated/classes/$classId")({
  head: () => ({
    meta: [
      { title: "Classe – Les Élites de Gao" },
      { name: "description", content: "Notes, bulletins et résultats d'une classe." },
    ],
  }),
  component: Page,
});

function Page() {
  const { classId } = Route.useParams();
  const { isDG, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const data = useSchoolData();
  const klass = data.classes.find((c) => c.id === classId);
  const allowed = klass && (isDG || establishmentIds.includes(klass.establishment_id));
  const establishment = klass ? data.establishments.find((e) => e.id === klass.establishment_id) : null;
  const classStudents = useMemo(
    () =>
      data.students
        .filter((s) => s.class_id === classId)
        .sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)),
    [data.students, classId],
  );
  const [studentsOpen, setStudentsOpen] = useState(false);
  const [noteEntryOpen, setNoteEntryOpen] = useState(false);
  const [bulletinsOpen, setBulletinsOpen] = useState(false);
  const [annualOpen, setAnnualOpen] = useState(false);
  const { template: activeTemplate } = useActiveReportTemplate(classId);
  const periods = useRows<GradePeriod>("grade_periods", {
    eq: { class_id: classId },
    order: { column: "period_number" },
  });
  const subjects = useRows<ClassSubject>("class_subjects", {
    eq: { class_id: classId },
    order: { column: "name" },
  });
  const currentPeriod = (periods.data ?? []).find((p) => p.ended_at === null) ?? null;
  const latestPeriod =
    currentPeriod ??
    [...(periods.data ?? [])].sort((a, b) => b.period_number - a.period_number)[0] ??
    null;
  const grades = useRows<Grade>("grades", {
    eq: latestPeriod ? { period_id: latestPeriod.id } : {},
    enabled: !!latestPeriod,
    order: { column: "created_at" },
  });

  if (!data.loading && !establishmentIdsLoading && (!klass || !allowed)) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Accès refusé"
        description="Cette classe n'existe pas ou vous n'y avez pas accès."
      />
    );
  }
  if (!klass) return null;

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link to="/etablissements/$id" params={{ id: klass.establishment_id }}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour à l'établissement
        </Link>
      </Button>
      <PageHeader
        eyebrow={establishment?.name ?? "Classe"}
        title={klass.name}
        description={
          currentPeriod
            ? `Période ${currentPeriod.period_number} en cours — démarrée le ${formatDateTime(currentPeriod.started_at)}`
            : "Aucune période en cours."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="press" onClick={() => setStudentsOpen(true)}>
              <Users className="mr-1.5 h-4 w-4" /> Élèves
            </Button>
            <Button size="sm" className="press" onClick={() => setNoteEntryOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Note
            </Button>
            <ClassActionsMenu klass={klass} data={data} />
          </div>
        }
      />
      <ReportTemplateManager
        classId={classId}
        establishmentId={klass.establishment_id}
        className={klass.name}
      />
      <p className="text-sm text-muted-foreground">
        {classStudents.length} élève{classStudents.length > 1 ? "s" : ""} ·{" "}
        {(subjects.data ?? []).length} matière{(subjects.data ?? []).length > 1 ? "s" : ""}
      </p>
      <StudentsDialog klass={studentsOpen ? klass : null} data={data} onClose={() => setStudentsOpen(false)} />
      <NoteEntryDialog
        open={noteEntryOpen}
        onClose={() => setNoteEntryOpen(false)}
        classId={classId}
        establishmentId={klass.establishment_id}
        students={classStudents}
        subjects={subjects.data ?? []}
        currentPeriod={currentPeriod}
        subjectLabels={activeTemplate?.subjectLabels}
        allowedNatures={activeTemplate?.gradeNatures}
        existingGrades={grades.data ?? []}
      />
      {bulletinsOpen && latestPeriod && (
        <BulletinWalkthroughDialog
          open={bulletinsOpen}
          onClose={() => setBulletinsOpen(false)}
          klass={klass}
          establishmentName={establishment?.name ?? "—"}
          students={classStudents}
          subjects={subjects.data ?? []}
          period={latestPeriod}
          grades={grades.data ?? []}
        />
      )}
      {annualOpen && (
        <AnnualBulletinDialog
          open={annualOpen}
          onClose={() => setAnnualOpen(false)}
          klass={klass}
          establishmentName={establishment?.name ?? "—"}
          students={classStudents}
          subjects={subjects.data ?? []}
          periods={periods.data ?? []}
          grades={grades.data ?? []}
        />
      )}
    </>
  );
}
