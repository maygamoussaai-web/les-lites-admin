import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Users, Search } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
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
import { lateStatus, sum, type Installment, type Student } from "@/lib/school";
import { formatFCFA } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/eleves/")({
  head: () => ({
    meta: [
      { title: "Élèves – Les Élites de Gao" },
      { name: "description", content: "Liste de tous les élèves accessibles, filtrable par établissement et par classe." },
    ],
  }),
  component: Page,
});

const PAGE_SIZE = 50;

function Page() {
  const navigate = useNavigate();
  const { isDG, establishmentIds } = useAdminProfile();
  const data = useSchoolData();
  const [establishmentFilter, setEstablishmentFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const accessibleEstablishments = isDG
    ? data.establishments
    : data.establishments.filter((e) => establishmentIds.includes(e.id));
  const canFilterByEstablishment = accessibleEstablishments.length > 1;

  const classOptions = data.classes.filter(
    (c) => !establishmentFilter || c.establishment_id === establishmentFilter,
  );

  const rows = useMemo(() => {
    let list = data.students.filter((s) => isDG || establishmentIds.includes(s.establishment_id));
    if (establishmentFilter) list = list.filter((s) => s.establishment_id === establishmentFilter);
    if (classFilter === "unassigned") list = list.filter((s) => !s.class_id);
    else if (classFilter) list = list.filter((s) => s.class_id === classFilter);
    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter((s) =>
        `${s.first_name} ${s.last_name}`.toLowerCase().includes(term),
      );
    }
    return list.sort((a, b) =>
      `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`),
    );
  }, [data.students, isDG, establishmentIds, establishmentFilter, classFilter, search]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [establishmentFilter, classFilter, search]);

  const visibleRows = rows.slice(0, visibleCount);
  const hasMore = rows.length > visibleRows.length;

  const columns: Column<Student>[] = [
    {
      key: "name",
      header: "Élève",
      cell: (s) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 border border-border">
            {s.photo_url ? (
              <AvatarImage src={s.photo_url} alt={`${s.last_name} ${s.first_name}`} />
            ) : null}
            <AvatarFallback className="text-xs">{initials(s.first_name, s.last_name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">
              {s.last_name} {s.first_name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {data.classes.find((c) => c.id === s.class_id)?.name ?? "Sans classe"}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Scolarité",
      cell: (s) => {
        const enr = data.activeEnrollmentByStudent.get(s.id);
        if (!enr) return <Badge variant="outline">—</Badge>;
        const paid = sum(
          data.tuitionPayments.filter((p) => p.enrollment_id === enr.id).map((p) => Number(p.amount)),
        );
        const total = Number(enr.total_amount);
        if (total > 0 && paid >= total)
          return <Badge className="bg-success text-success-foreground">Bouclé</Badge>;
        const installments = (enr.installments_snapshot as unknown as Installment[]) ?? [];
        const status = lateStatus(paid, installments);
        if (status.isLate) return <Badge variant="destructive">Retard</Badge>;
        return <Badge variant="secondary">{formatFCFA(paid)}</Badge>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Effectifs"
        title="Élèves"
        description="Recherche et filtres sur l’ensemble des élèves accessibles."
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Rechercher un élève…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {canFilterByEstablishment && (
          <Select
            value={establishmentFilter || "all"}
            onValueChange={(v) => setEstablishmentFilter(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Établissement" />
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
        <Select
          value={classFilter || "all"}
          onValueChange={(v) => setClassFilter(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Classe" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les classes</SelectItem>
            <SelectItem value="unassigned">Sans classe</SelectItem>
            {classOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 && !data.loading ? (
        <EmptyState
          icon={Users}
          title="Aucun élève"
          description={
            search || classFilter || establishmentFilter
              ? "Aucun élève ne correspond à ces critères. Modifiez les filtres ou la recherche."
              : "Aucun élève enregistré pour le moment. Ajoutez-en depuis une classe."
          }
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={visibleRows}
            loading={data.loading}
            onRowClick={(s) => navigate({ to: "/eleves/$studentId", params: { studentId: s.id } })}
          />
          {hasMore && (
            <div className="mt-3 flex justify-center">
              <Button variant="outline" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                Afficher plus
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
