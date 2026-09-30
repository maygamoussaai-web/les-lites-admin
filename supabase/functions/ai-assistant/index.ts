import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * ai-assistant V41 — chargeur gzip (source monolithe compressée).
 * Contient tous les outils lecture + écriture (confirmation required).
 * UI: mon-assistant plein écran, chat style Grok (déjà sur main).
 *
 * NOTE: Le payload B64 est injecté au prochain commit si ce fichier est un stub.
 * Pour déploiement immédiat, utiliser le déploiement Supabase MCP avec DEPLOY_V41.ts.
 */
const B64 = "H4sIAI8vvWoC/+1923LcRrLgu76i3GF7uu0mSMl2nBnSMg8tUTbPkUitSM2JCa22BaKrm5DQQBNAU6Q5"; // truncated intentionally - will fix
async function gunzipB64(b64: string): Promise<string> {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bin]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}
console.error("V41 loader incomplete in git — deploy DEPLOY_V41.ts via Supabase dashboard or MCP");
Deno.serve(() => new Response(JSON.stringify({ ok: false, error: { code: "INTERNAL", message: "Source incomplete. Redeploy V41." } }), { status: 500, headers: { "Content-Type": "application/json" } }));
