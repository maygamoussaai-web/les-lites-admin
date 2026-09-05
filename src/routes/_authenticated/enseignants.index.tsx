import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { GraduationCap, Search } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData } from "@/lib/school-data";
import { teacherDue, sum, type Teacher } from "@/lib/school";
import { formatFCFA } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/enseignants/")({
  head: () => ({
    meta: [
      { title: "Enseignants – Les Élites de Gao" },
      { name: "description", content: "Liste de tous les enseignants accessibles, filtrable par établissement." },
    ],
  }),
  component: Page,
});

// Nombre de lignes affichées par lot — toutes les données restent chargées et
// disponibles hors ligne, seul l'AFFICHAGE est limité pour rester fluide même
// avec un grand nombre d'enseignants.
const PAGE_SIZE = 50;

function Page() {
  const navigate = useNavigate();
  const { isDG, establishmentIds } = useAdminProfile();
  const data = useSchoolData();
  const [establishmentFilter, setEstablishmentFilter] = useState("");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const accessibleEstablishments = isDG
    ? data.establishments
    : data.establishments.filter((e) => establishmentIds.includes(e.id));
  const canFilterByEstablishment = accessibleEstablishments.length > 1;

  const teacherIds = useMemo(() => {
    const visibleAssignments = data.assignments.filter((a) =>
      establishmentFilter ? a.establishment_id === establishmentFilter : true,
    );
    return new Set(visibleAssignments.map((a) => a.teacher_id));
  }, [data.assignments, establishmentFilter]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.teachers
      .filter((t) => teacherIds.has(t.id))
      .filter((t) => (term ? `${t.first_name} ${t.last_name}`.toLowerCase().includes(term) : true))
      .sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`));
  }, [data.teachers, teacherIds, search]);

  // Revenir au premier lot à chaque changement de filtre ou de recherche.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [establishmentFilter, search]);

  const visibleRows = rows.slice(0, visibleCount);
  const hasMore = rows.length > visibleRows.length;

  const columns: Column<Teacher>[] = [
    {
      key: "name",
      header: "Enseignant",
      cell: (t) => (
        <div>
          <p className="font-medium text-foreground">{t.last_name} {t.first_name}</p>
          <p className="text-xs text-muted-foreground">{t.domain ?? "—"}</p>
        </div>
      ),
    },
    {
      key: "establishments",
      header: "Établissement(s)",
      cell: (t) => {
        const names = data.assignments
          .filter((a) => a.teacher_id === t.id)
          .map((a) => data.establishments.find((e) => e.id === a.establishment_id)?.name)
          .filter(Boolean) as string[];
        if (names.length === 0) return "—";
        return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
      },
    },
    {
      key: "due",
      header: "Dû (tous établissements)",
      cell: (t) => {
        const assignments = data.assignments.filter((a) => a.teacher_id === t.id);
        const due = sum(assignments.map((a) => teacherDue(a, data.sessions, data.sessionCompletions)));
        const paid = sum(data.teacherPayments.filter((p) => p.teacher_id === t.id).map((p) => Number(p.amount)));
        const remaining = Math.max(0, due - paid);
        return remaining > 0 ? (
          <Badge variant="destructive">{formatFCFA(remaining)}</Badge>
        ) : (
          <Badge className="bg-success text-success-foreground">À jour</Badge>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Complexe scolaire"
        title="Enseignants"
        description={isDG ? "Tous les enseignants du complexe." : "Les enseignants de votre établissement."}
      />

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher un enseignant…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        {canFilterByEstablishment && (
          <Select value={establishmentFilter || "all"} onValueChange={(v) => setEstablishmentFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Tous les établissements" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les établissements</SelectItem>
              {accessibleEstablishments.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {rows.length === 0 && !data.loading ? (
        <EmptyState icon={GraduationCap} title="Aucun enseignant" description="Aucun enseignant ne correspond à ces critères." />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={visibleRows}
            loading={data.loading}
            onRowClick={(t) => navigate({ to: "/enseignants/$teacherId", params: { teacherId: t.id } })}
          />
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {visibleRows.length} / {rows.length} enseignant(s) affiché(s)
            </span>
            {hasMore && (
              <Button variant="outline" size="sm" className="press" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
                Afficher {Math.min(PAGE_SIZE, rows.length - visibleRows.length)} de plus
              </Button>
            )}
          </div>
        </>
      )}
    </>
  );
}
