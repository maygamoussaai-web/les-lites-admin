/**
 * Modèles de bulletin Excel — chargement, natures de notes, labels.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  isSubjectLabel,
  readTemplate,
  type TemplateMapping,
  type TemplateSheet,
} from "@/lib/xlsx-template";

export type TemplateKind = "period" | "annual";

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

const DEFAULT_NATURE_LABELS: Record<GradeNature, string> = {
  evaluation: "Note d'évaluation",
  composition: "Note de composition",
};

/**
 * Libellés UI des types de notes = en-têtes Excel du modèle (1re colonne de chaque rôle).
 * Repli : libellés par défaut si absents.
 */
export function natureLabelsFromMapping(
  mapping: TemplateMapping | null | undefined,
  sheet?: { cells: Record<string, { v?: unknown }> } | null,
): Record<GradeNature, string> {
  const labels: Record<GradeNature, string> = { ...DEFAULT_NATURE_LABELS };
  if (!mapping?.columns) return labels;

  const pick = (role: GradeNature): string | null => {
    for (const [letter, r] of Object.entries(mapping.columns)) {
      if (r !== role) continue;
      const stored = mapping.columnLabels?.[letter]?.trim();
      if (stored) return stored.replace(/\s+/g, " ");
      if (sheet && mapping.headerRow > 0) {
        const cell =
          sheet.cells[`${letter}${mapping.headerRow}`] ??
          sheet.cells[`${letter}${mapping.headerRow - 1}`];
        const raw = cell?.v != null ? String(cell.v).trim() : "";
        if (raw) return raw.replace(/\s+/g, " ");
      }
    }
    return null;
  };

  const ev = pick("evaluation");
  const co = pick("composition");
  if (ev) labels.evaluation = ev;
  if (co) labels.composition = co;
  return labels;
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
  /** Libellés issus des en-têtes du modèle Excel */
  natureLabels: Record<GradeNature, string>;
  evaluationSlots: number;
};

function bufferFromBase64(b64: string): ArrayBuffer | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  } catch {
    return null;
  }
}

/** Télécharge le fichier Excel du modèle actif (période ou annuel) depuis Storage. */
export async function downloadActiveTemplateBuffer(
  classId: string,
  kind: TemplateKind = "period",
): Promise<{ buffer: ArrayBuffer; mapping: TemplateMapping; scale: number; name: string } | null> {
  let rows: { name: string; file_path: string; mapping: unknown; scale: number; kind?: string }[] | null =
    null;

  {
    const res = await supabase
      .from("report_templates")
      .select("name, file_path, mapping, scale, kind")
      .eq("class_id", classId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (res.error && /kind/i.test(res.error.message ?? "")) {
      const fallback = await supabase
        .from("report_templates")
        .select("name, file_path, mapping, scale")
        .eq("class_id", classId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (fallback.error) return null;
      rows = fallback.data as typeof rows;
      if (kind !== "period") return null;
    } else if (res.error) {
      return null;
    } else {
      rows = res.data as typeof rows;
    }
  }

  const tpl =
    (rows ?? []).find((r) => (r.kind ?? "period") === kind) ??
    (kind === "period" ? (rows ?? [])[0] : null);
  if (!tpl?.file_path) return null;

  const { data: blob, error: dlErr } = await supabase.storage
    .from("report-templates")
    .download(tpl.file_path);
  if (dlErr || !blob) return null;

  const buffer = await blob.arrayBuffer();
  const mapping = (tpl.mapping as TemplateMapping) ?? null;
  if (!mapping) return null;

  return {
    buffer,
    mapping,
    scale: Number(tpl.scale) || 20,
    name: tpl.name,
  };
}

export function useActiveReportTemplate(classId: string | null, kind: TemplateKind = "period") {
  const query = useQuery<ActiveTemplate | null>({
    queryKey: ["active-report-template", classId, kind],
    enabled: !!classId,
    staleTime: 30_000,
    refetchOnMount: "always",
    queryFn: async () => {
      if (!classId) return null;

      let rows: {
        name: string;
        file_path: string;
        mapping: unknown;
        scale: number;
        kind?: string;
      }[] | null = null;

      const res = await supabase
        .from("report_templates")
        .select("name, file_path, mapping, scale, kind")
        .eq("class_id", classId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (res.error && /kind/i.test(res.error.message ?? "")) {
        const fallback = await supabase
          .from("report_templates")
          .select("name, file_path, mapping, scale")
          .eq("class_id", classId)
          .eq("is_active", true)
          .order("created_at", { ascending: false });
        if (fallback.error) throw fallback.error;
        rows = fallback.data as typeof rows;
        if (kind !== "period") return null;
      } else if (res.error) {
        throw res.error;
      } else {
        rows = res.data as typeof rows;
      }

      const tpl =
        (rows ?? []).find((r) => (r.kind ?? "period") === kind) ??
        (kind === "period" ? (rows ?? [])[0] : null);
      if (!tpl?.file_path) return null;

      const { data: blob, error: dlErr } = await supabase.storage
        .from("report-templates")
        .download(tpl.file_path);
      if (dlErr || !blob) throw dlErr ?? new Error("Fichier modèle introuvable");

      const buffer = await blob.arrayBuffer();
      const { sheet } = readTemplate(buffer);
      const mapping = (tpl.mapping as TemplateMapping) ?? null;
      if (!mapping) return null;

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
      const natureLabels = natureLabelsFromMapping(mapping, sheet);
      const evaluationSlots = evaluationSlotCount(mapping);

      const bytes = new Uint8Array(buffer);
      const chunk = 0x8000;
      let binary = "";
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
      }
      let bufferBase64 = "";
      try {
        bufferBase64 = btoa(binary);
      } catch {
        bufferBase64 = "";
      }

      return {
        name: tpl.name,
        scale: Number(tpl.scale) || 20,
        bufferBase64,
        sheet,
        mapping,
        subjectLabels,
        gradeNatures,
        natureLabels,
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

export function subjectsOfTemplate<
  T extends { id: string; name: string },
>(subjects: T[], subjectLabels?: string[]): T[] {
  if (!subjectLabels?.length) return subjects;
  const byNorm = new Map(
    subjects.map((s) => [
      s.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim(),
      s,
    ]),
  );
  const ordered: T[] = [];
  const used = new Set<string>();
  for (const label of subjectLabels) {
    const key = label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    const match = byNorm.get(key);
    if (match && !used.has(match.id)) {
      ordered.push(match);
      used.add(match.id);
    }
  }
  for (const s of subjects) {
    if (!used.has(s.id)) ordered.push(s);
  }
  return ordered;
}

export { bufferFromBase64 };
