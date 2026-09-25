import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { LogOut, WifiOff, Wifi } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/app/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAdminProfile, useOnlineStatus } from "@/hooks/use-auth";
import { OfflineSyncIndicator } from "@/components/app/offline-sync-indicator";
import { NetworkBanner } from "@/components/app/network-banner";
import { initials, roleLabel } from "@/lib/format";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { AuroraBackground } from "@/components/app/aurora-background";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
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
      <div className="flex min-h-svh w-full bg-transparent">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <NetworkBanner />
          <header className="glass-panel safe-header sticky top-0 z-20 flex h-14 items-center gap-2 border-x-0 border-t-0 px-3 sm:px-4">
            <SidebarTrigger className="shrink-0" />
            <div className="min-w-0 flex-1" />
            <OfflineSyncIndicator />
            <Badge
              variant={online ? "success" : "destructive"}
              className="hidden gap-1.5 xs:inline-flex sm:inline-flex"
            >
              {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{online ? "En ligne" : "Hors ligne"}</span>
            </Badge>
            <ThemeToggle />
            {profile && (
              <div className="hidden items-center gap-2 sm:flex">
                <Avatar className="h-8 w-8 border border-border">
                  <AvatarFallback className="text-xs">
                    {initials(profile.first_name, profile.last_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-xs font-medium">
                    {profile.first_name} {profile.last_name}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">{roleLabel(profile.role)}</p>
                </div>
              </div>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0" aria-label="Déconnexion">
                  <LogOut className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Se déconnecter ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Vous devrez vous reconnecter pour accéder à l'administration.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void signOut()}>Déconnexion</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </header>
          <main className="safe-bottom flex-1 overflow-x-hidden px-3 py-4 sm:px-5 sm:py-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
