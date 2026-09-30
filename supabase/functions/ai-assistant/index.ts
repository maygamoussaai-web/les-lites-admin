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

function ageOf(dob?: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
  return a >= 0 && a < 120 ? a : null;
}

async function auth(sb: SupabaseClient): Promise<TR | null> {
  const { data: ud, error: ae } = await sb.auth.getUser();
  if (ae || !ud?.user) return { ok: false, error: { code: "UNAUTHENTICATED", message: "Session non authentifiée." } };
  const { data: p } = await sb.from("admin_profiles").select("id,is_active").eq("id", ud.user.id).maybeSingle();
  if (!p) return { ok: false, error: { code: "UNAUTHENTICATED", message: "Profil admin introuvable." } };
  if (!p.is_active) return { ok: false, error: { code: "FORBIDDEN", message: "Compte inactif." } };
  return null;
}

async function resolveClass(sb: SupabaseClient, className: string) {
  const { data: cs } = await sb.from("classes").select("id,name,establishment_id").ilike("name", `%${className}%`).eq("is_active", true).limit(5);
  if (!cs?.length) return { error: `Classe « ${className} » introuvable.` as string };
  const accessible: { id: string; name: string; establishment_id: string }[] = [];
  for (const c of cs) {
    const { data: ok } = await sb.rpc("has_establishment_access", { target_establishment_id: c.establishment_id });
    if (ok) accessible.push(c);
  }
  if (!accessible.length) return { error: `Classe « ${className} » introuvable.` };
  if (accessible.length > 1) return { error: "Plusieurs classes correspondent.", candidates: accessible.map((c) => ({ id: c.id, name: c.name })) };
  return { class: accessible[0] };
}

async function listEstablishments(sb: SupabaseClient): Promise<TR> {
  const { data, error } = await sb.from("establishments").select("id,name,type,phone,address,is_active").eq("is_active", true).limit(50);
  if (error) return { ok: false, error: { code: "DB", message: error.message } };
  const out: Record<string, unknown>[] = [];
  for (const e of data ?? []) {
    const { data: ok } = await sb.rpc("has_establishment_access", { target_establishment_id: e.id });
    if (ok === true) out.push({ id: e.id, name: e.name, type: e.type, phone: e.phone, address: e.address });
  }
  return { ok: true, data: { establishments: out, count: out.length } };
}

async function listClasses(sb: SupabaseClient, q: string): Promise<TR> {
  let query = sb.from("classes").select("id,name,establishment_id,is_active,capacity").eq("is_active", true).limit(50);
  if (q) query = query.ilike("name", `%${q}%`);
  const { data, error } = await query;
  if (error) return { ok: false, error: { code: "DB", message: error.message } };
  const out: Record<string, unknown>[] = [];
  for (const c of data ?? []) {
    const { data: ok } = await sb.rpc("has_establishment_access", { target_establishment_id: c.establishment_id });
    if (ok !== true) continue;
    const { count } = await sb.from("students").select("id", { count: "exact", head: true }).eq("class_id", c.id).is("archived_at", null);
    out.push({ id: c.id, name: c.name, capacity: c.capacity, students_count: count ?? 0 });
  }
  return { ok: true, data: { classes: out, count: out.length } };
}

async function listStudents(sb: SupabaseClient, className: string): Promise<TR> {
  const r = await resolveClass(sb, className);
  if ("error" in r && r.error) return { ok: false, error: { code: "NOT_FOUND", message: r.error, candidates: (r as { candidates?: unknown[] }).candidates } };
  const cl = (r as { class: { id: string; name: string } }).class;
  const { data: sts, error } = await sb.from("students")
    .select("id,first_name,last_name,date_of_birth,gender,term1_average,term2_average,term3_average,enrolled_at,parent_phone_1")
    .eq("class_id", cl.id).is("archived_at", null).order("last_name").limit(120);
  if (error) return { ok: false, error: { code: "DB", message: error.message } };
  const students = (sts ?? []).map((st) => ({
    id: st.id,
    name: `${st.last_name || ""} ${st.first_name || ""}`.trim(),
    gender: st.gender,
    date_of_birth: st.date_of_birth,
    age: ageOf(st.date_of_birth as string | null),
    averages: { term1: st.term1_average, term2: st.term2_average, term3: st.term3_average },
    enrolled_at: st.enrolled_at,
    parent_phone: st.parent_phone_1,
  }));
  return { ok: true, data: { class: cl.name, students, count: students.length } };
}

async function findStudent(sb: SupabaseClient, name: string, className: string): Promise<TR> {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return { ok: false, error: { code: "VALIDATION", message: "Nom requis." } };
  let q = sb.from("students")
    .select("id,first_name,last_name,date_of_birth,gender,class_id,term1_average,term2_average,term3_average,enrolled_at,parent_phone_1,parent_phone_2,establishment_id")
    .is("archived_at", null).limit(25);
  if (parts.length >= 2) {
    const a = parts[0], b = parts.slice(1).join(" ");
    q = q.or(`last_name.ilike.%${a}%,first_name.ilike.%${a}%,last_name.ilike.%${b}%,first_name.ilike.%${b}%`);
  } else {
    q = q.or(`last_name.ilike.%${parts[0]}%,first_name.ilike.%${parts[0]}%`);
  }
  const { data: sts, error } = await q;
  if (error) return { ok: false, error: { code: "DB", message: error.message } };
  const out: Record<string, unknown>[] = [];
  for (const st of sts ?? []) {
    const { data: ok } = await sb.rpc("has_establishment_access", { target_establishment_id: st.establishment_id });
    if (ok !== true) continue;
    let classResolved: string | null = null;
    if (st.class_id) {
      const { data: cl } = await sb.from("classes").select("name").eq("id", st.class_id).maybeSingle();
      classResolved = cl?.name ?? null;
      if (className && classResolved && !classResolved.toLowerCase().includes(className.toLowerCase())) continue;
    }
    out.push({
      id: st.id,
      name: `${st.last_name || ""} ${st.first_name || ""}`.trim(),
      gender: st.gender,
      date_of_birth: st.date_of_birth,
      age: ageOf(st.date_of_birth as string | null),
      class: classResolved,
      averages: { term1: st.term1_average, term2: st.term2_average, term3: st.term3_average },
      enrolled_at: st.enrolled_at,
      parent_phone_1: st.parent_phone_1,
      parent_phone_2: st.parent_phone_2,
    });
  }
  if (!out.length) return { ok: false, error: { code: "NOT_FOUND", message: `Aucun élève trouvé pour « ${name} ».` } };
  return { ok: true, data: { students: out, count: out.length } };
}

async function rankStudents(sb: SupabaseClient, className: string, order: string): Promise<TR> {
  const r = await resolveClass(sb, className);
  if ("error" in r && r.error) return { ok: false, error: { code: "NOT_FOUND", message: r.error } };
  const cl = (r as { class: { id: string; name: string } }).class;
  const { data: sts, error } = await sb.from("students")
    .select("id,first_name,last_name,term1_average,term2_average,term3_average")
    .eq("class_id", cl.id).is("archived_at", null).limit(120);
  if (error) return { ok: false, error: { code: "DB", message: error.message } };
  type Row = { id: string; name: string; term1: number | null; term2: number | null; term3: number | null; annual: number | null };
  const rows: Row[] = [];
  for (const st of sts ?? []) {
    const t1 = st.term1_average != null ? Number(st.term1_average) : null;
    const t2 = st.term2_average != null ? Number(st.term2_average) : null;
    const t3 = st.term3_average != null ? Number(st.term3_average) : null;
    const vals = [t1, t2, t3].filter((x): x is number => x != null && !Number.isNaN(x));
    const annual = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    rows.push({
      id: st.id,
      name: `${st.last_name || ""} ${st.first_name || ""}`.trim(),
      term1: t1, term2: t2, term3: t3, annual,
    });
  }
  const withAvg = rows.filter((r) => r.annual != null);
  const without = rows.filter((r) => r.annual == null);
  const asc = order === "asc" || order === "worst" || order === "pire";
  withAvg.sort((a, b) => asc ? (a.annual! - b.annual!) : (b.annual! - a.annual!));
  return {
    ok: true,
    data: {
      class: cl.name,
      order: asc ? "asc (pire → meilleur)" : "desc (meilleur → pire)",
      ranked: withAvg,
      without_averages: without.map((r) => r.name),
      counted_with_average: withAvg.length,
      counted_without_average: without.length,
    },
  };
}

async function listTeachers(sb: SupabaseClient, q: string): Promise<TR> {
  let query = sb.from("teachers").select("id,first_name,last_name,phone,domain").is("archived_at", null).limit(80);
  if (q) query = query.or(`last_name.ilike.%${q}%,first_name.ilike.%${q}%,domain.ilike.%${q}%`);
  const { data, error } = await query.order("last_name");
  if (error) return { ok: false, error: { code: "DB", message: error.message } };
  const teachers = (data ?? []).map((t) => ({
    id: t.id,
    name: `${t.last_name || ""} ${t.first_name || ""}`.trim(),
    phone: t.phone,
    domain: t.domain,
  }));
  return { ok: true, data: { teachers, count: teachers.length } };
}

async function studentPayments(sb: SupabaseClient, name: string): Promise<TR> {
  const found = await findStudent(sb, name, "");
  if (!found.ok) return found;
  const students = (found.data.students as { id: string; name: string }[]) || [];
  if (students.length !== 1) {
    return { ok: true, data: { note: "Plusieurs élèves correspondent. Précisez le nom.", candidates: students.map((x) => x.name) } };
  }
  const st = students[0];
  const { data: pays, error } = await sb.from("tuition_payments")
    .select("id,amount,paid_at,method,note")
    .eq("student_id", st.id).order("paid_at", { ascending: false }).limit(40);
  if (error) return { ok: false, error: { code: "DB", message: error.message } };
  const total = (pays ?? []).reduce((a, p) => a + Number(p.amount || 0), 0);
  return { ok: true, data: { student: st.name, payments: pays ?? [], total_paid: total, count: (pays ?? []).length } };
}

const TOOLS = [
  { name: "list_establishments", description: "Liste les établissements du complexe.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "list_classes", description: "Liste les classes actives avec effectif.", parameters: { type: "object", properties: { query: { type: "string" } }, required: [] } },
  { name: "list_students", description: "Liste les élèves actifs d'une classe (âge, moyennes).", parameters: { type: "object", properties: { class_name: { type: "string" } }, required: ["class_name"] } },
  { name: "find_student", description: "Cherche un élève par nom, optionnellement filtré par classe.", parameters: { type: "object", properties: { name: { type: "string" }, class_name: { type: "string" } }, required: ["name"] } },
  { name: "rank_students", description: "Classe les élèves par moyenne annuelle. order=desc (meilleurs) ou asc (pires).", parameters: { type: "object", properties: { class_name: { type: "string" }, order: { type: "string" } }, required: ["class_name"] } },
  { name: "list_teachers", description: "Liste les enseignants (filtre optionnel par nom/domaine).", parameters: { type: "object", properties: { query: { type: "string" } }, required: [] } },
  { name: "student_payments", description: "Historique des paiements de scolarité d'un élève.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
];

const SYSTEM = `Tu es l'assistant scolaire Les Élites de Gao. Réponds en français, clair et structuré.
Utilise TOUJOURS les tools pour les données — ne jamais inventer.
- Classes → list_classes
- Élèves d'une classe → list_students
- Infos d'un élève nommé → find_student
- Meilleur / pire / classement par moyenne → rank_students (order=desc ou asc)
- Enseignants → list_teachers
- Établissements → list_establishments
- Paiements scolarité → student_payments
Formatage : utilise **gras** pour les noms, listes à puces ou numérotées. Sois concis.
Si les moyennes manquent pour la plupart des élèves, dis-le clairement.
Tu ne peux PAS archiver, créer ou modifier des données : consultation uniquement.`;

async function callGemini(key: string, contents: unknown[]) {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    tools: [{ functionDeclarations: TOOLS }],
    generationConfig: { temperature: 0.12 },
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
    if (!sbUrl || !sbAnon) return jr({ ok: false, error: { code: "CONFIG", message: "Configuration Supabase manquante." } });
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
    for (let round = 0; round < 6; round++) {
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
        if (fc.name === "list_establishments") result = await listEstablishments(sb);
        else if (fc.name === "list_classes") result = await listClasses(sb, s(fc.args.query));
        else if (fc.name === "list_students") result = await listStudents(sb, s(fc.args.class_name));
        else if (fc.name === "find_student") result = await findStudent(sb, s(fc.args.name), s(fc.args.class_name));
        else if (fc.name === "rank_students") result = await rankStudents(sb, s(fc.args.class_name), s(fc.args.order) || "desc");
        else if (fc.name === "list_teachers") result = await listTeachers(sb, s(fc.args.query));
        else if (fc.name === "student_payments") result = await studentPayments(sb, s(fc.args.name));
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
