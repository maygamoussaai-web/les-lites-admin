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
  const evaluationAverage = evalValues.length
    ? evalValues.reduce((a, b) => a + b, 0) / evalValues.length
    : null;
  return {
    name,
    composition,
    evaluations: evalValues,
    evaluationAverage,
    average: null as number | null,
  };
}

export function buildModelFillData(opts: {
  establishmentName: string;
  className: string;
  studentFirstName: string;
  studentLastName: string;
  periodNumber: number;
  subjects: ClassSubject[];
  grades: Grade[];
  studentId: string;
  headcount: number;
  scale: number;
  rank: number | null;
  firstAverage: number | null;
  lastAverage: number | null;
}): FillData {
  // groupGradesBySubject indexe par subject_id (UUID), pas par nom.
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
    periodLabel: `Période ${opts.periodNumber}`,
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

export function computeModelAverages(
  templateBuffer: ArrayBuffer,
  mapping: TemplateMapping,
  fillData: FillData,
): ModelAverages {
  const { computed, warnings } = writeFilledWorkbook(templateBuffer, mapping, fillData);
  return {
    generalAverage: computed.generalAverage,
    subjectAverages: computed.subjectAverages,
    warnings,
  };
}

/** Calcule les moyennes modèle pour plusieurs élèves (stats de classe live). */
export function computeModelAveragesForStudents(opts: {
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
    const result = computeModelAverages(templateBuffer, mapping, fill);
    allWarnings.push(...result.warnings);
    perStudent.set(s.id, {
      generalAverage: result.generalAverage,
      subjectAverages: result.subjectAverages,
    });
  }

  return { perStudent, warnings: [...new Set(allWarnings)] };
}

/**
 * Remplissage annuel à partir des bulletins de périodes déjà générés.
 * - evaluations[] = moyennes de matière de chaque période (ordre chronologique)
 * - composition = moyenne annuelle matière (si le modèle a une colonne composition unique)
 * - average / evaluationAverage = moyenne annuelle matière
 *   → colonnes subject_average / evaluation_average (modèle bref type B)
 * - generalAverage fourni pour lecture ; la MG affichée reste celle des formules Excel
 */
export function buildAnnualFillData(opts: {
  establishmentName: string;
  className: string;
  studentFirstName: string;
  studentLastName: string;
  schoolYearLabel: string;
  subjects: ClassSubject[];
  studentCards: StudentReportCard[];
  headcount: number;
  scale: number;
  rank: number | null;
  firstAverage: number | null;
  lastAverage: number | null;
}): FillData {
  const {
    establishmentName,
    className,
    studentFirstName,
    studentLastName,
    schoolYearLabel,
    subjects,
    studentCards,
    headcount,
    scale,
    rank,
    firstAverage,
    lastAverage,
  } = opts;

  const periodGeneral: number[] = [];
  for (const c of studentCards) {
    if (c.general_average != null && Number.isFinite(Number(c.general_average))) {
      periodGeneral.push(Number(c.general_average));
    }
  }
  const annualGeneral =
    periodGeneral.length > 0
      ? periodGeneral.reduce((a, b) => a + b, 0) / periodGeneral.length
      : null;

  const fillSubjects = subjects.map((sub) => {
    const periodVals: number[] = [];
    for (const c of studentCards) {
      const sa = c.subject_averages as Record<string, number | null> | null;
      if (!sa) continue;
      let v = sa[sub.name];
      if (v == null) {
        const key = Object.keys(sa).find(
          (k) => k.trim().toLowerCase() === sub.name.trim().toLowerCase(),
        );
        if (key) v = sa[key];
      }
      if (v != null && Number.isFinite(Number(v))) periodVals.push(Number(v));
    }
    const annual =
      periodVals.length > 0
        ? periodVals.reduce((a, b) => a + b, 0) / periodVals.length
        : null;
    return {
      name: sub.name,
      composition: annual,
      evaluations: periodVals,
      evaluationAverage: annual,
      average: annual,
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
    generalAverage: annualGeneral,
    firstAverage,
    lastAverage,
    classAverageEvaluation: null,
    classAverageComposition: null,
    headcount,
    rank,
    scale,
  };
}
