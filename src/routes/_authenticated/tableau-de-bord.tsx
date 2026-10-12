/**
 * Tableau de bord DG — vue consolidée du complexe.
 */
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Users, Wallet, Banknote, GraduationCap, Sparkles, ArrowRight, Building2,
} from "lucide-react";
import { StatCard } from "@/components/app/stat-card";
import { EstablishmentCard } from "@/components/app/establishment-card";
import { ProgressRing } from "@/components/app/progress-ring";
import { ValidateTodaySessionsButton } from "@/components/app/validate-today-sessions";
import { QuickTuitionPaymentDialog } from "@/components/app/quick-tuition-payment-dialog";
import { QuickTeacherPaymentDialog } from "@/components/app/quick-teacher-payment-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData, useEstablishmentStats } from "@/lib/school-data";
import { formatFCFA } from "@/lib/format";
import { teacherDue, sum } from "@/lib/school";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/tableau-de-bord")({
  head: () => ({
    meta: [
      { title: "Tableau de bord – Les Élites de Gao" },
      {
        name: "description",
        content:
          "Vue d'ensemble du complexe scolaire Les Élites de Gao : effectifs, classes et recouvrement.",
      },
      { property: "og:title", content: "Tableau de bord – Les Élites de Gao" },
      {
        property: "og:description",
        content:
          "Pilotage global des établissements du complexe : élèves, classes, scolarité encaissée et retards.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { isDG, loading: authLoading, establishmentIdsLoading } = useAdminProfile();
  const navigate = useNavigate();
  const data = useSchoolData();
  const stats = useEstablishmentStats(data);
  const [tuitionPayOpen, setTuitionPayOpen] = useState(false);
  const [teacherPayOpen, setTeacherPayOpen] = useState(false);

  useEffect(() => {
    if (authLoading || isDG || establishmentIdsLoading) return;
    navigate({ to: "/etablissements", replace: true });
  }, [authLoading, isDG, establishmentIdsLoading, navigate]);

  const totals = [...stats.values()].reduce(
    (acc, s) => ({
      students: acc.students + s.students,
      classes: acc.classes + s.classes,
      expected: acc.expected + s.expected,
      collected: acc.collected + s.collected,
      late: acc.late + s.lateStudents,
    }),
    { students: 0, classes: 0, expected: 0, collected: 0, late: 0 },
  );

  const teacherOutstanding = sum(
    data.assignments.map((a) => {
      const due = teacherDue(a, data.sessions, data.sessionCompletions);
      const paid = sum(
        data.teacherPayments
          .filter(
            (p) => p.teacher_id === a.teacher_id && p.establishment_id === a.establishment_id,
          )
          .map((p) => Number(p.amount)),
      );
      return Math.max(0, due - paid);
    }),
  );

  const recoveryRatio =
    totals.expected > 0 ? Math.min(100, Math.round((totals.collected / totals.expected) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-primary/5 p-5 sm:p-6">
        <span
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-primary/10 blur-3xl"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-12 -left-10 h-36 w-36 rounded-full bg-accent/10 blur-3xl"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Complexe scolaire
            </p>
            <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Tableau de bord
            </h1>
            <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
              Situation consolidée des établissements : effectifs, scolarité et rémunération des
              enseignants.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/60 px-3 py-1.5">
              <Building2 className="h-3.5 w-3.5 text-primary" />
              {data.establishments.length} établissement
              {data.establishments.length > 1 ? "s" : ""}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/60 px-3 py-1.5">
              <GraduationCap className="h-3.5 w-3.5 text-primary" />
              {totals.classes} classe{totals.classes > 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Élèves inscrits"
          value={totals.students}
          icon={Users}
          loading={data.loading}
          delay={0}
        />
        <StatCard
          label="Scolarité encaissée"
          value={formatFCFA(totals.collected)}
          hint={`Attendu : ${formatFCFA(totals.expected)}`}
          icon={Wallet}
          tone="success"
          loading={data.loading}
          delay={50}
        />
        <StatCard
          label="À payer aux profs"
          value={formatFCFA(teacherOutstanding)}
          hint="Dû restant, tous établissements"
          icon={Banknote}
          tone="destructive"
          loading={data.loading}
          delay={100}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ValidateTodaySessionsButton data={data} />
        <button
          type="button"
          onClick={() => setTuitionPayOpen(true)}
          className={cn(
            "group flex items-center gap-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-left transition",
            "hover:border-emerald-500/40 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          )}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Wallet className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">Paiement de scolarité</p>
            <p className="text-xs text-muted-foreground">Enregistrer un encaissement élève</p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
        </button>
        <button
          type="button"
          onClick={() => setTeacherPayOpen(true)}
          className={cn(
            "group flex items-center gap-4 rounded-2xl border border-border/80 bg-card p-4 text-left transition",
            "hover:border-primary/30 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          )}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Banknote className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">Paiement de prof</p>
            <p className="text-xs text-muted-foreground">Régler un dû enseignant</p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_320px]">
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-foreground">Établissements</h2>
            {!data.loading && (
              <span className="text-xs text-muted-foreground">
                {data.establishments.length} au total
              </span>
            )}
          </div>
          {data.loading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-64 rounded-2xl" />
              ))}
            </div>
          ) : data.establishments.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <Building2 className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-medium text-foreground">Aucun établissement</p>
                <p className="text-xs text-muted-foreground">
                  Créez un établissement pour commencer le pilotage.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {data.establishments.map((est, index) => {
                const s = stats.get(est.id);
                return (
                  <EstablishmentCard
                    key={est.id}
                    establishment={est}
                    students={s?.students ?? 0}
                    classes={s?.classes ?? 0}
                    collected={s?.collected ?? 0}
                    expected={s?.expected ?? 0}
                    delay={index * 70}
                  />
                );
              })}
            </div>
          )}
        </section>

        <Card className="h-fit overflow-hidden border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base">Taux de recouvrement</CardTitle>
            <CardDescription>
              {recoveryRatio}% encaissé sur l'ensemble du complexe
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ProgressRing
              value={totals.collected}
              max={totals.expected}
              label="Encaissé"
              caption={`${formatFCFA(totals.collected)} encaissés sur ${formatFCFA(totals.expected)} attendus`}
            />
            <div className="h-px bg-border/60" />
            <div className="space-y-3.5">
              {data.establishments.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground">—</p>
              ) : (
                data.establishments.map((est) => {
                  const s = stats.get(est.id);
                  const ratio =
                    s && s.expected > 0 ? Math.round((s.collected / s.expected) * 100) : 0;
                  return (
                    <div key={est.id}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-muted-foreground">{est.name}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-foreground">
                          {ratio}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted/80">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-[width] duration-700 ease-out"
                          style={{ width: `${ratio}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <QuickTuitionPaymentDialog
        open={tuitionPayOpen}
        onClose={() => setTuitionPayOpen(false)}
        data={data}
      />
      <QuickTeacherPaymentDialog
        open={teacherPayOpen}
        onClose={() => setTeacherPayOpen(false)}
        data={data}
      />
    </div>
  );
}
