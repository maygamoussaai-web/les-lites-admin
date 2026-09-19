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
            <div className="hidden items-center gap-2.5 md:flex">
              <Avatar className="h-8 w-8 ring-2 ring-border/60 transition-transform duration-200 hover:scale-105">
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                  {initials(profile?.first_name, profile?.last_name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 leading-tight">
                <p className="truncate text-sm font-medium text-foreground">
                  {profile ? `${profile.first_name} ${profile.last_name}` : "Compte"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{roleLabel(profile?.role)}</p>
              </div>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="press h-9 w-9 shrink-0 rounded-full"
                  aria-label="Se déconnecter"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Se déconnecter ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Vous devrez ressaisir votre mot de passe pour vous reconnecter.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction onClick={signOut}>Se déconnecter</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </header>
          <main className="animate-fade-soft safe-pad mx-auto w-full max-w-7xl flex-1 space-y-5 p-3 sm:space-y-6 sm:p-5 lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
