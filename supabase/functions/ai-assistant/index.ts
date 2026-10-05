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

    const body = await req.json().catch(() => ({}));
    const message = String((body as { message?: string }).message || "").trim();
    if (!message) return jr({ ok: false, error: { code: "VALIDATION", message: "Message vide." } }, 400);

    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return jr({ ok: false, error: { code: "CONFIG", message: "GEMINI_API_KEY manquante côté Supabase." } }, 500);

    const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash-lite";
    const system = "Tu es l'assistant admin Les Élites (Niger). Réponds en français, clairement et utilement. Les outils base de données (listes élèves, archives, etc.) seront rétablis sous peu : si l'utilisateur demande une action précise sur les données, explique que la fonction est en restauration et propose ce que tu peux déjà faire (conseil, formulation, check-list).";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: system + "\n\nQuestion: " + message }] }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("gemini", r.status, t.slice(0, 300));
      return jr({ ok: false, error: { code: "UPSTREAM", message: "Erreur IA Gemini." } }, 502);
    }
    const j = await r.json();
    const reply = j?.candidates?.[0]?.content?.parts?.map((x: { text?: string }) => x.text || "").join("") || "Sans réponse.";
    return jr({ ok: true, data: { reply } });
  } catch (e) {
    console.error(e);
    return jr({ ok: false, error: { code: "INTERNAL", message: "Erreur interne." } }, 500);
  }
});
