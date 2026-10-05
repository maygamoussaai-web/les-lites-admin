/**
 * NOTE POUR CLAUDE: checklist d'intégrité des notes avant génération des bulletins
 * (étape 3 du plan). Lecture seule, calcul 100 % client sur les données déjà chargées
 * par useClassPage — aucune requête supplémentaire. Case vide ≠ 0 : on signale, on n'invente rien.
 */
import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown } from "lucide-react";
import type { ClassSubject, Grade } from "@/lib/grades";
import type { GradeNature } from "@/lib/report-template";

type StudentLite = { id: string; first_name: string; last_name: string };

type Issue = { student: string; detail: string };

export function GradesIntegrityCard({
  students,
  subjects,
  grades,
  natures,
  natureLabels,
  periodLabel,
}: {
  students: StudentLite[];
  subjects: ClassSubject[];
  grades: Grade[];
  natures: GradeNature[];
  natureLabels: Record<GradeNature, string>;
  periodLabel: string;
}) {
  const [open, setOpen] = useState(false);

  const { blocking, missing } = useMemo(() => {
    const blocking: Issue[] = [];
    const missing: Issue[] = [];
    const name = (s: StudentLite) => `${s.last_name} ${s.first_name}`;
    const byStudent = new Map<string, Grade[]>();
    for (const g of grades) {
      const list = byStudent.get(g.student_id) ?? [];
      list.push(g);
      byStudent.set(g.student_id, list);
    }
    for (const s of students) {
      const list = byStudent.get(s.id) ?? [];
      // Anomalies bloquantes : note hors barème / doublon exact (même matière, nature, rang).
      const seen = new Set<string>();
      for (const g of list) {
        const v = Number(g.value);
        const sc = Number(g.scale);
        const subj = subjects.find((x) => x.id === g.subject_id)?.name ?? "Matière";
        if (!Number.isFinite(v) || v < 0 || (Number.isFinite(sc) && sc > 0 && v > sc)) {
          blocking.push({ student: name(s), detail: `${subj} : note ${g.value} hors barème /${g.scale}` });
        }
        const key = `${g.subject_id}|${g.nature}|${g.sequence_number}`;
        if (seen.has(key)) blocking.push({ student: name(s), detail: `${subj} : note en double` });
        seen.add(key);
      }
      // Notes manquantes (non bloquantes).
      if (!list.length) {
        missing.push({ student: name(s), detail: "Aucune note sur la période" });
        continue;
      }
      for (const sub of subjects) {
        const lacks = natures.filter((n) => !list.some((g) => g.subject_id === sub.id && g.nature === n));
        if (lacks.length) {
          missing.push({
            student: name(s),
            detail: `${sub.name} : ${lacks.map((n) => natureLabels[n]).join(" et ")} manquante(s)`,
          });
        }
      }
    }
    return { blocking, missing };
  }, [students, subjects, grades, natures, natureLabels]);

  if (!students.length || !subjects.length) return null;

  const status = blocking.length ? "red" : missing.length ? "orange" : "green";
  const Icon = status === "green" ? CheckCircle2 : status === "orange" ? AlertTriangle : XCircle;
  const tone =
    status === "green"
      ? "text-success border-success/30 bg-success/5"
      : status === "orange"
        ? "text-accent-foreground border-accent/40 bg-accent/10"
        : "text-destructive border-destructive/30 bg-destructive/5";
  const title =
    status === "green"
      ? "Prêt pour les bulletins"
      : status === "orange"
        ? `${missing.length} note(s) manquante(s)`
        : `${blocking.length} anomalie(s) à corriger`;
  const issues = [...blocking, ...missing];

  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((v) => !v)}
        disabled={!issues.length}
      >
        <span className="flex items-center gap-2">
          <Icon className="h-5 w-5 shrink-0" />
          <span>
            <span className="block text-sm font-semibold text-foreground">Contrôle des notes — {title}</span>
            <span className="block text-xs text-muted-foreground">{periodLabel}</span>
          </span>
        </span>
        {issues.length > 0 && (
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>
      {open && issues.length > 0 && (
        <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto text-xs text-foreground">
          {issues.slice(0, 200).map((i, idx) => (
            <li key={idx} className="flex gap-2">
              <span className="font-medium">{i.student}</span>
              <span className="text-muted-foreground">— {i.detail}</span>
            </li>
          ))}
          {issues.length > 200 && <li className="text-muted-foreground">… et {issues.length - 200} autre(s)</li>}
        </ul>
      )}
    </div>
  );
}
