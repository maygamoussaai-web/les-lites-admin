/**
 * Bouton flottant assistant + Sheet conversation.
 * Masqué sur /mon-assistant (page dédiée).
 */
import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Bot, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AssistantChat } from "@/components/app/assistant-chat";

export function AssistantFab() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (pathname === "/mon-assistant" || pathname.startsWith("/mon-assistant/")) {
    return null;
  }

  return (
    <>
      <Button
        type="button"
        size="icon"
        className="fixed bottom-5 right-5 z-40 h-14 w-14 rounded-full shadow-lg press"
        onClick={() => setOpen(true)}
        aria-label="Ouvrir l'assistant scolaire"
      >
        <Bot className="h-6 w-6" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-4 sm:max-w-md"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Assistant scolaire</SheetTitle>
            <SheetDescription>
              Posez une question sur les classes, élèves ou statistiques.
            </SheetDescription>
          </SheetHeader>

          <div className="mb-2 flex justify-end">
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" asChild>
              <Link to="/mon-assistant" onClick={() => setOpen(false)}>
                <Maximize2 className="h-3.5 w-3.5" />
                Plein écran
              </Link>
            </Button>
          </div>

          <AssistantChat compact className="min-h-0 flex-1" />
        </SheetContent>
      </Sheet>
    </>
  );
}
