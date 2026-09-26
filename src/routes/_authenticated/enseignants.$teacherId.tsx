import { createFileRoute, useParams } from "@tanstack/react-router";
import { TeacherFichePage } from "@/components/school/teacher-fiche";
import { TeacherScheduleSection } from "@/components/school/teacher-schedule";
import { useSchoolData } from "@/lib/school-data";

function TeacherPage() {
  const { teacherId } = useParams({ from: "/_authenticated/enseignants/$teacherId" });
  const data = useSchoolData();
  const hourly = data.assignments.filter(
    (a) => a.teacher_id === teacherId && a.payment_method === "hourly" && a.is_active !== false,
  );
  return (
    <>
      <TeacherFichePage />
      <div className="mt-4 space-y-4">
        {hourly.map((a) => (
          <TeacherScheduleSection key={a.id} assignment={a} data={data} />
        ))}
      </div>
    </>
  );
}

export const Route = createFileRoute("/_authenticated/enseignants/$teacherId")({
  head: () => ({
    meta: [
      { title: "Fiche enseignant – Les Élites de Gao" },
      { name: "description", content: "Profil enseignant, affectations, emploi du temps et paiements." },
    ],
  }),
  component: TeacherPage,
});
