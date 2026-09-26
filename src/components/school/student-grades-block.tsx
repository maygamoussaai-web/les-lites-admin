import { StudentGradesCard as Inner } from "@/components/school/student-grades";
import { PeriodResultsCard } from "@/components/school/period-results-card";
import { PeriodComparisonChart } from "@/components/school/period-comparison-chart";

export function StudentGradesCard({
  studentId,
  classId,
}: {
  studentId: string;
  classId: string | null;
}) {
  return (
    <>
      <Inner studentId={studentId} classId={classId} />
      <div className="lg:col-span-2 space-y-4">
        <PeriodResultsCard studentId={studentId} classId={classId} />
        <PeriodComparisonChart
          classId={classId}
          studentId={studentId}
          title="Comparaison des périodes"
          subtitle="L'élève a-t-il progressé, stagné ou régressé ?"
        />
      </div>
    </>
  );
}
