import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Building2,
  CalendarRange,
  GraduationCap,
  BookOpen,
  Users,
  UserCog,
  ClipboardList,
  Wallet,
  Banknote,
  ShieldCheck,
  ScrollText,
  UserCircle,
} from "lucide-react";
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

const groups = [
  {
    label: "Pilotage",
    items: [{ title: "Tableau de bord", url: "/tableau-de-bord", icon: LayoutDashboard }],
  },
  {
    label: "Structure",
    items: [
      { title: "Établissements", url: "/etablissements", icon: Building2 },
      { title: "Années académiques", url: "/annees", icon: CalendarRange },
      { title: "Classes", url: "/classes", icon: GraduationCap },
      { title: "Matières", url: "/matieres", icon: BookOpen },
    ],
  },
  {
    label: "Scolarité",
    items: [
      { title: "Élèves", url: "/eleves", icon: Users },
      { title: "Enseignants", url: "/enseignants", icon: UserCog },
      { title: "Évaluations & notes", url: "/notes", icon: ClipboardList },
    ],
  },
  {
    label: "Finances",
    items: [
      { title: "Frais de scolarité", url: "/scolarite", icon: Wallet },
      { title: "Paiements enseignants", url: "/paiements-enseignants", icon: Banknote },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Personnel & accès", url: "/personnel", icon: ShieldCheck },
      { title: "Journal d'audit", url: "/audit", icon: ScrollText },
      { title: "Mon compte", url: "/mon-compte", icon: UserCircle },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sidebar-primary font-display text-sm font-bold text-sidebar-primary-foreground">
            EG
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold text-sidebar-foreground">
                Les Élites de Gao
              </p>
              <p className="truncate text-xs text-sidebar-foreground/70">Administration</p>
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
                    <SidebarMenuButton asChild isActive={pathname === item.url} tooltip={item.title}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
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
