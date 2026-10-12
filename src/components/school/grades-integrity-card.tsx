/**
 * Contrôle d'intégrité des notes avant bulletins.
 * Compteurs explicites :
 * - cases attendues = élèves × matières × natures (éval + compo)
 * - cases remplies / manquantes (slots)
 * - paires élève×matière incomplètes (détail déroulant)
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

  const stats = useMemo(() => {
    const blocking: Issue[] = [];
    const missing: Issue[] = [];
    const name = (s: StudentLite) => `${s.last_name} ${s.first_name}`;
    const byStudent = new Map<string, Grade[]>();
    for (const g of grades) {
      const list = byStudent.get(g.student_id) ?? [];
      list.push(g);
      byStudent.set(g.student_id, list);
    }

    const natureCount = Math.max(1, natures.length);
    const expectedSlots = students.length * subjects.length * natureCount;
    // Cases uniques (élève × matière × nature) présentes — pas les doublons de séquence.
    const filledKeys = new Set<string>();
    for (const g of grades) {
      if (!subjects.some((sub) => sub.id === g.subject_id)) continue;
      if (!natures.includes(g.nature as GradeNature)) continue;
      if (!students.some((st) => st.id === g.student_id)) continue;
      filledKeys.add(`${g.student_id}|${g.subject_id}|${g.nature}`);
    }
    const filledSlots = filledKeys.size;
    const missingSlots = Math.max(0, expectedSlots - filledSlots);

    const incompleteBySubject = new Map<string, number>();

    for (const s of students) {
      const list = byStudent.get(s.id) ?? [];
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
      if (!list.length) {
        missing.push({ student: name(s), detail: "Aucune note sur la période" });
        for (const sub of subjects) {
          incompleteBySubject.set(sub.name, (incompleteBySubject.get(sub.name) ?? 0) + 1);
        }
        continue;
      }
      for (const sub of subjects) {
        const lacks = natures.filter((n) => !list.some((g) => g.subject_id === sub.id && g.nature === n));
        if (lacks.length) {
          incompleteBySubject.set(sub.name, (incompleteBySubject.get(sub.name) ?? 0) + 1);
          missing.push({
            student: name(s),
            detail: `${sub.name} : ${lacks.map((n) => natureLabels[n]).join(" et ")} manquante(s)`,
          });
        }
      }
    }

    const subjectsIncomplete = [...incompleteBySubject.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"));

    return {
      blocking,
      missing,
      expectedSlots,
      filledSlots,
      missingSlots,
      subjectsIncomplete,
      completionPct: expectedSlots ? Math.round((filledSlots / expectedSlots) * 100) : 100,
    };
  }, [students, subjects, grades, natures, natureLabels]);

  if (!students.length || !subjects.length) return null;

  const { blocking, missing, expectedSlots, filledSlots, missingSlots, subjectsIncomplete, completionPct } =
    stats;
  const status = blocking.length ? "red" : missingSlots > 0 ? "orange" : "green";
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
        ? `${missingSlots} case${missingSlots > 1 ? "s" : ""} manquante${missingSlots > 1 ? "s" : ""} sur ${expectedSlots}`
        : `${blocking.length} anomalie(s) à corriger`;

  const issues = [...blocking, ...missing];

  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((v) => !v)}
        disabled={!issues.length && status === "green"}
      >
        <span className="flex items-center gap-2">
          <Icon className="h-5 w-5 shrink-0" />
          <span>
            <span className="block text-sm font-semibold text-foreground">Contrôle des notes — {title}</span>
            <span className="block text-xs text-muted-foreground">
              {periodLabel}
              {" · "}
              {filledSlots}/{expectedSlots} cases ({completionPct} %)
              {subjectsIncomplete.length > 0
                ? ` · ${subjectsIncomplete.length} matière${subjectsIncomplete.length > 1 ? "s" : ""} incomplète${subjectsIncomplete.length > 1 ? "s" : ""}`
                : ""}
            </span>
          </span>
        </span>
        {issues.length > 0 && (
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>

      {open && (subjectsIncomplete.length > 0 || issues.length > 0) && (
        <div className="mt-3 space-y-3 text-xs text-foreground">
          {subjectsIncomplete.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-muted-foreground">Matières incomplètes (élèves concernés)</p>
              <ul className="flex flex-wrap gap-1.5">
                {subjectsIncomplete.map(([sub, n]) => (
                  <li
                    key={sub}
                    className="rounded-full border border-border/60 bg-background/60 px-2.5 py-0.5 tabular-nums"
                  >
                    {sub} · {n}/{students.length}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {issues.length > 0 && (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {issues.slice(0, 200).map((i, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="font-medium">{i.student}</span>
                  <span className="text-muted-foreground">— {i.detail}</span>
                </li>
              ))}
              {issues.length > 200 && (
                <li className="text-muted-foreground">… et {issues.length - 200} autre(s)</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
