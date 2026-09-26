/**
 * Archives — anciens élèves et anciennes classes (lecture des données conservées).
 */
import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Archive, Users, School, Search, ChevronRight, Calendar, UserRound, Building2,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
  const [estFilter, setEstFilter] = useState<string>("all");

  const { data: allStudents = [] } = useRows<Tables<"students">>("students", {
    order: { column: "last_name" },
  });
  const { data: allClasses = [] } = useRows<Tables<"classes">>("classes", {
    order: { column: "name" },
  });

  const establishments = useMemo(() => {
    if (isDG) return data.establishments;
    return data.establishments.filter((e) => establishmentIds.includes(e.id));
  }, [data.establishments, isDG, establishmentIds]);

  /** Dernière classe connue (snapshot enrollment) par élève. */
  const lastClassByStudent = useMemo(() => {
    const map = new Map<string, string>();
    const sorted = [...(data.enrollments ?? [])].sort((a, b) =>
      (b.started_at ?? "").localeCompare(a.started_at ?? ""),
    );
    for (const e of sorted) {
      if (!map.has(e.student_id) && e.class_name) {
        map.set(e.student_id, e.class_name);
      }
    }
    return map;
  }, [data.enrollments]);

  /** Effectif historique : élèves encore liés ou ayant eu un enrollment sur cette classe. */
  const classStudentCount = useMemo(() => {
    const map = new Map<string, number>();
    const uniq = new Map<string, Set<string>>();
    for (const e of data.enrollments ?? []) {
      if (!e.class_id) continue;
      if (!uniq.has(e.class_id)) uniq.set(e.class_id, new Set());
      uniq.get(e.class_id)!.add(e.student_id);
    }
    for (const [cid, set] of uniq) map.set(cid, set.size);
    return map;
  }, [data.enrollments]);

  const archivedStudents = useMemo(() => {
    let list = allStudents.filter((s) => !!s.archived_at);
    if (!isDG) list = list.filter((s) => establishmentIds.includes(s.establishment_id));
    if (estFilter !== "all") list = list.filter((s) => s.establishment_id === estFilter);
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.first_name.toLowerCase().includes(n) ||
          s.last_name.toLowerCase().includes(n) ||
          (lastClassByStudent.get(s.id) ?? "").toLowerCase().includes(n),
      );
    }
    return list.sort((a, b) =>
      (b.archived_at ?? "").localeCompare(a.archived_at ?? ""),
    );
  }, [allStudents, isDG, establishmentIds, q, estFilter, lastClassByStudent]);

  const archivedClasses = useMemo(() => {
    let list = allClasses.filter((c) => c.is_active === false);
    if (!isDG) list = list.filter((c) => establishmentIds.includes(c.establishment_id));
    if (estFilter !== "all") list = list.filter((c) => c.establishment_id === estFilter);
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(n));
    }
    return list.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }, [allClasses, isDG, establishmentIds, q, estFilter]);

  const estName = (id: string) =>
    data.establishments.find((e) => e.id === id)?.name ?? "—";

  return (
    <>
      <PageHeader
        title="Archives"
        description="Consultez les élèves et classes archivés — toutes les données (notes, bulletins, scolarité) sont conservées en lecture seule."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4 text-primary" /> Anciens élèves
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{archivedStudents.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">Dossier complet consultable</p>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <School className="h-4 w-4 text-primary" /> Anciennes classes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{archivedClasses.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">Générations & classes fermées</p>
          </CardContent>
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tab === "eleves" ? "Nom, prénom, classe…" : "Nom de classe…"}
            className="pl-9"
          />
        </div>
        {establishments.length > 1 && (
          <Select value={estFilter} onValueChange={setEstFilter}>
            <SelectTrigger className="w-[11rem] sm:w-[14rem]">
              <Building2 className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <SelectValue placeholder="Établissement" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les établissements</SelectItem>
              {establishments.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "eleves" | "classes")}>
        <TabsList>
          <TabsTrigger value="eleves" className="gap-1.5">
            <UserRound className="h-3.5 w-3.5" /> Anciens élèves
            {archivedStudents.length > 0 && (
              <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                {archivedStudents.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="classes" className="gap-1.5">
            <Archive className="h-3.5 w-3.5" /> Anciennes classes
            {archivedClasses.length > 0 && (
              <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                {archivedClasses.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="eleves" className="mt-4 space-y-2">
          {archivedStudents.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Aucun ancien élève"
              description="Les élèves archivés apparaissent ici. Cliquez pour ouvrir leur dossier (scolarité, notes, bibliothèque)."
            />
          ) : (
            <ul className="space-y-2">
              {archivedStudents.map((s) => {
                const lastClass = lastClassByStudent.get(s.id);
                return (
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
                          {lastClass ? ` · ${lastClass}` : ""}
                          {s.archived_at ? ` · archivé le ${formatDate(s.archived_at)}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline" className="text-muted-foreground">
                          Archivé
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="classes" className="mt-4 space-y-2">
          {archivedClasses.length === 0 ? (
            <EmptyState
              icon={School}
              title="Aucune classe archivée"
              description="Les classes fermées (menu ⋮ → Archiver) apparaissent ici avec leurs notes et bulletins conservés."
            />
          ) : (
            <ul className="space-y-2">
              {archivedClasses.map((c) => {
                const nStudents = classStudentCount.get(c.id) ?? 0;
                return (
                  <li key={c.id}>
                    <Link
                      to="/classes/$classId"
                      params={{ classId: c.id }}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 transition hover:border-primary/40 hover:bg-muted/30"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{c.name}</p>
                        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3 shrink-0" />
                          <span>{estName(c.establishment_id)}</span>
                          {c.created_at ? <span>· créée {formatDateTime(c.created_at)}</span> : null}
                          {nStudents > 0 ? (
                            <span>· {nStudents} élève(s) historiques</span>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline">Archivée</Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
