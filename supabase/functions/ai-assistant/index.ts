import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BASE = "https://raw.githubusercontent.com/maygamoussaai-web/les-lites-admin/feature/gemini-assistant/supabase/functions/ai-assistant";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

let boot: Promise<(req: Request) => Promise<Response>> | null = null;

function loadHandler() {
  if (!boot) {
    boot = (async () => {
      const parts: string[] = [];
      for (let i = 0; i < 8; i++) {
        const res = await fetch(`${BASE}/c${i}.ts`);
        if (!res.ok) throw new Error(`chunk c${i} HTTP ${res.status}`);
        const text = await res.text();
        const m = text.match(/export const C\d+\s*=\s*"((?:[^"\\]|\\.)*)"/);
        if (!m) throw new Error(`chunk c${i} illisible`);
        parts.push(m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
      }
      const bin = Uint8Array.from(atob(parts.join("")), (c) => c.charCodeAt(0));
      const ds = new DecompressionStream("gzip");
      const buf = await new Response(new Blob([bin]).stream().pipeThrough(ds)).arrayBuffer();
      let code = new TextDecoder().decode(buf);
      if (!code.includes("list_capabilities")) throw new Error("payload incomplet");
      code = code.replace("Deno.serve(async (req) =>", "globalThis.__aiHandler = async (req) =>");
      const url = URL.createObjectURL(new Blob([code], { type: "application/typescript" }));
      try {
        await import(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const handler = (globalThis as { __aiHandler?: (req: Request) => Promise<Response> }).__aiHandler;
      if (!handler) throw new Error("handler absent");
      return handler;
    })().catch((e) => {
      boot = null;
      throw e;
    });
  }
  return boot;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const handler = await loadHandler();
    const res = await handler(req);
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    const message = e instanceof Error ? e.message : "boot failed";
    console.error("ai-assistant boot", message);
    return new Response(JSON.stringify({ ok: false, error: { code: "BOOT", message } }), { status: 500, headers: CORS });
  }
});
