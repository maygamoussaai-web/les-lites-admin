/**
 * Page Mon assistant — en-tête centré + conversation plein écran.
 * Accès uniquement via le menu latéral (aucun bouton flottant).
 */
import { createFileRoute } from "@tanstack/react-router";
import { AssistantChat } from "@/components/app/assistant-chat";

export const Route = createFileRoute("/_authenticated/mon-assistant")({
  head: () => ({
    meta: [
      { title: "Mon assistant – Les Élites de Gao" },
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
      <header className="shrink-0 border-b border-border/25 bg-background/95 px-4 py-3.5 text-center backdrop-blur-md supports-[backdrop-filter]:bg-background/80 sm:px-6">
        <h1 className="font-display text-base font-semibold tracking-tight text-foreground sm:text-lg">
          Mon assistant
        </h1>
        <p className="mx-auto mt-1 max-w-md text-[12px] leading-snug text-muted-foreground">
          Consultation, actions confirmées et aide à l’utilisation du complexe
        </p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <AssistantChat className="min-h-0 flex-1" />
      </div>
    </div>
  );
}
