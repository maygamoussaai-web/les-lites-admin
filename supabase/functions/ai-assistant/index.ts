import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const jr = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

const MODELS = [...new Set([
  Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
])];

const SYSTEM = `Tu es l'assistant admin professionnel de Les Élites.
Français, concis, professionnel. Pas de formules vides.
LECTURE : utilise les outils list_*/get_*/search dès qu'une donnée est demandée.
ÉCRITURE : confirme toujours avant d'agir (l'utilisateur doit dire oui).
Cite toujours une classe par son nom, jamais par son identifiant. Pour les effectifs par classe, utilise list_classes (champ eleves_actifs).
Ne révèle jamais de secrets ni de clés API.`;

type Content = { role: string; parts: { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: unknown } }[] };

const TOOLS = [
  { name: "list_capabilities", description: "Liste les capacités de l'assistant", parameters: { type: "object", properties: {}, required: [] as string[] } },
  { name: "get_complex_overview", description: "Synthèse du complexe scolaire", parameters: { type: "object", properties: {}, required: [] as string[] } },
  { name: "list_students", description: "Liste les élèves", parameters: { type: "object", properties: { query: { type: "string" }, class_name: { type: "string" }, include_archived: { type: "boolean" }, limit: { type: "number" } }, required: [] as string[] } },
  { name: "search", description: "Recherche unifiée élèves, classes, enseignants", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "list_classes", description: "Liste les classes", parameters: { type: "object", properties: { include_archived: { type: "boolean" } }, required: [] as string[] } },
  { name: "list_teachers", description: "Liste les enseignants", parameters: { type: "object", properties: { query: { type: "string" } }, required: [] as string[] } },
  { name: "get_class_statistics", description: "Statistiques d'une classe", parameters: { type: "object", properties: { class_name: { type: "string" }, class_id: { type: "string" } }, required: [] as string[] } },
  { name: "rank_students", description: "Classement des élèves d'une classe", parameters: { type: "object", properties: { class_name: { type: "string" }, class_id: { type: "string" }, period_number: { type: "number" } }, required: [] as string[] } },
  { name: "list_audit_logs", description: "Derniers logs d'audit", parameters: { type: "object", properties: { limit: { type: "number" } }, required: [] as string[] } },
];

async function auth(sb: SupabaseClient) {
  const { data: ud } = await sb.auth.getUser();
  if (!ud?.user) return { ok: false as const, error: { code: "UNAUTHENTICATED", message: "Session non authentifiée." } };
  const { data: p } = await sb.from("admin_profiles").select("id,is_active").eq("id", ud.user.id).maybeSingle();
  if (!p?.is_active) return { ok: false as const, error: { code: "FORBIDDEN", message: "Compte inactif." } };
  return null;
}

async function runTool(sb: SupabaseClient, name: string, args: Record<string, unknown>) {
  try {
    switch (name) {
      case "list_capabilities":
        return { ok: true, data: { lecture: TOOLS.map((t) => t.name) } };
      case "get_complex_overview": {
        const [{ count: students }, { count: classes }, { count: teachers }] = await Promise.all([
          sb.from("students").select("id", { count: "exact", head: true }).is("archived_at", null),
          sb.from("classes").select("id", { count: "exact", head: true }).eq("is_active", true),
          sb.from("teachers").select("id", { count: "exact", head: true }),
        ]);
        return { ok: true, data: { eleves_actifs: students ?? 0, classes_actives: classes ?? 0, enseignants: teachers ?? 0 } };
      }
      case "list_students": {
        let q = sb.from("students").select("id,first_name,last_name,class_id,archived_at,date_of_birth,classes(name)").order("last_name").limit(Number(args.limit) || 500);
        if (args.include_archived !== true) q = q.is("archived_at", null);
        const { data, error } = await q;
        if (error) return { ok: false, error: { code: "DB", message: error.message } };
        let rows = data ?? [];
        const query = String(args.query || "").trim().toLowerCase();
        if (query) rows = rows.filter((r) => `${r.last_name} ${r.first_name}`.toLowerCase().includes(query));
        return { ok: true, data: { count: rows.length, students: rows } };
      }
      case "list_classes": {
        // NOTE POUR CLAUDE: la table classes n'a ni level ni archived_at ; archivée = is_active false.
        let q = sb.from("classes").select("id,name,capacity,is_active,establishments(name)").order("name");
        if (args.include_archived !== true) q = q.eq("is_active", true);
        const { data, error } = await q;
        if (error) return { ok: false, error: { code: "DB", message: error.message } };
        const { data: st } = await sb.from("students").select("class_id").is("archived_at", null).limit(5000);
        const counts = new Map<string, number>();
        for (const r of st ?? []) if (r.class_id) counts.set(r.class_id, (counts.get(r.class_id) ?? 0) + 1);
        // deno-lint-ignore no-explicit-any
        const classes = (data ?? []).map((c: any) => ({ id: c.id, nom: String(c.name).trim(), etablissement: c.establishments?.name ?? null, capacite: c.capacity, archivee: !c.is_active, eleves_actifs: counts.get(c.id) ?? 0 }));
        return { ok: true, data: { classes } };
      }
      case "list_teachers": {
        const { data, error } = await sb.from("teachers").select("id,first_name,last_name").order("last_name").limit(50);
        if (error) return { ok: false, error: { code: "DB", message: error.message } };
        let rows = data ?? [];
        const query = String(args.query || "").trim().toLowerCase();
        if (query) rows = rows.filter((r) => `${r.last_name} ${r.first_name}`.toLowerCase().includes(query));
        return { ok: true, data: { teachers: rows } };
      }
      case "search": {
        const query = String(args.query || "").trim();
        if (!query) return { ok: false, error: { code: "VALIDATION", message: "query requis" } };
        const q = query.toLowerCase();
        const [{ data: st }, { data: cl }, { data: te }] = await Promise.all([
          sb.from("students").select("id,first_name,last_name").is("archived_at", null).limit(30),
          sb.from("classes").select("id,name").eq("is_active", true).limit(50),
          sb.from("teachers").select("id,first_name,last_name").limit(20),
        ]);
        return {
          ok: true,
          data: {
            students: (st ?? []).filter((r) => `${r.last_name} ${r.first_name}`.toLowerCase().includes(q)),
            classes: (cl ?? []).filter((r) => String(r.name).toLowerCase().includes(q)),
            teachers: (te ?? []).filter((r) => `${r.last_name} ${r.first_name}`.toLowerCase().includes(q)),
          },
        };
      }
      case "get_class_statistics": {
        const className = String(args.class_name || "").trim();
        let classId = String(args.class_id || "").trim();
        if (!classId && className) {
          const { data } = await sb.from("classes").select("id,name").ilike("name", `%${className}%`).eq("is_active", true).limit(5);
          if (!data?.length) return { ok: false, error: { code: "NOT_FOUND", message: "Classe introuvable" } };
          if (data.length > 1) return { ok: false, error: { code: "AMBIGUOUS", message: "Plusieurs classes", candidates: data } };
          classId = data[0].id;
        }
        if (!classId) return { ok: false, error: { code: "VALIDATION", message: "class_name ou class_id requis" } };
        const { count } = await sb.from("students").select("id", { count: "exact", head: true }).eq("class_id", classId).is("archived_at", null);
        const { data: cn } = await sb.from("classes").select("name").eq("id", classId).maybeSingle();
        return { ok: true, data: { class_id: classId, classe: cn?.name?.trim() ?? null, eleves_actifs: count ?? 0 } };
      }
      case "rank_students": {
        const className = String(args.class_name || "").trim();
        let classId = String(args.class_id || "").trim();
        if (!classId && className) {
          const { data } = await sb.from("classes").select("id,name").ilike("name", `%${className}%`).eq("is_active", true).limit(5);
          if (!data?.length) return { ok: false, error: { code: "NOT_FOUND", message: "Classe introuvable" } };
          classId = data[0].id;
        }
        if (!classId) return { ok: false, error: { code: "VALIDATION", message: "class_name ou class_id requis" } };
        const { data: periods } = await sb.from("grade_periods").select("id,period_number").eq("class_id", classId).order("period_number", { ascending: false }).limit(3);
        const pid = periods?.[0]?.id;
        if (!pid) return { ok: true, data: { ranking: [], message: "Aucune période" } };
        const { data: cards } = await sb.from("student_report_cards").select("student_id,general_average").eq("class_id", classId).eq("period_id", pid);
        const { data: studs } = await sb.from("students").select("id,first_name,last_name").eq("class_id", classId).is("archived_at", null);
        const names = new Map((studs ?? []).map((s) => [s.id, `${s.last_name} ${s.first_name}`]));
        const ranking = (cards ?? [])
          .map((c) => ({ name: names.get(c.student_id) || c.student_id, average: c.general_average }))
          .sort((a, b) => Number(b.average ?? 0) - Number(a.average ?? 0))
          .slice(0, 30);
        return { ok: true, data: { period_number: periods?.[0]?.period_number, ranking } };
      }
      case "list_audit_logs": {
        const { data, error } = await sb.from("audit_logs").select("id,action,created_at,entity_type").order("created_at", { ascending: false }).limit(Number(args.limit) || 15);
        if (error) return { ok: false, error: { code: "DB", message: error.message } };
        return { ok: true, data: { logs: data ?? [] } };
      }
      default:
        return { ok: false, error: { code: "UNKNOWN_TOOL", message: name } };
    }
  } catch (e) {
    return { ok: false, error: { code: "INTERNAL", message: e instanceof Error ? e.message : "erreur" } };
  }
}

function decls() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

async function callGemini(key: string, contents: Content[]) {
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents,
          tools: [{ functionDeclarations: decls() }],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        }),
      });
      if (!res.ok) {
        console.error("gemini", model, res.status, (await res.text()).slice(0, 200));
        continue;
      }
      return await res.json();
    } catch (e) {
      console.error("gemini fetch", model, e);
    }
  }
  return null;
}

function extract(j: { candidates?: { content?: { parts?: { text?: string; thought?: boolean; functionCall?: { name: string; args?: Record<string, unknown> } }[] } }[] }) {
  const parts = j?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text || "").join("").trim();
  const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
  // NOTE POUR CLAUDE: Gemini 3.x exige de renvoyer les parts brutes (avec thoughtSignature) du tour modèle.
  return { text, calls, rawParts: parts };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jr({ ok: false, error: { code: "VALIDATION", message: "Méthode non autorisée." } }, 405);
  try {
    const authH = req.headers.get("Authorization") ?? "";
    if (!authH.toLowerCase().startsWith("bearer ")) {
      return jr({ ok: false, error: { code: "UNAUTHENTICATED", message: "Session non authentifiée." } }, 401);
    }
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const gkey = Deno.env.get("GEMINI_API_KEY") ?? "";
    if (!url || !anon || !gkey) return jr({ ok: false, error: { code: "CONFIG", message: "Config incomplète." } }, 500);
    const sb = createClient(url, anon, {
      global: { headers: { Authorization: authH } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const af = await auth(sb);
    if (af) return jr(af, af.error.code === "FORBIDDEN" ? 403 : 401);

    let body: { message?: unknown; history?: unknown };
    try {
      body = await req.json();
    } catch {
      return jr({ ok: false, error: { code: "VALIDATION", message: "JSON invalide." } }, 400);
    }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return jr({ ok: false, error: { code: "VALIDATION", message: "Message vide." } }, 400);
    if (message.length > 2000) return jr({ ok: false, error: { code: "VALIDATION", message: "Message trop long." } }, 400);

    const history: { role: string; content: string }[] = [];
    for (const h of Array.isArray(body.history) ? body.history : []) {
      if (!h || typeof h !== "object") continue;
      const role = (h as { role?: unknown }).role;
      const content = (h as { content?: unknown }).content;
      if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim()) {
        history.push({ role, content: content.trim().slice(0, 2000) });
      }
    }

    const contents: Content[] = [];
    for (const h of history.slice(-20)) {
      contents.push({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.content }] });
    }
    contents.push({ role: "user", parts: [{ text: message }] });

    let reply = "";
    for (let round = 0; round < 6; round++) {
      const gj = await callGemini(gkey, contents);
      if (!gj) return jr({ ok: false, error: { code: "UPSTREAM", message: "Erreur IA Gemini." } }, 502);
      const { text, calls, rawParts } = extract(gj);
      if (!calls.length) {
        reply = text || "Sans réponse.";
        break;
      }
      contents.push({ role: "model", parts: rawParts as Content["parts"] });
      const frParts: Content["parts"] = [];
      for (const c of calls) {
        const result = await runTool(sb, c.name, c.args || {});
        frParts.push({ functionResponse: { name: c.name, response: result } });
      }
      contents.push({ role: "user", parts: frParts });
      if (round === 5) {
        const fj = await callGemini(gkey, contents);
        reply = extract(fj || {}).text || text || "Synthèse indisponible.";
      }
    }
    return jr({ ok: true, data: { reply } });
  } catch (e) {
    console.error(e);
    return jr({ ok: false, error: { code: "INTERNAL", message: "Erreur interne." } }, 500);
  }
});
