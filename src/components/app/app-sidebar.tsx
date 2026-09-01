import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Building2, ShieldCheck, Wallet, UserCircle, School, History, Users, GraduationCap } from "lucide-react";
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
import { BrandLogo } from "@/components/app/brand-logo";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isDG } = useAdminProfile();

  const dgGroups = [
    {
      label: "Pilotage",
      items: [
        { title: "Tableau de bord", url: "/tableau-de-bord", icon: LayoutDashboard },
        { title: "Établissements", url: "/etablissements", icon: Building2 },
        { title: "Élèves", url: "/eleves", icon: Users },
        { title: "Enseignants", url: "/enseignants", icon: GraduationCap },
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
        { title: "Établissements", url: "/etablissements", icon: School },
        { title: "Élèves", url: "/eleves", icon: Users },
        { title: "Enseignants", url: "/enseignants", icon: GraduationCap },
        { title: "Historique", url: "/historique", icon: History },
        { title: "Mon compte", url: "/mon-compte", icon: UserCircle },
      ],
    },
  ];

  const groups = isDG ? dgGroups : staffGroups;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-2.5">
          <BrandLogo size={36} className="shrink-0" />
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