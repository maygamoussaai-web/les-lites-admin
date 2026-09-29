/**
 * Page dédiée « Mon assistant » — conversation plein écran.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/page-header";
import { AssistantChat } from "@/components/app/assistant-chat";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/mon-assistant")({
  head: () => ({
    meta: [
      { title: "Mon assistant – Les Élites de Gao" },
      {
        name: "description",
        content:
          "Assistant scolaire : questions sur les classes, élèves et statistiques des Élites de Gao.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Mon assistant"
        description="Posez vos questions sur les classes, les élèves et les résultats. Une conversation par compte, enregistrée sur cet appareil."
      />
      <Card className="overflow-hidden border-border/60 shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <AssistantChat className="min-h-[480px]" />
        </CardContent>
      </Card>
    </div>
  );
}
