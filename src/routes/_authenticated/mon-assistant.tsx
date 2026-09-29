import { createFileRoute } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { AssistantChat } from "@/components/app/assistant-chat";
import { useAdminProfile } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/mon-assistant")({
  head: () => ({
    meta: [
      { title: "Mon assistant – Les Élites de Gao" },
      {
        name: "description",
        content:
          "Assistant scolaire : questions sur les classes, les élèves et les résultats officiels.",
      },
      { property: "og:title", content: "Mon assistant – Les Élites de Gao" },
    ],
  }),
  component: Page,
});

function Page() {
  const { user, loading } = useAdminProfile();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Mon assistant"
        description="Posez des questions sur les classes, les élèves et les moyennes officielles (bulletins). Une seule conversation est conservée pour votre compte sur cet appareil."
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5" />
            Intelligence
          </span>
        }
      />

      {loading || !user?.id ? (
        <p className="text-sm text-muted-foreground">Chargement de la session…</p>
      ) : (
        <AssistantChat userId={user.id} className="min-h-[calc(100dvh-14rem)]" />
      )}
    </div>
  );
}
