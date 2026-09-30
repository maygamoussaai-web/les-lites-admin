import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "gemini-3.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

type TR = { ok: true; data: Record<string, unknown> } | { ok: false; error: { code: string; message: string; candidates?: unknown[] } };
const s = (v: unknown) => typeof v === "string" ? v.trim() : "";

function jr(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function auth(sb: SupabaseClient): Promise<TR | null> {
  const { data: ud, error: ae } = await sb.auth.getUser();
  if (ae || !ud?.user) return { ok: false, error: { code: "UNAUTHENTICATED", message: "Session non authentifiée." } };
  const { data: p } = await sb.from("admin_profiles").select("id,is_active").eq("id", ud.user.id).maybeSingle();
  if (!p) return { ok: false, error: { code: "UNAUTHENTICATED", message: "Profil admin introuvable." } };
  if (!p.is_active) return { ok: false, error: { code: "FORBIDDEN", message: "Compte inactif." } };
  return null;
}

async function listClasses(sb: SupabaseClient, q: string): Promise<TR> {
  let query = sb.from("classes").select("id,name,establishment_id,is_active").eq("is_active", true).limit(50);
  if (q) query = query.ilike("name", `%${q}%`);
  const { data, error } = await query;
  if (error) return { ok: false, error: { code: "DB", message: error.message } };
  const out: { id: string; name: string }[] = [];
  for (const c of data ?? []) {
    const { data: ok } = await sb.rpc("has_establishment_access", { target_establishment_id: c.establishment_id });
    if (ok === true) out.push({ id: c.id, name: c.name });
  }
  return { ok: true, data: { classes: out, count: out.length } };
}

async function listStudents(sb: SupabaseClient, className: string): Promise<TR> {
  const { data: cs } = await sb.from("classes").select("id,name,establishment_id").ilike("name", `%${className}%`).eq("is_active", true).limit(5);
  if (!cs?.length) return { ok: false, error: { code: "NOT_FOUND", message: `Classe « ${className} » introuvable.` } };
  const accessible: { id: string; name: string; establishment_id: string }[] = [];
  for (const c of cs) {
    const { data: ok } = await sb.rpc("has_establishment_access", { target_establishment_id: c.establishment_id });
    if (ok) accessible.push(c);
  }
  if (!accessible.length) return { ok: false, error: { code: "NOT_FOUND", message: `Classe « ${className} » introuvable.` } };
  if (accessible.length > 1) {
    return { ok: false, error: { code: "AMBIGUOUS", message: "Plusieurs classes correspondent.", candidates: accessible.map((c) => ({ id: c.id, name: c.name })) } };
  }
  const cid = accessible[0].id;
  const { data: sts, error } = await sb.from("students").select("id,first_name,last_name,date_of_birth,gender,term1_average,term2_average,term3_average,enrolled_at,parent_phone_1").eq("class_id", cid).is("archived_at", null).limit(100);
  if (error) return { ok: false, error: { code: "DB", message: error.message } };
  const age = (dob?: string | null) => {
    if (!dob) return null;
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return null;
    const n = new Date();
    let a = n.getFullYear() - d.getFullYear();
    const m = n.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
    return a >= 0 && a < 120 ? a : null;
  };
  const students = (sts ?? []).map((st) => ({
    id: st.id,
    name: `${st.last_name || ""} ${st.first_name || ""}`.trim(),
    first_name: st.first_name,
    last_name: st.last_name,
    date_of_birth: st.date_of_birth,
    age: age(st.date_of_birth as string | null),
    gender: st.gender,
    averages: { term1: st.term1_average, term2: st.term2_average, term3: st.term3_average },
    enrolled_at: st.enrolled_at,
    parent_phone: st.parent_phone_1,
  }));
  return { ok: true, data: { class: accessible[0].name, students, count: students.length } };
}

async function findStudent(sb: SupabaseClient, name: string, className: string): Promise<TR> {
  const parts = name.split(/\s+/).filter(Boolean);
  let q = sb.from("students").select("id,first_name,last_name,date_of_birth,gender,class_id,term1_average,term2_average,term3_average,enrolled_at,parent_phone_1,parent_phone_2,establishment_id,archived_at").is("archived_at", null).limit(20);
  if (parts.length >= 2) {
    const a = parts[0], b = parts.slice(1).join(" ");
    q = q.or(`last_name.ilike.%${a}%,first_name.ilike.%${a}%,last_name.ilike.%${b}%,first_name.ilike.%${b}%`);
  } else if (parts.length === 1) {
    q = q.or(`last_name.ilike.%${parts[0]}%,first_name.ilike.%${parts[0]}%`);
  } else {
    return { ok: false, error: { code: "VALIDATION", message: "Nom requis." } };
  }
  const { data: sts, error } = await q;
  if (error) return { ok: false, error: { code: "DB", message: error.message } };
  const age = (dob?: string | null) => {
    if (!dob) return null;
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return null;
    const n = new Date();
    let a = n.getFullYear() - d.getFullYear();
    const m = n.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
    return a >= 0 && a < 120 ? a : null;
  };
  const out: Record<string, unknown>[] = [];
  for (const st of sts ?? []) {
    const { data: ok } = await sb.rpc("has_establishment_access", { target_establishment_id: st.establishment_id });
    if (ok !== true) continue;
    let classNameResolved: string | null = null;
    if (st.class_id) {
      const { data: cl } = await sb.from("classes").select("name").eq("id", st.class_id).maybeSingle();
      classNameResolved = cl?.name ?? null;
      if (className && classNameResolved && !classNameResolved.toLowerCase().includes(className.toLowerCase())) continue;
    }
    out.push({
      id: st.id,
      name: `${st.last_name || ""} ${st.first_name || ""}`.trim(),
      first_name: st.first_name,
      last_name: st.last_name,
      date_of_birth: st.date_of_birth,
      age: age(st.date_of_birth as string | null),
      gender: st.gender,
      class: classNameResolved,
      averages: { term1: st.term1_average, term2: st.term2_average, term3: st.term3_average },
      enrolled_at: st.enrolled_at,
      parent_phone_1: st.parent_phone_1,
      parent_phone_2: st.parent_phone_2,
    });
  }
  if (!out.length) return { ok: false, error: { code: "NOT_FOUND", message: `Aucun élève trouvé pour « ${name} ».` } };
  return { ok: true, data: { students: out, count: out.length } };
}

const TOOLS = [
  { name: "list_classes", description: "Liste les classes disponibles.", parameters: { type: "object", properties: { query: { type: "string" } }, required: [] } },
  { name: "list_students", description: "Liste les élèves actifs d'une classe avec âge et moyennes.", parameters: { type: "object", properties: { class_name: { type: "string" } }, required: ["class_name"] } },
  { name: "find_student", description: "Cherche un élève par nom (optionnellement filtré par classe).", parameters: { type: "object", properties: { name: { type: "string" }, class_name: { type: "string" } }, required: ["name"] } },
];

const SYSTEM = `Tu es l'assistant scolaire Les Élites de Gao. Réponds en français clairement.
Utilise les tools fournis. Pour une liste de classes, appelle immédiatement list_classes.
Pour les élèves / âges / moyennes d'une classe, appelle list_students avec class_name.
Pour les infos d'un élève nommé, appelle find_student avec name (et class_name si connu).
Tu n'as PAS d'outil d'archivage ni de modification : si on te demande d'archiver ou modifier, dis clairement que tu peux seulement consulter pour l'instant et propose les infos pertinentes.
Ne invente jamais de données.`;

async function callGemini(key: string, contents: unknown[]) {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    tools: [{ functionDeclarations: TOOLS }],
    generationConfig: { temperature: 0.15 },
  });
  for (let i = 0; i < 3; i++) {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body,
    });
    if (res.ok) return await res.json();
    const t = await res.text();
    console.error("Gemini", res.status, t.slice(0, 200));
    if ((res.status === 503 || res.status === 429) && i < 2) {
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      continue;
    }
    throw new Error(`Gemini ${res.status}`);
  }
  throw new Error("Gemini unavailable");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const sbUrl = Deno.env.get("SUPABASE_URL");
    const sbAnon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!sbUrl || !sbAnon) {
      return jr({ ok: false, error: { code: "CONFIG", message: "Configuration Supabase manquante." } });
    }
    const sb = createClient(sbUrl, sbAnon, { global: { headers: { Authorization: authHeader } } });
    const a = await auth(sb);
    if (a) return jr(a);

    const body = await req.json().catch(() => ({}));
    const message = s((body as { message?: string }).message);
    if (!message) return jr({ ok: false, error: { code: "VALIDATION", message: "Message vide." } });

    const key = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
    if (!key) return jr({ ok: false, error: { code: "CONFIG", message: "Clé IA (GEMINI_API_KEY) manquante sur la fonction." } });

    type Content = { role: string; parts: unknown[] };
    const contents: Content[] = [];
    const history = ((body as { history?: { role: string; content: string }[] }).history) || [];
    for (const h of history.slice(-20)) {
      if (h.role === "user" || h.role === "assistant") {
        contents.push({
          role: h.role === "assistant" ? "model" : "user",
          parts: [{ text: String(h.content || "").slice(0, 2000) }],
        });
      }
    }
    contents.push({ role: "user", parts: [{ text: message }] });

    let reply = "";
    for (let round = 0; round < 5; round++) {
      const j = (await callGemini(key, contents)) as {
        candidates?: { content?: { parts?: { text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }[] } }[];
      };
      const parts = j?.candidates?.[0]?.content?.parts || [];
      const fcs: { name: string; args: Record<string, unknown> }[] = [];
      let text = "";
      for (const p of parts) {
        if (typeof p.text === "string") text += p.text;
        if (p.functionCall?.name) fcs.push({ name: p.functionCall.name, args: p.functionCall.args || {} });
      }
      if (!fcs.length) {
        reply = text || "Je n'ai pas de réponse.";
        break;
      }
      contents.push({ role: "model", parts });
      const frParts: unknown[] = [];
      for (const fc of fcs) {
        let result: TR;
        if (fc.name === "list_classes") result = await listClasses(sb, s(fc.args.query));
        else if (fc.name === "list_students") result = await listStudents(sb, s(fc.args.class_name));
        else if (fc.name === "find_student") result = await findStudent(sb, s(fc.args.name), s(fc.args.class_name));
        else result = { ok: false, error: { code: "UNKNOWN", message: `Outil inconnu: ${fc.name}` } };
        frParts.push({ functionResponse: { name: fc.name, response: result } });
      }
      contents.push({ role: "user", parts: frParts });
    }
    return jr({ ok: true, data: { reply } });
  } catch (e) {
    console.error("ai-assistant error", e);
    return jr({ ok: false, error: { code: "INTERNAL", message: String((e as Error)?.message || e) } });
  }
});
