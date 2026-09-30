import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { C0 } from "./c0.ts";
import { C1 } from "./c1.ts";
import { C2 } from "./c2.ts";
import { C3 } from "./c3.ts";
import { C4 } from "./c4.ts";
import { C5 } from "./c5.ts";
const B64 = C0 + C1 + C2 + C3 + C4 + C5;
async function gunzipB64(b64: string): Promise<string> {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bin]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}
const code = await gunzipB64(B64);
await Deno.writeTextFile("/tmp/ai_full.ts", code);
await import("file:///tmp/ai_full.ts");
