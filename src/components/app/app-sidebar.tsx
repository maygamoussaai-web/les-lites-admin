import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Building2, ShieldCheck, Wallet, UserCircle, School, History } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAdminProfile } from "@/hooks/use-auth";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isDG, profile } = useAdminProfile();

  const dgGroups = [
    {
      label: "Pilotage",
      items: [
        { title: "Tableau de bord", url: "/tableau-de-bord", icon: LayoutDashboard },
        { title: "Établissements", url: "/etablissements", icon: Building2 },
      ],
    },
    {
      label: "Direction",
      items: [
        { title: "Personnel administratif", url: "/personnel", icon: ShieldCheck },
        { title: "Finance", url: "/finance", icon: Wallet },
        { title: "Historique", url: "/historique", icon: History },
        { title: "Mon compte", url: "/mon-compte", icon: UserCircle },
      ],
    },
  ];

  const staffGroups = [
    {
      label: "Mon établissement",
      items: [
        {
          title: "Gestion",
          url: profile?.establishment_id ? `/etablissements/${profile.establishment_id}` : "/mon-compte",
          icon: School,
        },
        { title: "Historique", url: "/historique", icon: History },
        { title: "Mon compte", url: "/mon-compte", icon: UserCircle },
      ],
    },
  ];

  const groups = isDG ? dgGroups : staffGroups;

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border/60">
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-2.5">
          <span className="shine-gold flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sidebar-primary font-display text-sm font-bold text-sidebar-primary-foreground">
            EG
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold text-sidebar-foreground">
                Les Élites de Gao
              </p>
              <p className="truncate text-xs text-sidebar-foreground/70">
                {isDG ? "Direction générale" : "Administration"}
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.url || pathname.startsWith(item.url + "/")}
                      tooltip={item.title}
                      className="group/menu-item relative transition-all duration-200 data-[active=true]:shadow-[inset_2px_0_0_0_var(--sidebar-primary)]"
                    >
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4 transition-transform duration-200 group-hover/menu-item:scale-110" />
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}