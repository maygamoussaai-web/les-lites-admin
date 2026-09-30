import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

let handler: ((req: Request) => Promise<Response>) | null = null;

async function ensureLoaded() {
  if (handler) return;
  const BASE = "https://raw.githubusercontent.com/maygamoussaai-web/les-lites-admin/main/supabase/functions/ai-assistant";
  const parts = await Promise.all([0,1,2,3,4,5].map(async (i) => {
    const res = await fetch(`${BASE}/c${i}.ts`);
    if (!res.ok) throw new Error(`fetch c${i}: ${res.status}`);
    const text = await res.text();
    const m = text.match(/"([^"]+)"/);
    if (!m) throw new Error(`no payload c${i}`);
    return m[1];
  }));
  const b64 = parts.join("");
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bin]).stream().pipeThrough(ds);
  const code = await new Response(stream).text();
  await Deno.writeTextFile("/tmp/ai_full.ts", code);
  const origServe = Deno.serve;
  let captured: ((req: Request) => Promise<Response> | Response) | null = null;
  // @ts-ignore
  Deno.serve = (h: typeof captured) => { captured = h; return { finished: Promise.resolve() }; };
  await import("file:///tmp/ai_full.ts");
  // @ts-ignore
  Deno.serve = origServe;
  if (!captured) throw new Error("No handler captured");
  handler = async (req: Request) => {
    const r = captured!(req);
    return r instanceof Promise ? await r : r;
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  try {
    await ensureLoaded();
    return await handler!(req);
  } catch (e) {
    console.error("loader error", e);
    return new Response(JSON.stringify({ ok: false, error: { code: "LOADER", message: String(e) } }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
