/**
 * PROTOCOL-FIXED snapshot (2026-10-06)
 * Corrige la boucle de confirmation (pendingByUser + isAffirmative).
 *
 * NE PAS utiliser comme entrypoint Edge automatique.
 * Déploiement : coller le contenu décodé dans le Dashboard Supabase.
 *
 * Décodage (Node) :
 *   const fs=require("fs");const zlib=require("zlib");
 *   const b64=fs.readFileSync("PROTOCOL-FIXED.b64.gz.txt","utf8");
 *   fs.writeFileSync("index.ts", zlib.gunzipSync(Buffer.from(b64,"base64")));
 *
 * Ou utiliser le fichier local fourni dans le chat : ai-assistant-PROTOCOL-FIXED.ts
 *
 * Le source complet est aussi dans PROTOCOL-FIXED.b64.gz.txt (même commit).
 */
export const NOTE = "Voir PROTOCOL-FIXED.b64.gz.txt et README.md — source de vérité Dashboard Supabase.";
