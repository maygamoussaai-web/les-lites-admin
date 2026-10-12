/**
 * Page Mon assistant — conversation plein écran, en-tête soigné.
 * Accès uniquement via le menu latéral.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Bot } from "lucide-react";
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
    <div className="flex h-[calc(100svh-3.5rem)] min-h-0 w-full flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border/30 bg-gradient-to-b from-card/90 to-background/80 px-4 py-3.5 backdrop-blur-md supports-[backdrop-filter]:from-card/70 sm:px-6">
        <div className="mx-auto flex max-w-2xl items-center justify-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <Bot className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0 text-left">
            <h1 className="font-display text-base font-semibold tracking-tight text-foreground sm:text-lg">
              Mon assistant
            </h1>
            <p className="text-[11.5px] leading-snug text-muted-foreground">
              Lecture immédiate · écritures confirmées
            </p>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <AssistantChat className="h-full" />
      </div>
    </div>
  );
}
