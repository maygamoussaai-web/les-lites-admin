/**
 * Génère un PDF d'une page à partir d'une image JPEG, à la main, sans
 * dépendance externe. Fonctionne entièrement dans le navigateur.
 */
function readJpegSize(data: Uint8Array): { width: number; height: number } {
  let offset = 2; // saute le marqueur SOI (0xFFD8)
  while (offset < data.length - 8) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }
    const at = (i: number) => data[i] ?? 0;
    const marker = at(offset + 1);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = (at(offset + 5) << 8) | at(offset + 6);
      const width = (at(offset + 7) << 8) | at(offset + 8);
      return { width, height };
    }
    const length = (at(offset + 2) << 8) | at(offset + 3);
    offset += 2 + length;
  }
  throw new Error("Dimensions de l'image introuvables");
}

export async function imageToPdfBlob(imageUrl: string): Promise<Blob> {
  const res = await fetch(imageUrl);
  const jpegBytes = new Uint8Array(await res.arrayBuffer());
  const { width, height } = readJpegSize(jpegBytes);

  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    parts.push(bytes);
    pos += bytes.length;
  };

  push("%PDF-1.4\n");

  offsets[1] = pos;
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  offsets[2] = pos;
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  offsets[3] = pos;
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  );

  offsets[4] = pos;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
  );
  push(jpegBytes);
  push("\nendstream\nendobj\n");

  const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
  offsets[5] = pos;
  push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

  const xrefStart = pos;
  push("xref\n0 6\n0000000000 65535 f \n");
  for (let i = 1; i <= 5; i++) {
    push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return new Blob(parts, { type: "application/pdf" });
}
/**
 * Ouvre le PDF dans un nouvel onglet (le lecteur PDF du navigateur propose
 * alors l'enregistrement) — plus fiable que le téléchargement forcé, qui est
 * souvent ignoré silencieusement sur mobile et dans les PWA.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    // Si la fenêtre a été bloquée (rare), on retente via un lien classique.
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}