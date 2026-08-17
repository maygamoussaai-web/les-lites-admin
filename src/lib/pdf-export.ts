import { PDFDocument } from "pdf-lib";

/**
 * Convertit une image (jpg/png/webp) accessible par URL en un PDF d'une page,
 * généré entièrement dans le navigateur — jamais stocké côté serveur.
 */
export async function imageToPdfBlob(imageUrl: string, mimeType: string): Promise<Blob> {
  const res = await fetch(imageUrl);
  const bytes = await res.arrayBuffer();

  const pdf = await PDFDocument.create();
  const image = mimeType === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);

  const page = pdf.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });

  const pdfBytes = await pdf.save();
  return new Blob([pdfBytes], { type: "application/pdf" });
}

/** Déclenche le téléchargement d'un blob dans le navigateur. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}