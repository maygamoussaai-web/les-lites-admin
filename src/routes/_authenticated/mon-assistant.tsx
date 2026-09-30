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
      <header className="shrink-0 border-b border-border/40 bg-background/80 px-4 pb-3 pt-4 text-center backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-6 sm:pt-5">
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Mon assistant
        </h1>
        <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
          Consultation et aide à la gestion du complexe scolaire.
        </p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <AssistantChat className="min-h-0 flex-1" />
      </div>
    </div>
  );
}
