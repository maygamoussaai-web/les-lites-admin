/**
 * ai-assistant — stub GitHub (volontairement minimal).
 *
 * Production = coller le monolithe COMPLET dans Supabase Dashboard
 * (fichier ai-assistant-index-FULL-RESTORE.ts / DEPLOY_AI_ASSISTANT_v151.ts).
 *
 * Ce stub évite un crash runtime (export {} sans Deno.serve).
 * Il répond toujours avec un message clair tant que le monolithe n'est pas déployé.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const jr = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return jr({ ok: false, error: { code: "VALIDATION", message: "Méthode non autorisée." } }, 405);
  }

  try {
    const authH = req.headers.get("Authorization") ?? "";
    if (!authH.toLowerCase().startsWith("bearer ")) {
      return jr({ ok: false, error: { code: "UNAUTHENTICATED", message: "Session non authentifiée." } }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!url || !anon) {
      return jr({ ok: false, error: { code: "CONFIG", message: "Config Supabase incomplète." } }, 500);
    }

    const sb = createClient(url, anon, {
      global: { headers: { Authorization: authH } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: ud, error: ue } = await sb.auth.getUser();
    if (ue || !ud?.user) {
      return jr({ ok: false, error: { code: "UNAUTHENTICATED", message: "Session invalide." } }, 401);
    }

    // Stub : le monolithe v151 n'est pas déployé sur cette instance.
    return jr({
      ok: true,
      data: {
        reply:
          "L'assistant n'est pas encore déployé en version complète sur Supabase. " +
          "Ouvre le Dashboard Supabase → Edge Functions → ai-assistant → déploie le fichier monolithe " +
          "(ai-assistant-index-FULL-RESTORE.ts, ~134 Ko). Ensuite réessaie.",
      },
    });
  } catch (e) {
    console.error(e);
    return jr({ ok: false, error: { code: "INTERNAL", message: "Erreur interne (stub)." } }, 500);
  }
});
