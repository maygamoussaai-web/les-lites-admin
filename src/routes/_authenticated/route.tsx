import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { LogOut, WifiOff, Wifi } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/app/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAdminProfile, useOnlineStatus } from "@/hooks/use-auth";
import { OfflineSyncIndicator } from "@/components/app/offline-sync-indicator";
import { initials, roleLabel } from "@/lib/format";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { AuroraBackground } from "@/components/app/aurora-background";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) return { user: data.user };
    // Hors ligne (ou erreur réseau ponctuelle) : getUser() a échoué faute de
    // pouvoir joindre Supabase. On retombe sur la session déjà en mémoire
    // (getSession() ne fait aucun appel réseau) plutôt que de déconnecter
    // l'utilisateur — sinon l'app hors ligne renverrait tout le monde vers /auth.
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.user) return { user: sessionData.session.user };
    throw redirect({ to: "/auth" });
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { profile } = useAdminProfile();
  const online = useOnlineStatus();
  const navigate = useNavigate();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <SidebarProvider>
      <AuroraBackground />
      <div className="flex min-h-screen w-full bg-transparent">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="glass-panel sticky top-0 z-20 flex h-14 items-center gap-2 border-x-0 border-t-0 px-3">
            <SidebarTrigger />
            <div className="flex-1" />
            <OfflineSyncIndicator />
            <Badge
              variant={online ? "secondary" : "destructive"}
              className="hidden gap-1.5 transition-all duration-300 sm:inline-flex"
            >
              {online ? (
                <Wifi className="h-3.5 w-3.5 text-success" />
              ) : (
                <WifiOff className="h-3.5 w-3.5" />
              )}
              {online ? "En ligne" : "Hors ligne"}
            </Badge>
            <ThemeToggle />
            <div className="hidden items-center gap-2 sm:flex">
              <Avatar className="h-8 w-8 ring-1 ring-border transition-transform duration-200 hover:scale-105">
                <AvatarFallback className="bg-primary/10 text-xs text-primary">
                  {initials(profile?.first_name, profile?.last_name)}
                </AvatarFallback>
              </Avatar>
              <div className="leading-tight">
                <p className="text-sm font-medium text-foreground">
                  {profile ? `${profile.first_name} ${profile.last_name}` : "Compte"}
                </p>
                <p className="text-xs text-muted-foreground">{roleLabel(profile?.role)}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="press rounded-full"
              aria-label="Se déconnecter"
              onClick={signOut}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </header>
          <main className="animate-fade-soft mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 sm:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
