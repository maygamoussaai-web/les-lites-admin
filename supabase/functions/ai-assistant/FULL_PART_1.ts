import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type TR = { ok: true; data: Record<string, unknown> } | { ok: false; error: { code: string; message: string; candidates?: unknown[]; confirm_token?: string; expires_at?: string; tool?: string } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const s = (v: unknown) => typeof v === "string" ? v.trim() : "";
const iu = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const fn = (l: string, f: string) => `${(l || "").trim()} ${(f || "").trim()}`.trim();
const conf = (a: Record<string, unknown>) => a.confirmed === true || a.confirmed === "true";

/** Confirmation liée outil+params+user — token HMAC one-shot, expire 10 min. */
function confirmSecret(): string {
  const s = Deno.env.get("CONFIRM_SECRET") || Deno.env.get("SUPABASE_ANON_KEY");
  if (!s) throw new Error("CONFIRM_SECRET ou SUPABASE_ANON_KEY requis pour les confirmations WRITE");
  return s + "|ai-assistant-v1";
}
async function hmacHex(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(confirmSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function stableParams(a: Record<string, unknown>): string {
  const skip = new Set(["confirmed", "confirm_token"]);
  const keys = Object.keys(a).filter((k) => !skip.has(k)).sort();
  const o: Record<string, unknown> = {};
  for (const k of keys) {
    const v = a[k];
    if (v === undefined || v === null || v === "") continue;
    o[k] = v;
  }
  return JSON.stringify(o);
}
const consumedTokens = new Set<string>();

function establishmentHint(a: Record<string, unknown>): string {
  for (const k of ["establishment_id", "to_establishment_id", "from_establishment_id"]) {
    const v = a[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

async function issueConfirmToken(userId: string, tool: string, a: Record<string, unknown>): Promise<{ token: string; expires_at: string }> {
  const exp = Date.now() + 10 * 60 * 1000;
  const nonce = crypto.randomUUID();
  const eid = establishmentHint(a);
  const payload = `${userId}|${tool}|${eid}|${stableParams(a)}|${exp}|${nonce}`;
  const sig = await hmacHex(payload);
  return { token: `${exp}.${nonce}.${sig}`, expires_at: new Date(exp).toISOString() };
}
async function verifyConfirmToken(userId: string, tool: string, a: Record<string, unknown>, token: unknown): Promise<boolean> {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expS, nonce, sig] = parts;
  const exp = Number(expS);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  if (consumedTokens.has(token)) return false;
  const eid = establishmentHint(a);
  const payload = `${userId}|${tool}|${eid}|${stableParams(a)}|${exp}|${nonce}`;
  const expect = await hmacHex(payload);
  if (expect.length !== sig.length) return false;
  let ok = 0;
  for (let i = 0; i < expect.length; i++) ok |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  if (ok !== 0) return false;
  consumedTokens.add(token);
  if (consumedTokens.size > 500) {
    const first = consumedTokens.values().next().value;
    if (first) consumedTokens.delete(first);
  }
  return true;
}
async function requireWrite(
  sb: SupabaseClient,
  tool: string,
  a: Record<string, unknown>,
): Promise<TR | null> {
  const { data: ud } = await sb.auth.getUser();
  const uid = ud?.user?.id ?? "";
  if (conf(a)) {
    if (await verifyConfirmToken(uid, tool, a, a.confirm_token)) return null;
    return {
      ok: false,
      error: {
        code: "CONFIRMATION_REQUIRED",
        message: "Confirmation invalide ou expirée. Redemandez l'action puis confirmez par « oui ».",
      },
    };
  }
  const { token, expires_at } = await issueConfirmToken(uid, tool, a);
  return {
    ok: false,
    error: {
      code: "CONFIRMATION_REQUIRED",
      message: "Confirmation requise. Répondez « oui » ; l'outil sera rappelé avec confirmed=true et le confirm_token fourni.",
      confirm_token: token,
      expires_at,
      tool,
    },
  };
}

// ... PARTIE 1 incomplete in this push - use artifacts download instead
