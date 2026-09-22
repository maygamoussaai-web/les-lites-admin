/**
 * Genere un PDF d'une page a partir d'une image JPEG, a la main, sans
 * dependance externe. Fonctionne entierement dans le navigateur.
 */
function readJpegSize(data: Uint8Array): { width: number; height: number } {
  const at = (i: number) => data[i] ?? 0;
  let offset = 2;
  while (offset < data.length - 8) {
    if (at(offset) !== 0xff) {
      offset++;
      continue;
    }
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

function assemblePdf(jpegBytes: Uint8Array, width: number, height: number): Blob {
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

  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

export async function imageToPdfBlob(imageUrl: string): Promise<Blob> {
  const res = await fetch(imageUrl);
  const jpegBytes = new Uint8Array(await res.arrayBuffer());
  const { width, height } = readJpegSize(jpegBytes);
  return assemblePdf(jpegBytes, width, height);
}

export async function canvasToPdfBlob(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Generation de l'image echouee"))), "image/jpeg", quality),
  );
  const jpegBytes = new Uint8Array(await blob.arrayBuffer());
  return assemblePdf(jpegBytes, canvas.width, canvas.height);
}

/**
 * Téléchargement forcé d’un Blob (xlsx, pdf, images…).
 * Gère desktop + iOS/Android (où l’attribut download est souvent ignoré).
 */
export function downloadBlob(blob: Blob, filename: string) {
  const name = (filename || "document").replace(/[\\/:*?"<>|]+/g, "_").trim() || "document";

  const nav = window.navigator as Navigator & {
    msSaveOrOpenBlob?: (b: Blob, n: string) => void;
  };
  if (typeof nav.msSaveOrOpenBlob === "function") {
    nav.msSaveOrOpenBlob(blob, name);
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.target = "_blank";
  a.style.display = "none";
  document.body.appendChild(a);

  try {
    a.click();
  } catch {
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }
  a.remove();

  const ua = navigator.userAgent || "";
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) {
    setTimeout(() => {
      const w = window.open(url, "_blank");
      if (!w) {
        window.location.assign(url);
      }
    }, 120);
  }

  setTimeout(() => URL.revokeObjectURL(url), 90_000);
}

/** Ouvre un Blob dans un nouvel onglet (aperçu PDF / image). */
export function openBlobInNewTab(blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return !!w;
}
