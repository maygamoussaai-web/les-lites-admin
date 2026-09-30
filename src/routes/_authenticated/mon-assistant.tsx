/**
 * Assistant — interface conversationnelle plein écran, sobre.
 * Accès via le menu latéral uniquement (pas de bouton flottant).
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
    <div className="-mx-3 -mb-5 flex min-h-[calc(100svh-5.5rem)] flex-col sm:-mx-5 sm:-mb-6 lg:-mx-6 lg:-mb-6">
      <div className="flex w-full flex-1 flex-col px-3 sm:px-5 lg:px-6">
        <header className="shrink-0 border-b border-border/40 pb-3 pt-1">
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Assistant
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Consultation et aide à la gestion du complexe scolaire.
          </p>
        </header>
        <div className="flex min-h-0 flex-1 flex-col pt-2">
          <AssistantChat className="min-h-0 flex-1" />
        </div>
      </div>
    </div>
  );
}
