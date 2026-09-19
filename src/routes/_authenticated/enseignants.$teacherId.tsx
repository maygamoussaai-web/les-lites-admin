import { createFileRoute } from "@tanstack/react-router";
import { TeacherFichePage } from "@/components/school/teacher-fiche";

export const Route = createFileRoute("/_authenticated/enseignants/$teacherId")({
  head: () => ({
    meta: [
      { title: "Fiche enseignant – Les Élites de Gao" },
      { name: "description", content: "Profil enseignant, affectations et paiements." },
    ],
  }),
  component: TeacherFichePage,
});
