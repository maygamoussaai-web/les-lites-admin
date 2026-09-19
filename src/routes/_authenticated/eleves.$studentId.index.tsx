import { createFileRoute } from "@tanstack/react-router";
import { StudentFichePage } from "@/components/school/student-fiche";

export const Route = createFileRoute("/_authenticated/eleves/$studentId/")({
  head: () => ({
    meta: [
      { title: "Fiche élève – Les Élites de Gao" },
      { name: "description", content: "Profil élève : identité, scolarité et résultats." },
    ],
  }),
  component: StudentFichePage,
});
