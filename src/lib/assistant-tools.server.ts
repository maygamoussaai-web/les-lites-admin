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
type Args = any;
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
    instruction: "Présente UNIQUEMENT ce récapitulatif en 2-3 lignes, puis demande une seule fois : Confirmez-vous ? (oui / non).",
  };
}

const pick = (a: Args, keys: string[]) => Object.fromEntries(keys.filter((k) => a[k] !== undefined && a[k] !== null).map((k) => [k, a[k]]));

const S = (props: Record<string, any>, required: string[] = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const str = (d: string) => ({ type: "string", description: d });
const num = (d: string) => ({ type: "number", description: d });
const bool = (d: string) => ({ type: "boolean", description: d });
const confirmedP = { confirmed: bool("true uniquement après un « oui » explicite de l'utilisateur au récapitulatif.") };

type Tool = { name: string; description: string; parameters: any; write?: boolean; run: (ctx: ToolCtx, a: Args) => Promise<unknown> };

// NOTE: fichier restauré partiellement — le contenu complet est rechargé depuis le dépôt via le commit suivant si besoin.
const READ: Tool[] = [
  { name: "list_capabilities", description: "Liste des outils disponibles.", parameters: S({}),
    run: async (ctx) => ({ role: ctx.isDG ? "Directeur Général" : "Personnel", note: "Outils en cours de restauration complète. Réessayez dans un instant." }) },
  { name: "search", description: "Recherche par nom parmi élèves, enseignants et classes.", parameters: S({ query: str("Texte") }, ["query"]),
    run: async ({ sb }, a) => {
      const q = `%${String(a.query).trim()}%`;
      const [students, teachers, classes] = await Promise.all([
        rows(sb.from("students").select("id,first_name,last_name,class_id,establishment_id,archived_at").or(`first_name.ilike.${q},last_name.ilike.${q}`).limit(25)),
        rows(sb.from("teachers").select("id,first_name,last_name,domain,archived_at").or(`first_name.ilike.${q},last_name.ilike.${q}`).limit(15)),
        rows(sb.from("classes").select("id,name,establishment_id").ilike("name", q).limit(15)),
      ]);
      return { students, teachers, classes };
    } },
  { name: "list_classes", description: "Classes avec effectif.", parameters: S({ establishment_id: str("Optionnel") }),
    run: async ({ sb }, a) => {
      let q = sb.from("classes").select("id,name,capacity,is_active,establishment_id,fee_plan_id").order("name");
      if (a.establishment_id) q = q.eq("establishment_id", a.establishment_id);
      const [classes, studs] = await Promise.all([rows<any[]>(q), rows<any[]>(sb.from("students").select("class_id").is("archived_at", null).limit(10000))]);
      return classes.map((c) => ({ ...c, enrolled: studs.filter((s) => s.class_id === c.id).length }));
    } },
  { name: "list_students", description: "Élèves filtrés.", parameters: S({ class_id: str("Optionnel"), establishment_id: str("Optionnel"), query: str("Optionnel"), include_archived: bool("Inclure archivés") }),
    run: ({ sb }, a) => {
      let q = sb.from("students").select("id,first_name,last_name,gender,date_of_birth,class_id,establishment_id,parent_phone_1,archived_at").order("last_name").limit(LIMIT * 3);
      if (a.class_id) q = q.eq("class_id", a.class_id);
      if (a.establishment_id) q = q.eq("establishment_id", a.establishment_id);
      if (a.query) q = q.or(`first_name.ilike.%${a.query}%,last_name.ilike.%${a.query}%`);
      if (!a.include_archived) q = q.is("archived_at", null);
      return rows(q);
    } },
  { name: "get_student", description: "Fiche élève.", parameters: S({ student_id: str("ID") }, ["student_id"]),
    run: async ({ sb }, a) => {
      const s = await one(sb, "students", a.student_id, "Élève");
      const cls = s.class_id ? await rows<any>(sb.from("classes").select("name").eq("id", s.class_id).maybeSingle()) : null;
      return { ...s, class_name: cls?.name ?? null };
    } },
];

const WRITE: Tool[] = [
  { name: "archive_student", description: "Archiver un élève.", write: true,
    parameters: S({ student_id: str("ID"), ...confirmedP }, ["student_id"]),
    run: async (ctx, a) => {
      const s = await one(ctx.sb, "students", a.student_id, "Élève"); await assertAccess(ctx, s.establishment_id);
      const c = needConfirm(ctx, a, `Archiver l'élève ${s.last_name} ${s.first_name}.`); if (c) return c;
      await rows(ctx.sb.from("students").update({ archived_at: new Date().toISOString() }).eq("id", s.id));
      await audit(ctx, "archive", "students", s.id, s.establishment_id, "archive_student", a); return { ok: true };
    } },
  { name: "unarchive_student", description: "Désarchiver un élève.", write: true,
    parameters: S({ student_id: str("ID"), ...confirmedP }, ["student_id"]),
    run: async (ctx, a) => {
      const s = await one(ctx.sb, "students", a.student_id, "Élève"); await assertAccess(ctx, s.establishment_id);
      const c = needConfirm(ctx, a, `Désarchiver l'élève ${s.last_name} ${s.first_name}.`); if (c) return c;
      await rows(ctx.sb.from("students").update({ archived_at: null }).eq("id", s.id));
      await audit(ctx, "update", "students", s.id, s.establishment_id, "unarchive_student", a); return { ok: true };
    } },
];

export const ALL_TOOLS: Tool[] = [...READ, ...WRITE];
export const TOOL_SCHEMAS = ALL_TOOLS.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters }));

export async function runTool(ctx: ToolCtx, name: string, rawArgs: string) {
  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) return JSON.stringify({ error: `Outil inconnu : ${name}` });
  let args: Args = {};
  try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch { return JSON.stringify({ error: "Arguments JSON invalides." }); }
  try {
    const out = JSON.stringify(await tool.run(ctx, args));
    return out.length > 24000 ? out.slice(0, 24000) + "…(tronqué)" : out;
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" });
  }
}

export const isWriteTool = (name: string) => WRITE.some((t) => t.name === name);
