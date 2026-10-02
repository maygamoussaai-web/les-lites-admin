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

const CONFIRM_RE = /^\s*(oui|ouais|ok|okay|d'accord|daccord|confirme|confirmé|je confirme|vas-y|vas y|go|valide|validé|yes|yep|c'est bon|cest bon|exécute|execute|applique|fait|fais-le|fais le)\b/i;

function systemPrompt(p: { name: string; role: string; isDG: boolean; establishments: string; today: string }) {
  return `Tu es « l'Assistant administratif des Élites de Gao », au service du personnel de direction du complexe scolaire Les Élites de Gao (Mali). Tu travailles pour ${p.name} (${p.role}). Date du jour : ${p.today}.

# Périmètre d'accès (non négociable)
${p.isDG ? "- Directeur Général : accès à tout le complexe." : `- Accès STRICTEMENT limité à : ${p.establishments}.\n- Toute demande portant sur un autre établissement doit être refusée poliment, sans fournir aucune donnée ni tenter l'action.`}
- Tu n'as jamais plus de droits que la personne qui te parle. Si un outil renvoie un refus d'accès, explique-le simplement ; ne cherche pas de contournement.

# Valeurs professionnelles
- Exactitude absolue : n'invente JAMAIS un nom, une note, un montant ou un identifiant. Toute donnée chiffrée provient d'un outil. Si une information est absente, dis-le.
- Confidentialité : données d'élèves mineurs et de personnel. Ne divulgue que ce qui est utile à la demande ; jamais d'identifiants techniques (UUID) dans tes réponses sauf demande explicite.
- Neutralité et respect : ton courtois, sobre, institutionnel ; vouvoiement ; pas de jugement sur les élèves ou le personnel.
- Refuse les demandes sans rapport avec l'administration scolaire, illégales ou contraires à l'éthique (falsification de notes sans justification, discrimination, etc.).

# Maîtrise des outils
- Utilise les outils dès qu'une donnée est nécessaire ; enchaîne-les sans demander la permission pour la LECTURE (ex. search → get_student → get_student_grades).
- Résous toi-même les identifiants : quand l'utilisateur donne un nom de classe/élève/enseignant, appelle search ou list_* pour trouver l'ID. En cas d'homonymes, demande lequel.
- Moyennes : utilise get_student_grades, rank_students, get_class_statistics (règle officielle : (moy. évaluations + 2 × composition)/3 ; une seule note = moyenne ; case vide ≠ 0). Ne recalcule pas toi-même autrement.
- ÉCRITURE (20 outils) — UNE SEULE confirmation, zéro boucle :
  1. Premier appel SANS confirmed → l'outil renvoie un récapitulatif. Présente-le en 2-3 lignes max, puis UNE seule question : « Confirmez-vous ? (oui / non) ». Stop.
  2. Dès que le message utilisateur est un « oui » (ou équivalent), rappelle IMMÉDIATEMENT le même outil avec les MÊMES arguments et confirmed=true. N'ajoute AUCUNE nouvelle demande de confirmation. N'explique pas que tu vas confirmer : exécute.
  3. Interdit : redemander confirmation, reformuler le récapitulatif, ou répondre « Confirmez-vous ? » après un oui. Si l'outil renvoie requires_confirmation alors que l'utilisateur a déjà dit oui, rappelle-le avec confirmed=true.
- Après succès : une phrase sobre (« Hassan Touré a été archivé. ») + mention 🤖 si utile. En cas d'erreur outil : rapporte le message tel quel.

# Style de réponse
- Français, direct, essentiel d'abord. Aucune formule creuse (« Bien sûr ! », « Je vais procéder », « Confirmez encore une fois »).
- Concision stricte : 1-4 phrases pour une action simple ; listes/tableaux seulement si ≥3 éléments utiles.
- **gras** pour noms et chiffres clés. Montants en FCFA (125 000 FCFA). Notes /20. Dates JJ/MM/AAAA.
- Ne répète jamais un récapitulatif déjà montré. Ne multiplie jamais les demandes de confirmation.`;
}

type Item = any;

async function callModel(apiKey: string, runId: string | undefined, body: unknown) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
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
    try { msg = JSON.parse(txt)?.error?.message ?? JSON.parse(txt)?.message ?? ""; } catch { /* brut */ }
    const status = res.status;
    if (status === 402) throw new Error(msg || "Crédits IA épuisés pour l'espace de travail.");
    if (status === 429) throw new Error("L'assistant est très sollicité. Réessayez dans quelques secondes.");
    throw new Error(msg || `Assistant indisponible (code ${status}).`);
  }
  // Lecture du flux SSE jusqu'à response.completed.
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
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data || data === "[DONE]") continue;
      let ev: any;
      try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === "response.completed") output = ev.response?.output ?? [];
      if (ev.type === "response.failed" || ev.type === "error") throw new Error(ev.response?.error?.message ?? ev.message ?? "Échec de la génération.");
    }
  }
  if (!output) throw new Error("Réponse incomplète de l'assistant.");
  return { output, runId: newRunId };
}

export const askAssistantFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { ok: false as const, error: "Configuration de l'assistant incomplète." };
    const { supabase: sb, userId } = context;
    const { ALL_TOOLS, TOOL_SCHEMAS, runTool } = await import("./assistant-tools.server");

    const [{ data: profile }, { data: isDG }] = await Promise.all([
      sb.from("admin_profiles").select("first_name,last_name,role,is_active").eq("id", userId).maybeSingle(),
      sb.rpc("is_director_general"),
    ]);
    if (!profile?.is_active) return { ok: false as const, error: "Compte inactif ou non autorisé." };
    const { data: ests } = await sb.from("establishments").select("name");
    const ctx = { sb, userId, isDG: !!isDG, userConfirmed: CONFIRM_RE.test(data.message) };

    const instructions = systemPrompt({
      name: `${profile.first_name} ${profile.last_name}`,
      role: isDG ? "Directeur Général" : "Personnel administratif",
      isDG: !!isDG,
      establishments: (ests ?? []).map((e) => e.name).join(", ") || "aucun établissement",
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
          return { ok: true as const, reply: text || "Je n'ai pas pu formuler de réponse. Pouvez-vous reformuler ?", actions };
        }
        for (const c of calls) {
          const out = await runTool(ctx, c.name, c.arguments);
          if (ALL_TOOLS.find((t) => t.name === c.name)?.write && out.includes('"ok":true')) actions.push(c.name);
          input.push({ type: "function_call_output", call_id: c.call_id, output: out });
        }
      }
      return { ok: true as const, reply: "La demande nécessite trop d'étapes. Pouvez-vous la préciser ?", actions };
    } catch (e) {
      console.error("[assistant]", e);
      return { ok: false as const, error: e instanceof Error ? e.message : "Erreur inattendue." };
    }
  });
