/**
 * Modele de bulletin actif d'une classe — charge une seule fois, mis en cache.
 * NOTE POUR CLAUDE : point d'entree unique (saisie de notes, verification du
 * bulletin, generation). Evite de dupliquer le telechargement du .xlsx.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readTemplate, isSubjectLabel, type TemplateMapping, type TemplateSheet } from "@/lib/xlsx-template";

/** Types de notes saisisables, dérivés des colonnes du modèle Excel. */
export type GradeNature = "evaluation" | "composition";

/**
 * Lit le mapping du modèle et retourne les natures de notes présentes
 * (colonnes `evaluation` / `composition`). Sans modèle → les deux.
 */
export function gradeNaturesFromMapping(
  mapping: TemplateMapping | null | undefined,
): GradeNature[] {
  if (!mapping?.columns) return ["evaluation", "composition"];
  const roles = Object.values(mapping.columns);
  const hasEval = roles.includes("evaluation");
  const hasComp = roles.includes("composition");
  // Si aucune colonne note reconnue, on garde les deux pour ne pas bloquer la saisie.
  if (!hasEval && !hasComp) return ["evaluation", "composition"];
  const out: GradeNature[] = [];
  if (hasEval) out.push("evaluation");
  if (hasComp) out.push("composition");
  return out;
}

/** Nombre de colonnes d'évaluation dans le modèle (plusieurs interros possibles). */
export function evaluationSlotCount(mapping: TemplateMapping | null | undefined): number {
  if (!mapping?.columns) return 1;
  return Math.max(1, Object.values(mapping.columns).filter((r) => r === "evaluation").length);
}

export type ActiveTemplate = {
  name: string;
  scale: number;
  buffer: ArrayBuffer;
  sheet: TemplateSheet;
  mapping: TemplateMapping;
  /** Matieres listees dans le modele actif, dans l'ordre du fichier. */
  subjectLabels: string[];
  /** Natures de notes prévues par le modèle (colonnes Excel). */
  gradeNatures: GradeNature[];
  /** Nombre de colonnes d'évaluation dans le modèle. */
  evaluationSlots: number;
};

export function useActiveReportTemplate(classId: string, enabled = true) {
  const query = useQuery<ActiveTemplate | null>({
    queryKey: ["active_report_template", classId],
    enabled: enabled && !!classId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: tpl, error } = await supabase
        .from("report_templates")
        .select("name, file_path, mapping, scale")
        .eq("class_id", classId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!tpl?.file_path) return null;

      const { data: file, error: dlError } = await supabase.storage
        .from("report-templates")
        .download(tpl.file_path);
      if (dlError || !file) throw dlError ?? new Error("Telechargement du modele impossible");

      const buffer = await file.arrayBuffer();
      const sheet = readTemplate(buffer);
      const mapping = tpl.mapping as unknown as TemplateMapping;

      const subjectCol = Object.entries(mapping.columns ?? {}).find(([, r]) => r === "subject")?.[0];
      const subjectLabels: string[] = [];
      if (subjectCol) {
        for (let r = mapping.firstSubjectRow; r <= mapping.lastSubjectRow; r++) {
          const cell = sheet.cells[`${subjectCol}${r}`];
          const label = cell && cell.v !== null ? String(cell.v).trim() : "";
          if (label && isSubjectLabel(label)) subjectLabels.push(label);
        }
      }

      const gradeNatures = gradeNaturesFromMapping(mapping);
      const evaluationSlots = evaluationSlotCount(mapping);

      return {
        name: tpl.name,
        scale: Number(tpl.scale) || 20,
        buffer,
        sheet,
        mapping,
        subjectLabels,
        gradeNatures,
        evaluationSlots,
      };
    },
  });

  return {
    template: query.data ?? null,
    loading: query.isPending,
    error: query.error ? ((query.error as Error).message ?? "Modele indisponible") : null,
  };
}

export const normalizeSubject = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Ne garde que les matieres presentes dans le modele actif (sinon, tout). */
export function subjectsOfTemplate<T extends { name: string }>(subjects: T[], labels: string[] | undefined): T[] {
  if (!labels || labels.length === 0) return subjects;
  const wanted = new Set(labels.map(normalizeSubject));
  const kept = subjects.filter((s) => wanted.has(normalizeSubject(s.name)));
  return kept.length ? kept : subjects;
}
