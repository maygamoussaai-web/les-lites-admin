/**
 * Modele de bulletin actif d'une classe — charge une seule fois, mis en cache.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readTemplate, isSubjectLabel, type TemplateMapping, type TemplateSheet } from "@/lib/xlsx-template";

export type GradeNature = "evaluation" | "composition";

export function gradeNaturesFromMapping(
  mapping: TemplateMapping | null | undefined,
): GradeNature[] {
  if (!mapping?.columns) return ["evaluation", "composition"];
  const roles = Object.values(mapping.columns);
  const hasEval = roles.includes("evaluation");
  const hasComp = roles.includes("composition");
  if (!hasEval && !hasComp) return ["evaluation", "composition"];
  const out: GradeNature[] = [];
  if (hasEval) out.push("evaluation");
  if (hasComp) out.push("composition");
  return out;
}

export function evaluationSlotCount(mapping: TemplateMapping | null | undefined): number {
  if (!mapping?.columns) return 1;
  return Math.max(1, Object.values(mapping.columns).filter((r) => r === "evaluation").length);
}

export type ActiveTemplate = {
  name: string;
  scale: number;
  bufferBase64: string;
  sheet: TemplateSheet;
  mapping: TemplateMapping;
  subjectLabels: string[];
  gradeNatures: GradeNature[];
  evaluationSlots: number;
};

export function templateBuffer(tpl: ActiveTemplate | null | undefined): ArrayBuffer | null {
  if (!tpl?.bufferBase64) return null;
  try {
    const bin = atob(tpl.bufferBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  } catch {
    return null;
  }
}

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

      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const bufferBase64 = btoa(binary);

      return {
        name: tpl.name,
        scale: Number(tpl.scale) || 20,
        bufferBase64,
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

export function subjectsOfTemplate<T extends { name: string }>(subjects: T[], labels: string[] | undefined): T[] {
  if (!labels || labels.length === 0) return subjects;
  const wanted = new Set(labels.map(normalizeSubject));
  const kept = subjects.filter((s) => wanted.has(normalizeSubject(s.name)));
  return kept.length ? kept : subjects;
}
