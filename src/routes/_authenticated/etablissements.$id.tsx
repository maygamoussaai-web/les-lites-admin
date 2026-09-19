import { createFileRoute } from "@tanstack/react-router";
import { EstablishmentPage } from "@/components/school/establishment-page";

export const Route = createFileRoute("/_authenticated/etablissements/$id")({
  head: () => ({
    meta: [
      { title: "Établissement – Les Élites de Gao" },
      { name: "description", content: "Classes, enseignants et finances de l'établissement." },
    ],
  }),
  component: EstablishmentPage,
});
