/**
 * Bulletins et rapports de classe — rendu et calculs.
 *
 * NOTE POUR CLAUDE :
 * - Les calculs viennent TOUS de src/lib/grades.ts (source unique de vérité).
 *   Ne pas recalculer une moyenne ici.
 * - Le rendu PDF réutilise `canvasToPdfBlob` de src/lib/pdf-export.ts (aucune
 *   dépendance PDF externe dans le projet — ne pas en ajouter).
 * - `drawReportCard` est un MODÈLE PROVISOIRE : le client fournira des
 *   modèles Excel par classe. Seule cette fonction (et `drawClassReport`)
 *   devra être remplacée le moment venu ; la structure de données
 *   `ReportCardData` / `ReportRow` est le contrat à conserver.
 */
import { subjectAverage, to20, PASS_THRESHOLD, type ClassSubject, type Grade } from "@/lib/grades";

export type ReportRow = {
  subjectId: string;
  subject: string;
  composition: number | null; // note normalisée /20
  evaluations: number[]; // notes normalisées /20
  average: number | null;
  missing: ("composition" | "evaluation")[];
};

export type ReportCardData = {
  establishment: string;
  className: string;
  periodLabel: string;
  studentName: string;
  rows: ReportRow[];
  average: number | null;
  rank?: { position: number; total: number } | null;
};

/** Construit les lignes du bulletin d'un élève, matière par matière. */
export function buildReportRows(grades: Grade[], subjects: ClassSubject[], studentId: string): ReportRow[] {
  return subjects.map((subject) => {
    const list = grades.filter((g) => g.student_id === studentId && g.subject_id === subject.id);
    const comp = list.find((g) => g.nature === "composition");
    const evals = list.filter((g) => g.nature === "evaluation");
    const missing: ("composition" | "evaluation")[] = [];
    if (!comp) missing.push("composition");
    if (evals.length === 0) missing.push("evaluation");
    return {
      subjectId: subject.id,
      subject: subject.name,
      composition: comp ? to20(Number(comp.value), Number(comp.scale)) : null,
      evaluations: evals.map((g) => to20(Number(g.value), Number(g.scale))),
      average: subjectAverage(list),
      missing,
    };
  });
}

const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(2));

/** Dessine un bulletin sur un canvas A4 (150 dpi) — modèle provisoire. */
export function drawReportCard(data: ReportCardData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f2a5c";
  ctx.fillRect(0, 0, canvas.width, 130);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 38px Helvetica, Arial, sans-serif";
  ctx.fillText(data.establishment, 60, 65);
  ctx.font = "22px Helvetica, Arial, sans-serif";
  ctx.fillText(`Bulletin de notes — ${data.periodLabel}`, 60, 102);

  ctx.fillStyle = "#111827";
  ctx.font = "bold 30px Helvetica, Arial, sans-serif";
  ctx.fillText(data.studentName, 60, 190);
  ctx.font = "20px Helvetica, Arial, sans-serif";
  ctx.fillStyle = "#4b5563";
  ctx.fillText(`Classe : ${data.className}`, 60, 224);

  const top = 270;
  const cols = [60, 520, 700, 900, 1080];
  ctx.fillStyle = "#e8edf7";
  ctx.fillRect(60, top, 1120, 44);
  ctx.fillStyle = "#0f2a5c";
  ctx.font = "bold 20px Helvetica, Arial, sans-serif";
  ctx.fillText("Matière", cols[0]! + 12, top + 29);
  ctx.fillText("Composition", cols[1]!, top + 29);
  ctx.fillText("Évaluations", cols[2]!, top + 29);
  ctx.fillText("Moyenne", cols[3]!, top + 29);
  ctx.fillText("Appr.", cols[4]!, top + 29);

  let y = top + 44;
  ctx.font = "19px Helvetica, Arial, sans-serif";
  for (const row of data.rows) {
    ctx.strokeStyle = "#e5e7eb";
    ctx.beginPath();
    ctx.moveTo(60, y + 40);
    ctx.lineTo(1180, y + 40);
    ctx.stroke();
    ctx.fillStyle = "#111827";
    ctx.fillText(row.subject, cols[0]! + 12, y + 27);
    ctx.fillText(fmt(row.composition), cols[1]!, y + 27);
    ctx.fillText(row.evaluations.length ? row.evaluations.map((v) => v.toFixed(1)).join(" / ") : "—", cols[2]!, y + 27);
    ctx.fillStyle = row.average !== null && row.average < PASS_THRESHOLD ? "#b91c1c" : "#111827";
    ctx.fillText(fmt(row.average), cols[3]!, y + 27);
    ctx.fillStyle = "#6b7280";
    ctx.fillText(row.missing.length ? "Incomplet" : row.average !== null && row.average >= PASS_THRESHOLD ? "Acquis" : "À revoir", cols[4]!, y + 27);
    y += 40;
  }

  y += 40;
  ctx.fillStyle = "#0f2a5c";
  ctx.font = "bold 26px Helvetica, Arial, sans-serif";
  ctx.fillText(`Moyenne générale : ${fmt(data.average)} / 20`, 60, y);
  if (data.rank) {
    ctx.font = "22px Helvetica, Arial, sans-serif";
    ctx.fillText(`Rang : ${data.rank.position} / ${data.rank.total}`, 60, y + 36);
  }

  const weak = data.rows.filter((r) => r.average !== null && r.average < PASS_THRESHOLD);
  if (weak.length) {
    ctx.fillStyle = "#111827";
    ctx.font = "bold 22px Helvetica, Arial, sans-serif";
    ctx.fillText("Matières à travailler :", 60, y + 90);
    ctx.font = "20px Helvetica, Arial, sans-serif";
    ctx.fillStyle = "#b91c1c";
    ctx.fillText(weak.map((r) => r.subject).join(", "), 60, y + 124);
  }

  ctx.fillStyle = "#6b7280";
  ctx.font = "17px Helvetica, Arial, sans-serif";
  ctx.fillText(`Édité le ${new Date().toLocaleDateString("fr-FR")}`, 60, canvas.height - 60);
  ctx.fillText("Signature de la Direction", 860, canvas.height - 60);
  return canvas;
}

export type ClassReportData = {
  establishment: string;
  className: string;
  periodLabel: string;
  lines: [string, string][];
  struggling: string[];
  excellent: string[];
};

/** Dessine le rapport statistique d'une classe — modèle provisoire. */
export function drawClassReport(data: ClassReportData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f2a5c";
  ctx.fillRect(0, 0, canvas.width, 130);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 38px Helvetica, Arial, sans-serif";
  ctx.fillText(data.establishment, 60, 65);
  ctx.font = "22px Helvetica, Arial, sans-serif";
  ctx.fillText(`Rapport de classe — ${data.className} — ${data.periodLabel}`, 60, 102);

  let y = 220;
  ctx.font = "21px Helvetica, Arial, sans-serif";
  for (const [label, value] of data.lines) {
    ctx.fillStyle = "#4b5563";
    ctx.fillText(label, 60, y);
    ctx.fillStyle = "#111827";
    ctx.font = "bold 21px Helvetica, Arial, sans-serif";
    ctx.fillText(value, 760, y);
    ctx.font = "21px Helvetica, Arial, sans-serif";
    y += 42;
  }

  const block = (title: string, items: string[]) => {
    y += 30;
    ctx.fillStyle = "#0f2a5c";
    ctx.font = "bold 24px Helvetica, Arial, sans-serif";
    ctx.fillText(title, 60, y);
    y += 34;
    ctx.font = "20px Helvetica, Arial, sans-serif";
    ctx.fillStyle = "#111827";
    if (!items.length) {
      ctx.fillText("—", 60, y);
      y += 30;
      return;
    }
    for (const item of items) {
      ctx.fillText(`• ${item}`, 60, y);
      y += 30;
    }
  };
  block("Élèves excellents", data.excellent);
  block("Élèves en difficulté", data.struggling);

  ctx.fillStyle = "#6b7280";
  ctx.font = "17px Helvetica, Arial, sans-serif";
  ctx.fillText(`Édité le ${new Date().toLocaleDateString("fr-FR")}`, 60, canvas.height - 60);
  return canvas;
}
