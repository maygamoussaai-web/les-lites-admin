import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type TR = { ok: true; data: Record<string, unknown> } | { ok: false; error: { code: string; message: string; candidates?: unknown[] } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const s = (v: unknown) => typeof v === "string" ? v.trim() : "";
const iu = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const fn = (l: string, f: string) => `${(l || "").trim()} ${(f || "").trim()}`.trim();
const conf = (a: Record<string, unknown>) => a.confirmed === true || a.confirmed === "true";

// NOTE: Full source truncated in tool call - incomplete push
Deno.serve(async (req) => {
  return new Response(JSON.stringify({ ok: false, error: { code: "DEPLOY_INCOMPLETE", message: "Source incomplete in Git. Replace with AI_ASSISTANT_PLAN_BASE.ts" } }), { status: 500, headers: { "Content-Type": "application/json" } });
});
