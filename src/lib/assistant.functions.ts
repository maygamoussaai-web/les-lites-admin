/**
 * Assistant IA — boucle outils côté serveur (Lovable AI Gateway, API Responses).
 *
 * NOTE POUR CLAUDE:
 * - Remplace l'ancienne Edge Function compressée (supabase/functions/ai-assistant).
 * - Le client Supabase utilisé est celui de l'utilisateur (requireSupabaseAuth) :
 *   l'IA hérite EXACTEMENT des droits RLS de la personne connectée.
 * - Les outils sont dans assistant-tools.server.ts ; ce fichier ne fait que
 *   l'orchestration (prompt, appels modèle, exécution des outils).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(40)
    .default([]),
});

const CONFIRM_RE = new RegExp(
  "^\\s*(oui|ouais|ok|okay|d'accord|daccord|confirme|confirm\\u00e9|je confirme|vas-y|vas y|go|valide|valid\\u00e9|yes|yep|c'est bon|cest bon|ex\\u00e9cute|execute|applique|fait|fais-le|fais le)\\b",
  "i",
);

function systemPrompt(p: { name: string; role: string; isDG: boolean; establishments: string; today: string }) {
  const scope = p.isDG
    ? "- Directeur General : acces a tout le complexe."
    : "- Acces STRICTEMENT limite a : " + p.establishments + ". Toute demande portant sur un autre etablissement doit etre refusee poliment, sans fournir aucune donnee ni tenter l'action.";
  return [
    "Tu es l'Assistant administratif des Elites de Gao, au service du personnel de direction du complexe scolaire Les Elites de Gao (Mali). Tu travailles pour " + p.name + " (" + p.role + "). Date du jour : " + p.today + ".",
    "",
    "# Perimetre d'acces (non negociable)",
    scope,
    "- Tu n'as jamais plus de droits que la personne qui te parle. Si un outil renvoie un refus d'acces, explique-le simplement ; ne cherche pas de contournement.",
    "",
    "# Valeurs professionnelles",
    "- Exactitude absolue : n'invente JAMAIS un nom, une note, un montant ou un identifiant. Toute donnee chiffree provient d'un outil. Si une information est absente, dis-le.",
    "- Confidentialite : donnees d'eleves mineurs et de personnel. Ne divulgue que ce qui est utile a la demande ; jamais d'identifiants techniques (UUID) dans tes reponses sauf demande explicite.",
    "- Neutralite et respect : ton courtois, sobre, institutionnel ; vouvoiement ; pas de jugement sur les eleves ou le personnel.",
    "- Refuse les demandes sans rapport avec l'administration scolaire, illegales ou contraires a l'ethique.",
    "",
    "# Maitrise des outils",
    "- Utilise les outils des qu'une donnee est necessaire ; enchaine-les sans demander la permission pour la LECTURE.",
    "- Resous toi-meme les identifiants : quand l'utilisateur donne un nom, appelle search ou list_* pour trouver l'ID. En cas d'homonymes, demande lequel.",
    "- Moyennes : utilise get_student_grades, rank_students, get_class_statistics. Ne recalcule pas toi-meme autrement.",
    "- ECRITURE : UNE SEULE confirmation, zero boucle.",
    "  1. Premier appel SANS confirmed : l'outil renvoie un recapitulatif. Presente-le en 2-3 lignes max, puis UNE seule question : Confirmez-vous ? (oui / non). Stop.",
    "  2. Des que le message utilisateur est un oui (ou equivalent), rappelle IMMEDIATEMENT le meme outil avec les MEMES arguments et confirmed=true. N'ajoute AUCUNE nouvelle demande de confirmation.",
    "  3. Interdit : redemander confirmation apres un oui. Si l'outil renvoie requires_confirmation alors que l'utilisateur a deja dit oui, rappelle-le avec confirmed=true.",
    "- Apres succes : une phrase sobre. En cas d'erreur outil : rapporte le message tel quel.",
    "",
    "# Style de reponse",
    "- Francais, direct, essentiel d'abord. Aucune formule creuse.",
    "- Concision stricte : 1-4 phrases pour une action simple ; listes seulement si au moins 3 elements utiles.",
    "- Gras markdown pour noms et chiffres cles. Montants en FCFA. Notes /20. Dates JJ/MM/AAAA.",
    "- Ne repete jamais un recapitulatif deja montre. Ne multiplie jamais les demandes de confirmation.",
  ].join("\n");
}

type Item = any;

async function callModel(apiKey: string, runId: string | undefined, body: unknown) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
      ...(runId ? { "X-Lovable-AIG-Run-ID": runId } : {}),
    },
    body: JSON.stringify(body),
  });
  const newRunId = res.headers.get("X-Lovable-AIG-Run-ID") ?? runId;
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    let msg = "";
    try {
      const parsed = JSON.parse(txt);
      msg = parsed?.error?.message ?? parsed?.message ?? "";
    } catch {
      /* brut */
    }
    const status = res.status;
    if (status === 402) throw new Error(msg || "Credits IA epuises pour l'espace de travail.");
    if (status === 429) throw new Error("L'assistant est tres sollicite. Reessayez dans quelques secondes.");
    throw new Error(msg || ("Assistant indisponible (code " + status + ")."));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let output: Item[] | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!data || data === "[DONE]") continue;
      let ev: any;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      if (ev.type === "response.completed") output = ev.response?.output ?? [];
      if (ev.type === "response.failed" || ev.type === "error") {
        throw new Error(ev.response?.error?.message ?? ev.message ?? "Echec de la generation.");
      }
    }
  }
  if (!output) throw new Error("Reponse incomplete de l'assistant.");
  return { output, runId: newRunId };
}

export const askAssistantFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { ok: false as const, error: "Configuration de l'assistant incomplete." };
    const { supabase: sb, userId } = context;
    const { ALL_TOOLS, TOOL_SCHEMAS, runTool } = await import("./assistant-tools.server");

    const [{ data: profile }, { data: isDG }] = await Promise.all([
      sb.from("admin_profiles").select("first_name,last_name,role,is_active").eq("id", userId).maybeSingle(),
      sb.rpc("is_director_general"),
    ]);
    if (!profile?.is_active) return { ok: false as const, error: "Compte inactif ou non autorise." };
    const { data: ests } = await sb.from("establishments").select("name");
    const ctx = { sb, userId, isDG: !!isDG, userConfirmed: CONFIRM_RE.test(data.message) };

    const instructions = systemPrompt({
      name: (profile.first_name || "") + " " + (profile.last_name || ""),
      role: isDG ? "Directeur General" : "Personnel administratif",
      isDG: !!isDG,
      establishments: (ests ?? []).map((e) => e.name).join(", ") || "aucun etablissement",
      today: new Date().toLocaleDateString("fr-FR", { timeZone: "Africa/Bamako" }),
    });

    const input: Item[] = [...data.history.slice(-30), { role: "user", content: data.message }];
    let runId: string | undefined;
    const actions: string[] = [];
    try {
      for (let step = 0; step < 10; step++) {
        const r = await callModel(apiKey, runId, {
          model: "openai/gpt-6-astra",
          instructions,
          input,
          tools: TOOL_SCHEMAS,
          stream: true,
          store: false,
          reasoning: { effort: "low" },
          include: ["reasoning.encrypted_content"],
        });
        runId = r.runId;
        input.push(...r.output);
        const calls = r.output.filter((o: Item) => o.type === "function_call");
        if (!calls.length) {
          const text = r.output
            .filter((o: Item) => o.type === "message")
            .flatMap((o: Item) => o.content ?? [])
            .filter((c: Item) => c.type === "output_text")
            .map((c: Item) => c.text)
            .join("\n")
            .trim();
          return { ok: true as const, reply: text || "Je n'ai pas pu formuler de reponse. Pouvez-vous reformuler ?", actions };
        }
        for (const c of calls) {
          let toolArgs = c.arguments;
          if (ctx.userConfirmed) {
            try {
              const parsed = toolArgs ? JSON.parse(toolArgs) : {};
              if (typeof parsed === "object" && parsed) {
                parsed.confirmed = true;
                toolArgs = JSON.stringify(parsed);
              }
            } catch {
              /* keep original args */
            }
          }
          const out = await runTool(ctx, c.name, toolArgs);
          if (ALL_TOOLS.find((t) => t.name === c.name)?.write && out.includes('"ok":true')) actions.push(c.name);
          input.push({ type: "function_call_output", call_id: c.call_id, output: out });
        }
      }
      return { ok: true as const, reply: "La demande necessite trop d'etapes. Pouvez-vous la preciser ?", actions };
    } catch (e) {
      console.error("[assistant]", e);
      return { ok: false as const, error: e instanceof Error ? e.message : "Erreur inattendue." };
    }
  });
}
