import { createFileRoute, useParams } from "@tanstack/react-router";
import { TeacherFichePage } from "@/components/school/teacher-fiche";
import { TeacherScheduleSection } from "@/components/school/teacher-schedule";
import { useSchoolData } from "@/lib/school-data";

function TeacherPage() {
  const { teacherId } = useParams({ from: "/_authenticated/enseignants/$teacherId/" });
  const data = useSchoolData();
  const hourly = data.assignments.filter(
    (a) => a.teacher_id === teacherId && a.payment_method === "hourly" && a.is_active !== false,
  );
  return (
    <>
      {hourly.length > 0 && (
        <div className="mb-6 space-y-3">
          {hourly.map((a) => (
            <TeacherScheduleSection key={a.id} assignment={a} data={data} />
          ))}
        </div>
      )}
      <TeacherFichePage />
    </>
  );
}

export const Route = createFileRoute("/_authenticated/enseignants/$teacherId/")({
  head: () => ({
    meta: [
      { title: "Fiche enseignant – Les Élites de Gao" },
      { name: "description", content: "Emploi du temps, affectations et paiements." },
    ],
  }),
  component: TeacherPage,
});
