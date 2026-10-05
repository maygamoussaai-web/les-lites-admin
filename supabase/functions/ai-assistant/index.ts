import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const jr = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") || "";
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: ud } = await sb.auth.getUser();
    if (!ud?.user) return jr({ ok: false, error: { code: "UNAUTHENTICATED", message: "Session non authentifiée." } }, 401);
    const { data: p } = await sb.from("admin_profiles").select("id,is_active").eq("id", ud.user.id).maybeSingle();
    if (!p?.is_active) return jr({ ok: false, error: { code: "FORBIDDEN", message: "Compte inactif." } }, 403);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const message = String(body.message || "").trim();
    if (!message) return jr({ ok: false, error: { code: "VALIDATION", message: "Message vide." } }, 400);

    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return jr({ ok: false, error: { code: "CONFIG", message: "GEMINI_API_KEY manquante côté Supabase." } }, 500);

    const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash-lite";
    const system = [
      "Tu es l'assistant admin professionnel de Les Élites.",
      "Réponds en français, de façon claire, concise et utile.",
      "Tu aides sur la gestion scolaire (classes, élèves, enseignants, finances, bulletins).",
      "Les outils base de données (43 outils) sont en cours de restauration technique :",
      "si l'utilisateur demande une action précise sur les données (liste, archive, note),",
      "explique brièvement la limite temporaire et propose une check-list ou la formulation exacte à faire dans l'interface.",
    ].join(" ");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: system + "\n\nMessage: " + message }] }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("gemini", r.status, t.slice(0, 300));
      return jr({ ok: false, error: { code: "UPSTREAM", message: "Erreur IA Gemini." } }, 502);
    }
    const j = await r.json();
    const reply =
      j?.candidates?.[0]?.content?.parts?.map((x: { text?: string }) => x.text || "").join("") ||
      "Sans réponse.";
    return jr({ ok: true, data: { reply } });
  } catch (e) {
    console.error(e);
    return jr({ ok: false, error: { code: "INTERNAL", message: "Erreur interne." } }, 500);
  }
});
