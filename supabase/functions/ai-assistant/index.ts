import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type TR =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string; candidates?: unknown[]; confirm_token?: string; expires_at?: string; tool?: string } };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const jr = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const iu = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const fn = (l: string, f: string) => `${(l || "").trim()} ${(f || "").trim()}`.trim();
const conf = (a: Record<string, unknown>) => a.confirmed === true || a.confirmed === "true";

const MODELS = [...new Set([
  Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
])];

const SYSTEM = `Tu es l'assistant admin professionnel de Les Élites.
Français, concis, professionnel. Pas de formules vides.
LECTURE : appelle IMMÉDIATEMENT l'outil adapté.
ÉCRITURE (upsert_grade, delete_grade, open_period, close_period) :
1) appelle SANS confirmed → CONFIRMATION_REQUIRED + confirm_token
2) après « oui », rappelle avec confirmed=true + confirm_token exact.
JAMAIS confirmed=true sans confirm_token.`;

type Content = {
  role: string;
  parts: {
    text?: string;
    thought?: boolean;
    functionCall?: { name: string; args: Record<string, unknown> };
    functionResponse?: { name: string; response: unknown };
  }[];
};

const consumedTokens = new Set<string>();
function confirmSecret(): string {
  const x = Deno.env.get("CONFIRM_SECRET") || Deno.env.get("SUPABASE_ANON_KEY");
  if (!x) throw new Error("CONFIRM_SECRET ou SUPABASE_ANON_KEY requis");
  return x + "|ai-assistant-v1";
}
async function hmacHex(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(confirmSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function stableParams(a: Record<string, unknown>): string {
  const skip = new Set(["confirmed", "confirm_token"]);
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(a).filter((k) => !skip.has(k)).sort()) {
    const v = a[k];
    if (v === undefined || v === null || v === "") continue;
    o[k] = v;
  }
  return JSON.stringify(o);
}
function establishmentHint(a: Record<string, unknown>): string {
  for (const k of ["establishment_id", "to_establishment_id", "from_establishment_id"]) {
    if (typeof a[k] === "string" && a[k]) return a[k] as string;
  }
  return "";
}
async function issueConfirmToken(userId: string, tool: string, a: Record<string, unknown>) {
  const exp = Date.now() + 10 * 60 * 1000;
  const nonce = crypto.randomUUID();
  const payload = `${userId}|${tool}|${establishmentHint(a)}|${stableParams(a)}|${exp}|${nonce}`;
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
  const payload = `${userId}|${tool}|${establishmentHint(a)}|${stableParams(a)}|${exp}|${nonce}`;
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
async function requireWrite(sb: SupabaseClient, tool: string, a: Record<string, unknown>): Promise<TR | null> {
  const { data: ud } = await sb.auth.getUser();
  const uid = ud?.user?.id ?? "";
  if (conf(a)) {
    if (await verifyConfirmToken(uid, tool, a, a.confirm_token)) return null;
    return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation invalide ou expirée. Redemandez l'action puis confirmez par « oui »." } };
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

async function acc(sb: SupabaseClient, eid: string) {
  const { data } = await sb.rpc("has_establishment_access", { target_establishment_id: eid });
  return data === true;
}

async function writeAuditLog(sb: SupabaseClient, action: string, entity_type: string, entity_id: string | null, establishment_id: string | null, metadata: Record<string, unknown> = {}) {
  try {
    const { data: ud } = await sb.auth.getUser();
    const safe: Record<string, unknown> = { via_ai: true };
    for (const [k, v] of Object.entries(metadata)) {
      if (/token|secret|key|password/i.test(k)) continue;
      safe[k] = v;
    }
    await sb.from("audit_logs").insert({ actor_id: ud?.user?.id ?? null, action, entity_type, entity_id, establishment_id, metadata: safe } as never);
  } catch (e) {
    console.error("audit", e);
  }
}

async function rClass(sb: SupabaseClient, cid: string, cn: string): Promise<TR | { ok: true; classId: string; className: string; establishmentId: string }> {
  if (iu(cid)) {
    const { data: k } = await sb.from("classes").select("id,name,establishment_id").eq("id", cid).maybeSingle();
    if (!k || !(await acc(sb, k.establishment_id))) return { ok: false, error: { code: "NOT_FOUND", message: "Classe introuvable." } };
    return { ok: true, classId: k.id, className: k.name, establishmentId: k.establishment_id };
  }
  if (!cn) return { ok: false, error: { code: "VALIDATION", message: "class_id ou class_name requis." } };
  const { data: cs } = await sb.from("classes").select("id,name,establishment_id").ilike("name", `%${cn}%`).eq("is_active", true).limit(10);
  const a: { id: string; name: string; establishment_id: string }[] = [];
  for (const c of cs ?? []) if (await acc(sb, c.establishment_id)) a.push(c);
  if (!a.length) return { ok: false, error: { code: "NOT_FOUND", message: `Aucune classe « ${cn} ».` } };
  if (a.length > 1) return { ok: false, error: { code: "AMBIGUOUS", message: "Plusieurs classes.", candidates: a.map((c) => ({ id: c.id, name: c.name })) } };
  return { ok: true, classId: a[0].id, className: a[0].name, establishmentId: a[0].establishment_id };
}

async function rStud(sb: SupabaseClient, sid: string, q: string, allowArchived = false): Promise<TR | { ok: true; student: Record<string, unknown> }> {
  let st: Record<string, unknown> | null = null;
  if (iu(sid)) {
    const { data } = await sb.from("students").select("*").eq("id", sid).maybeSingle();
    st = data;
  } else if (q) {
    let qq = sb.from("students").select("*").limit(10);
    if (!allowArchived) qq = qq.is("archived_at", null);
    const p = q.split(/\s+/).filter(Boolean);
    if (p.length >= 2) {
      const a = p[0], b = p.slice(1).join(" ");
      qq = qq.or(`and(first_name.ilike.%${a}%,last_name.ilike.%${b}%),and(first_name.ilike.%${b}%,last_name.ilike.%${a}%),first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
    } else qq = qq.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
    const { data } = await qq;
    const ac: Record<string, unknown>[] = [];
    for (const x of data ?? []) if (await acc(sb, x.establishment_id as string)) ac.push(x);
    if (ac.length > 1) return { ok: false, error: { code: "AMBIGUOUS", message: "Plusieurs élèves.", candidates: ac.map((x) => ({ id: x.id, name: fn(x.last_name as string, x.first_name as string) })) } };
    st = ac[0] ?? null;
  }
  if (!st) return { ok: false, error: { code: "NOT_FOUND", message: "Élève introuvable." } };
  if (!(await acc(sb, st.establishment_id as string))) return { ok: false, error: { code: "FORBIDDEN", message: "Accès refusé." } };
  return { ok: true, student: st };
}

const TOOLS = [
  { name: "list_capabilities", description: "Liste les capacités", parameters: { type: "object", properties: {}, required: [] as string[] } },
  { name: "get_complex_overview", description: "Synthèse du complexe", parameters: { type: "object", properties: {}, required: [] as string[] } },
  { name: "list_students", description: "Liste les élèves", parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: [] as string[] } },
  { name: "search", description: "Recherche unifiée", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "list_classes", description: "Liste les classes", parameters: { type: "object", properties: {}, required: [] as string[] } },
  { name: "list_teachers", description: "Liste les enseignants", parameters: { type: "object", properties: { query: { type: "string" } }, required: [] as string[] } },
  { name: "get_class_statistics", description: "Stats d'une classe", parameters: { type: "object", properties: { class_name: { type: "string" }, class_id: { type: "string" } }, required: [] as string[] } },
  { name: "rank_students", description: "Classement élèves", parameters: { type: "object", properties: { class_name: { type: "string" }, class_id: { type: "string" } }, required: [] as string[] } },
  { name: "list_audit_logs", description: "Logs d'audit", parameters: { type: "object", properties: { limit: { type: "number" } }, required: [] as string[] } },
  { name: "list_periods", description: "Périodes de notes d'une classe", parameters: { type: "object", properties: { class_id: { type: "string" }, class_name: { type: "string" } }, required: [] as string[] } },
  { name: "get_student_grades", description: "Notes d'un élève", parameters: { type: "object", properties: { student_id: { type: "string" }, query: { type: "string" }, student_name: { type: "string" }, period_number: { type: "number" } }, required: [] as string[] } },
  { name: "check_grades_completeness", description: "Checklist complétude notes avant bulletins", parameters: { type: "object", properties: { class_id: { type: "string" }, class_name: { type: "string" }, period_number: { type: "number" } }, required: [] as string[] } },
  { name: "upsert_grade", description: "Créer/MAJ note. REQUIRES confirmed + confirm_token.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, confirm_token: { type: "string" }, student_id: { type: "string" }, query: { type: "string" }, student_name: { type: "string" }, subject_name: { type: "string" }, subject: { type: "string" }, nature: { type: "string" }, value: { type: "number" }, scale: { type: "number" } }, required: ["value"] } },
  { name: "delete_grade", description: "Supprimer note. REQUIRES confirmed + confirm_token.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, confirm_token: { type: "string" }, grade_id: { type: "string" } }, required: ["grade_id"] } },
  { name: "open_period", description: "Ouvrir période. REQUIRES confirmed + confirm_token.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, confirm_token: { type: "string" }, class_id: { type: "string" }, class_name: { type: "string" } }, required: [] as string[] } },
  { name: "close_period", description: "Clôturer période. REQUIRES confirmed + confirm_token.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, confirm_token: { type: "string" }, class_id: { type: "string" }, class_name: { type: "string" }, period_number: { type: "number" }, reopen: { type: "boolean" } }, required: [] as string[] } },
];

async function auth(sb: SupabaseClient) {
  const { data: ud } = await sb.auth.getUser();
  if (!ud?.user) return { ok: false as const, error: { code: "UNAUTHENTICATED", message: "Session non authentifiée." } };
  const { data: p } = await sb.from("admin_profiles").select("id,is_active").eq("id", ud.user.id).maybeSingle();
  if (!p?.is_active) return { ok: false as const, error: { code: "FORBIDDEN", message: "Compte inactif." } };
  return null;
}

async function listPer(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const r = await rClass(sb, s(a.class_id), s(a.class_name));
  if (!r.ok) return r;
  const { data } = await sb.from("grade_periods").select("id,period_number,started_at,ended_at").eq("class_id", r.classId).order("period_number");
  return { ok: true, data: { class_name: r.className, periods: (data ?? []).map((p) => ({ id: p.id, period_number: p.period_number, started_at: p.started_at, ended_at: p.ended_at, is_open: !p.ended_at })) } };
}

async function getGrades(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const sr = await rStud(sb, s(a.student_id), s(a.query) || s(a.student_name));
  if (!sr.ok) return sr;
  const x = sr.student;
  const cid = x.class_id as string;
  if (!cid) return { ok: false, error: { code: "VALIDATION", message: "Élève sans classe." } };
  let pid = s(a.period_id);
  const pn = a.period_number != null ? Number(a.period_number) : null;
  if (!iu(pid)) {
    let pq = sb.from("grade_periods").select("id,period_number").eq("class_id", cid).order("period_number", { ascending: false });
    if (pn != null && Number.isFinite(pn)) pq = pq.eq("period_number", pn);
    const { data: ps } = await pq.limit(1);
    pid = ps?.[0]?.id ?? "";
  }
  if (!pid) return { ok: true, data: { student: fn(x.last_name as string, x.first_name as string), subjects: [], message: "Aucune période." } };
  const { data: subs } = await sb.from("class_subjects").select("id,name").eq("class_id", cid);
  const { data: gs } = await sb.from("grades").select("id,subject_id,nature,sequence_number,value,scale").eq("student_id", x.id as string).eq("period_id", pid);
  const sm = new Map((subs ?? []).map((z) => [z.id, z.name]));
  const by: Record<string, { subject: string; notes: { id: string; nature: string; value: number; scale: number }[] }> = {};
  for (const g of gs ?? []) {
    const n = sm.get(g.subject_id) ?? "Matière";
    if (!by[g.subject_id]) by[g.subject_id] = { subject: n, notes: [] };
    by[g.subject_id].notes.push({ id: g.id, nature: g.nature, value: Number(g.value), scale: Number(g.scale) });
  }
  const { data: card } = await sb.from("student_report_cards").select("status,general_average,validated_at").eq("student_id", x.id as string).eq("period_id", pid).maybeSingle();
  return { ok: true, data: { student: fn(x.last_name as string, x.first_name as string), period_id: pid, subjects: Object.values(by), report_card: card } };
}

async function checkGradesCompleteness(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const r = await rClass(sb, s(a.class_id), s(a.class_name));
  if (!r.ok) return r;
  let pid = s(a.period_id);
  const pn = a.period_number != null ? Number(a.period_number) : null;
  if (!iu(pid)) {
    let pq = sb.from("grade_periods").select("id,period_number").eq("class_id", r.classId).order("period_number", { ascending: false });
    if (pn != null && Number.isFinite(pn)) pq = pq.eq("period_number", pn);
    const { data: ps } = await pq.limit(1);
    if (!ps?.[0]) return { ok: true, data: { class_name: r.className, message: "Aucune période.", missing: [] } };
    pid = ps[0].id;
  }
  const { data: studs } = await sb.from("students").select("id,first_name,last_name").eq("class_id", r.classId).is("archived_at", null);
  const { data: subs } = await sb.from("class_subjects").select("id,name").eq("class_id", r.classId);
  const { data: gs } = await sb.from("grades").select("student_id,subject_id,nature").eq("class_id", r.classId).eq("period_id", pid);
  const have = new Set((gs ?? []).map((g) => `${g.student_id}|${g.subject_id}|${g.nature}`));
  const missing: { student: string; subject: string; nature: string }[] = [];
  for (const st of studs ?? []) {
    for (const sub of subs ?? []) {
      for (const nature of ["composition", "evaluation"]) {
        if (!have.has(`${st.id}|${sub.id}|${nature}`)) missing.push({ student: fn(st.last_name, st.first_name), subject: sub.name, nature });
      }
    }
  }
  const totalExpected = (studs?.length ?? 0) * (subs?.length ?? 0) * 2;
  const filled = totalExpected - missing.length;
  return { ok: true, data: { class_name: r.className, period_id: pid, students: studs?.length ?? 0, subjects: subs?.length ?? 0, expected_grades: totalExpected, filled, completion_pct: totalExpected ? Math.round((filled / totalExpected) * 100) : 100, missing_count: missing.length, missing_sample: missing.slice(0, 40), ready_for_bulletins: missing.length === 0 } };
}

async function upGrade(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const _cw = await requireWrite(sb, "upsert_grade", a);
  if (_cw) return _cw;
  const sr = await rStud(sb, s(a.student_id), s(a.query) || s(a.student_name));
  if (!sr.ok) return sr;
  const x = sr.student;
  const cid = x.class_id as string, eid = x.establishment_id as string;
  if (!cid) return { ok: false, error: { code: "VALIDATION", message: "Élève sans classe." } };
  const nature = s(a.nature) || "composition";
  if (nature !== "composition" && nature !== "evaluation") return { ok: false, error: { code: "VALIDATION", message: "nature: composition ou evaluation." } };
  const value = Number(a.value), scale = Number(a.scale ?? 20);
  if (!Number.isFinite(value)) return { ok: false, error: { code: "VALIDATION", message: "value invalide." } };
  let sid = s(a.subject_id);
  const sn = s(a.subject_name) || s(a.subject);
  if (!iu(sid) && sn) {
    const { data: subs } = await sb.from("class_subjects").select("id,name").eq("class_id", cid).ilike("name", `%${sn}%`).limit(5);
    if (!subs?.length) return { ok: false, error: { code: "NOT_FOUND", message: `Matière « ${sn} » introuvable.` } };
    if (subs.length > 1) return { ok: false, error: { code: "AMBIGUOUS", message: "Plusieurs matières.", candidates: subs } };
    sid = subs[0].id;
  }
  if (!iu(sid)) return { ok: false, error: { code: "VALIDATION", message: "subject_name requis." } };
  let pid = s(a.period_id);
  if (!iu(pid)) {
    const { data: ps } = await sb.from("grade_periods").select("id").eq("class_id", cid).order("period_number", { ascending: false }).limit(1);
    pid = ps?.[0]?.id ?? "";
  }
  if (!iu(pid)) {
    const { data: cr, error: pe } = await sb.from("grade_periods").insert({ class_id: cid, establishment_id: eid, period_number: 1, started_at: new Date().toISOString() } as never).select("id").single();
    if (pe || !cr) return { ok: false, error: { code: "INTERNAL", message: "Impossible de créer une période." } };
    pid = cr.id;
  }
  if (nature === "composition") {
    const { data: ex } = await sb.from("grades").select("id").eq("student_id", x.id as string).eq("period_id", pid).eq("subject_id", sid).eq("nature", "composition").maybeSingle();
    if (ex) {
      const { error } = await sb.from("grades").update({ value, scale } as never).eq("id", ex.id);
      if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
      await writeAuditLog(sb, "upsert", "grade", ex.id, eid, { value, scale, nature });
      return { ok: true, data: { updated: true, grade_id: ex.id, nature, value, scale } };
    }
  }
  const { data: ins, error } = await sb.from("grades").insert({ period_id: pid, class_id: cid, establishment_id: eid, subject_id: sid, student_id: x.id, nature, sequence_number: 1, value, scale } as never).select("id").single();
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  await writeAuditLog(sb, "create", "grade", ins.id, eid, { value, scale, nature });
  return { ok: true, data: { created: true, grade_id: ins.id, nature, value, scale } };
}

async function delGrade(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const _cw = await requireWrite(sb, "delete_grade", a);
  if (_cw) return _cw;
  const gid = s(a.grade_id);
  if (!iu(gid)) return { ok: false, error: { code: "VALIDATION", message: "grade_id requis." } };
  const { data: g } = await sb.from("grades").select("id,establishment_id").eq("id", gid).maybeSingle();
  if (!g || !(await acc(sb, g.establishment_id))) return { ok: false, error: { code: "NOT_FOUND", message: "Note introuvable." } };
  const { error } = await sb.from("grades").delete().eq("id", gid);
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  await writeAuditLog(sb, "delete", "grade", gid, g.establishment_id, {});
  return { ok: true, data: { deleted: true, grade_id: gid } };
}

async function openPeriod(sb: SupabaseClient, args: Record<string, unknown>): Promise<TR> {
  const _cw = await requireWrite(sb, "open_period", args);
  if (_cw) return _cw;
  const r = await rClass(sb, s(args.class_id), s(args.class_name));
  if (!r.ok) return r;
  const { data: last } = await sb.from("grade_periods").select("period_number").eq("class_id", r.classId).order("period_number", { ascending: false }).limit(1);
  const next = ((last?.[0]?.period_number as number) ?? 0) + 1;
  const { data, error } = await sb.from("grade_periods").insert({ class_id: r.classId, establishment_id: r.establishmentId, period_number: next, started_at: new Date().toISOString() } as never).select("id,period_number").single();
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  await writeAuditLog(sb, "open", "grade_period", data.id, r.establishmentId, { period_number: next });
  return { ok: true, data: { opened: true, period_id: data.id, period_number: data.period_number, class_name: r.className } };
}

async function closePeriod(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const _cw = await requireWrite(sb, "close_period", a);
  if (_cw) return _cw;
  const r = await rClass(sb, s(a.class_id), s(a.class_name));
  if (!r.ok) return r;
  let pid = s(a.period_id);
  const pn = a.period_number != null ? Number(a.period_number) : null;
  if (!iu(pid)) {
    let qq = sb.from("grade_periods").select("id,period_number").eq("class_id", r.classId).order("period_number", { ascending: false });
    if (pn != null) qq = qq.eq("period_number", pn);
    const { data: ps } = await qq.limit(1);
    if (!ps?.[0]) return { ok: false, error: { code: "NOT_FOUND", message: "Période introuvable." } };
    pid = ps[0].id;
  }
  const reopen = a.reopen === true || a.reopen === "true";
  const { error } = await sb.from("grade_periods").update({ ended_at: reopen ? null : new Date().toISOString() } as never).eq("id", pid);
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  await writeAuditLog(sb, reopen ? "reopen" : "close", "grade_period", pid, r.establishmentId, {});
  return { ok: true, data: { period_id: pid, closed: !reopen, class_name: r.className } };
}

async function runTool(sb: SupabaseClient, name: string, args: Record<string, unknown>) {
  try {
    switch (name) {
      case "list_capabilities":
        return { ok: true, data: { version: "lot1", lecture: TOOLS.filter((t) => !["upsert_grade", "delete_grade", "open_period", "close_period"].includes(t.name)).map((t) => t.name), ecriture: ["upsert_grade", "delete_grade", "open_period", "close_period"] } };
      case "get_complex_overview": {
        const [{ count: students }, { count: classes }, { count: teachers }] = await Promise.all([
          sb.from("students").select("id", { count: "exact", head: true }).is("archived_at", null),
          sb.from("classes").select("id", { count: "exact", head: true }).eq("is_active", true),
          sb.from("teachers").select("id", { count: "exact", head: true }),
        ]);
        return { ok: true, data: { eleves_actifs: students ?? 0, classes_actives: classes ?? 0, enseignants: teachers ?? 0 } };
      }
      case "list_students": {
        let q = sb.from("students").select("id,first_name,last_name,class_id").is("archived_at", null).order("last_name").limit(Number(args.limit) || 40);
        const { data, error } = await q;
        if (error) return { ok: false, error: { code: "DB", message: error.message } };
        let rows = data ?? [];
        const query = String(args.query || "").trim().toLowerCase();
        if (query) rows = rows.filter((r) => `${r.last_name} ${r.first_name}`.toLowerCase().includes(query));
        return { ok: true, data: { count: rows.length, students: rows } };
      }
      case "list_classes": {
        const { data, error } = await sb.from("classes").select("id,name,is_active").eq("is_active", true).order("name");
        if (error) return { ok: false, error: { code: "DB", message: error.message } };
        return { ok: true, data: { classes: data ?? [] } };
      }
      case "list_teachers": {
        const { data, error } = await sb.from("teachers").select("id,first_name,last_name").order("last_name").limit(50);
        if (error) return { ok: false, error: { code: "DB", message: error.message } };
        return { ok: true, data: { teachers: data ?? [] } };
      }
      case "search": {
        const query = String(args.query || "").trim().toLowerCase();
        if (!query) return { ok: false, error: { code: "VALIDATION", message: "query requis" } };
        const [{ data: st }, { data: cl }, { data: te }] = await Promise.all([
          sb.from("students").select("id,first_name,last_name").is("archived_at", null).limit(30),
          sb.from("classes").select("id,name").eq("is_active", true).limit(20),
          sb.from("teachers").select("id,first_name,last_name").limit(20),
        ]);
        return { ok: true, data: { students: (st ?? []).filter((r) => `${r.last_name} ${r.first_name}`.toLowerCase().includes(query)), classes: (cl ?? []).filter((r) => String(r.name).toLowerCase().includes(query)), teachers: (te ?? []).filter((r) => `${r.last_name} ${r.first_name}`.toLowerCase().includes(query)) } };
      }
      case "get_class_statistics": {
        const r = await rClass(sb, s(args.class_id), s(args.class_name));
        if (!r.ok) return r;
        const { count } = await sb.from("students").select("id", { count: "exact", head: true }).eq("class_id", r.classId).is("archived_at", null);
        return { ok: true, data: { class_id: r.classId, class_name: r.className, eleves_actifs: count ?? 0 } };
      }
      case "rank_students": {
        const r = await rClass(sb, s(args.class_id), s(args.class_name));
        if (!r.ok) return r;
        const { data: periods } = await sb.from("grade_periods").select("id,period_number").eq("class_id", r.classId).order("period_number", { ascending: false }).limit(1);
        const pid = periods?.[0]?.id;
        if (!pid) return { ok: true, data: { ranking: [], message: "Aucune période" } };
        const { data: cards } = await sb.from("student_report_cards").select("student_id,general_average").eq("class_id", r.classId).eq("period_id", pid);
        const { data: studs } = await sb.from("students").select("id,first_name,last_name").eq("class_id", r.classId).is("archived_at", null);
        const names = new Map((studs ?? []).map((st) => [st.id, `${st.last_name} ${st.first_name}`]));
        const ranking = (cards ?? []).map((c) => ({ name: names.get(c.student_id) || c.student_id, average: c.general_average })).sort((a, b) => Number(b.average ?? 0) - Number(a.average ?? 0)).slice(0, 30);
        return { ok: true, data: { period_number: periods?.[0]?.period_number, ranking } };
      }
      case "list_audit_logs": {
        const { data, error } = await sb.from("audit_logs").select("id,action,created_at,entity_type,metadata").order("created_at", { ascending: false }).limit(Number(args.limit) || 15);
        if (error) return { ok: false, error: { code: "DB", message: error.message } };
        return { ok: true, data: { logs: data ?? [] } };
      }
      case "list_periods": return listPer(sb, args);
      case "get_student_grades": return getGrades(sb, args);
      case "check_grades_completeness": return checkGradesCompleteness(sb, args);
      case "upsert_grade": return upGrade(sb, args);
      case "delete_grade": return delGrade(sb, args);
      case "open_period": return openPeriod(sb, args);
      case "close_period": return closePeriod(sb, args);
      default: return { ok: false, error: { code: "UNKNOWN_TOOL", message: name } };
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
      if (!res.ok) { console.error("gemini", model, res.status, (await res.text()).slice(0, 200)); continue; }
      return await res.json();
    } catch (e) { console.error("gemini fetch", model, e); }
  }
  return null;
}

function extract(j: { candidates?: { content?: { parts?: Content["parts"] } }[] }) {
  const parts = j?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text || "").join("").trim();
  const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
  return { text, calls, rawParts: parts };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jr({ ok: false, error: { code: "VALIDATION", message: "Méthode non autorisée." } }, 405);
  try {
    const authH = req.headers.get("Authorization") ?? "";
    if (!authH.toLowerCase().startsWith("bearer ")) return jr({ ok: false, error: { code: "UNAUTHENTICATED", message: "Session non authentifiée." } }, 401);
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const gkey = Deno.env.get("GEMINI_API_KEY") ?? "";
    if (!url || !anon || !gkey) return jr({ ok: false, error: { code: "CONFIG", message: "Config incomplète." } }, 500);
    const sb = createClient(url, anon, { global: { headers: { Authorization: authH } }, auth: { persistSession: false, autoRefreshToken: false } });
    const af = await auth(sb);
    if (af) return jr(af, af.error.code === "FORBIDDEN" ? 403 : 401);
    let body: { message?: unknown; history?: unknown };
    try { body = await req.json(); } catch { return jr({ ok: false, error: { code: "VALIDATION", message: "JSON invalide." } }, 400); }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return jr({ ok: false, error: { code: "VALIDATION", message: "Message vide." } }, 400);
    if (message.length > 2000) return jr({ ok: false, error: { code: "VALIDATION", message: "Message trop long." } }, 400);
    const history: { role: string; content: string }[] = [];
    for (const h of Array.isArray(body.history) ? body.history : []) {
      if (!h || typeof h !== "object") continue;
      const role = (h as { role?: unknown }).role;
      const content = (h as { content?: unknown }).content;
      if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim()) history.push({ role, content: content.trim().slice(0, 2000) });
    }
    const contents: Content[] = [];
    for (const h of history.slice(-20)) contents.push({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.content }] });
    contents.push({ role: "user", parts: [{ text: message }] });
    let reply = "";
    for (let round = 0; round < 8; round++) {
      const gj = await callGemini(gkey, contents);
      if (!gj) return jr({ ok: false, error: { code: "UPSTREAM", message: "Erreur IA Gemini." } }, 502);
      const { text, calls, rawParts } = extract(gj);
      if (!calls.length) { reply = text || "Sans réponse."; break; }
      contents.push({ role: "model", parts: rawParts });
      const frParts: Content["parts"] = [];
      for (const c of calls) frParts.push({ functionResponse: { name: c.name, response: await runTool(sb, c.name, c.args || {}) } });
      contents.push({ role: "user", parts: frParts });
      if (round === 7) { const fj = await callGemini(gkey, contents); reply = extract(fj || {}).text || text || "Synthèse indisponible."; }
    }
    return jr({ ok: true, data: { reply } });
  } catch (e) {
    console.error(e);
    return jr({ ok: false, error: { code: "INTERNAL", message: "Erreur interne." } }, 500);
  }
});
