/**
 * Moyennes UNIQUEMENT a partir des formules du modele Excel.
 * L'app n'invente jamais de moyenne a partir des notes saisies.
 */
import { writeFilledWorkbook } from "@/lib/xlsx-writeback";
import type { TemplateMapping, FillData } from "@/lib/xlsx-template";
import type { ClassSubject, Grade, StudentReportCard } from "@/lib/grades";
import { groupGradesBySubject } from "@/lib/grades";

export type ModelAverages = {
  generalAverage: number | null;
  subjectAverages: Record<string, number | null>;
  warnings: string[];
};

function subjectRowFromGrades(name: string, gs: Grade[]) {
  const evals = gs.filter((g) => g.nature === "evaluation");
  const comp = gs.find((g) => g.nature === "composition");
  const to20 = (g: Grade) =>
    g.scale > 0 ? (Number(g.value) / Number(g.scale)) * 20 : Number(g.value);
  const evalValues = evals.map(to20);
  const composition = comp ? to20(comp) : null;
  return {
    name,
    composition,
    evaluations: evalValues,
    evaluationAverage: null as number | null,
    average: null as number | null,
  };
}

export function buildModelFillData(opts: {
  establishmentName: string;
  className: string;
  studentFirstName: string;
  studentLastName: string;
  periodNumber: number;
  periodName?: string | null;
  subjects: ClassSubject[];
  grades: Grade[];
  studentId: string;
  headcount: number;
  scale: number;
  rank: number | null;
  firstAverage: number | null;
  lastAverage: number | null;
}): FillData {
  const bySubject = groupGradesBySubject(opts.grades, opts.studentId);
  const fillSubjects = opts.subjects.map((sub) => {
    const gs =
      bySubject.get(sub.id) ??
      bySubject.get(sub.name) ??
      bySubject.get(sub.name.trim()) ??
      [];
    return subjectRowFromGrades(sub.name, gs);
  });
  return {
    establishmentName: opts.establishmentName,
    className: opts.className,
    periodLabel: opts.periodName?.trim() || `Période ${opts.periodNumber}`,
    studentName: `${opts.studentLastName} ${opts.studentFirstName}`.trim(),
    studentFirstName: opts.studentFirstName,
    studentLastName: opts.studentLastName,
    subjects: fillSubjects,
    generalAverage: null,
    firstAverage: opts.firstAverage,
    lastAverage: opts.lastAverage,
    classAverageEvaluation: null,
    classAverageComposition: null,
    headcount: opts.headcount,
    rank: opts.rank,
    scale: opts.scale,
  };
}

export async function computeModelAverages(
  templateBuffer: ArrayBuffer,
  mapping: TemplateMapping,
  fillData: FillData,
): Promise<ModelAverages> {
  const { computed, warnings } = await writeFilledWorkbook(templateBuffer, mapping, fillData);
  return {
    generalAverage: computed.generalAverage,
    subjectAverages: computed.subjectAverages,
    warnings,
  };
}

export async function computeModelAveragesForStudents(opts: {
  templateBuffer: ArrayBuffer;
  mapping: TemplateMapping;
  scale: number;
  establishmentName: string;
  className: string;
  periodNumber: number;
  subjects: ClassSubject[];
  grades: Grade[];
  students: { id: string; first_name: string; last_name: string }[];
}): {
  perStudent: Map<
    string,
    { generalAverage: number | null; subjectAverages: Record<string, number | null> }
  >;
  warnings: string[];
} {
  const { templateBuffer, mapping, scale, establishmentName, className, periodNumber, subjects, grades, students } =
    opts;
  const perStudent = new Map<
    string,
    { generalAverage: number | null; subjectAverages: Record<string, number | null> }
  >();
  const allWarnings: string[] = [];

  for (const s of students) {
    const bySubject = groupGradesBySubject(grades, s.id);
    if (bySubject.size === 0) continue;
    const fill = buildModelFillData({
      establishmentName,
      className,
      studentFirstName: s.first_name,
      studentLastName: s.last_name,
      periodNumber,
      subjects,
      grades,
      studentId: s.id,
      headcount: students.length,
      scale,
      rank: null,
      firstAverage: null,
      lastAverage: null,
    });
    const result = await computeModelAverages(templateBuffer, mapping, fill);
    allWarnings.push(...result.warnings);
    perStudent.set(s.id, {
      generalAverage: result.generalAverage,
      subjectAverages: result.subjectAverages,
    });
  }

  return { perStudent, warnings: [...new Set(allWarnings)] };
}

/**
 * Bulletin annuel : injecte Note classe + Compo par période (notes brutes).
 * Aucune moyenne inventée — formules Excel du modèle uniquement.
 */
export function buildAnnualFillData(opts: {
  establishmentName: string;
  className: string;
  studentFirstName: string;
  studentLastName: string;
  schoolYearLabel: string;
  subjects: ClassSubject[];
  grades: Grade[];
  studentId: string;
  orderedPeriodIds: string[];
  headcount: number;
  scale: number;
  rank: number | null;
  firstAverage: number | null;
  lastAverage: number | null;
  studentCards?: StudentReportCard[];
}): FillData {
  const {
    establishmentName,
    className,
    studentFirstName,
    studentLastName,
    schoolYearLabel,
    subjects,
    grades,
    studentId,
    orderedPeriodIds,
    headcount,
    scale,
    rank,
    firstAverage,
    lastAverage,
  } = opts;

  const periodIds = orderedPeriodIds?.length ? orderedPeriodIds : [];

  const periodStats = periodIds.map(() => ({
    generalAverage: null as number | null,
    rank: null as number | null,
    firstAverage: null as number | null,
    lastAverage: null as number | null,
    classAverage: null as number | null,
    headcount,
  }));

  const to20 = (g: Grade) =>
    g.scale > 0 ? (Number(g.value) / Number(g.scale)) * 20 : Number(g.value);

  const fillSubjects = subjects.map((sub) => {
    const evaluations: number[] = [];
    const compositions: (number | null)[] = [];
    for (const pid of periodIds) {
      const periodGrades = grades.filter(
        (g) =>
          g.student_id === studentId &&
          g.period_id === pid &&
          (g.subject_id === sub.id || String(g.subject_id) === String(sub.id)),
      );
      const evals = periodGrades.filter((g) => g.nature === "evaluation");
      let noteClasse: number | null = null;
      if (evals.length === 1) {
        noteClasse = to20(evals[0]!);
      } else if (evals.length > 1) {
        noteClasse = evals.reduce((a, g) => a + to20(g), 0) / evals.length;
      }
      evaluations.push(
        noteClasse != null && Number.isFinite(noteClasse)
          ? noteClasse
          : (null as unknown as number),
      );

      const comp = periodGrades.find((g) => g.nature === "composition");
      compositions.push(comp ? to20(comp) : null);
    }
    return {
      name: sub.name,
      composition: null,
      evaluations,
      compositions,
      evaluationAverage: null,
      average: null,
    };
  });

  return {
    establishmentName,
    className,
    periodLabel: schoolYearLabel || "Année scolaire",
    studentName: `${studentLastName} ${studentFirstName}`.trim(),
    studentFirstName,
    studentLastName,
    subjects: fillSubjects,
    generalAverage: null,
    firstAverage,
    lastAverage,
    classAverageEvaluation: null,
    classAverageComposition: null,
    headcount,
    rank,
    scale,
    periodStats,
  };
}

export function buildSampleFillData(opts: {
  kind: "period" | "annual";
  subjectLabels: string[];
  className: string;
  scale: number;
  periods: number;
}): FillData {
  const base: [number | null, number | null][] = [[12, 15], [10, 8], [14, null], [11, 13], [16, 12]];
  const subjects = opts.subjectLabels.map((name, i) => {
    const [ev, co] = base[i % base.length]!;
    if (opts.kind === "annual") {
      const per = Array.from({ length: opts.periods }, (_, p) => 10 + ((i + p * 2) % 7));
      const comps = per.map((v) => v + 0.5);
      return {
        name,
        composition: null,
        evaluations: per,
        compositions: comps,
        evaluationAverage: null,
        average: null,
      };
    }
    return {
      name,
      composition: co,
      evaluations: ev == null ? [] : [ev],
      evaluationAverage: null,
      average: null,
    };
  });
  const periodStats = Array.from({ length: opts.periods }, () => ({
    generalAverage: null as number | null,
    rank: null as number | null,
    firstAverage: 17.25,
    lastAverage: 6.5,
    classAverage: 11.4,
    headcount: 42,
  }));
  return {
    establishmentName: "Complexe Scolaire Les Élites de Gao",
    className: opts.className,
    periodLabel: opts.kind === "annual" ? "Année scolaire (test)" : "Période 1 (test)",
    studentName: "TEST Élève fictif",
    studentFirstName: "Élève fictif",
    studentLastName: "TEST",
    subjects,
    generalAverage: null,
    firstAverage: 17.25,
    lastAverage: 6.5,
    classAverageEvaluation: null,
    classAverageComposition: null,
    classAverage: null,
    headcount: 42,
    rank: 5,
    scale: opts.scale,
    periodStats,
  };
}
