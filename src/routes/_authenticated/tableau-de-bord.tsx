import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Users, Wallet, Banknote } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { EstablishmentCard } from "@/components/app/establishment-card";
import { ProgressRing } from "@/components/app/progress-ring";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData, useEstablishmentStats } from "@/lib/school-data";
import { useSaveRow } from "@/lib/data";
import { formatFCFA } from "@/lib/format";
import { expectedTuition, teacherDue, sum } from "@/lib/school";

export const Route = createFileRoute("/_authenticated/tableau-de-bord")({
  head: () => ({
    meta: [
      { title: "Tableau de bord – Les Élites de Gao" },
      {
        name: "description",
        content: "Vue d'ensemble du complexe scolaire Les Élites de Gao : effectifs, classes et recouvrement.",
      },
      { property: "og:title", content: "Tableau de bord – Les Élites de Gao" },
      {
        property: "og:description",
        content: "Pilotage global des quatre établissements : élèves, classes, scolarité encaissée et retards.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

type Data = ReturnType<typeof useSchoolData>;

/* ---------------------------------------------------------------------- */
/* Widgets rapides                                                         */
/* ---------------------------------------------------------------------- */

function QuickTuitionPaymentDialog({ open, onClose, data }: { open: boolean; onClose: () => void; data: Data }) {
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
  const expected = student ? expectedTuition(student, data.classes, data.feePlans) : 0;
  const paidSoFar = student
    ? sum(data.tuitionPayments.filter((p) => p.student_id === student.id).map((p) => Number(p.amount)))
    : 0;
  const remaining = Math.max(0, expected - paidSoFar);
  const hasPlan = expected > 0;
  const amountNum = Number(amount || 0);
  const exceeds = hasPlan && amountNum > remaining;
  const canSubmit = !!establishmentId && !!studentId && amountNum > 0 && !exceeds && !savePayment.isPending;

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
                {hasPlan ? `Reste dû : ${formatFCFA(remaining)}` : "Aucun modèle de scolarité associé à la classe de cet élève."}
              </p>
            ) : null}
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">
              Montant (FCFA)<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
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

function QuickTeacherPaymentDialog({ open, onClose, data }: { open: boolean; onClose: () => void; data: Data }) {
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
  const teacher = assignment ? data.teachers.find((t) => t.id === assignment.teacher_id) : null;
  const due = assignment ? teacherDue(assignment, data.sessions, data.sessionCompletions) : 0;
  const paidSoFar = assignment
    ? sum(
        data.teacherPayments
          .filter((p) => p.teacher_id === assignment.teacher_id && p.establishment_id === establishmentId)
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
            <Select value={assignmentId} onValueChange={setAssignmentId} disabled={!assignments.length}>
              <SelectTrigger>
                <SelectValue placeholder={assignments.length ? "Sélectionner" : "Aucun enseignant affecté"} />
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
              <p className="mt-1 text-xs text-muted-foreground">Reste dû : {formatFCFA(remaining)}</p>
            ) : null}
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">
              Montant (FCFA)<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
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

/* ---------------------------------------------------------------------- */

function Page() {
  const { isDG, loading: authLoading, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const navigate = useNavigate();
  const data = useSchoolData();
  const stats = useEstablishmentStats(data);
  const [tuitionPayOpen, setTuitionPayOpen] = useState(false);
  const [teacherPayOpen, setTeacherPayOpen] = useState(false);

  // Le personnel administratif peut avoir accès à plusieurs établissements :
  // on le renvoie vers la liste (qui affichera automatiquement, via les
  // règles de sécurité, uniquement les établissements auxquels il a accès —
  // qu'il y en ait un seul ou plusieurs), jamais vers un établissement fixe.
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
          .filter((p) => p.teacher_id === a.teacher_id && p.establishment_id === a.establishment_id)
          .map((p) => Number(p.amount)),
      );
      return Math.max(0, due - paid);
    }),
  );

  return (
    <>
      <PageHeader
        eyebrow="Complexe scolaire"
        title="Tableau de bord"
        description="Situation consolidée des quatre établissements : effectifs, scolarité et rémunération des enseignants."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Élèves inscrits" value={totals.students} icon={Users} loading={data.loading} delay={0} />
        <StatCard
          label="Scolarité encaissée"
          value={formatFCFA(totals.collected)}
          hint={`Attendu : ${formatFCFA(totals.expected)}`}
          icon={Wallet}
          tone="success"
          loading={data.loading}
          delay={60}
        />
        <StatCard
          label="À payer aux profs"
          value={formatFCFA(teacherOutstanding)}
          hint="Dû restant, tous établissements"
          icon={Banknote}
          tone="destructive"
          loading={data.loading}
          delay={120}
        />
      </div>

      <Card className="animate-rise panel-gradient">
        <CardHeader>
          <CardTitle className="font-display text-base">Actions rapides</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Button className="press justify-start" size="lg" onClick={() => setTuitionPayOpen(true)}>
            <Wallet className="mr-2 h-4 w-4" /> Enregistrer un paiement de scolarité
          </Button>
          <Button className="press justify-start" size="lg" variant="outline" onClick={() => setTeacherPayOpen(true)}>
            <Banknote className="mr-2 h-4 w-4" /> Enregistrer un paiement de prof
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-foreground">Établissements</h2>
          {data.loading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-64 rounded-2xl" />
              ))}
            </div>
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
                    delay={index * 80}
                  />
                );
              })}
            </div>
          )}
        </div>

        <Card className="animate-rise panel-gradient h-fit">
          <CardHeader>
            <CardTitle className="font-display text-base">Taux de recouvrement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <ProgressRing
              value={totals.collected}
              max={totals.expected}
              label="Encaissé"
              caption={`${formatFCFA(totals.collected)} encaissés sur ${formatFCFA(totals.expected)} attendus`}
            />
            <div className="hairline" />
            <div className="space-y-3">
              {data.establishments.map((est) => {
                const s = stats.get(est.id);
                const ratio = s && s.expected > 0 ? Math.round((s.collected / s.expected) * 100) : 0;
                return (
                  <div key={est.id}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate text-muted-foreground">{est.name}</span>
                      <span className="font-medium text-foreground">{ratio}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-700"
                        style={{ width: `${ratio}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <QuickTuitionPaymentDialog open={tuitionPayOpen} onClose={() => setTuitionPayOpen(false)} data={data} />
      <QuickTeacherPaymentDialog open={teacherPayOpen} onClose={() => setTeacherPayOpen(false)} data={data} />
    </>
  );
}
