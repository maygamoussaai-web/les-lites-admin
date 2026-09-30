import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { P0 } from "./p0.ts";
import { P1 } from "./p1.ts";
import { P2 } from "./p2.ts";
const B64 = P0 + P1 + P2;
async function gunzipB64(b64: string): Promise<string> {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bin]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}
const code = await gunzipB64(B64);
await Deno.writeTextFile("/tmp/ai_full.ts", code);
await import("file:///tmp/ai_full.ts");
