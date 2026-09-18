/**
 * Rendu d'un classeur rempli en image (puis PDF via canvasToPdfBlob).
 * NOTE POUR CLAUDE : reproduit la grille du modele ORIGINAL rempli
 * (largeurs de colonnes, cellules fusionnees, textes/valeurs reels),
 * page A4 portrait. Aucune dependance PDF supplementaire.
 */
import type { CellValue } from "@/lib/xlsx-formula";
import { colLetter, type TemplateSheet } from "@/lib/xlsx-template";

const A4_W = 1240;
const A4_H = 1754;
const MARGIN = 40;

const display = (v: CellValue): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toFixed(2);
  return String(v);
};

export function renderFilledSheetCanvas(
  sheet: TemplateSheet,
  values: Record<string, CellValue>,
): HTMLCanvasElement {
  const colPx: number[] = [];
  for (let c = 0; c < sheet.cols; c++) colPx[c] = Math.max(28, (sheet.colWidths[c] ?? 11) * 7.2);
  const rowPx = 26;

  const gridW = colPx.reduce((a, b) => a + b, 0);
  const gridH = sheet.rows * rowPx;
  const scale = Math.min((A4_W - MARGIN * 2) / gridW, (A4_H - MARGIN * 2) / gridH, 2.2);

  const canvas = document.createElement("canvas");
  canvas.width = A4_W;
  canvas.height = A4_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, A4_W, A4_H);
  ctx.translate(MARGIN, MARGIN);
  ctx.scale(scale, scale);

  const x0: number[] = [0];
  for (let c = 0; c < sheet.cols; c++) x0[c + 1] = x0[c]! + colPx[c]!;

  // Cellules fusionnees : on retient l'ancre et on masque les cellules internes.
  const covered = new Set<string>();
  const anchorSpan = new Map<string, { w: number; h: number }>();
  for (const m of sheet.merges) {
    const anchor = `${colLetter(m.s.c)}${m.s.r + 1}`;
    let w = 0;
    for (let c = m.s.c; c <= m.e.c; c++) w += colPx[c] ?? 0;
    anchorSpan.set(anchor, { w, h: (m.e.r - m.s.r + 1) * rowPx });
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        const key = `${colLetter(c)}${r + 1}`;
        if (key !== anchor) covered.add(key);
      }
    }
  }

  ctx.lineWidth = 0.6;
  ctx.strokeStyle = "#c9ced8";
  ctx.textBaseline = "middle";

  for (let r = 0; r < sheet.rows; r++) {
    for (let c = 0; c < sheet.cols; c++) {
      const address = `${colLetter(c)}${r + 1}`;
      if (covered.has(address)) continue;
      const span = anchorSpan.get(address);
      const w = span?.w ?? colPx[c]!;
      const h = span?.h ?? rowPx;
      const x = x0[c]!;
      const y = r * rowPx;

      const raw = address in values ? values[address]! : (sheet.cells[address]?.v ?? null);
      const text = display(raw);
      const hasCell = !!sheet.cells[address] || text !== "";
      if (hasCell) ctx.strokeRect(x, y, w, h);
      if (!text) continue;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 1, y + 1, w - 2, h - 2);
      ctx.clip();
      ctx.fillStyle = "#111827";
      const isNumber = typeof raw === "number";
      const big = (span?.w ?? 0) > colPx[c]! * 2;
      ctx.font = `${big ? "bold " : ""}13px sans-serif`;
      if (isNumber) {
        ctx.textAlign = "right";
        ctx.fillText(text, x + w - 6, y + h / 2);
      } else if (span) {
        ctx.textAlign = "center";
        ctx.fillText(text, x + w / 2, y + h / 2);
      } else {
        ctx.textAlign = "left";
        ctx.fillText(text, x + 6, y + h / 2);
      }
      ctx.restore();
    }
  }

  return canvas;
}
