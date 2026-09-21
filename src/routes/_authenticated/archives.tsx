/**
 * Onglet Archive — anciens élèves et anciennes classes / générations.
 */
import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Archive, Users, School, Search, ChevronRight, Calendar, UserRound,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSchoolData } from "@/lib/school-data";
import { useRows } from "@/lib/data";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";
import { useAdminProfile } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/archives")({
  head: () => ({
    meta: [
      { title: "Archives – Les Élites de Gao" },
      {
        name: "description",
        content: "Anciens élèves et anciennes classes / générations du complexe scolaire.",
      },
    ],
  }),
  component: ArchivesPage,
});

function ArchivesPage() {
  const { isDG, establishmentIds } = useAdminProfile();
  const data = useSchoolData();
  const [tab, setTab] = useState<"eleves" | "classes">("eleves");
  const [q, setQ] = useState("");

  const { data: allStudents = [] } = useRows<Tables<"students">>("students", {
    order: { column: "last_name" },
  });
  const { data: allClasses = [] } = useRows<Tables<"classes">>("classes", {
    order: { column: "name" },
  });

  const archivedStudents = useMemo(() => {
    let list = allStudents.filter((s) => !!s.archived_at);
    if (!isDG) list = list.filter((s) => establishmentIds.includes(s.establishment_id));
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.first_name.toLowerCase().includes(n) ||
          s.last_name.toLowerCase().includes(n),
      );
    }
    return list;
  }, [allStudents, isDG, establishmentIds, q]);

  const archivedClasses = useMemo(() => {
    let list = allClasses.filter((c) => c.is_active === false);
    if (!isDG) list = list.filter((c) => establishmentIds.includes(c.establishment_id));
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(n));
    }
    return list;
  }, [allClasses, isDG, establishmentIds, q]);

  const estName = (id: string) =>
    data.establishments.find((e) => e.id === id)?.name ?? "—";

  return (
    <>
      <PageHeader
        eyebrow="Mémoire"
        title="Archives"
        description="Anciens élèves et générations de classes archivées. Lecture seule — pas de réaffectation."
        actions={
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Rechercher…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-border/70 bg-gradient-to-br from-card to-muted/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-display">
              <Users className="h-4 w-4 text-primary" /> Anciens élèves
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{archivedStudents.length}</p>
            <p className="text-xs text-muted-foreground">Dossiers conservés, classe non assignée</p>
          </CardContent>
        </Card>
        <Card className="border-border/70 bg-gradient-to-br from-card to-muted/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-display">
              <School className="h-4 w-4 text-primary" /> Anciennes classes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{archivedClasses.length}</p>
            <p className="text-xs text-muted-foreground">Générations et classes archivées</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "eleves" | "classes")}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="eleves" className="gap-1.5">
            <UserRound className="h-3.5 w-3.5" /> Anciens élèves
          </TabsTrigger>
          <TabsTrigger value="classes" className="gap-1.5">
            <Archive className="h-3.5 w-3.5" /> Anciennes classes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="eleves" className="mt-4 space-y-2">
          {archivedStudents.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Aucun ancien élève"
              description="Les élèves archivés apparaîtront ici avec tout leur dossier."
            />
          ) : (
            <ul className="space-y-2">
              {archivedStudents.map((s) => (
                <li key={s.id}>
                  <Link
                    to="/eleves/$studentId"
                    params={{ studentId: s.id }}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 transition hover:border-primary/40 hover:bg-muted/30"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {s.last_name} {s.first_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {estName(s.establishment_id)}
                        {s.archived_at ? ` · archivé le ${formatDate(s.archived_at)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Non assigné</Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="classes" className="mt-4 space-y-2">
          {archivedClasses.length === 0 ? (
            <EmptyState
              icon={School}
              title="Aucune classe archivée"
              description="Les classes supprimées ou les générations d'un renouvellement apparaissent ici."
            />
          ) : (
            <ul className="space-y-2">
              {archivedClasses.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{c.name}</p>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {estName(c.establishment_id)}
                      {c.created_at ? ` · créée ${formatDateTime(c.created_at)}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline">Archivée</Badge>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
