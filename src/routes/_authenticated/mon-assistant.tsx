/**
 * Page Assistant — conversation plein écran, sobre, adaptée à tous les écrans.
 * Accès uniquement via le menu latéral (aucun bouton flottant).
 */
import { createFileRoute } from "@tanstack/react-router";
import { AssistantChat } from "@/components/app/assistant-chat";

export const Route = createFileRoute("/_authenticated/mon-assistant")({
  head: () => ({
    meta: [
      { title: "Assistant – Les Élites de Gao" },
      {
        name: "description",
        content:
          "Assistant administratif : consultation des classes, élèves, enseignants et résultats.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <div className="flex h-[calc(100svh-3.5rem)] min-h-0 w-full flex-col overflow-hidden">
      <AssistantChat className="min-h-0 flex-1" />
    </div>
  );
}
