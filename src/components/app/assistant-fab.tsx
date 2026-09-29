import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Bot, Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AssistantChat } from "@/components/app/assistant-chat";
import { useAdminProfile } from "@/hooks/use-auth";

export function AssistantFab() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAdminProfile();

  // Masqué sur la page dédiée pour éviter le doublon
  if (!user?.id || pathname === "/mon-assistant" || pathname.startsWith("/mon-assistant/")) {
    return null;
  }

  return (
    <>
      <Button
        type="button"
        size="icon"
        onClick={() => setOpen(true)}
        className="press fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))] z-40 h-12 w-12 rounded-full shadow-lg"
        aria-label="Ouvrir l'assistant"
      >
        <Bot className="h-5 w-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="border-b border-border/60 px-4 py-3 text-left">
            <div className="flex items-start justify-between gap-2 pr-6">
              <div>
                <SheetTitle className="flex items-center gap-2 text-base">
                  <Bot className="h-4 w-4 text-primary" />
                  Mon assistant
                </SheetTitle>
                <SheetDescription className="text-xs">
                  Question rapide — une conversation par compte.
                </SheetDescription>
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5">
                <Link to="/mon-assistant" onClick={() => setOpen(false)}>
                  <Maximize2 className="h-3.5 w-3.5" />
                  Page
                </Link>
              </Button>
            </div>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <AssistantChat userId={user.id} compact className="flex-1" />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
