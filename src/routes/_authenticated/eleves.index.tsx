import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Users, Search } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
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

function Page() {
  const navigate = useNavigate();
  const { isDG, establishmentIds } = useAdminProfile();
  const data = useSchoolData();
  const [establishmentFilter, setEstablishmentFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [search, setSearch] = useState("");

  const accessibleEstablishments = isDG
    ? data.establishments
    : data.establishments.filter((e) => establishmentIds.includes(e.id));
  const canFilterByEstablishment = accessibleEstablishments.length > 1;

  const classOptions = data.classes.filter(
    (c) => !establishmentFilter || c.establishment_id === establishmentFilter,
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.students
      .filter((s) => (establishmentFilter ? s.establishment_id === establishmentFilter : true))
      .filter((s) => {
        if (classFilter === "unassigned") return !s.class_id;
        if (classFilter) return s.class_id === classFilter;
        return true;
      })
      .filter((s) => (term ? `${s.first_name} ${s.last_name}`.toLowerCase().includes(term) : true))
      .sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`));
  }, [data.students, establishmentFilter, classFilter, search]);

  const columns: Column<Student>[] = [
    {
      key: "name",
      header: "Élève",
      cell: (s) => (
        <div>
          <p className="font-medium text-foreground">{s.last_name} {s.first_name}</p>
          <p className="text-xs text-muted-foreground">{s.gender === "F" ? "Féminin" : "Masculin"}</p>
        </div>
      ),
    },
    {
      key: "establishment",
      header: "Établissement",
      cell: (s) => data.establishments.find((e) => e.id === s.establishment_id)?.name ?? "—",
    },
    {
      key: "class",
      header: "Classe",
      cell: (s) => {
        const klass = data.classes.find((c) => c.id === s.class_id);
        return klass ? klass.name : <Badge variant="outline">Non assignée</Badge>;
      },
    },
    {
      key: "tuition",
      header: "Scolarité",
      cell: (s) => {
        const enrollment = data.activeEnrollmentByStudent.get(s.id);
        if (!enrollment) return <span className="text-sm text-muted-foreground">—</span>;
        const installments = (enrollment.installments_snapshot as unknown as Installment[]) ?? [];
        const paid = sum(
          data.tuitionPayments.filter((p) => p.enrollment_id === enrollment.id).map((p) => Number(p.amount)),
        );
        if (!installments.length) return <span className="text-sm text-muted-foreground">—</span>;
        const status = lateStatus(paid, installments);
        return status.isLate ? (
          <Badge variant="destructive">Retard {formatFCFA(status.overdueAmount)}</Badge>
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
        title="Élèves"
        description={isDG ? "Tous les élèves du complexe." : "Les élèves de votre établissement."}
      />

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher un élève…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        {canFilterByEstablishment && (
          <Select
            value={establishmentFilter || "all"}
            onValueChange={(v) => {
              setEstablishmentFilter(v === "all" ? "" : v);
              setClassFilter("");
            }}
          >
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
        <Select value={classFilter || "all"} onValueChange={(v) => setClassFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Toutes les classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les classes</SelectItem>
            {classOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 && !data.loading ? (
        <EmptyState icon={Users} title="Aucun élève" description="Aucun élève ne correspond à ces critères." />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={data.loading}
          onRowClick={(s) => navigate({ to: "/eleves/$studentId", params: { studentId: s.id } })}
        />
      )}
    </>
  );
}