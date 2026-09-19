import { createFileRoute } from "@tanstack/react-router";
import { ClassPage } from "@/components/school/class-page";

export const Route = createFileRoute("/_authenticated/classes/$classId")({
  head: () => ({
    meta: [
      { title: "Classe – Les Élites de Gao" },
      { name: "description", content: "Notes, bulletins et résultats d'une classe." },
    ],
  }),
  component: ClassPage,
});
