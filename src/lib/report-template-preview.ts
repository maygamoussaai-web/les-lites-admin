/**
 * Aperçu in-app du modèle bulletin avec données d'élève fictif.
 * Aucune écriture en base, pas de téléchargement.
 */
import * as XLSX from "xlsx";
import { writeFilledWorkbook } from "@/lib/xlsx-writeback";
import { buildSampleFillData } from "@/lib/model-averages";
import type { TemplateMapping } from "@/lib/xlsx-template";

export async function buildFictivePreview(opts: {
  buffer: ArrayBuffer;
  mapping: TemplateMapping;
  kind: "period" | "annual";
  subjectLabels: string[];
  className: string;
  scale: number;
}): Promise<{ html: string; warnings: string[] }> {
  const fill = buildSampleFillData({
    kind: opts.kind,
    subjectLabels: opts.subjectLabels,
    className: opts.className,
    scale: opts.scale,
    periods: Math.max(3, opts.mapping.periodGroupLabels?.length ?? 0),
  });
  const { buffer: out, warnings } = await writeFilledWorkbook(opts.buffer, opts.mapping, fill);
  const wb = XLSX.read(out, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const html = XLSX.utils.sheet_to_html(ws);
  return { html, warnings };
}
