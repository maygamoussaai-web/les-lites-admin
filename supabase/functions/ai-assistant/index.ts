import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * ai-assistant V41 — chargeur gzip (source monolithe compressée).
 * Contient tous les outils lecture + écriture (confirmation required).
 * UI: mon-assistant plein écran, chat style Grok (déjà sur main).
 */
const B64 = "PLACEHOLDER_WILL_REPLACE";
async function gunzipB64(b64: string): Promise<string> {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bin]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}
const code = await gunzipB64(B64);
await Deno.writeTextFile("/tmp/ai_full.ts", code);
await import("file:///tmp/ai_full.ts");
