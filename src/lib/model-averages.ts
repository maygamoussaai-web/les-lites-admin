/**
 * Moyennes calculees UNIQUEMENT a partir des formules du modele Excel.
 * Aucune moyenne inventee par l'app (pas de subjectAverage / studentAverage).
 */
import { writeFilledWorkbook } from "@/lib/xlsx-writeback";
import type { TemplateMapping, FillData } from "@/lib/xlsx-template";
import type { ClassSubject, Grade } from "@/lib/grades";
import { groupGradesBySubject } from "@/lib/grades";

export type ModelAverages = {
  generalAverage: number | null;
  subjectAverages: Record<string, number | null>;
  warnings: string[];
};

/** Construit les notes saisies (echelle /20) pour une ligne matiere — sans moyenne. */
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

/**
 * Prepare FillData pour un eleve. Les moyennes restent null :
 * elles seront lues apres evaluation des formules du modele.
 */
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
  const bySubject = groupGradesBySubject(opts.grades, opts.studentId);
  return {
    establishmentName: opts.establishmentName,
    className: opts.className,
    periodLabel: `Periode ${opts.periodNumber}`,
    studentName: `${opts.studentLastName} ${opts.studentFirstName}`,
    studentFirstName: opts.studentFirstName,
    studentLastName: opts.studentLastName,
    subjects: opts.subjects.map((s) => subjectRowFromGrades(s.name, bySubject.get(s.id) ?? [])),
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

/**
 * Calcule moyenne generale + moyennes par matiere via les formules du modele Excel.
 * Retourne null partout si le modele n'a pas de formule / mapping pour ces cellules.
 */
export function computeModelAverages(
  templateBuffer: ArrayBuffer,
  mapping: TemplateMapping,
  fillData: FillData,
): ModelAverages {
  const written = writeFilledWorkbook(templateBuffer, mapping, fillData);
  return {
    generalAverage: written.computed.generalAverage,
    subjectAverages: written.computed.subjectAverages,
    warnings: written.warnings,
  };
}

/**
 * Pour chaque eleve de la classe : moyennes issues du modele uniquement.
 * Les eleves sans note du tout sont omis.
 */
export function computeClassModelAverages(opts: {
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
