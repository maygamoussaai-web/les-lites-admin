import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type ToolOk = { ok: true; data: Record<string, unknown> };
export type ToolErr = { ok: false; error: { code: string; message: string; candidates?: unknown[] } };
export type ToolResult = ToolOk | ToolErr;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string { return typeof v === "string" && UUID_RE.test(v); }
export function str(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }
export function fullName(last: string, first: string): string { return `${last} ${first}`.trim(); }
export const LIST_LIMIT = 25;

export async function assertActiveAdmin(sb: SupabaseClient): Promise<ToolResult | null> {
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) return { ok: false, error: { code: "UNAUTHENTICATED", message: "Session non authentifiée." } };
  const { data: profile, error: pErr } = await sb.from("admin_profiles").select("id, role, is_active").eq("id", userData.user.id).maybeSingle();
  if (pErr || !profile) return { ok: false, error: { code: "UNAUTHENTICATED", message: "Session non authentifiée." } };
  if (!profile.is_active) return { ok: false, error: { code: "FORBIDDEN", message: "Compte inactif." } };
  return null;
}

async function hasAccess(sb: SupabaseClient, establishmentId: string): Promise<boolean> {
  const { data, error } = await sb.rpc("has_establishment_access", { target_establishment_id: establishmentId });
  if (error) { console.error("has_establishment_access", error.message); return false; }
  return data === true;
}

async function toolListEstablishments(sb: SupabaseClient, _a: Record<string, unknown>): Promise<ToolResult> {
  const { data, error } = await sb.from("establishments").select("id, name, type, is_active").eq("is_active", true).order("name");
  if (error) return { ok: false, error: { code: "INTERNAL", message: "Impossible de lister les établissements." } };
  const out: { id: string; name: string; type: string }[] = [];
  for (const e of data ?? []) if (await hasAccess(sb, e.id)) out.push({ id: e.id, name: e.name, type: e.type });
  return { ok: true, data: { count: out.length, establishments: out } };
}

async function toolListClasses(sb: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const query = str(args.query) || str(args.name);
  let q = sb.from("classes").select("id, name, establishment_id, is_active, capacity").eq("is_active", true).order("name").limit(LIST_LIMIT);
  if (query) q = q.ilike("name", `%${query}%`);
  const { data, error } = await q;
  if (error) return { ok: false, error: { code: "INTERNAL", message: "Impossible de lister les classes." } };
  const rows = data ?? [];
  const estIds = [...new Set(rows.map((r) => r.establishment_id))];
  const { data: ests } = estIds.length ? await sb.from("establishments").select("id, name").in("id", estIds) : { data: [] as { id: string; name: string }[] };
  const estMap = new Map((ests ?? []).map((e) => [e.id, e.name]));
  const out: Record<string, unknown>[] = [];
  for (const c of rows) {
    if (!(await hasAccess(sb, c.establishment_id))) continue;
    const { count } = await sb.from("students").select("id", { count: "exact", head: true }).eq("class_id", c.id).is("archived_at", null);
    out.push({ id: c.id, name: c.name, establishment_id: c.establishment_id, establishment_name: estMap.get(c.establishment_id) ?? "", capacity: c.capacity, headcount: count ?? 0 });
  }
  return { ok: true, data: { count: out.length, classes: out } };
}

async function toolListStudents(sb: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const query = str(args.query) || str(args.name);
  const className = str(args.class_name);
  let classId = str(args.class_id);
  if (!isUuid(classId) && className) {
    const r = await toolListClasses(sb, { query: className });
    if (!r.ok) return r;
    const classes = r.data.classes as { id: string; name: string }[];
    if (!classes.length) return { ok: false, error: { code: "NOT_FOUND", message: "Classe introuvable." } };
    if (classes.length > 1) return { ok: false, error: { code: "AMBIGUOUS", message: "Plusieurs classes correspondent.", candidates: classes } };
    classId = classes[0].id;
  }
  let q = sb.from("students").select("id, first_name, last_name, gender, class_id, establishment_id").is("archived_at", null).order("last_name").limit(LIST_LIMIT);
  if (isUuid(classId)) q = q.eq("class_id", classId);
  if (query) q = q.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`);
  const { data, error } = await q;
  if (error) return { ok: false, error: { code: "INTERNAL", message: "Impossible de lister les élèves." } };
  const out: Record<string, unknown>[] = [];
  for (const s of data ?? []) {
    if (!(await hasAccess(sb, s.establishment_id))) continue;
    out.push({ id: s.id, name: fullName(s.last_name, s.first_name), first_name: s.first_name, last_name: s.last_name, gender: s.gender, class_id: s.class_id });
  }
  return { ok: true, data: { count: out.length, students: out } };
}

async function toolListTeachers(sb: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const query = str(args.query) || str(args.name);
  let q = sb.from("teachers").select("id, first_name, last_name, domain").order("last_name").limit(LIST_LIMIT);
  if (query) q = q.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`);
  const { data, error } = await q;
  if (error) return { ok: false, error: { code: "INTERNAL", message: "Impossible de lister les enseignants." } };
  const teachers = (data ?? []).map((t) => ({ id: t.id, name: fullName(t.last_name, t.first_name), domain: t.domain }));
  return { ok: true, data: { count: teachers.length, teachers } };
}

async function toolSearch(sb: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const query = str(args.query);
  if (query.length < 2) return { ok: false, error: { code: "VALIDATION", message: "query min 2 caractères." } };
  const type = str(args.type) || "all";
  const results: Record<string, unknown> = {};
  if (type === "all" || type === "class") { const r = await toolListClasses(sb, { query }); if (r.ok) results.classes = r.data.classes; }
  if (type === "all" || type === "student") { const r = await toolListStudents(sb, { query }); if (r.ok) results.students = r.data.students; }
  if (type === "all" || type === "teacher") { const r = await toolListTeachers(sb, { query }); if (r.ok) results.teachers = r.data.teachers; }
  if (type === "all" || type === "establishment") { const r = await toolListEstablishments(sb, {}); if (r.ok) results.establishments = (r.data.establishments as {name:string}[]).filter(e => e.name.toLowerCase().includes(query.toLowerCase())); }
  return { ok: true, data: { query, results } };
}

async function toolGetStudent(sb: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const r = await toolListStudents(sb, args);
  if (!r.ok) return r;
  const students = r.data.students as { id: string; name: string }[];
  if (!students.length) return { ok: false, error: { code: "NOT_FOUND", message: "Élève introuvable." } };
  if (students.length > 1 && !str(args.student_id)) return { ok: false, error: { code: "AMBIGUOUS", message: "Plusieurs élèves correspondent.", candidates: students } };
  return { ok: true, data: students[0] };
}

async function toolGetTeacher(sb: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const r = await toolListTeachers(sb, args);
  if (!r.ok) return r;
  const teachers = r.data.teachers as { id: string; name: string }[];
  if (!teachers.length) return { ok: false, error: { code: "NOT_FOUND", message: "Enseignant introuvable." } };
  if (teachers.length > 1) return { ok: false, error: { code: "AMBIGUOUS", message: "Plusieurs enseignants correspondent.", candidates: teachers } };
  return { ok: true, data: teachers[0] };
}

async function toolListPeriods(sb: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  let classId = str(args.class_id);
  const className = str(args.class_name);
  if (!isUuid(classId) && className) {
    const r = await toolListClasses(sb, { query: className });
    if (!r.ok) return r;
    const classes = r.data.classes as { id: string; name: string }[];
    if (classes.length !== 1) return { ok: false, error: { code: classes.length ? "AMBIGUOUS" : "NOT_FOUND", message: classes.length ? "Plusieurs classes." : "Classe introuvable.", candidates: classes } };
    classId = classes[0].id;
  }
  if (!isUuid(classId)) return { ok: false, error: { code: "VALIDATION", message: "class_id ou class_name requis." } };
  const { data, error } = await sb.from("grade_periods").select("id, period_number, name, started_at, ended_at").eq("class_id", classId).order("period_number");
  if (error) return { ok: false, error: { code: "INTERNAL", message: "Impossible de lister les périodes." } };
  return { ok: true, data: { class_id: classId, periods: data ?? [] } };
}

async function toolListSubjects(sb: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const classId = str(args.class_id);
  if (!isUuid(classId)) return { ok: false, error: { code: "VALIDATION", message: "class_id UUID requis." } };
  const { data: klass } = await sb.from("classes").select("id, name, establishment_id").eq("id", classId).maybeSingle();
  if (!klass || !(await hasAccess(sb, klass.establishment_id))) return { ok: false, error: { code: "NOT_FOUND", message: "Classe introuvable." } };
  const { data, error } = await sb.from("subjects").select("id, name").eq("class_id", classId).order("name");
  if (error) return { ok: false, error: { code: "INTERNAL", message: "Impossible de lister les matières." } };
  return { ok: true, data: { class: { id: klass.id, name: klass.name }, subjects: data ?? [] } };
}

async function toolGetClassStatistics(sb: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  let classId = str(args.class_id);
  const className = str(args.class_name);
  if (!isUuid(classId) && className) {
    const r = await toolListClasses(sb, { query: className });
    if (!r.ok) return r;
    const classes = r.data.classes as { id: string; name: string }[];
    if (classes.length !== 1) return { ok: false, error: { code: classes.length ? "AMBIGUOUS" : "NOT_FOUND", message: classes.length ? "Plusieurs classes." : "Classe introuvable.", candidates: classes } };
    classId = classes[0].id;
  }
  if (!isUuid(classId)) return { ok: false, error: { code: "VALIDATION", message: "class_id ou class_name requis." } };
  const { data: klass } = await sb.from("classes").select("id, name, establishment_id").eq("id", classId).maybeSingle();
  if (!klass || !(await hasAccess(sb, klass.establishment_id))) return { ok: false, error: { code: "NOT_FOUND", message: "Classe introuvable." } };
  const { count } = await sb.from("students").select("id", { count: "exact", head: true }).eq("class_id", classId).is("archived_at", null);
  const { data: periods } = await sb.from("grade_periods").select("id, period_number, name, ended_at").eq("class_id", classId).order("period_number", { ascending: false }).limit(1);
  const period = periods?.[0] ?? null;
  if (!period) return { ok: true, data: { class: { id: klass.id, name: klass.name }, headcount: count ?? 0, class_average: null, source: "incomplete" } };
  const { data: cards } = await sb.from("student_report_cards").select("general_average").eq("class_id", classId).eq("period_id", period.id);
  const avgs = (cards ?? []).map((c) => Number(c.general_average)).filter((n) => Number.isFinite(n));
  const class_average = avgs.length ? Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 100) / 100 : null;
  return { ok: true, data: { class: { id: klass.id, name: klass.name }, period: { id: period.id, period_number: period.period_number, name: period.name }, headcount: count ?? 0, students_with_official_average: avgs.length, class_average, source: avgs.length ? "official" : "incomplete" } };
}

export async function runTool(sb: SupabaseClient, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case "list_establishments": return toolListEstablishments(sb, args);
    case "list_classes": return toolListClasses(sb, args);
    case "list_students": return toolListStudents(sb, args);
    case "list_teachers": return toolListTeachers(sb, args);
    case "get_teacher": return toolGetTeacher(sb, args);
    case "list_periods": return toolListPeriods(sb, args);
    case "list_subjects": return toolListSubjects(sb, args);
    case "search": return toolSearch(sb, args);
    case "get_class_statistics": return toolGetClassStatistics(sb, args);
    case "get_student": return toolGetStudent(sb, args);
    default: return { ok: false, error: { code: "INTERNAL", message: "Tool inconnu." } };
  }
}
