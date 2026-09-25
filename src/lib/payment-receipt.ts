/**
 * Reçu PDF de paiement de scolarité (canvas → PDF, sans dépendance externe).
 */
import { canvasToPdfBlob, downloadBlob } from "@/lib/pdf-export";
import { formatFCFA } from "@/lib/format";

const METHOD_LABEL: Record<string, string> = {
  cash: "Espèces",
  mobile_money: "Mobile money",
  bank: "Banque",
};

export type PaymentReceiptInput = {
  studentName: string;
  establishmentName?: string;
  amount: number;
  paidAt: string;
  method: string;
  note?: string | null;
  paidBefore: number;
  totalDue: number;
  remainingAfter: number;
};

function drawLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = "#e2e8f0",
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/**
 * Génère et télécharge un reçu PDF pour un paiement.
 */
export async function downloadPaymentReceipt(data: PaymentReceiptInput): Promise<void> {
  const W = 794; // ~A4 width at 96dpi
  const H = 520;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible");

  // Fond
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Bandeau
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, W, 88);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px system-ui, -apple-system, sans-serif";
  ctx.fillText("Reçu de paiement", 40, 42);
  ctx.font = "16px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#94a3b8";
  ctx.fillText(data.establishmentName || "Établissement scolaire", 40, 68);

  let y = 120;
  const left = 40;
  const right = W - 40;

  const row = (label: string, value: string, bold = false) => {
    ctx.fillStyle = "#64748b";
    ctx.font = "14px system-ui, -apple-system, sans-serif";
    ctx.fillText(label, left, y);
    ctx.fillStyle = "#0f172a";
    ctx.font = bold
      ? "bold 16px system-ui, -apple-system, sans-serif"
      : "16px system-ui, -apple-system, sans-serif";
    const tw = ctx.measureText(value).width;
    ctx.fillText(value, right - tw, y);
    y += 28;
  };

  row("Élève", data.studentName, true);
  row("Date", data.paidAt);
  row("Moyen de paiement", METHOD_LABEL[data.method] || data.method);
  if (data.note?.trim()) {
    row("Note", data.note.trim().slice(0, 80));
  }

  y += 8;
  drawLine(ctx, left, y, right, y);
  y += 36;

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 18px system-ui, -apple-system, sans-serif";
  ctx.fillText("Montant payé", left, y);
  const amountStr = formatFCFA(data.amount);
  ctx.font = "bold 28px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#059669";
  const aw = ctx.measureText(amountStr).width;
  ctx.fillText(amountStr, right - aw, y);

  y += 40;
  drawLine(ctx, left, y, right, y);
  y += 32;

  row("Total dû", formatFCFA(data.totalDue));
  row("Déjà réglé (avant)", formatFCFA(data.paidBefore));
  row("Reste après ce paiement", formatFCFA(data.remainingAfter), true);

  y += 24;
  drawLine(ctx, left, y, right, y, "#cbd5e1");
  y += 28;
  ctx.fillStyle = "#94a3b8";
  ctx.font = "12px system-ui, -apple-system, sans-serif";
  ctx.fillText(
    `Document généré le ${new Date().toLocaleString("fr-FR")} — Les Lites Admin`,
    left,
    y,
  );

  const blob = await canvasToPdfBlob(canvas, 0.95);
  const safe = data.studentName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 40);
  downloadBlob(blob, `recu_${safe}_${data.paidAt}.pdf`);
}
