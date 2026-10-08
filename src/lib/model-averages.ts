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
  // Jamais de moyenne inventée en JS : evaluationAverage / average restent null.
  // Seules les notes brutes (evaluations + composition) sont des entrées ;
  // les moyennes viennent uniquement des formules du modèle Excel.
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

/** Calcule les moyennes modèle pour plusieurs élèves (stats de classe live). */
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
 * Remplissage annuel à partir des bulletins de périodes déjà générés.
 * L'app n'injecte QUE les moyennes de période (entrées brutes) :
 * - evaluations[] = moyennes matière P1, P2, P3… (pour [moy:1], [moy:2]…)
 * - composition / evaluationAverage / average = null → formules Excel du modèle annuel
 * - generalAverage = null → formule MG du modèle (jamais de moyenne inventée en JS)
 * periodStats alimente [mg:1], [rang:2]… (stats de chaque période, entrées légitimes)
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

  const periodStats = studentCards.map((c) => ({
    generalAverage:
      c.general_average != null && Number.isFinite(Number(c.general_average))
        ? Number(c.general_average)
        : null,
    rank: null as number | null,
    firstAverage: null as number | null,
    lastAverage: null as number | null,
    classAverage: null as number | null,
    headcount,
  }));

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
    // Pas de moyenne annuelle JS : le classeur Excel la calcule via ses formules.
    return {
      name: sub.name,
      composition: null,
      evaluations: periodVals,
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

/**
 * NOTE POUR CLAUDE: jeu de données fictif pour le bouton « Tester avec un élève fictif »
 * (import d'un modèle). Notes déterministes : matière 1 = éval 12 / compo 15,
 * matière 2 = 10 / 8, matière 3 = 14 seule, puis une rotation simple.
 */
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
      const avg = per.reduce((a, b) => a + b, 0) / per.length;
      return { name, composition: avg, evaluations: per, evaluationAverage: avg, average: avg };
    }
    return { name, composition: co, evaluations: ev == null ? [] : [ev], evaluationAverage: ev, average: null };
  });
  const periodStats = Array.from({ length: opts.periods }, (_, p) => ({
    generalAverage: 12 + p * 0.5, rank: 3 + p, firstAverage: 17.25, lastAverage: 6.5, classAverage: 11.4, headcount: 42,
  }));
  return {
    establishmentName: "Complexe Scolaire Les Élites de Gao",
    className: opts.className,
    periodLabel: opts.kind === "annual" ? "Année scolaire (test)" : "Période 1 (test)",
    studentName: "TEST Élève fictif",
    studentFirstName: "Élève fictif",
    studentLastName: "TEST",
    subjects,
    generalAverage: opts.kind === "annual" ? 12.5 : null,
    firstAverage: 17.25,
    lastAverage: 6.5,
    classAverageEvaluation: 11.2,
    classAverageComposition: 10.8,
    classAverage: 11.4,
    headcount: 42,
    rank: 5,
    scale: opts.scale,
    periodStats,
  };
}
