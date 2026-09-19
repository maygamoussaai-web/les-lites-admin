import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, GraduationCap, Users, Wallet, AlertTriangle, Banknote } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { ClassesTab } from "@/components/school/classes-tab";
import { TeachersTab } from "@/components/school/teachers-tab";
import { FinanceTab } from "@/components/school/finance-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData, useEstablishmentStats } from "@/lib/school-data";
import { establishmentTypeLabel, formatFCFA } from "@/lib/format";

export function EstablishmentPage() {
  const { id } = useParams({ from: "/_authenticated/etablissements/$id" });
  const { isDG, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const data = useSchoolData();
  const stats = useEstablishmentStats(data);
  const est = data.establishments.find((e) => e.id === id);
  const s = stats.get(id);
  const allowed = isDG || establishmentIds.includes(id);

  if (!data.loading && !establishmentIdsLoading && (!est || !allowed)) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Accès refusé"
        description="Vous n'avez pas accès à cet établissement."
      />
    );
  }

  return (
    <>
      {isDG && (
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
          <Link to="/etablissements">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour aux établissements
          </Link>
        </Button>
      )}

      <PageHeader
        eyebrow={est ? establishmentTypeLabel(est.type) : "Établissement"}
        title={est?.name ?? "Établissement"}
        description="Classes, élèves, scolarité, enseignants et finance de cet établissement."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Élèves" value={s?.students ?? 0} icon={Users} loading={data.loading} />
        <StatCard label="Classes" value={s?.classes ?? 0} icon={GraduationCap} tone="accent" loading={data.loading} delay={60} />
        <StatCard label="Recettes" value={formatFCFA(s?.revenue ?? 0)} icon={Wallet} tone="success" loading={data.loading} delay={120} />
        <StatCard label="Retards" value={formatFCFA(s?.overdue ?? 0)} icon={Banknote} tone="destructive" loading={data.loading} delay={180} />
      </div>

      <Tabs defaultValue="classes">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="classes">Classes</TabsTrigger>
          <TabsTrigger value="enseignants">Enseignants</TabsTrigger>
          <TabsTrigger value="finance">Finance</TabsTrigger>
        </TabsList>
        <TabsContent value="classes" className="mt-4">
          <ClassesTab establishmentId={id} data={data} />
        </TabsContent>
        <TabsContent value="enseignants" className="mt-4">
          <TeachersTab establishmentId={id} data={data} isDG={isDG} />
        </TabsContent>
        <TabsContent value="finance" className="mt-4">
          <FinanceTab establishmentId={id} data={data} />
        </TabsContent>
      </Tabs>
    </>
  );
}
