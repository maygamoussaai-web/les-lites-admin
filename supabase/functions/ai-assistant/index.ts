import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type TR = { ok: true; data: Record<string, unknown> } | { ok: false; error: { code: string; message: string; candidates?: unknown[] } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const s = (v: unknown) => typeof v === "string" ? v.trim() : "";
const iu = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const fn = (l: string, f: string) => `${(l || "").trim()} ${(f || "").trim()}`.trim();
const conf = (a: Record<string, unknown>) => a.confirmed === true || a.confirmed === "true";
function age(dob?: string | null) {
  if (!dob) return null;
  const d = new Date(dob); if (Number.isNaN(d.getTime())) return null;
  const n = new Date(); let a = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
  return a >= 0 && a < 120 ? a : null;
}
function fd(dob?: string | null) {
  if (!dob) return null;
  const d = new Date(dob); if (Number.isNaN(d.getTime())) return String(dob);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

async function auth(sb: SupabaseClient): Promise<TR | null> {
  const { data: ud } = await sb.auth.getUser();
  if (!ud?.user) return { ok: false, error: { code: "UNAUTHENTICATED", message: "Session non authentifiée." } };
  const { data: p } = await sb.from("admin_profiles").select("id,is_active").eq("id", ud.user.id).maybeSingle();
  if (!p) return { ok: false, error: { code: "UNAUTHENTICATED", message: "Session non authentifiée." } };
  if (!p.is_active) return { ok: false, error: { code: "FORBIDDEN", message: "Compte inactif." } };
  return null;
}
async function acc(sb: SupabaseClient, eid: string) {
  const { data } = await sb.rpc("has_establishment_access", { target_establishment_id: eid });
  return data === true;
}
/** Enseignant accessible ssi au moins une affectation dans un établissement autorisé. */
async function teaAccessible(sb: SupabaseClient, teacherId: string): Promise<boolean> {
  const { data } = await sb.from("teacher_assignments").select("establishment_id").eq("teacher_id", teacherId);
  for (const row of data ?? []) {
    if (await acc(sb, row.establishment_id as string)) return true;
  }
  return false;
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
    const p = q.split(/\s+/).filter(Boolean);
    let qq = sb.from("students").select("*").limit(10);
    if (!allowArchived) qq = qq.is("archived_at", null);
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
  if (!st || !(await acc(sb, st.establishment_id as string))) return { ok: false, error: { code: "NOT_FOUND", message: "Élève introuvable." } };
  return { ok: true, student: st };
}
async function rEst(sb: SupabaseClient, eid: string, ename: string): Promise<TR | { ok: true; establishmentId: string; name: string }> {
  if (iu(eid)) {
    const { data } = await sb.from("establishments").select("id,name").eq("id", eid).maybeSingle();
    if (!data || !(await acc(sb, data.id))) return { ok: false, error: { code: "NOT_FOUND", message: "Établissement introuvable." } };
    return { ok: true, establishmentId: data.id, name: data.name };
  }
  if (!ename) return { ok: false, error: { code: "VALIDATION", message: "establishment_id ou establishment_name requis." } };
  const { data } = await sb.from("establishments").select("id,name").ilike("name", `%${ename}%`).limit(10);
  const a: { id: string; name: string }[] = [];
  for (const e of data ?? []) if (await acc(sb, e.id)) a.push(e);
  if (!a.length) return { ok: false, error: { code: "NOT_FOUND", message: `Établissement « ${ename} » introuvable.` } };
  if (a.length > 1) return { ok: false, error: { code: "AMBIGUOUS", message: "Plusieurs établissements.", candidates: a } };
  return { ok: true, establishmentId: a[0].id, name: a[0].name };
}
async function rTea(sb: SupabaseClient, tid: string, q: string): Promise<TR | { ok: true; teacher: Record<string, unknown> }> {
  let t: Record<string, unknown> | null = null;
  if (iu(tid)) {
    const { data } = await sb.from("teachers").select("*").eq("id", tid).maybeSingle();
    t = data;
  } else if (q) {
    const { data } = await sb.from("teachers").select("*").is("archived_at", null).or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`).limit(8);
    const ac: Record<string, unknown>[] = [];
    for (const x of data ?? []) {
      if (await teaAccessible(sb, x.id as string)) ac.push(x);
    }
    if (ac.length > 1) return { ok: false, error: { code: "AMBIGUOUS", message: "Plusieurs enseignants.", candidates: ac.map((x) => ({ id: x.id, name: fn(x.last_name as string, x.first_name as string) })) } };
    t = ac[0] ?? null;
  }
  if (!t || !(await teaAccessible(sb, t.id as string))) return { ok: false, error: { code: "NOT_FOUND", message: "Enseignant introuvable." } };
  return { ok: true, teacher: t };
}

// ——— READ ———
async function listEst(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const all = a.include_inactive === true;
  let q = sb.from("establishments").select("id,name,type,address,phone,is_active").order("name");
  if (!all) q = q.eq("is_active", true);
  const { data } = await q;
  const o: Record<string, unknown>[] = [];
  for (const e of data ?? []) if (await acc(sb, e.id)) o.push(e);
  return { ok: true, data: { count: o.length, establishments: o } };
}
async function listCls(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const q = s(a.query) || s(a.name);
  let qq = sb.from("classes").select("id,name,establishment_id,capacity,is_active,fee_plan_id").order("name").limit(50);
  if (a.include_inactive !== true) qq = qq.eq("is_active", true);
  if (q) qq = qq.ilike("name", `%${q}%`);
  const { data, error } = await qq;
  if (error) return { ok: false, error: { code: "INTERNAL", message: "Impossible de lister les classes." } };
  const o: Record<string, unknown>[] = [];
  for (const c of data ?? []) {
    if (!(await acc(sb, c.establishment_id))) continue;
    const { count } = await sb.from("students").select("id", { count: "exact", head: true }).eq("class_id", c.id).is("archived_at", null);
    const { data: e } = await sb.from("establishments").select("name").eq("id", c.establishment_id).maybeSingle();
    o.push({ id: c.id, name: c.name, establishment_name: e?.name ?? "", capacity: c.capacity, headcount: count ?? 0, is_active: c.is_active, fee_plan_id: c.fee_plan_id });
  }
  return { ok: true, data: { count: o.length, classes: o } };
}
async function listStu(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const q = s(a.query) || s(a.name);
  const cn = s(a.class_name);
  let cid = s(a.class_id);
  let rn = cn;
  if (!iu(cid) && cn) {
    const r = await rClass(sb, "", cn);
    if (!r.ok) return r;
    cid = r.classId; rn = r.className;
  }
  let qq = sb.from("students").select("id,first_name,last_name,gender,date_of_birth,class_id,establishment_id,enrolled_at,archived_at").order("last_name").limit(50);
  if (a.include_archived !== true) qq = qq.is("archived_at", null);
  if (iu(cid)) qq = qq.eq("class_id", cid);
  if (q) qq = qq.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
  const { data, error } = await qq;
  if (error) return { ok: false, error: { code: "INTERNAL", message: "Impossible de lister les élèves." } };
  const o: Record<string, unknown>[] = [];
  for (const x of data ?? []) {
    if (!(await acc(sb, x.establishment_id))) continue;
    const dob = x.date_of_birth as string | null;
    o.push({ id: x.id, name: fn(x.last_name, x.first_name), gender: x.gender, date_of_birth: fd(dob), age: age(dob), class_name: rn || null, enrolled_at: x.enrolled_at, is_archived: !!x.archived_at });
  }
  return { ok: true, data: { count: o.length, class_name: rn || null, students: o } };
}
async function getStu(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const r = await rStud(sb, s(a.student_id), s(a.query) || [s(a.first_name), s(a.last_name)].filter(Boolean).join(" "), true);
  if (!r.ok) return r;
  const x = r.student;
  const dob = x.date_of_birth as string | null;
  let cn: string | null = null, en: string | null = null;
  if (x.class_id) { const { data: k } = await sb.from("classes").select("name").eq("id", x.class_id as string).maybeSingle(); cn = k?.name ?? null; }
  if (x.establishment_id) { const { data: e } = await sb.from("establishments").select("name").eq("id", x.establishment_id as string).maybeSingle(); en = e?.name ?? null; }
  const d: Record<string, unknown> = {
    id: x.id, name: fn(x.last_name as string, x.first_name as string), first_name: x.first_name, last_name: x.last_name, gender: x.gender,
    date_of_birth: fd(dob), age: age(dob), class_name: cn, establishment_name: en, enrolled_at: x.enrolled_at,
    term1_average: x.term1_average, term2_average: x.term2_average, term3_average: x.term3_average, is_archived: !!x.archived_at, photo_url: x.photo_url ?? null,
  };
  if (a.include_phones === true || a.include_phones === "true") { d.parent_phone_1 = x.parent_phone_1 ?? null; d.parent_phone_2 = x.parent_phone_2 ?? null; }
  return { ok: true, data: d };
}
async function listTea(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const q = s(a.query);
  let qq = sb.from("teachers").select("id,first_name,last_name,domain,phone,archived_at").order("last_name").limit(50);
  if (a.include_archived !== true) qq = qq.is("archived_at", null);
  if (q) qq = qq.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
  const { data } = await qq;
  const teachers: Record<string, unknown>[] = [];
  for (const t of data ?? []) {
    if (!(await teaAccessible(sb, t.id as string))) continue;
    teachers.push({ id: t.id, name: fn(t.last_name, t.first_name), domain: t.domain, is_archived: !!t.archived_at });
  }
  return { ok: true, data: { count: teachers.length, teachers } };
}
async function getTea(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const r = await rTea(sb, s(a.teacher_id), s(a.query));
  if (!r.ok) return r;
  const t = r.teacher;
  const { data: assigns } = await sb.from("teacher_assignments").select("id,establishment_id,payment_method,salary_amount,hourly_rate,is_active").eq("teacher_id", t.id as string);
  const assignments = [];
  for (const as of assigns ?? []) {
    if (!(await acc(sb, as.establishment_id))) continue;
    const { data: e } = await sb.from("establishments").select("name").eq("id", as.establishment_id).maybeSingle();
    assignments.push({ id: as.id, establishment_name: e?.name, payment_method: as.payment_method, salary_amount: as.salary_amount, hourly_rate: as.hourly_rate, is_active: as.is_active });
  }
  return { ok: true, data: { id: t.id, name: fn(t.last_name as string, t.first_name as string), domain: t.domain, is_archived: !!t.archived_at, assignments } };
}
async function listPer(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const r = await rClass(sb, s(a.class_id), s(a.class_name));
  if (!r.ok) return r;
  const { data } = await sb.from("grade_periods").select("id,period_number,started_at,ended_at").eq("class_id", r.classId).order("period_number");
  return { ok: true, data: { class_name: r.className, periods: (data ?? []).map((p) => ({ id: p.id, period_number: p.period_number, started_at: p.started_at, ended_at: p.ended_at, is_open: !p.ended_at })) } };
}
async function listSub(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const r = await rClass(sb, s(a.class_id), s(a.class_name));
  if (!r.ok) return r;
  const { data } = await sb.from("class_subjects").select("id,name").eq("class_id", r.classId).order("name");
  return { ok: true, data: { class_name: r.className, count: (data ?? []).length, subjects: data ?? [] } };
}
async function getGrades(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const sr = await rStud(sb, s(a.student_id), s(a.query) || [s(a.first_name), s(a.last_name)].filter(Boolean).join(" "));
  if (!sr.ok) return sr;
  const x = sr.student;
  const cid = x.class_id as string | null;
  if (!cid) return { ok: false, error: { code: "NOT_FOUND", message: "Élève sans classe." } };
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
  const { data: card } = await sb.from("student_report_cards").select("status,general_average,validated_at,subject_averages").eq("student_id", x.id as string).eq("period_id", pid).maybeSingle();
  return { ok: true, data: { student: fn(x.last_name as string, x.first_name as string), period_id: pid, subjects: Object.values(by), report_card: card, bulletin_note: "La génération Excel/PDF se fait dans l'interface de la classe." } };
}
async function getStats(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const r = await rClass(sb, s(a.class_id), s(a.class_name));
  if (!r.ok) return r;
  const { count } = await sb.from("students").select("id", { count: "exact", head: true }).eq("class_id", r.classId).is("archived_at", null);
  const { data: ps } = await sb.from("grade_periods").select("id,period_number").eq("class_id", r.classId).order("period_number", { ascending: false }).limit(1);
  const p = ps?.[0];
  let avg: number | null = null, wa = 0;
  if (p) {
    const { data: cards } = await sb.from("student_report_cards").select("general_average").eq("class_id", r.classId).eq("period_id", p.id);
    const av = (cards ?? []).map((c) => Number(c.general_average)).filter((n) => Number.isFinite(n));
    wa = av.length;
    avg = av.length ? Math.round((av.reduce((x, y) => x + y, 0) / av.length) * 100) / 100 : null;
  }
  const { count: sc } = await sb.from("class_subjects").select("id", { count: "exact", head: true }).eq("class_id", r.classId);
  return { ok: true, data: { class: { id: r.classId, name: r.className }, headcount: count ?? 0, subjects_count: sc ?? 0, period_number: p?.period_number ?? null, students_with_average: wa, class_average: avg, source: wa ? "official" : "incomplete" } };
}
async function overview(sb: SupabaseClient): Promise<TR> {
  const e = await listEst(sb, {});
  if (!e.ok) return e;
  const est = e.data.establishments as { id: string; name: string; type: string }[];
  let tc = 0, ts = 0;
  const by: Record<string, unknown>[] = [];
  for (const x of est) {
    const { count: cc } = await sb.from("classes").select("id", { count: "exact", head: true }).eq("establishment_id", x.id).eq("is_active", true);
    const { count: sc } = await sb.from("students").select("id", { count: "exact", head: true }).eq("establishment_id", x.id).is("archived_at", null);
    tc += cc ?? 0; ts += sc ?? 0;
    by.push({ name: x.name, type: x.type, classes: cc ?? 0, students: sc ?? 0 });
  }
  const seenTeachers = new Set<string>();
  for (const x of est) {
    const { data: assigns } = await sb.from("teacher_assignments").select("teacher_id").eq("establishment_id", x.id);
    for (const a of assigns ?? []) {
      const tid = a.teacher_id as string | null;
      if (tid) seenTeachers.add(tid);
    }
  }
  return { ok: true, data: { establishments_count: est.length, classes_count: tc, students_count: ts, teachers_count: seenTeachers.size, by_establishment: by } };
}
async function search(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const q = s(a.query);
  if (q.length < 2) return { ok: false, error: { code: "VALIDATION", message: "query min 2." } };
  const r: Record<string, unknown> = {};
  const c = await listCls(sb, { query: q }); if (c.ok) r.classes = c.data.classes;
  const st = await listStu(sb, { query: q }); if (st.ok) r.students = st.data.students;
  const t = await listTea(sb, { query: q }); if (t.ok) r.teachers = t.data.teachers;
  return { ok: true, data: { query: q, results: r } };
}
async function listDocs(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const sr = await rStud(sb, s(a.student_id), s(a.query));
  if (!sr.ok) return sr;
  const { data } = await sb.from("student_documents").select("id,name,file_type,file_size,created_at").eq("student_id", sr.student.id as string).order("created_at", { ascending: false });
  return { ok: true, data: { student: fn(sr.student.last_name as string, sr.student.first_name as string), count: (data ?? []).length, documents: (data ?? []).map((d) => ({ id: d.id, name: d.name, file_type: d.file_type, file_size: d.file_size, created_at: d.created_at })) } };
}
async function listEnroll(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const sr = await rStud(sb, s(a.student_id), s(a.query));
  if (!sr.ok) return sr;
  const { data } = await sb.from("student_enrollments").select("id,establishment_name,class_name,total_amount,started_at,ended_at,fee_plan_id").eq("student_id", sr.student.id as string).order("started_at", { ascending: false });
  return { ok: true, data: { student: fn(sr.student.last_name as string, sr.student.first_name as string), enrollments: data ?? [] } };
}
async function listFeePlans(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const er = await rEst(sb, s(a.establishment_id), s(a.establishment_name));
  let eid: string | null = er.ok ? er.establishmentId : null;
  let qq = sb.from("fee_plans").select("id,name,total_amount,establishment_id").order("name");
  if (eid) qq = qq.eq("establishment_id", eid);
  const { data } = await qq;
  const o: Record<string, unknown>[] = [];
  for (const p of data ?? []) {
    if (!(await acc(sb, p.establishment_id))) continue;
    const { data: inst } = await sb.from("fee_plan_installments").select("id,label,amount,due_date,position").eq("fee_plan_id", p.id).order("position");
    o.push({ id: p.id, name: p.name, total_amount: p.total_amount, installments: inst ?? [] });
  }
  return { ok: true, data: { count: o.length, fee_plans: o } };
}
async function getStuFinance(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const sr = await rStud(sb, s(a.student_id), s(a.query));
  if (!sr.ok) return sr;
  const sid = sr.student.id as string;
  const { data: pays } = await sb.from("tuition_payments").select("id,amount,paid_at,method,note,enrollment_id").eq("student_id", sid).order("paid_at", { ascending: false }).limit(50);
  const { data: enrs } = await sb.from("student_enrollments").select("id,total_amount,class_name,establishment_name,ended_at,installments_snapshot").eq("student_id", sid).is("ended_at", null);
  const paid = (pays ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
  const due = (enrs ?? []).reduce((sum, e) => sum + Number(e.total_amount), 0);
  return { ok: true, data: { student: fn(sr.student.last_name as string, sr.student.first_name as string), total_due: due, total_paid: paid, balance: due - paid, active_enrollments: enrs ?? [], recent_payments: pays ?? [] } };
}
async function listAudit(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const lim = Math.min(Number(a.limit ?? 30), 50);
  let qq = sb.from("audit_logs").select("id,action,entity_type,entity_id,establishment_id,metadata,created_at,actor_id").order("created_at", { ascending: false }).limit(lim);
  if (s(a.entity_type)) qq = qq.eq("entity_type", s(a.entity_type));
  const { data } = await qq;
  const o: Record<string, unknown>[] = [];
  for (const row of data ?? []) {
    if (row.establishment_id && !(await acc(sb, row.establishment_id as string))) continue;
    o.push({ id: row.id, action: row.action, entity_type: row.entity_type, entity_id: row.entity_id, created_at: row.created_at, metadata: row.metadata });
  }
  return { ok: true, data: { count: o.length, logs: o } };
}
async function listInvites(sb: SupabaseClient): Promise<TR> {
  const { data } = await sb.from("invitations").select("id,establishment_id,expires_at,accepted_at,created_at").order("created_at", { ascending: false }).limit(30);
  const o: Record<string, unknown>[] = [];
  for (const i of data ?? []) {
    if (!(await acc(sb, i.establishment_id))) continue;
    const { data: e } = await sb.from("establishments").select("name").eq("id", i.establishment_id).maybeSingle();
    o.push({ id: i.id, establishment_name: e?.name, expires_at: i.expires_at, accepted: !!i.accepted_at, created_at: i.created_at });
  }
  return { ok: true, data: { count: o.length, invitations: o } };
}
async function listTeaPay(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const r = await rTea(sb, s(a.teacher_id), s(a.query));
  if (!r.ok) return r;
  const { data } = await sb.from("teacher_payments").select("id,amount,paid_at,note,establishment_id").eq("teacher_id", r.teacher.id as string).order("paid_at", { ascending: false }).limit(30);
  const o = [];
  for (const p of data ?? []) {
    if (!(await acc(sb, p.establishment_id))) continue;
    o.push({ id: p.id, amount: p.amount, paid_at: p.paid_at, note: p.note });
  }
  return { ok: true, data: { teacher: fn(r.teacher.last_name as string, r.teacher.first_name as string), payments: o } };
}

// ——— WRITE ———
async function createStu(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const first = s(a.first_name), last = s(a.last_name), gender = s(a.gender) || "M";
  if (!first || !last) return { ok: false, error: { code: "VALIDATION", message: "first_name et last_name requis." } };
  const r = await rClass(sb, s(a.class_id), s(a.class_name));
  if (!r.ok) return r;
  const row: Record<string, unknown> = { first_name: first, last_name: last, gender, class_id: r.classId, establishment_id: r.establishmentId, enrolled_at: s(a.enrolled_at) || new Date().toISOString().slice(0, 10) };
  if (s(a.date_of_birth)) row.date_of_birth = s(a.date_of_birth);
  if (s(a.parent_phone_1)) row.parent_phone_1 = s(a.parent_phone_1);
  const { data, error } = await sb.from("students").insert(row as never).select("id,first_name,last_name").single();
  if (error) return { ok: false, error: { code: "INTERNAL", message: "Création échouée: " + error.message } };
  return { ok: true, data: { created: true, id: data.id, name: fn(data.last_name, data.first_name), class_name: r.className } };
}
async function updateStu(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const sr = await rStud(sb, s(a.student_id), s(a.query), true);
  if (!sr.ok) return sr;
  const patch: Record<string, unknown> = {};
  for (const k of ["first_name", "last_name", "gender", "date_of_birth", "parent_phone_1", "parent_phone_2"] as const) {
    if (a[k] !== undefined && s(a[k])) patch[k] = s(a[k]);
  }
  if (!Object.keys(patch).length) return { ok: false, error: { code: "VALIDATION", message: "Aucun champ à modifier." } };
  const { error } = await sb.from("students").update(patch as never).eq("id", sr.student.id as string);
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { updated: true, id: sr.student.id, fields: Object.keys(patch) } };
}
async function archiveStu(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const un = a.unarchive === true || a.unarchive === "true";
  const sr = await rStud(sb, s(a.student_id), s(a.query), true);
  if (!sr.ok) return sr;
  const { error } = await sb.from("students").update({ archived_at: un ? null : new Date().toISOString() } as never).eq("id", sr.student.id as string);
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { archived: !un, id: sr.student.id, name: fn(sr.student.last_name as string, sr.student.first_name as string) } };
}
async function transferStu(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const sr = await rStud(sb, s(a.student_id), s(a.query));
  if (!sr.ok) return sr;
  const cr = await rClass(sb, s(a.to_class_id), s(a.to_class_name) || s(a.class_name));
  if (!cr.ok) return cr;
  const st = sr.student;
  const { error: te } = await sb.from("student_transfers").insert({
    student_id: st.id, from_establishment_id: st.establishment_id, from_class_id: st.class_id,
    to_establishment_id: cr.establishmentId, to_class_id: cr.classId,
  } as never);
  if (te) return { ok: false, error: { code: "INTERNAL", message: te.message } };
  const { error } = await sb.from("students").update({ class_id: cr.classId, establishment_id: cr.establishmentId } as never).eq("id", st.id as string);
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { transferred: true, student: fn(st.last_name as string, st.first_name as string), to_class: cr.className } };
}
async function upGrade(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const sr = await rStud(sb, s(a.student_id), s(a.query) || s(a.student_name));
  if (!sr.ok) return sr;
  const x = sr.student;
  const cid = x.class_id as string, eid = x.establishment_id as string;
  if (!cid) return { ok: false, error: { code: "VALIDATION", message: "Élève sans classe." } };
  const nature = s(a.nature) || "composition";
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
      return { ok: true, data: { updated: true, grade_id: ex.id, nature, value, scale } };
    }
  }
  const { data: ins, error } = await sb.from("grades").insert({ period_id: pid, class_id: cid, establishment_id: eid, subject_id: sid, student_id: x.id, nature, sequence_number: 1, value, scale } as never).select("id").single();
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { created: true, grade_id: ins.id, nature, value, scale } };
}
async function delGrade(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const gid = s(a.grade_id);
  if (!iu(gid)) return { ok: false, error: { code: "VALIDATION", message: "grade_id requis." } };
  const { data: g } = await sb.from("grades").select("id,establishment_id,student_id").eq("id", gid).maybeSingle();
  if (!g || !(await acc(sb, g.establishment_id))) return { ok: false, error: { code: "NOT_FOUND", message: "Note introuvable." } };
  const { error } = await sb.from("grades").delete().eq("id", gid);
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { deleted: true, grade_id: gid } };
}
async function closePeriod(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const r = await rClass(sb, s(a.class_id), s(a.class_name));
  if (!r.ok) return r;
  let pid = s(a.period_id);
  const pn = a.period_number != null ? Number(a.period_number) : null;
  if (!iu(pid)) {
    let qq = sb.from("grade_periods").select("id,period_number,ended_at").eq("class_id", r.classId).order("period_number", { ascending: false });
    if (pn != null) qq = qq.eq("period_number", pn);
    const { data: ps } = await qq.limit(1);
    if (!ps?.[0]) return { ok: false, error: { code: "NOT_FOUND", message: "Période introuvable." } };
    pid = ps[0].id;
  }
  const reopen = a.reopen === true || a.reopen === "true";
  const { error } = await sb.from("grade_periods").update({ ended_at: reopen ? null : new Date().toISOString() } as never).eq("id", pid);
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { period_id: pid, closed: !reopen, class_name: r.className } };
}
async function createCls(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const name = s(a.name) || s(a.class_name);
  if (!name) return { ok: false, error: { code: "VALIDATION", message: "name requis." } };
  const er = await rEst(sb, s(a.establishment_id), s(a.establishment_name));
  if (!er.ok) return er;
  const capacity = Number(a.capacity ?? 50);
  const row: Record<string, unknown> = { name, establishment_id: er.establishmentId, capacity: Number.isFinite(capacity) ? capacity : 50, is_active: true };
  if (iu(s(a.fee_plan_id))) row.fee_plan_id = s(a.fee_plan_id);
  const { data, error } = await sb.from("classes").insert(row as never).select("id,name").single();
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { created: true, id: data.id, name: data.name, establishment: er.name } };
}
async function updateCls(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const r = await rClass(sb, s(a.class_id), s(a.class_name) || s(a.query));
  if (!r.ok) return r;
  const patch: Record<string, unknown> = {};
  if (s(a.name) || s(a.new_name)) patch.name = s(a.name) || s(a.new_name);
  if (a.capacity != null) patch.capacity = Number(a.capacity);
  if (a.is_active === true || a.is_active === false || a.is_active === "true" || a.is_active === "false") patch.is_active = a.is_active === true || a.is_active === "true";
  if (iu(s(a.fee_plan_id))) patch.fee_plan_id = s(a.fee_plan_id);
  if (!Object.keys(patch).length) return { ok: false, error: { code: "VALIDATION", message: "Aucun champ à modifier." } };
  const { error } = await sb.from("classes").update(patch as never).eq("id", r.classId);
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { updated: true, id: r.classId, fields: Object.keys(patch) } };
}
async function addSub(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const r = await rClass(sb, s(a.class_id), s(a.class_name));
  if (!r.ok) return r;
  const name = s(a.subject_name) || s(a.name);
  if (!name) return { ok: false, error: { code: "VALIDATION", message: "subject_name requis." } };
  const { data, error } = await sb.from("class_subjects").insert({ class_id: r.classId, establishment_id: r.establishmentId, name } as never).select("id,name").single();
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { created: true, subject: data, class_name: r.className } };
}
async function remSub(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const r = await rClass(sb, s(a.class_id), s(a.class_name));
  if (!r.ok) return r;
  const name = s(a.subject_name) || s(a.name);
  let sid = s(a.subject_id);
  if (!iu(sid) && name) {
    const { data: subs } = await sb.from("class_subjects").select("id,name").eq("class_id", r.classId).ilike("name", `%${name}%`).limit(5);
    if (!subs?.length) return { ok: false, error: { code: "NOT_FOUND", message: "Matière introuvable." } };
    if (subs.length > 1) return { ok: false, error: { code: "AMBIGUOUS", message: "Plusieurs matières.", candidates: subs } };
    sid = subs[0].id;
  }
  if (!iu(sid)) return { ok: false, error: { code: "VALIDATION", message: "subject_id ou subject_name requis." } };
  const { error } = await sb.from("class_subjects").delete().eq("id", sid);
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { deleted: true, subject_id: sid, class_name: r.className } };
}
async function createEst(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const name = s(a.name);
  if (!name) return { ok: false, error: { code: "VALIDATION", message: "name requis." } };
  const type = s(a.type) || "école";
  const row: Record<string, unknown> = { name, type, is_active: true };
  if (s(a.address)) row.address = s(a.address);
  if (s(a.phone)) row.phone = s(a.phone);
  if (s(a.description)) row.description = s(a.description);
  const { data, error } = await sb.from("establishments").insert(row as never).select("id,name,type").single();
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { created: true, establishment: data } };
}
async function updateEst(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const er = await rEst(sb, s(a.establishment_id), s(a.establishment_name) || s(a.query));
  if (!er.ok) return er;
  const patch: Record<string, unknown> = {};
  if (s(a.name) || s(a.new_name)) patch.name = s(a.name) || s(a.new_name);
  if (s(a.type)) patch.type = s(a.type);
  if (s(a.address)) patch.address = s(a.address);
  if (s(a.phone)) patch.phone = s(a.phone);
  if (a.is_active === true || a.is_active === false || a.is_active === "true" || a.is_active === "false") patch.is_active = a.is_active === true || a.is_active === "true";
  if (!Object.keys(patch).length) return { ok: false, error: { code: "VALIDATION", message: "Aucun champ à modifier." } };
  const { error } = await sb.from("establishments").update(patch as never).eq("id", er.establishmentId);
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { updated: true, id: er.establishmentId, fields: Object.keys(patch) } };
}
async function createTea(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const first = s(a.first_name), last = s(a.last_name);
  if (!first || !last) return { ok: false, error: { code: "VALIDATION", message: "first_name et last_name requis." } };
  if (!s(a.establishment_id) && !s(a.establishment_name)) {
    return { ok: false, error: { code: "VALIDATION", message: "establishment_id ou establishment_name requis." } };
  }
  const er = await rEst(sb, s(a.establishment_id), s(a.establishment_name));
  if (!er.ok) return er;
  const row: Record<string, unknown> = { first_name: first, last_name: last };
  if (s(a.domain)) row.domain = s(a.domain);
  if (s(a.phone)) row.phone = s(a.phone);
  const { data, error } = await sb.from("teachers").insert(row as never).select("id,first_name,last_name").single();
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  const { error: ae } = await sb.from("teacher_assignments").insert({
    teacher_id: data.id,
    establishment_id: er.establishmentId,
    is_active: true,
  } as never);
  if (ae) return { ok: false, error: { code: "INTERNAL", message: ae.message } };
  return { ok: true, data: { created: true, id: data.id, name: fn(data.last_name, data.first_name), establishment_name: er.name } };
}
async function updateTea(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const r = await rTea(sb, s(a.teacher_id), s(a.query));
  if (!r.ok) return r;
  const patch: Record<string, unknown> = {};
  for (const k of ["first_name", "last_name", "domain", "phone"] as const) if (s(a[k])) patch[k] = s(a[k]);
  if (!Object.keys(patch).length) return { ok: false, error: { code: "VALIDATION", message: "Aucun champ à modifier." } };
  const { error } = await sb.from("teachers").update(patch as never).eq("id", r.teacher.id as string);
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { updated: true, id: r.teacher.id, fields: Object.keys(patch) } };
}
async function archiveTea(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const un = a.unarchive === true || a.unarchive === "true";
  const r = await rTea(sb, s(a.teacher_id), s(a.query));
  if (!r.ok) return r;
  const { error } = await sb.from("teachers").update({ archived_at: un ? null : new Date().toISOString() } as never).eq("id", r.teacher.id as string);
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { archived: !un, id: r.teacher.id, name: fn(r.teacher.last_name as string, r.teacher.first_name as string) } };
}
async function recordTuition(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const sr = await rStud(sb, s(a.student_id), s(a.query));
  if (!sr.ok) return sr;
  const amount = Number(a.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: { code: "VALIDATION", message: "amount positif requis." } };
  const method = s(a.method) || "espèces";
  const paid_at = s(a.paid_at) || new Date().toISOString().slice(0, 10);
  const row: Record<string, unknown> = { student_id: sr.student.id, establishment_id: sr.student.establishment_id, amount, method, paid_at };
  if (s(a.note)) row.note = s(a.note);
  if (iu(s(a.enrollment_id))) row.enrollment_id = s(a.enrollment_id);
  const { data, error } = await sb.from("tuition_payments").insert(row as never).select("id,amount,paid_at").single();
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { recorded: true, payment: data, student: fn(sr.student.last_name as string, sr.student.first_name as string) } };
}
async function recordTeaPay(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  if (!conf(a)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const r = await rTea(sb, s(a.teacher_id), s(a.query));
  if (!r.ok) return r;
  const er = await rEst(sb, s(a.establishment_id), s(a.establishment_name));
  if (!er.ok) return er;
  const amount = Number(a.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: { code: "VALIDATION", message: "amount positif requis." } };
  const paid_at = s(a.paid_at) || new Date().toISOString().slice(0, 10);
  const row: Record<string, unknown> = { teacher_id: r.teacher.id, establishment_id: er.establishmentId, amount, paid_at };
  if (s(a.note)) row.note = s(a.note);
  const { data, error } = await sb.from("teacher_payments").insert(row as never).select("id,amount,paid_at").single();
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { recorded: true, payment: data, teacher: fn(r.teacher.last_name as string, r.teacher.first_name as string) } };
}


async function unarchiveStu(sb: SupabaseClient, args: Record<string, unknown>): Promise<TR> {
  if (!conf(args)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const sr = await rStud(sb, s(args.student_id), s(args.query), true);
  if (!sr.ok) return sr;
  const { error } = await sb.from("students").update({ archived_at: null } as never).eq("id", sr.student.id as string);
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { unarchived: true, id: sr.student.id, name: fn(sr.student.last_name as string, sr.student.first_name as string) } };
}
async function openPeriod(sb: SupabaseClient, args: Record<string, unknown>): Promise<TR> {
  if (!conf(args)) return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "Confirmation requise (confirmed=true après oui)." } };
  const r = await rClass(sb, s(args.class_id), s(args.class_name));
  if (!r.ok) return r;
  const { data: last } = await sb.from("grade_periods").select("period_number").eq("class_id", r.classId).order("period_number", { ascending: false }).limit(1);
  const next = ((last?.[0]?.period_number as number) ?? 0) + 1;
  const { data, error } = await sb.from("grade_periods").insert({
    class_id: r.classId, establishment_id: r.establishmentId, period_number: next, started_at: new Date().toISOString(),
  } as never).select("id,period_number").single();
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  return { ok: true, data: { opened: true, period_id: data.id, period_number: data.period_number, class_name: r.className } };
}
async function listTuition(sb: SupabaseClient, args: Record<string, unknown>): Promise<TR> {
  const query = s(args.query) || s(args.student_name);
  let studentId = s(args.student_id);
  if (!iu(studentId) && query) {
    const sr = await rStud(sb, "", query);
    if (!sr.ok) return sr;
    studentId = sr.student.id as string;
  }
  let q = sb.from("tuition_payments").select("id,student_id,amount,paid_at,method,note,establishment_id").order("paid_at", { ascending: false }).limit(50);
  if (iu(studentId)) q = q.eq("student_id", studentId);
  const { data, error } = await q;
  if (error) return { ok: false, error: { code: "INTERNAL", message: error.message } };
  const out: Record<string, unknown>[] = [];
  for (const p of data ?? []) {
    if (!(await acc(sb, p.establishment_id))) continue;
    out.push({ id: p.id, student_id: p.student_id, amount: p.amount, paid_at: p.paid_at, method: p.method, note: p.note });
  }
  return { ok: true, data: { count: out.length, payments: out } };
}
async function listTeaSessions(sb: SupabaseClient, args: Record<string, unknown>): Promise<TR> {
  const query = s(args.query) || s(args.teacher_name);
  const tr = await rTea(sb, s(args.teacher_id), query);
  if (!tr.ok) return tr;
  const teacherId = tr.teacher.id as string;
  const { data: assigns } = await sb.from("teacher_assignments").select("id,establishment_id,is_active,payment_method,salary_amount").eq("teacher_id", teacherId);
  const sessions: Record<string, unknown>[] = [];
  const safeAssigns: Record<string, unknown>[] = [];
  for (const a of assigns ?? []) {
    if (!(await acc(sb, a.establishment_id))) continue;
    safeAssigns.push({ id: a.id, is_active: a.is_active, payment_method: a.payment_method, salary_amount: a.salary_amount });
    const { data: sess } = await sb.from("teacher_sessions").select("id,name,weekday,duration_minutes,is_done,class_id,subject_id").eq("assignment_id", a.id);
    for (const sessRow of sess ?? []) sessions.push({ ...sessRow, assignment_id: a.id });
  }
  return { ok: true, data: { teacher_id: teacherId, assignments: safeAssigns, sessions } };
}


async function listCapabilities(): Promise<TR> {
  return {
    ok: true,
    data: {
      role: "Assistant autonome admin — Les Élites de Gao",
      lecture: [
        "list_capabilities", "search", "list_establishments", "list_classes", "list_students", "get_student",
        "rank_students", "list_teachers", "get_teacher", "list_periods", "list_subjects", "get_student_grades",
        "get_class_statistics", "get_complex_overview", "list_student_documents", "list_student_enrollments",
        "list_fee_plans", "get_student_finance", "list_audit_logs", "list_invitations", "list_teacher_payments",
        "list_tuition_payments", "list_teacher_sessions"
      ],
      ecriture: [
        "create_student", "update_student", "archive_student", "unarchive_student", "transfer_student",
        "upsert_grade", "delete_grade", "open_period", "close_period", "create_class", "update_class",
        "add_class_subject", "remove_class_subject", "create_establishment", "update_establishment",
        "create_teacher", "update_teacher", "archive_teacher", "record_tuition_payment", "record_teacher_payment"
      ],
      regle_confirmation: "Écriture : décrire l'action → attendre « oui » explicite → rappeler l'outil avec confirmed=true. Une seule confirmation.",
      acces: "Toutes les données accessibles via RLS du compte admin authentifié (tous les élèves/classes des établissements autorisés)."
    }
  };
}

async function rankStudents(sb: SupabaseClient, a: Record<string, unknown>): Promise<TR> {
  const r = await rClass(sb, s(a.class_id), s(a.class_name));
  if (!r.ok) return r;
  const order = (s(a.order) || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const { data: ps } = await sb.from("grade_periods").select("id,period_number").eq("class_id", r.classId).order("period_number", { ascending: false }).limit(5);
  let pid = "";
  let pnum: number | null = null;
  const want = a.period_number != null ? Number(a.period_number) : null;
  if (want != null && Number.isFinite(want) && ps) {
    const found = ps.find((p) => p.period_number === want);
    if (found) { pid = found.id; pnum = found.period_number; }
  }
  if (!pid && ps?.[0]) { pid = ps[0].id; pnum = ps[0].period_number; }
  if (!pid) return { ok: true, data: { class_name: r.className, ranking: [], message: "Aucune période de notes." } };
  const { data: cards } = await sb.from("student_report_cards").select("student_id,general_average,status").eq("class_id", r.classId).eq("period_id", pid);
  const { data: studs } = await sb.from("students").select("id,first_name,last_name").eq("class_id", r.classId).is("archived_at", null);
  const nameMap = new Map((studs ?? []).map((st) => [st.id, fn(st.last_name, st.first_name)]));
  const rows = (cards ?? [])
    .map((c) => ({
      student_id: c.student_id,
      name: nameMap.get(c.student_id) || "—",
      average: c.general_average != null ? Number(c.general_average) : null,
      status: c.status
    }))
    .filter((x) => x.average != null && Number.isFinite(x.average as number));
  rows.sort((a, b) => order === "asc" ? (a.average as number) - (b.average as number) : (b.average as number) - (a.average as number));
  const ranking = rows.map((x, i) => ({ rank: i + 1, name: x.name, average: x.average, status: x.status }));
  return { ok: true, data: { class_name: r.className, period_number: pnum, order, count: ranking.length, ranking } };
}

async function runTool(sb: SupabaseClient, name: string, args: Record<string, unknown>): Promise<TR> {
  switch (name) {
    case "list_capabilities": return listCapabilities();
    case "rank_students": return rankStudents(sb, args);
    case "list_establishments": return listEst(sb, args);
    case "list_classes": return listCls(sb, args);
    case "list_students": return listStu(sb, args);
    case "get_student": return getStu(sb, args);
    case "list_teachers": return listTea(sb, args);
    case "get_teacher": return getTea(sb, args);
    case "list_periods": return listPer(sb, args);
    case "list_subjects": return listSub(sb, args);
    case "get_student_grades": return getGrades(sb, args);
    case "get_class_statistics": return getStats(sb, args);
    case "get_complex_overview": return overview(sb);
    case "search": return search(sb, args);
    case "list_student_documents": return listDocs(sb, args);
    case "list_student_enrollments": return listEnroll(sb, args);
    case "list_fee_plans": return listFeePlans(sb, args);
    case "get_student_finance": return getStuFinance(sb, args);
    case "list_audit_logs": return listAudit(sb, args);
    case "list_invitations": return listInvites(sb);
    case "list_teacher_payments": return listTeaPay(sb, args);
    case "list_teacher_sessions": return listTeaSessions(sb, args);
    case "create_student": return createStu(sb, args);
    case "update_student": return updateStu(sb, args);
    case "archive_student": return archiveStu(sb, args);
    case "unarchive_student": return unarchiveStu(sb, args);
    case "transfer_student": return transferStu(sb, args);
    case "upsert_grade": return upGrade(sb, args);
    case "delete_grade": return delGrade(sb, args);
    case "close_period": return closePeriod(sb, args);
    case "open_period": return openPeriod(sb, args);
    case "create_class": return createCls(sb, args);
    case "update_class": return updateCls(sb, args);
    case "add_class_subject": return addSub(sb, args);
    case "remove_class_subject": return remSub(sb, args);
    case "create_establishment": return createEst(sb, args);
    case "update_establishment": return updateEst(sb, args);
    case "create_teacher": return createTea(sb, args);
    case "update_teacher": return updateTea(sb, args);
    case "archive_teacher": return archiveTea(sb, args);
    case "record_tuition_payment": return recordTuition(sb, args);
    case "list_tuition_payments": return listTuition(sb, args);
    case "record_teacher_payment": return recordTeaPay(sb, args);
    default: return { ok: false, error: { code: "INTERNAL", message: "Outil inconnu: " + name } };
  }
}

const MODELS = [
  Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];
const CORS: Record<string, string> = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const SYSTEM = `Tu es l'assistant admin professionnel de Les Élites de Gao (Mali).

RÈGLES DE RÉPONSE (strictes) :
1. Français, concis, professionnel. Pas de digressions, pas de formules vides (« je vais vérifier », « un instant »).
2. LECTURE : appelle IMMÉDIATEMENT l'outil adapté (list_*, get_*, search, rank_students, get_complex_overview, get_student_finance, list_audit_logs, list_capabilities). Ne dis jamais « impossible de vérifier » si un outil existe.
3. ÉCRITURE (create_*, update_*, archive_*, transfer_*, upsert_grade, delete_grade, close/open_period, add/remove_class_subject, record_*_payment) :
   - Étape 1 : décris l'action en 1–2 phrases précises + demande « Confirmez par oui ».
   - Étape 2 : UNIQUEMENT après un « oui » explicite de l'utilisateur, rappelle l'outil avec confirmed=true. Une seule confirmation suffit.
4. JAMAIS confirmed=true sans « oui » explicite dans le message utilisateur courant.
5. Âge / date de naissance : via get_student ou list_students uniquement.
6. Bulletins Excel/PDF : fournis les données (get_student_grades / rank_students) et oriente vers l'interface de la classe.
7. Pas d'UUID dans les réponses sauf si indispensable. Pas de téléphones sauf demande explicite. Pas de secrets.
8. Si un outil échoue, explique l'erreur concrète (NOT_FOUND, AMBIGUOUS, FORBIDDEN…) et propose la correction. Ne refuse jamais une capacité listée dans list_capabilities.
9. Format : listes markdown, **gras** pour noms importants, réponses structurées.`;

const TOOLS = [
  { name: "list_capabilities", description: "Liste TOUTES les capacités lecture+écriture de l'assistant.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "rank_students", description: "Classement des élèves d'une classe par moyenne. order=desc|asc.", parameters: { type: "object", properties: { class_id: { type: "string" }, class_name: { type: "string" }, order: { type: "string" }, period_number: { type: "integer" } }, required: [] } },
  { name: "search", description: "Recherche globale.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "list_establishments", description: "Liste établissements.", parameters: { type: "object", properties: { include_inactive: { type: "boolean" } }, required: [] } },
  { name: "list_classes", description: "Liste classes.", parameters: { type: "object", properties: { query: { type: "string" }, name: { type: "string" }, include_inactive: { type: "boolean" } }, required: [] } },
  { name: "list_students", description: "Liste élèves. class_name pour une classe. Renvoie age/DOB.", parameters: { type: "object", properties: { class_id: { type: "string" }, class_name: { type: "string" }, query: { type: "string" }, include_archived: { type: "boolean" } }, required: [] } },
  { name: "get_student", description: "Fiche élève complète.", parameters: { type: "object", properties: { student_id: { type: "string" }, query: { type: "string" }, include_phones: { type: "boolean" } }, required: [] } },
  { name: "list_teachers", description: "Liste enseignants.", parameters: { type: "object", properties: { query: { type: "string" }, include_archived: { type: "boolean" } }, required: [] } },
  { name: "get_teacher", description: "Fiche enseignant + affectations.", parameters: { type: "object", properties: { teacher_id: { type: "string" }, query: { type: "string" } }, required: [] } },
  { name: "list_periods", description: "Périodes de notes.", parameters: { type: "object", properties: { class_id: { type: "string" }, class_name: { type: "string" } }, required: [] } },
  { name: "list_subjects", description: "Matières d'une classe.", parameters: { type: "object", properties: { class_id: { type: "string" }, class_name: { type: "string" } }, required: [] } },
  { name: "get_student_grades", description: "Notes et bulletin données.", parameters: { type: "object", properties: { student_id: { type: "string" }, query: { type: "string" }, period_id: { type: "string" }, period_number: { type: "integer" } }, required: [] } },
  { name: "get_class_statistics", description: "Stats classe.", parameters: { type: "object", properties: { class_id: { type: "string" }, class_name: { type: "string" } }, required: [] } },
  { name: "get_complex_overview", description: "Vue d'ensemble.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "list_student_documents", description: "Documents d'un élève.", parameters: { type: "object", properties: { student_id: { type: "string" }, query: { type: "string" } }, required: [] } },
  { name: "list_student_enrollments", description: "Scolarités d'un élève.", parameters: { type: "object", properties: { student_id: { type: "string" }, query: { type: "string" } }, required: [] } },
  { name: "list_fee_plans", description: "Plans de scolarité.", parameters: { type: "object", properties: { establishment_id: { type: "string" }, establishment_name: { type: "string" } }, required: [] } },
  { name: "get_student_finance", description: "Paiements et solde élève.", parameters: { type: "object", properties: { student_id: { type: "string" }, query: { type: "string" } }, required: [] } },
  { name: "list_audit_logs", description: "Historique d'actions.", parameters: { type: "object", properties: { entity_type: { type: "string" }, limit: { type: "integer" } }, required: [] } },
  { name: "list_invitations", description: "Invitations admin.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "list_teacher_payments", description: "Paiements d'un enseignant.", parameters: { type: "object", properties: { teacher_id: { type: "string" }, query: { type: "string" } }, required: [] } },
 { name: "create_student", description: "Créer élève. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, first_name: { type: "string" }, last_name: { type: "string" }, gender: { type: "string" }, class_name: { type: "string" }, class_id: { type: "string" }, date_of_birth: { type: "string" }, parent_phone_1: { type: "string" } }, required: ["first_name", "last_name"] } },

{ name: "update_student", description: "Modifier élève. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, student_id: { type: "string" }, query: { type: "string" }, first_name: { type: "string" }, last_name: { type: "string" }, gender: { type: "string" }, date_of_birth: { type: "string" } }, required: [] } },

{ name: "archive_student", description: "Archiver/désarchiver élève. REQUIRES confirmed=true. unarchive=true pour restaurer.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, student_id: { type: "string" }, query: { type: "string" }, unarchive: { type: "boolean" } }, required: [] } },

{ name: "unarchive_student", description: "Désarchiver un élève. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, student_id: { type: "string" }, query: { type: "string" } }, required: [] } },

{ name: "open_period", description: "Ouvrir une nouvelle période de notes. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, class_id: { type: "string" }, class_name: { type: "string" } }, required: [] } },

{ name: "list_tuition_payments", description: "Liste paiements de scolarité.", parameters: { type: "object", properties: { student_id: { type: "string" }, query: { type: "string" } }, required: [] } },

{ name: "list_teacher_sessions", description: "Séances et affectations enseignant.", parameters: { type: "object", properties: { teacher_id: { type: "string" }, query: { type: "string" } }, required: [] } },

{ name: "transfer_student", description: "Transférer élève vers une classe. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, student_id: { type: "string" }, query: { type: "string" }, to_class_name: { type: "string" }, to_class_id: { type: "string" } }, required: [] } },

  { name: "upsert_grade", description: "Saisir note. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, student_id: { type: "string" }, query: { type: "string" }, subject_name: { type: "string" }, nature: { type: "string" }, value: { type: "number" }, scale: { type: "number" } }, required: ["value"] } },
  { name: "delete_grade", description: "Supprimer une note. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, grade_id: { type: "string" } }, required: ["grade_id"] } },
  { name: "close_period", description: "Clôturer/rouvrir période. REQUIRES confirmed=true. reopen=true pour rouvrir.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, class_name: { type: "string" }, class_id: { type: "string" }, period_id: { type: "string" }, period_number: { type: "integer" }, reopen: { type: "boolean" } }, required: [] } },
  { name: "create_class", description: "Créer classe. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, name: { type: "string" }, establishment_name: { type: "string" }, establishment_id: { type: "string" }, capacity: { type: "integer" }, fee_plan_id: { type: "string" } }, required: ["name"] } },
  { name: "update_class", description: "Modifier classe. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, class_id: { type: "string" }, class_name: { type: "string" }, name: { type: "string" }, capacity: { type: "integer" }, is_active: { type: "boolean" } }, required: [] } },
  { name: "add_class_subject", description: "Ajouter matière. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, class_name: { type: "string" }, class_id: { type: "string" }, subject_name: { type: "string" } }, required: ["subject_name"] } },
  { name: "remove_class_subject", description: "Retirer matière. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, class_name: { type: "string" }, subject_name: { type: "string" }, subject_id: { type: "string" } }, required: [] } },
  { name: "create_establishment", description: "Créer établissement. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, name: { type: "string" }, type: { type: "string" }, address: { type: "string" }, phone: { type: "string" } }, required: ["name"] } },
  { name: "update_establishment", description: "Modifier établissement. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, establishment_id: { type: "string" }, establishment_name: { type: "string" }, name: { type: "string" }, type: { type: "string" }, is_active: { type: "boolean" } }, required: [] } },
  { name: "create_teacher", description: "Créer enseignant dans un établissement autorisé. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, first_name: { type: "string" }, last_name: { type: "string" }, domain: { type: "string" }, phone: { type: "string" }, establishment_id: { type: "string" }, establishment_name: { type: "string" } }, required: ["first_name", "last_name"] } },
  { name: "update_teacher", description: "Modifier enseignant. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, teacher_id: { type: "string" }, query: { type: "string" }, first_name: { type: "string" }, last_name: { type: "string" }, domain: { type: "string" } }, required: [] } },
  { name: "archive_teacher", description: "Archiver enseignant. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, teacher_id: { type: "string" }, query: { type: "string" }, unarchive: { type: "boolean" } }, required: [] } },
  { name: "record_tuition_payment", description: "Enregistrer paiement scolarité. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, student_id: { type: "string" }, query: { type: "string" }, amount: { type: "number" }, method: { type: "string" }, paid_at: { type: "string" }, note: { type: "string" } }, required: ["amount"] } },
  { name: "record_teacher_payment", description: "Enregistrer paiement enseignant. REQUIRES confirmed=true.", parameters: { type: "object", properties: { confirmed: { type: "boolean" }, teacher_id: { type: "string" }, query: { type: "string" }, establishment_name: { type: "string" }, amount: { type: "number" }, paid_at: { type: "string" }, note: { type: "string" } }, required: ["amount"] } },
];

function jr(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
type Part = Record<string, unknown>;
type Content = { role: string; parts: Part[] };
class GErr extends Error { constructor(public st: number, public code: string) { super(code); } }
async function callGemini(key: string, contents: Content[]) {
  const body = JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, tools: [{ functionDeclarations: TOOLS }], generationConfig: { temperature: 0.15 } });
  let lastErr = "UPSTREAM_UNAVAILABLE";
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    for (let i = 0; i < 2; i++) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body });
        if (res.ok) return await res.json() as Record<string, unknown>;
        const t = await res.text();
        console.error("Gemini", model, res.status, t.slice(0, 180));
        lastErr = res.status === 404 || res.status === 400 ? "UPSTREAM_CONFIG" : "UPSTREAM_UNAVAILABLE";
        if (res.status === 404 || res.status === 400) break;
        if ((res.status === 503 || res.status === 429) && i < 1) {
          await new Promise((r) => setTimeout(r, 400 * (i + 1)));
          continue;
        }
        break;
      } catch (e) {
        console.error("Gemini fetch", model, e);
        lastErr = "UPSTREAM_UNAVAILABLE";
      }
    }
  }
  throw new GErr(0, lastErr);
}
function extract(j: Record<string, unknown>) {
  const parts = ((j.candidates as { content?: { parts?: Part[] } }[])?.[0]?.content?.parts) ?? [];
  let text = "";
  const fcs: { name: string; args: Record<string, unknown> }[] = [];
  for (const p of parts) {
    if (typeof p.text === "string") text += p.text;
    const fc = p.functionCall as { name?: string; args?: Record<string, unknown> } | undefined;
    if (fc?.name) fcs.push({ name: fc.name, args: fc.args ?? {} });
  }
  return { parts, text, fcs };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jr({ ok: false, error: { code: "VALIDATION", message: "Méthode non autorisée." } }, 405);
  try {
    const authH = req.headers.get("Authorization") ?? "";
    if (!authH.toLowerCase().startsWith("bearer ")) return jr({ ok: false, error: { code: "UNAUTHENTICATED", message: "Session non authentifiée." } }, 401);
    const jwt = authH.slice(7).trim();
    const url = Deno.env.get("SUPABASE_URL") ?? "", anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "", gkey = Deno.env.get("GEMINI_API_KEY") ?? "";
    if (!url || !anon || !gkey) return jr({ ok: false, error: { code: "INTERNAL", message: "Config incomplète." } }, 500);
    const sb = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const af = await auth(sb);
    if (af) return jr(af, af.error.code === "FORBIDDEN" ? 403 : 401);
    let body: { message?: unknown; history?: unknown };
    try { body = await req.json(); } catch { return jr({ ok: false, error: { code: "VALIDATION", message: "JSON invalide." } }, 400); }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const CONFIRM_RE = /^(oui|ok|d['']?accord|confirme[rz]?|valide[rz]?|go|yes|yep|ouais)\b/i;
    const userConfirmed = CONFIRM_RE.test(message.trim());

    if (!message) return jr({ ok: false, error: { code: "VALIDATION", message: "Message vide." } }, 400);
    if (message.length > 2000) return jr({ ok: false, error: { code: "VALIDATION", message: "Message trop long." } }, 400);
    const history: { role: string; content: string }[] = [];
    for (const h of (Array.isArray(body.history) ? body.history : [])) {
      if (!h || typeof h !== "object") continue;
      const role = (h as { role?: unknown }).role, content = (h as { content?: unknown }).content;
      if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim()) history.push({ role, content: content.trim().slice(0, 2000) });
    }
    const contents: Content[] = [];
    for (const h of history.slice(-24)) contents.push({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.content }] });
    contents.push({ role: "user", parts: [{ text: message }] });
    let reply = "";
    for (let round = 0; round < 8; round++) {
      const gj = await callGemini(gkey, contents);
      const { parts, text, fcs } = extract(gj);
      if (!fcs.length) { reply = text.trim() || "Reformulez votre question."; break; }
      contents.push({ role: "model", parts });
      const resp: Part[] = [];
      for (const fc of fcs) {
        console.log("tool", fc.name, JSON.stringify(fc.args).slice(0, 120));
        let toolArgs = fc.args;
        if (userConfirmed && typeof toolArgs === "object" && toolArgs !== null) {
          const writeTools = new Set([
            "create_student","update_student","archive_student","unarchive_student","transfer_student",
            "upsert_grade","delete_grade","open_period","close_period","create_class","update_class",
            "add_class_subject","remove_class_subject","create_establishment","update_establishment",
            "create_teacher","update_teacher","archive_teacher","record_tuition_payment","record_teacher_payment"
          ]);
          if (writeTools.has(fc.name)) toolArgs = { ...toolArgs, confirmed: true };
        }
        const result = await runTool(sb, fc.name, toolArgs);
        console.log("result", fc.name, result.ok ? "ok" : (result as { error: { code: string } }).error?.code);
        resp.push({ functionResponse: { name: fc.name, response: result.ok ? result.data : { error: result.error } } });
      }
      contents.push({ role: "user", parts: resp });
      if (round === 7) { const fj = await callGemini(gkey, contents); reply = extract(fj).text.trim() || "Synthèse échouée."; }
    }
    return jr({ ok: true, data: { reply: reply || "Reformulez votre question." } });
  } catch (e) {
    if (e instanceof GErr) {
      if (e.code === "UPSTREAM_UNAVAILABLE") return jr({ ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Assistant temporairement indisponible. Réessayez." } }, 503);
      return jr({ ok: false, error: { code: "UPSTREAM", message: "Erreur IA." } }, 502);
    }
    console.error("unhandled", e);
    return jr({ ok: false, error: { code: "INTERNAL", message: "Erreur interne." } }, 500);
  }
});
