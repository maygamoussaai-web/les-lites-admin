/**
 * Compression d'images cote navigateur.
 * - Conserve le ratio (jamais d'etirement).
 * - Option squareCrop pour les avatars (recadrage centre, pas de deformation).
 * - Qualite JPEG elevee pour rester legere sans flou visible.
 */

export type CompressOptions = {
  /** Plus grand cote max (defaut 1280). */
  maxDim?: number;
  /** Qualite JPEG 0–1 (defaut 0.88). */
  quality?: number;
  /** Si true : recadre au centre en carre puis redimensionne (photos de profil). */
  squareCrop?: boolean;
  /** Cote max du carre si squareCrop (defaut 512). */
  squareSize?: number;
};

export async function compressImage(
  file: File,
  maxDimOrOpts: number | CompressOptions = 1280,
  qualityArg = 0.88,
): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  const opts: CompressOptions =
    typeof maxDimOrOpts === "number"
      ? { maxDim: maxDimOrOpts, quality: qualityArg }
      : maxDimOrOpts;

  const maxDim = opts.maxDim ?? 1280;
  const quality = opts.quality ?? 0.88;
  const squareCrop = opts.squareCrop ?? false;
  const squareSize = opts.squareSize ?? 512;

  try {
    const bitmap = await createImageBitmap(file);
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    if (!(srcW > 0 && srcH > 0)) return file;

    let sx = 0;
    let sy = 0;
    let sw = srcW;
    let sh = srcH;
    let outW: number;
    let outH: number;

    if (squareCrop) {
      const side = Math.min(srcW, srcH);
      sx = Math.floor((srcW - side) / 2);
      sy = Math.floor((srcH - side) / 2);
      sw = side;
      sh = side;
      outW = Math.min(squareSize, side);
      outH = outW;
    } else {
      const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
      outW = Math.max(1, Math.round(srcW * scale));
      outH = Math.max(1, Math.round(srcH * scale));
    }

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
    bitmap.close?.();

    let bestBlob: Blob | null = await blobAt(canvas, quality);
    if (!bestBlob) return file;

    // Si encore trop lourd (> 400 Ko), baisser un peu la qualite sans retomber trop bas
    if (bestBlob.size > 400 * 1024 && quality > 0.7) {
      for (const q of [0.8, 0.72]) {
        const b = await blobAt(canvas, q);
        if (b && b.size < bestBlob.size) bestBlob = b;
        if (bestBlob.size <= 400 * 1024) break;
      }
    }

    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([bestBlob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function blobAt(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}
