/**
 * Page détail d'un établissement — hero, KPI et onglets soignés.
 */
import { Link, useParams } from "@tanstack/react-router";
import {
  ArrowLeft, GraduationCap, Users, Wallet, AlertTriangle, Banknote,
  Building2, TrendingUp, UserCheck,
} from "lucide-react";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { ClassesTab } from "@/components/school/classes-tab";
import { TeachersTab } from "@/components/school/teachers-tab";
import { FinanceTab } from "@/components/school/finance-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData, useEstablishmentStats } from "@/lib/school-data";
import { establishmentTypeLabel, formatFCFA } from "@/lib/format";
import { ESTABLISHMENT_VISUALS } from "@/lib/school";
import { cn } from "@/lib/utils";

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

  const visual = est
    ? (ESTABLISHMENT_VISUALS[est.type] ?? ESTABLISHMENT_VISUALS.lycee)
    : null;
  const recovery =
    s && s.expected > 0 ? Math.min(100, Math.round((s.collected / s.expected) * 100)) : 0;
  const teacherCount = data.assignments.filter(
    (a) => a.establishment_id === id && a.is_active,
  ).length;

  return (
    <div className="space-y-6">
      {isDG && (
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
          <Link to="/etablissements">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour aux établissements
          </Link>
        </Button>
      )}

      <div className="relative overflow-hidden rounded-2xl border border-border/70">
        <div
          className={cn(
            "relative bg-gradient-to-br p-5 text-white sm:p-6",
            visual?.gradient ?? "from-primary to-primary/80",
          )}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-white/15 blur-3xl"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-12 -left-10 h-36 w-36 rounded-full bg-black/10 blur-3xl"
          />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/75">
                <Building2 className="h-3.5 w-3.5" />
                {est ? establishmentTypeLabel(est.type) : "Établissement"}
              </p>
              {data.loading && !est ? (
                <Skeleton className="mt-2 h-8 w-48 bg-white/20" />
              ) : (
                <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                  {est?.name ?? "Établissement"}
                </h1>
              )}
              <p className="mt-1.5 max-w-xl text-sm text-white/80">
                Classes, élèves, scolarité, enseignants et finance de cet établissement.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 backdrop-blur-sm">
                <GraduationCap className="h-3.5 w-3.5" />
                {s?.classes ?? 0} classe{(s?.classes ?? 0) > 1 ? "s" : ""}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 backdrop-blur-sm">
                <UserCheck className="h-3.5 w-3.5" />
                {teacherCount} enseignant{teacherCount > 1 ? "s" : ""}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 backdrop-blur-sm">
                <TrendingUp className="h-3.5 w-3.5" />
                {recovery}% recouvré
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Élèves"
          value={s?.students ?? 0}
          icon={Users}
          loading={data.loading}
        />
        <StatCard
          label="Classes"
          value={s?.classes ?? 0}
          icon={GraduationCap}
          tone="accent"
          loading={data.loading}
          delay={40}
        />
        <StatCard
          label="Recettes"
          value={formatFCFA(s?.collected ?? 0)}
          hint={s?.expected ? `Attendu : ${formatFCFA(s.expected)}` : undefined}
          icon={Wallet}
          tone="success"
          loading={data.loading}
          delay={80}
        />
        <StatCard
          label="Impayés"
          value={formatFCFA(s?.outstanding ?? 0)}
          icon={Banknote}
          tone="destructive"
          loading={data.loading}
          delay={120}
        />
      </div>

      {s && s.expected > 0 && (
        <div className="rounded-xl border border-border/70 bg-card/80 px-4 py-3 shadow-sm">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-muted-foreground">Taux de recouvrement</span>
            <span className="font-semibold tabular-nums text-foreground">{recovery}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted/80">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500/90 to-emerald-400 transition-[width] duration-700 ease-out"
              style={{ width: `${recovery}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {formatFCFA(s.collected)} encaissés sur {formatFCFA(s.expected)} attendus
          </p>
        </div>
      )}

      <Tabs defaultValue="classes" className="space-y-4">
        <TabsList className="grid h-11 w-full grid-cols-3 gap-1 rounded-xl border border-border/70 bg-muted/40 p-1">
          <TabsTrigger
            value="classes"
            className="gap-1.5 rounded-lg px-2 py-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm"
          >
            <GraduationCap className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Classes</span>
          </TabsTrigger>
          <TabsTrigger
            value="enseignants"
            className="gap-1.5 rounded-lg px-2 py-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm"
          >
            <UserCheck className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Enseignants</span>
          </TabsTrigger>
          <TabsTrigger
            value="finance"
            className="gap-1.5 rounded-lg px-2 py-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm"
          >
            <Wallet className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Finance</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="classes" className="mt-0 focus-visible:outline-none">
          <ClassesTab establishmentId={id} data={data} />
        </TabsContent>
        <TabsContent value="enseignants" className="mt-0 focus-visible:outline-none">
          <TeachersTab establishmentId={id} data={data} isDG={isDG} />
        </TabsContent>
        <TabsContent value="finance" className="mt-0 focus-visible:outline-none">
          <FinanceTab establishmentId={id} data={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
