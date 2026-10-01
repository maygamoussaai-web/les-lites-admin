/**
 * Outils de l'Assistant IA (23 lecture + 20 écriture).
 *
 * NOTE POUR CLAUDE:
 * - Tout passe par le client Supabase de l'utilisateur (RLS) : un personnel limité
 *   au Collège ne voit et ne modifie QUE le Collège, exactement comme dans l'UI.
 * - Les écritures vérifient en plus has_establishment_access AVANT d'agir, pour
 *   renvoyer un refus clair au lieu d'une erreur RLS opaque.
 * - Une écriture n'est exécutée que si confirmed=true ET si le dernier message
 *   de l'utilisateur est une confirmation explicite (garde-fou serveur).
 * - Chaque écriture est tracée dans audit_logs au nom de l'utilisateur avec
 *   metadata.via_ai=true (badge 🤖 dans Historique).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Sb = SupabaseClient<Database>;
type Args = Record<string, any>;
export type ToolCtx = { sb: Sb; userId: string; isDG: boolean; userConfirmed: boolean };

class ToolError extends Error {}
const fail = (m: string): never => {
  throw new ToolError(m);
};
const LIMIT = 100;

async function rows<T = any>(p: PromiseLike<{ data: T | null; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) fail(error.message);
  return data as T;
}

async function one(sb: Sb, table: string, id: string, label: string, select = "*") {
  if (!id) fail(`Identifiant ${label} manquant.`);
  const { data, error } = await (sb.from(table as any) as any).select(select).eq("id", id).maybeSingle();
  if (error) fail(error.message);
  if (!data) fail(`${label} introuvable ou hors de votre périmètre.`);
  return data;
}

async function assertAccess(ctx: ToolCtx, establishmentId: string | null | undefined) {
  if (!establishmentId) fail("Établissement non déterminé.");
  if (ctx.isDG) return;
  const { data } = await ctx.sb.rpc("has_establishment_access", { target_establishment_id: establishmentId! });
  if (!data) fail("Action refusée : cet établissement est hors de votre périmètre d'accès.");
}

async function audit(ctx: ToolCtx, action: string, table: string, entityId: string | null, establishmentId: string | null, tool: string, args: Args) {
  const { confirmed: _c, ...rest } = args;
  await ctx.sb.from("audit_logs").insert({
    actor_id: ctx.userId,
    action,
    entity_type: table,
    entity_id: entityId,
    establishment_id: establishmentId,
    metadata: { via_ai: true, label: "🤖 Effectué via Assistant IA", tool, args: rest } as never,
  });
}

const to20 = (v: number, s: number) => (s > 0 ? (v / s) * 20 : v);
const r2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

/** Même règle que src/lib/grades.ts : (moy. éval + 2×compo)/3, sinon la seule note, vide ≠ 0. */
function averagesOf(grades: any[]) {
  const bySubject = new Map<string, { evals: number[]; compo: number | null }>();
  for (const g of grades) {
    const e = bySubject.get(g.subject_id) ?? { evals: [], compo: null };
    const v = to20(Number(g.value), Number(g.scale));
    if (g.nature === "composition") e.compo = v;
    else e.evals.push(v);
    bySubject.set(g.subject_id, e);
  }
  const subjects: Record<string, number | null> = {};
  for (const [sid, { evals, compo }] of bySubject) {
    const ev = evals.length ? evals.reduce((a, b) => a + b, 0) / evals.length : null;
    subjects[sid] = r2(ev != null && compo != null ? (ev + 2 * compo) / 3 : ev ?? compo);
  }
  const vals = Object.values(subjects).filter((v): v is number => v != null);
  return { subjects, general: vals.length ? r2(vals.reduce((a, b) => a + b, 0) / vals.length) : null };
}

async function resolvePeriod(sb: Sb, classId: string, periodId?: string) {
  if (periodId) return one(sb, "grade_periods", periodId, "Période");
  const ps = await rows<any[]>(sb.from("grade_periods").select("*").eq("class_id", classId).order("period_number", { ascending: false }).limit(1));
  return ps[0] ?? fail("Aucune période pour cette classe.");
}

async function classRanking(sb: Sb, classId: string, periodId?: string) {
  const period = await resolvePeriod(sb, classId, periodId);
  const [students, grades, subjects] = await Promise.all([
    rows<any[]>(sb.from("students").select("id,first_name,last_name").eq("class_id", classId).is("archived_at", null)),
    rows<any[]>(sb.from("grades").select("student_id,subject_id,nature,value,scale").eq("period_id", period.id).limit(5000)),
    rows<any[]>(sb.from("class_subjects").select("id,name").eq("class_id", classId)),
  ]);
  const subjName = new Map(subjects.map((s) => [s.id, s.name]));
  const ranked = students
    .map((s) => {
      const a = averagesOf(grades.filter((g) => g.student_id === s.id));
      return {
        student_id: s.id,
        name: `${s.last_name} ${s.first_name}`,
        general_average: a.general,
        subjects: Object.fromEntries(Object.entries(a.subjects).map(([k, v]) => [subjName.get(k) ?? k, v])),
      };
    })
    .sort((a, b) => (b.general_average ?? -1) - (a.general_average ?? -1))
    .map((s, i) => ({ rank: s.general_average == null ? null : i + 1, ...s }));
  return { period: { id: period.id, number: period.period_number, closed: !!period.ended_at }, ranked, subjects };
}

function needConfirm(ctx: ToolCtx, args: Args, summary: string) {
  if (args.confirmed === true && ctx.userConfirmed) return null;
  return {
    requires_confirmation: true,
    summary,
    instruction: "Présente ce récapitulatif à l'utilisateur et demande-lui de répondre « oui » pour confirmer. N'exécute rien avant.",
  };
}

const pick = (a: Args, keys: string[]) => Object.fromEntries(keys.filter((k) => a[k] !== undefined && a[k] !== null).map((k) => [k, a[k]]));

// ---------------------------------------------------------------- schémas
const S = (props: Record<string, any>, required: string[] = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const str = (d: string) => ({ type: "string", description: d });
const num = (d: string) => ({ type: "number", description: d });
const bool = (d: string) => ({ type: "boolean", description: d });
const confirmedP = { confirmed: bool("true uniquement après un « oui » explicite de l'utilisateur au récapitulatif.") };

type Tool = { name: string; description: string; parameters: any; write?: boolean; run: (ctx: ToolCtx, a: Args) => Promise<unknown> };

const READ: Tool[] = [
  { name: "list_capabilities", description: "Liste des outils disponibles et du périmètre de l'utilisateur.", parameters: S({}),
    run: async (ctx) => ({ role: ctx.isDG ? "Directeur Général (tout le complexe)" : "Personnel (établissements assignés uniquement)", read: READ.map((t) => t.name), write: WRITE.map((t) => t.name) }) },
  { name: "search", description: "Recherche par nom parmi élèves, enseignants et classes.", parameters: S({ query: str("Texte recherché") }, ["query"]),
    run: async ({ sb }, a) => {
      const q = `%${String(a.query).trim()}%`;
      const [students, teachers, classes] = await Promise.all([
        rows(sb.from("students").select("id,first_name,last_name,class_id,establishment_id,archived_at").or(`first_name.ilike.${q},last_name.ilike.${q}`).limit(25)),
        rows(sb.from("teachers").select("id,first_name,last_name,domain,archived_at").or(`first_name.ilike.${q},last_name.ilike.${q}`).limit(15)),
        rows(sb.from("classes").select("id,name,establishment_id").ilike("name", q).limit(15)),
      ]);
      return { students, teachers, classes };
    } },
  { name: "list_establishments", description: "Établissements accessibles.", parameters: S({}),
    run: ({ sb }) => rows(sb.from("establishments").select("id,name,type,phone,address,is_active").order("name")) },
  { name: "list_classes", description: "Classes (filtre optionnel par établissement) avec effectif.", parameters: S({ establishment_id: str("Optionnel") }),
    run: async ({ sb }, a) => {
      let q = sb.from("classes").select("id,name,capacity,is_active,establishment_id,fee_plan_id").order("name");
      if (a.establishment_id) q = q.eq("establishment_id", a.establishment_id);
      const [classes, studs] = await Promise.all([rows<any[]>(q), rows<any[]>(sb.from("students").select("class_id").is("archived_at", null).limit(10000))]);
      return classes.map((c) => ({ ...c, enrolled: studs.filter((s) => s.class_id === c.id).length }));
    } },
  { name: "list_students", description: "Élèves filtrés par classe, établissement ou nom.", parameters: S({ class_id: str("Optionnel"), establishment_id: str("Optionnel"), query: str("Optionnel"), include_archived: bool("Inclure les archivés") }),
    run: ({ sb }, a) => {
      let q = sb.from("students").select("id,first_name,last_name,gender,date_of_birth,class_id,establishment_id,parent_phone_1,archived_at").order("last_name").limit(LIMIT * 3);
      if (a.class_id) q = q.eq("class_id", a.class_id);
      if (a.establishment_id) q = q.eq("establishment_id", a.establishment_id);
      if (a.query) q = q.or(`first_name.ilike.%${a.query}%,last_name.ilike.%${a.query}%`);
      if (!a.include_archived) q = q.is("archived_at", null);
      return rows(q);
    } },
  { name: "get_student", description: "Fiche complète d'un élève.", parameters: S({ student_id: str("ID élève") }, ["student_id"]),
    run: async ({ sb }, a) => {
      const s = await one(sb, "students", a.student_id, "Élève");
      const cls = s.class_id ? await rows<any>(sb.from("classes").select("name").eq("id", s.class_id).maybeSingle()) : null;
      return { ...s, class_name: cls?.name ?? null };
    } },
  { name: "rank_students", description: "Classement d'une classe pour une période (dernière par défaut).", parameters: S({ class_id: str("ID classe"), period_id: str("Optionnel") }, ["class_id"]),
    run: async ({ sb }, a) => { const r = await classRanking(sb, a.class_id, a.period_id); return { period: r.period, ranking: r.ranked.map(({ subjects: _s, ...x }) => x) }; } },
  { name: "list_teachers", description: "Enseignants.", parameters: S({ include_archived: bool("Inclure les archivés") }),
    run: ({ sb }, a) => { let q = sb.from("teachers").select("id,first_name,last_name,phone,domain,archived_at").order("last_name"); if (!a.include_archived) q = q.is("archived_at", null); return rows(q); } },
  { name: "get_teacher", description: "Fiche enseignant avec affectations et séances.", parameters: S({ teacher_id: str("ID") }, ["teacher_id"]),
    run: async ({ sb }, a) => {
      const t = await one(sb, "teachers", a.teacher_id, "Enseignant");
      const assignments = await rows<any[]>(sb.from("teacher_assignments").select("*").eq("teacher_id", t.id));
      const sessions = assignments.length ? await rows(sb.from("teacher_sessions").select("*").in("assignment_id", assignments.map((x) => x.id))) : [];
      return { ...t, assignments, sessions };
    } },
  { name: "list_periods", description: "Périodes d'une classe (ouverte si ended_at vide).", parameters: S({ class_id: str("ID classe") }, ["class_id"]),
    run: ({ sb }, a) => rows(sb.from("grade_periods").select("id,period_number,started_at,ended_at").eq("class_id", a.class_id).order("period_number")) },
  { name: "list_subjects", description: "Matières d'une classe.", parameters: S({ class_id: str("ID classe") }, ["class_id"]),
    run: ({ sb }, a) => rows(sb.from("class_subjects").select("id,name").eq("class_id", a.class_id).order("name")) },
  { name: "get_student_grades", description: "Notes et moyennes d'un élève (période optionnelle).", parameters: S({ student_id: str("ID élève"), period_id: str("Optionnel") }, ["student_id"]),
    run: async ({ sb }, a) => {
      let q = sb.from("grades").select("id,period_id,subject_id,nature,sequence_number,value,scale").eq("student_id", a.student_id);
      if (a.period_id) q = q.eq("period_id", a.period_id);
      const grades = await rows<any[]>(q);
      const subjIds = [...new Set(grades.map((g) => g.subject_id))];
      const subjects = subjIds.length ? await rows<any[]>(sb.from("class_subjects").select("id,name").in("id", subjIds)) : [];
      const name = new Map(subjects.map((s) => [s.id, s.name]));
      const byPeriod: Record<string, any> = {};
      for (const pid of new Set(grades.map((g) => g.period_id))) {
        const gs = grades.filter((g) => g.period_id === pid);
        const av = averagesOf(gs);
        byPeriod[pid] = { general_average: av.general, subject_averages: Object.fromEntries(Object.entries(av.subjects).map(([k, v]) => [name.get(k) ?? k, v])) };
      }
      return { grades: grades.map((g) => ({ ...g, subject: name.get(g.subject_id) })), averages_by_period: byPeriod };
    } },
  { name: "get_class_statistics", description: "Statistiques d'une classe : moyenne, réussite (≥10), premier, dernier.", parameters: S({ class_id: str("ID classe"), period_id: str("Optionnel") }, ["class_id"]),
    run: async ({ sb }, a) => {
      const r = await classRanking(sb, a.class_id, a.period_id);
      const graded = r.ranked.filter((s) => s.general_average != null);
      const avg = graded.length ? r2(graded.reduce((x, s) => x + s.general_average!, 0) / graded.length) : null;
      return { period: r.period, effectif: r.ranked.length, evalues: graded.length, class_average: avg,
        pass_rate: graded.length ? r2((graded.filter((s) => s.general_average! >= 10).length / graded.length) * 100) : null,
        first: graded[0] ?? null, last: graded[graded.length - 1] ?? null };
    } },
  { name: "get_complex_overview", description: "Synthèse globale : établissements, classes, élèves, enseignants, encaissements.", parameters: S({}),
    run: async ({ sb }) => {
      const c = async (t: string, f?: (q: any) => any) => { let q: any = sb.from(t as any).select("id", { count: "exact", head: true }); if (f) q = f(q); const { count } = await q; return count ?? 0; };
      const pays = await rows<any[]>(sb.from("tuition_payments").select("amount").limit(10000));
      return { establishments: await c("establishments"), classes: await c("classes"), active_students: await c("students", (q) => q.is("archived_at", null)),
        teachers: await c("teachers", (q) => q.is("archived_at", null)), tuition_collected_fcfa: pays.reduce((s, p) => s + Number(p.amount), 0) };
    } },
  { name: "list_student_documents", description: "Documents d'un élève (bulletins, reçus…).", parameters: S({ student_id: str("ID élève") }, ["student_id"]),
    run: ({ sb }, a) => rows(sb.from("student_documents").select("id,name,file_type,file_size,created_at").eq("student_id", a.student_id).order("created_at", { ascending: false })) },
  { name: "list_student_enrollments", description: "Historique des inscriptions d'un élève.", parameters: S({ student_id: str("ID élève") }, ["student_id"]),
    run: ({ sb }, a) => rows(sb.from("student_enrollments").select("id,establishment_name,class_name,total_amount,started_at,ended_at").eq("student_id", a.student_id).order("started_at", { ascending: false })) },
  { name: "list_fee_plans", description: "Grilles tarifaires et échéances.", parameters: S({ establishment_id: str("Optionnel") }),
    run: ({ sb }, a) => { let q = sb.from("fee_plans").select("id,name,total_amount,establishment_id,fee_plan_installments(label,amount,due_date,position)"); if (a.establishment_id) q = q.eq("establishment_id", a.establishment_id); return rows(q); } },
  { name: "get_student_finance", description: "Situation financière d'un élève : dû, payé, reste.", parameters: S({ student_id: str("ID élève") }, ["student_id"]),
    run: async ({ sb }, a) => {
      const [enr, pays] = await Promise.all([
        rows<any[]>(sb.from("student_enrollments").select("id,class_name,establishment_name,total_amount,started_at,ended_at").eq("student_id", a.student_id)),
        rows<any[]>(sb.from("tuition_payments").select("id,amount,paid_at,method,enrollment_id").eq("student_id", a.student_id).order("paid_at", { ascending: false })),
      ]);
      const enrollments = enr.map((e) => { const paid = pays.filter((p) => p.enrollment_id === e.id).reduce((s, p) => s + Number(p.amount), 0); return { ...e, paid, remaining: Math.max(Number(e.total_amount) - paid, 0) }; });
      return { enrollments, payments: pays, total_due: enrollments.reduce((s, e) => s + Number(e.total_amount), 0), total_paid: pays.reduce((s, p) => s + Number(p.amount), 0) };
    } },
  { name: "list_tuition_payments", description: "Paiements de scolarité (filtres élève/établissement/dates).", parameters: S({ student_id: str("Optionnel"), establishment_id: str("Optionnel"), from: str("YYYY-MM-DD"), to: str("YYYY-MM-DD") }),
    run: ({ sb }, a) => { let q = sb.from("tuition_payments").select("id,student_id,establishment_id,amount,paid_at,method,note").order("paid_at", { ascending: false }).limit(LIMIT * 2);
      if (a.student_id) q = q.eq("student_id", a.student_id); if (a.establishment_id) q = q.eq("establishment_id", a.establishment_id); if (a.from) q = q.gte("paid_at", a.from); if (a.to) q = q.lte("paid_at", a.to); return rows(q); } },
  { name: "list_audit_logs", description: "Journal d'audit récent.", parameters: S({ establishment_id: str("Optionnel"), limit: num("Max 100") }),
    run: ({ sb }, a) => { let q = sb.from("audit_logs").select("action,entity_type,entity_id,establishment_id,metadata,created_at,actor_id").order("created_at", { ascending: false }).limit(Math.min(Number(a.limit) || 30, LIMIT)); if (a.establishment_id) q = q.eq("establishment_id", a.establishment_id); return rows(q); } },
  { name: "list_invitations", description: "Invitations du personnel (sans les jetons).", parameters: S({}),
    run: ({ sb }) => rows(sb.from("invitations").select("id,establishment_id,expires_at,accepted_at,created_at").order("created_at", { ascending: false }).limit(LIMIT)) },
  { name: "list_teacher_payments", description: "Paiements des enseignants.", parameters: S({ teacher_id: str("Optionnel"), establishment_id: str("Optionnel") }),
    run: ({ sb }, a) => { let q = sb.from("teacher_payments").select("id,teacher_id,establishment_id,amount,paid_at,note").order("paid_at", { ascending: false }).limit(LIMIT * 2); if (a.teacher_id) q = q.eq("teacher_id", a.teacher_id); if (a.establishment_id) q = q.eq("establishment_id", a.establishment_id); return rows(q); } },
  { name: "list_teacher_sessions", description: "Séances hebdomadaires (weekday 1=lundi).", parameters: S({ teacher_id: str("Optionnel"), class_id: str("Optionnel") }),
    run: async ({ sb }, a) => {
      let q = sb.from("teacher_sessions").select("id,name,weekday,duration_minutes,is_done,class_id,subject_id,teacher_assignments!inner(teacher_id,establishment_id)").limit(LIMIT * 2);
      if (a.teacher_id) q = q.eq("teacher_assignments.teacher_id", a.teacher_id); if (a.class_id) q = q.eq("class_id", a.class_id); return rows(q);
    } },
];

const WRITE: Tool[] = [
  { name: "create_student", description: "Inscrire un élève dans une classe.", write: true,
    parameters: S({ class_id: str("ID classe"), first_name: str("Prénom"), last_name: str("Nom"), gender: str("M ou F"), date_of_birth: str("YYYY-MM-DD optionnel"), parent_phone_1: str("Optionnel"), parent_phone_2: str("Optionnel"), ...confirmedP }, ["class_id", "first_name", "last_name", "gender"]),
    run: async (ctx, a) => {
      const cls = await one(ctx.sb, "classes", a.class_id, "Classe"); await assertAccess(ctx, cls.establishment_id);
      const c = needConfirm(ctx, a, `Créer l'élève ${a.last_name} ${a.first_name} (${a.gender}) en ${cls.name}.`); if (c) return c;
      const s = await rows<any>(ctx.sb.from("students").insert({ ...pick(a, ["first_name", "last_name", "gender", "date_of_birth", "parent_phone_1", "parent_phone_2"]), class_id: cls.id, establishment_id: cls.establishment_id } as any).select("id").single());
      await audit(ctx, "create", "students", s.id, cls.establishment_id, "create_student", a); return { ok: true, student_id: s.id };
    } },
  { name: "update_student", description: "Modifier la fiche d'un élève.", write: true,
    parameters: S({ student_id: str("ID"), first_name: str(""), last_name: str(""), gender: str(""), date_of_birth: str(""), parent_phone_1: str(""), parent_phone_2: str(""), ...confirmedP }, ["student_id"]),
    run: async (ctx, a) => {
      const s = await one(ctx.sb, "students", a.student_id, "Élève"); await assertAccess(ctx, s.establishment_id);
      const patch = pick(a, ["first_name", "last_name", "gender", "date_of_birth", "parent_phone_1", "parent_phone_2"]); if (!Object.keys(patch).length) fail("Aucune modification fournie.");
      const c = needConfirm(ctx, a, `Modifier ${s.last_name} ${s.first_name} : ${JSON.stringify(patch)}.`); if (c) return c;
      await rows(ctx.sb.from("students").update(patch).eq("id", s.id)); await audit(ctx, "update", "students", s.id, s.establishment_id, "update_student", a); return { ok: true };
    } },
  ...(["archive_student", "unarchive_student"] as const).map((name): Tool => ({ name, write: true, description: name === "archive_student" ? "Archiver un élève." : "Désarchiver un élève.",
    parameters: S({ student_id: str("ID"), ...confirmedP }, ["student_id"]),
    run: async (ctx, a) => {
      const s = await one(ctx.sb, "students", a.student_id, "Élève"); await assertAccess(ctx, s.establishment_id);
      const arch = name === "archive_student";
      const c = needConfirm(ctx, a, `${arch ? "Archiver" : "Désarchiver"} l'élève ${s.last_name} ${s.first_name}.`); if (c) return c;
      await rows(ctx.sb.from("students").update({ archived_at: arch ? new Date().toISOString() : null }).eq("id", s.id));
      await audit(ctx, arch ? "archive" : "update", "students", s.id, s.establishment_id, name, a); return { ok: true };
    } })),
  { name: "transfer_student", description: "Transférer un élève vers une autre classe (éventuellement un autre établissement).", write: true,
    parameters: S({ student_id: str("ID"), to_class_id: str("Classe cible"), ...confirmedP }, ["student_id", "to_class_id"]),
    run: async (ctx, a) => {
      const s = await one(ctx.sb, "students", a.student_id, "Élève"); const to = await one(ctx.sb, "classes", a.to_class_id, "Classe cible");
      await assertAccess(ctx, s.establishment_id); await assertAccess(ctx, to.establishment_id);
      const c = needConfirm(ctx, a, `Transférer ${s.last_name} ${s.first_name} vers ${to.name}.`); if (c) return c;
      await rows(ctx.sb.from("students").update({ class_id: to.id, establishment_id: to.establishment_id }).eq("id", s.id));
      await ctx.sb.from("student_transfers").insert({ student_id: s.id, from_class_id: s.class_id, from_establishment_id: s.establishment_id, to_class_id: to.id, to_establishment_id: to.establishment_id, moved_by: ctx.userId });
      await audit(ctx, "update", "students", s.id, to.establishment_id, "transfer_student", a); return { ok: true };
    } },
  { name: "upsert_grade", description: "Saisir/modifier une note. nature = evaluation | composition (une seule composition par matière/période).", write: true,
    parameters: S({ student_id: str("ID élève"), subject_id: str("ID matière"), period_id: str("Optionnel (période ouverte par défaut)"), nature: str("evaluation|composition"), value: num("Note"), scale: num("Barème, 20 par défaut"), grade_id: str("Pour modifier une note existante"), sequence_number: num("N° d'évaluation"), ...confirmedP }, ["student_id", "subject_id", "nature", "value"]),
    run: async (ctx, a) => {
      if (!["evaluation", "composition"].includes(a.nature)) fail("nature doit être evaluation ou composition.");
      const scale = Number(a.scale) || 20; const value = Number(a.value);
      if (!(value >= 0 && value <= scale)) fail(`La note doit être entre 0 et ${scale}.`);
      const s = await one(ctx.sb, "students", a.student_id, "Élève"); const subj = await one(ctx.sb, "class_subjects", a.subject_id, "Matière");
      if (subj.class_id !== s.class_id) fail("Cette matière n'appartient pas à la classe de l'élève.");
      await assertAccess(ctx, s.establishment_id);
      const period = a.period_id ? await one(ctx.sb, "grade_periods", a.period_id, "Période") : await resolvePeriod(ctx.sb, s.class_id);
      if (period.ended_at) fail("Cette période est clôturée : impossible de modifier les notes.");
      let existing: any = a.grade_id ? await one(ctx.sb, "grades", a.grade_id, "Note") : null;
      if (!existing && a.nature === "composition") existing = (await rows<any[]>(ctx.sb.from("grades").select("*").eq("period_id", period.id).eq("subject_id", subj.id).eq("student_id", s.id).eq("nature", "composition")))[0] ?? null;
      const c = needConfirm(ctx, a, `${existing ? "Modifier" : "Ajouter"} la note de ${a.nature} en ${subj.name} pour ${s.last_name} ${s.first_name} : ${value}/${scale} (période ${period.period_number}).`); if (c) return c;
      let id = existing?.id;
      if (existing) await rows(ctx.sb.from("grades").update({ value, scale }).eq("id", existing.id));
      else {
        const seq = Number(a.sequence_number) || (await rows<any[]>(ctx.sb.from("grades").select("id").eq("period_id", period.id).eq("subject_id", subj.id).eq("student_id", s.id).eq("nature", a.nature))).length + 1;
        id = (await rows<any>(ctx.sb.from("grades").insert({ period_id: period.id, class_id: s.class_id, establishment_id: s.establishment_id, subject_id: subj.id, student_id: s.id, nature: a.nature, sequence_number: seq, value, scale, created_by: ctx.userId }).select("id").single())).id;
      }
      await audit(ctx, existing ? "update" : "create", "grades", id, s.establishment_id, "upsert_grade", a); return { ok: true, grade_id: id };
    } },
  { name: "delete_grade", description: "Supprimer une note.", write: true, parameters: S({ grade_id: str("ID note"), ...confirmedP }, ["grade_id"]),
    run: async (ctx, a) => {
      const g = await one(ctx.sb, "grades", a.grade_id, "Note"); await assertAccess(ctx, g.establishment_id);
      const p = await one(ctx.sb, "grade_periods", g.period_id, "Période"); if (p.ended_at) fail("Période clôturée : suppression impossible.");
      const c = needConfirm(ctx, a, `Supprimer la note ${g.value}/${g.scale} (${g.nature}).`); if (c) return c;
      await rows(ctx.sb.from("grades").delete().eq("id", g.id)); await audit(ctx, "delete", "grades", g.id, g.establishment_id, "delete_grade", a); return { ok: true };
    } },
  { name: "close_period", description: "Clôturer une période.", write: true, parameters: S({ period_id: str("ID période"), ...confirmedP }, ["period_id"]),
    run: async (ctx, a) => {
      const p = await one(ctx.sb, "grade_periods", a.period_id, "Période"); await assertAccess(ctx, p.establishment_id); if (p.ended_at) fail("Période déjà clôturée.");
      const c = needConfirm(ctx, a, `Clôturer la période ${p.period_number}. Les notes ne seront plus modifiables.`); if (c) return c;
      await rows(ctx.sb.from("grade_periods").update({ ended_at: new Date().toISOString() }).eq("id", p.id)); await audit(ctx, "update", "grade_periods", p.id, p.establishment_id, "close_period", a); return { ok: true };
    } },
  { name: "open_period", description: "Ouvrir la période suivante d'une classe (3 max, la précédente doit être clôturée).", write: true, parameters: S({ class_id: str("ID classe"), ...confirmedP }, ["class_id"]),
    run: async (ctx, a) => {
      const cls = await one(ctx.sb, "classes", a.class_id, "Classe"); await assertAccess(ctx, cls.establishment_id);
      const ps = await rows<any[]>(ctx.sb.from("grade_periods").select("*").eq("class_id", cls.id).order("period_number"));
      if (ps.some((p) => !p.ended_at)) fail("Une période est encore ouverte : clôturez-la d'abord.");
      const n = (ps.at(-1)?.period_number ?? 0) + 1; if (n > 3) fail("Les 3 périodes de l'année sont déjà créées.");
      const c = needConfirm(ctx, a, `Ouvrir la période ${n} pour ${cls.name}.`); if (c) return c;
      const p = await rows<any>(ctx.sb.from("grade_periods").insert({ class_id: cls.id, establishment_id: cls.establishment_id, period_number: n }).select("id").single());
      await audit(ctx, "create", "grade_periods", p.id, cls.establishment_id, "open_period", a); return { ok: true, period_id: p.id };
    } },
  { name: "create_class", description: "Créer une classe.", write: true, parameters: S({ establishment_id: str("ID"), name: str("Nom"), capacity: num("Capacité"), fee_plan_id: str("Optionnel"), ...confirmedP }, ["establishment_id", "name"]),
    run: async (ctx, a) => {
      await assertAccess(ctx, a.establishment_id); const c = needConfirm(ctx, a, `Créer la classe ${a.name}${a.capacity ? ` (capacité ${a.capacity})` : ""}.`); if (c) return c;
      const r = await rows<any>(ctx.sb.from("classes").insert({ ...pick(a, ["establishment_id", "name", "capacity", "fee_plan_id"]) } as any).select("id").single());
      await audit(ctx, "create", "classes", r.id, a.establishment_id, "create_class", a); return { ok: true, class_id: r.id };
    } },
  { name: "update_class", description: "Modifier une classe.", write: true, parameters: S({ class_id: str("ID"), name: str(""), capacity: num(""), is_active: bool(""), fee_plan_id: str(""), ...confirmedP }, ["class_id"]),
    run: async (ctx, a) => {
      const cls = await one(ctx.sb, "classes", a.class_id, "Classe"); await assertAccess(ctx, cls.establishment_id);
      const patch = pick(a, ["name", "capacity", "is_active", "fee_plan_id"]); if (!Object.keys(patch).length) fail("Aucune modification fournie.");
      const c = needConfirm(ctx, a, `Modifier la classe ${cls.name} : ${JSON.stringify(patch)}.`); if (c) return c;
      await rows(ctx.sb.from("classes").update(patch).eq("id", cls.id)); await audit(ctx, "update", "classes", cls.id, cls.establishment_id, "update_class", a); return { ok: true };
    } },
  { name: "add_class_subject", description: "Ajouter une matière à une classe.", write: true, parameters: S({ class_id: str("ID"), name: str("Matière"), ...confirmedP }, ["class_id", "name"]),
    run: async (ctx, a) => {
      const cls = await one(ctx.sb, "classes", a.class_id, "Classe"); await assertAccess(ctx, cls.establishment_id);
      const c = needConfirm(ctx, a, `Ajouter la matière « ${a.name} » en ${cls.name}.`); if (c) return c;
      const r = await rows<any>(ctx.sb.from("class_subjects").insert({ class_id: cls.id, establishment_id: cls.establishment_id, name: String(a.name).trim() }).select("id").single());
      await audit(ctx, "create", "class_subjects", r.id, cls.establishment_id, "add_class_subject", a); return { ok: true, subject_id: r.id };
    } },
  { name: "remove_class_subject", description: "Retirer une matière (impossible si des notes existent).", write: true, parameters: S({ subject_id: str("ID matière"), ...confirmedP }, ["subject_id"]),
    run: async (ctx, a) => {
      const s = await one(ctx.sb, "class_subjects", a.subject_id, "Matière"); await assertAccess(ctx, s.establishment_id);
      const { count } = await ctx.sb.from("grades").select("id", { count: "exact", head: true }).eq("subject_id", s.id);
      if (count) fail(`Impossible : ${count} note(s) existent pour « ${s.name} ».`);
      const c = needConfirm(ctx, a, `Retirer la matière « ${s.name} ».`); if (c) return c;
      await rows(ctx.sb.from("class_subjects").delete().eq("id", s.id)); await audit(ctx, "delete", "class_subjects", s.id, s.establishment_id, "remove_class_subject", a); return { ok: true };
    } },
  { name: "create_establishment", description: "Créer un établissement (Directeur Général uniquement).", write: true,
    parameters: S({ name: str("Nom"), type: str("Type (ex. college, lycee, primaire)"), description: str(""), phone: str(""), address: str(""), ...confirmedP }, ["name", "type"]),
    run: async (ctx, a) => {
      if (!ctx.isDG) fail("Action réservée au Directeur Général.");
      const c = needConfirm(ctx, a, `Créer l'établissement ${a.name} (${a.type}).`); if (c) return c;
      const r = await rows<any>(ctx.sb.from("establishments").insert(pick(a, ["name", "type", "description", "phone", "address"]) as any).select("id").single());
      await audit(ctx, "create", "establishments", r.id, r.id, "create_establishment", a); return { ok: true, establishment_id: r.id };
    } },
  { name: "update_establishment", description: "Modifier un établissement.", write: true,
    parameters: S({ establishment_id: str("ID"), name: str(""), description: str(""), phone: str(""), address: str(""), is_active: bool(""), ...confirmedP }, ["establishment_id"]),
    run: async (ctx, a) => {
      if (!ctx.isDG) fail("Action réservée au Directeur Général.");
      const e = await one(ctx.sb, "establishments", a.establishment_id, "Établissement");
      const patch = pick(a, ["name", "description", "phone", "address", "is_active"]); if (!Object.keys(patch).length) fail("Aucune modification fournie.");
      const c = needConfirm(ctx, a, `Modifier ${e.name} : ${JSON.stringify(patch)}.`); if (c) return c;
      await rows(ctx.sb.from("establishments").update(patch).eq("id", e.id)); await audit(ctx, "update", "establishments", e.id, e.id, "update_establishment", a); return { ok: true };
    } },
  { name: "create_teacher", description: "Créer un enseignant.", write: true, parameters: S({ first_name: str(""), last_name: str(""), phone: str(""), domain: str("Spécialité"), ...confirmedP }, ["first_name", "last_name"]),
    run: async (ctx, a) => {
      const c = needConfirm(ctx, a, `Créer l'enseignant ${a.last_name} ${a.first_name}${a.domain ? ` (${a.domain})` : ""}.`); if (c) return c;
      const r = await rows<any>(ctx.sb.from("teachers").insert(pick(a, ["first_name", "last_name", "phone", "domain"]) as any).select("id").single());
      await audit(ctx, "create", "teachers", r.id, null, "create_teacher", a); return { ok: true, teacher_id: r.id };
    } },
  { name: "update_teacher", description: "Modifier un enseignant.", write: true, parameters: S({ teacher_id: str("ID"), first_name: str(""), last_name: str(""), phone: str(""), domain: str(""), ...confirmedP }, ["teacher_id"]),
    run: async (ctx, a) => {
      const t = await one(ctx.sb, "teachers", a.teacher_id, "Enseignant");
      const patch = pick(a, ["first_name", "last_name", "phone", "domain"]); if (!Object.keys(patch).length) fail("Aucune modification fournie.");
      const c = needConfirm(ctx, a, `Modifier ${t.last_name} ${t.first_name} : ${JSON.stringify(patch)}.`); if (c) return c;
      await rows(ctx.sb.from("teachers").update(patch).eq("id", t.id)); await audit(ctx, "update", "teachers", t.id, null, "update_teacher", a); return { ok: true };
    } },
  { name: "archive_teacher", description: "Archiver un enseignant.", write: true, parameters: S({ teacher_id: str("ID"), ...confirmedP }, ["teacher_id"]),
    run: async (ctx, a) => {
      const t = await one(ctx.sb, "teachers", a.teacher_id, "Enseignant");
      const c = needConfirm(ctx, a, `Archiver l'enseignant ${t.last_name} ${t.first_name}.`); if (c) return c;
      await rows(ctx.sb.from("teachers").update({ archived_at: new Date().toISOString() }).eq("id", t.id)); await audit(ctx, "archive", "teachers", t.id, null, "archive_teacher", a); return { ok: true };
    } },
  { name: "record_tuition_payment", description: "Enregistrer un paiement de scolarité (sur l'inscription en cours par défaut ; plafonné au reste dû).", write: true,
    parameters: S({ student_id: str("ID"), amount: num("Montant FCFA"), method: str("cash|mobile_money|bank|other"), paid_at: str("YYYY-MM-DD"), note: str(""), enrollment_id: str("Optionnel"), ...confirmedP }, ["student_id", "amount", "method"]),
    run: async (ctx, a) => {
      const s = await one(ctx.sb, "students", a.student_id, "Élève"); await assertAccess(ctx, s.establishment_id);
      const amount = Number(a.amount); if (!(amount > 0)) fail("Montant invalide.");
      const enr = a.enrollment_id ? await one(ctx.sb, "student_enrollments", a.enrollment_id, "Inscription")
        : (await rows<any[]>(ctx.sb.from("student_enrollments").select("*").eq("student_id", s.id).is("ended_at", null).order("started_at", { ascending: false }).limit(1)))[0] ?? null;
      const c = needConfirm(ctx, a, `Enregistrer ${amount.toLocaleString("fr-FR")} FCFA (${a.method}) pour ${s.last_name} ${s.first_name}${enr ? ` — ${enr.class_name}` : ""}.`); if (c) return c;
      const r = await rows<any>(ctx.sb.from("tuition_payments").insert({ student_id: s.id, establishment_id: s.establishment_id, amount, method: a.method, paid_at: a.paid_at || new Date().toISOString().slice(0, 10), note: a.note ?? null, enrollment_id: enr?.id ?? null, recorded_by: ctx.userId }).select("id").single());
      await audit(ctx, "create", "tuition_payments", r.id, s.establishment_id, "record_tuition_payment", a); return { ok: true, payment_id: r.id };
    } },
  { name: "record_teacher_payment", description: "Enregistrer un paiement à un enseignant.", write: true,
    parameters: S({ teacher_id: str("ID"), establishment_id: str("Établissement payeur"), amount: num("Montant FCFA"), paid_at: str("YYYY-MM-DD"), note: str(""), ...confirmedP }, ["teacher_id", "establishment_id", "amount"]),
    run: async (ctx, a) => {
      const t = await one(ctx.sb, "teachers", a.teacher_id, "Enseignant"); await assertAccess(ctx, a.establishment_id);
      const amount = Number(a.amount); if (!(amount > 0)) fail("Montant invalide.");
      const c = needConfirm(ctx, a, `Payer ${amount.toLocaleString("fr-FR")} FCFA à ${t.last_name} ${t.first_name}.`); if (c) return c;
      const r = await rows<any>(ctx.sb.from("teacher_payments").insert({ teacher_id: t.id, establishment_id: a.establishment_id, amount, paid_at: a.paid_at || new Date().toISOString().slice(0, 10), note: a.note ?? null, recorded_by: ctx.userId }).select("id").single());
      await audit(ctx, "create", "teacher_payments", r.id, a.establishment_id, "record_teacher_payment", a); return { ok: true, payment_id: r.id };
    } },
];

export const ALL_TOOLS = [...READ, ...WRITE];

export const TOOL_SCHEMAS = ALL_TOOLS.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false }));

export async function runTool(ctx: ToolCtx, name: string, rawArgs: string) {
  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) return JSON.stringify({ error: `Outil inconnu : ${name}` });
  let args: Args = {};
  try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch { return JSON.stringify({ error: "Arguments JSON invalides." }); }
  try {
    const out = JSON.stringify(await tool.run(ctx, args));
    return out.length > 24000 ? out.slice(0, 24000) + "…(tronqué : affinez la requête)" : out;
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" });
  }
}

export const isWriteTool = (name: string) => WRITE.some((t) => t.name === name);
