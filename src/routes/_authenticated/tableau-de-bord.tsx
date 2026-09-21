/**
 * Tableau de bord DG — vue consolidée du complexe.
 * Données inchangées : effectifs, scolarité, dû enseignants, établissements, recouvrement.
 */
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Users, Wallet, Banknote, GraduationCap, Sparkles, ArrowRight, Building2,
} from "lucide-react";
import { StatCard } from "@/components/app/stat-card";
import { EstablishmentCard } from "@/components/app/establishment-card";
import { ProgressRing } from "@/components/app/progress-ring";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData, useEstablishmentStats } from "@/lib/school-data";
import { useSaveRow } from "@/lib/data";
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

type Data = ReturnType<typeof useSchoolData>;

function QuickTuitionPaymentDialog({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: Data;
}) {
  const savePayment = useSaveRow("tuition_payments", "Paiement");
  const [establishmentId, setEstablishmentId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setEstablishmentId(data.establishments[0]?.id ?? "");
    setAmount("");
    setPaidAt(new Date().toISOString().slice(0, 10));
    setMethod("cash");
    setNote("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const students = data.students.filter((s) => s.establishment_id === establishmentId);

  useEffect(() => {
    setStudentId(students[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [establishmentId]);

  const student = students.find((s) => s.id === studentId) ?? null;
  const enrollment = student ? data.activeEnrollmentByStudent.get(student.id) : undefined;
  const expected = enrollment ? Number(enrollment.total_amount) : 0;
  const paidSoFar = enrollment
    ? sum(
        data.tuitionPayments
          .filter((p) => p.enrollment_id === enrollment.id)
          .map((p) => Number(p.amount)),
      )
    : 0;
  const remaining = Math.max(0, expected - paidSoFar);
  const hasPlan = expected > 0;
  const amountNum = Number(amount || 0);
  const exceeds = hasPlan && amountNum > remaining;
  const canSubmit =
    !!establishmentId &&
    !!studentId &&
    !!enrollment &&
    amountNum > 0 &&
    !exceeds &&
    !savePayment.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enregistrer un paiement de scolarité</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">
              Établissement<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select value={establishmentId} onValueChange={setEstablishmentId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner" />
              </SelectTrigger>
              <SelectContent>
                {data.establishments.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">
              Élève<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select value={studentId} onValueChange={setStudentId} disabled={!students.length}>
              <SelectTrigger>
                <SelectValue placeholder={students.length ? "Sélectionner" : "Aucun élève"} />
              </SelectTrigger>
              <SelectContent>
                {students.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.last_name} {s.first_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {student ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {enrollment
                  ? hasPlan
                    ? `Reste dû : ${formatFCFA(remaining)}`
                    : "Aucun modèle de scolarité associé à cette période."
                  : "Cet élève n'a pas de période de scolarité active."}
              </p>
            ) : null}
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">
              Montant (FCFA)<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              type="number"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!enrollment}
            />
            {exceeds ? (
              <p className="mt-1 text-xs font-medium text-destructive">
                Le montant dépasse le reste dû ({formatFCFA(remaining)}).
              </p>
            ) : null}
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">Date</Label>
            <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">Moyen de paiement</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Espèces</SelectItem>
                <SelectItem value="mobile_money">Mobile money</SelectItem>
                <SelectItem value="bank">Banque</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              savePayment.mutate(
                {
                  values: {
                    student_id: studentId,
                    enrollment_id: enrollment!.id,
                    amount: amountNum,
                    paid_at: paidAt,
                    method,
                    note: note || null,
                    establishment_id: establishmentId,
                  },
                },
                { onSuccess: onClose },
              )
            }
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuickTeacherPaymentDialog({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: Data;
}) {
  const savePayment = useSaveRow("teacher_payments", "Paiement");
  const [establishmentId, setEstablishmentId] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setEstablishmentId(data.establishments[0]?.id ?? "");
    setAmount("");
    setPaidAt(new Date().toISOString().slice(0, 10));
    setNote("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const assignments = data.assignments.filter((a) => a.establishment_id === establishmentId);

  useEffect(() => {
    setAssignmentId(assignments[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [establishmentId]);

  const assignment = assignments.find((a) => a.id === assignmentId) ?? null;
  const due = assignment ? teacherDue(assignment, data.sessions, data.sessionCompletions) : 0;
  const paidSoFar = assignment
    ? sum(
        data.teacherPayments
          .filter(
            (p) =>
              p.teacher_id === assignment.teacher_id && p.establishment_id === establishmentId,
          )
          .map((p) => Number(p.amount)),
      )
    : 0;
  const remaining = Math.max(0, due - paidSoFar);
  const amountNum = Number(amount || 0);
  const exceeds = amountNum > remaining;
  const canSubmit = !!assignment && amountNum > 0 && !exceeds && !savePayment.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enregistrer un paiement de prof</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">
              Établissement<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select value={establishmentId} onValueChange={setEstablishmentId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner" />
              </SelectTrigger>
              <SelectContent>
                {data.establishments.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">
              Enseignant<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select
              value={assignmentId}
              onValueChange={setAssignmentId}
              disabled={!assignments.length}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={assignments.length ? "Sélectionner" : "Aucun enseignant affecté"}
                />
              </SelectTrigger>
              <SelectContent>
                {assignments.map((a) => {
                  const t = data.teachers.find((x) => x.id === a.teacher_id);
                  return (
                    <SelectItem key={a.id} value={a.id}>
                      {t ? `${t.last_name} ${t.first_name}` : "Enseignant"}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {assignment ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Reste dû : {formatFCFA(remaining)}
              </p>
            ) : null}
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">
              Montant (FCFA)<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              type="number"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {exceeds ? (
              <p className="mt-1 text-xs font-medium text-destructive">
                Le montant dépasse le reste dû ({formatFCFA(remaining)}).
              </p>
            ) : null}
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">Date</Label>
            <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-sm">Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              savePayment.mutate(
                {
                  values: {
                    amount: amountNum,
                    paid_at: paidAt,
                    note: note || null,
                    teacher_id: assignment!.teacher_id,
                    establishment_id: establishmentId,
                  },
                },
                { onSuccess: onClose },
              )
            }
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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

      <div className="grid gap-3 sm:grid-cols-2">
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
            <p className="text-xs text-muted-foreground">
              Enregistrer un encaissement élève
            </p>
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
            <p className="text-xs text-muted-foreground">
              Régler un dû enseignant
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_320px]">
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Établissements
            </h2>
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
              {recoveryRatio}% encaissé sur l&apos;ensemble du complexe
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
