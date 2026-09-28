/**
 * Tools v1 for ai-assistant — get_class_statistics, get_student.
 * Permissions via public.has_establishment_access only (user JWT client).
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const PASS_THRESHOLD = 10;
export const EXCELLENT_THRESHOLD = 15;
export const LIST_LIMIT = 10;
export const GRADES_LIMIT = 500;

export type ToolOk = { ok: true; data: Record<string, unknown> };
export type ToolErr = {
  ok: false;
  error: { code: string; message: string; candidates?: unknown[] };
};
export type ToolResult = ToolOk | ToolErr;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function periodLabel(p: { name?: string | null; period_number: number }): string {
  const n = p.name && String(p.name).trim();
  return n ? n : `Période ${p.period_number}`;
}

function fullName(last: string, first: string): string {
  return `${last} ${first}`.trim();
}

export async function assertActiveAdmin(
  sb: SupabaseClient,
): Promise<ToolResult | null> {
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) {
    return {
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Session non authentifiée." },
    };
  }
  const { data: profile, error: pErr } = await sb
    .from("admin_profiles")
    .select("id, role, is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (pErr || !profile) {
    return {
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Session non authentifiée." },
    };
  }
  if (!profile.is_active) {
    return {
      ok: false,
      error: { code: "FORBIDDEN", message: "Compte inactif." },
    };
  }
  return null;
}

async function hasAccess(
  sb: SupabaseClient,
  establishmentId: string,
): Promise<boolean> {
  const { data, error } = await sb.rpc("has_establishment_access", {
    target_establishment_id: establishmentId,
  });
  if (error) {
    console.error("has_establishment_access error", error.message);
    return false;
  }
  return data === true;
}

async function resolvePeriod(
  sb: SupabaseClient,
  classId: string,
  periodId?: string | null,
  periodNumber?: number | null,
): Promise<
  | { ok: true; period: Record<string, unknown> | null }
  | { ok: false; error: ToolErr["error"] }
> {
  if (periodId) {
    if (!isUuid(periodId)) {
      return {
        ok: false,
        error: { code: "VALIDATION", message: "period_id doit être un UUID." },
      };
    }
    const { data, error } = await sb
      .from("grade_periods")
      .select("id, class_id, period_number, name, started_at, ended_at")
      .eq("id", periodId)
      .eq("class_id", classId)
      .maybeSingle();
    if (error || !data) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Période introuvable pour cette classe.",
        },
      };
    }
    return { ok: true, period: data };
  }

  if (periodNumber != null && Number.isFinite(Number(periodNumber))) {
    const { data, error } = await sb
      .from("grade_periods")
      .select("id, class_id, period_number, name, started_at, ended_at")
      .eq("class_id", classId)
      .eq("period_number", Number(periodNumber))
      .maybeSingle();
    if (error || !data) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Période introuvable pour cette classe.",
        },
      };
    }
    return { ok: true, period: data };
  }

  const { data: openRows } = await sb
    .from("grade_periods")
    .select("id, class_id, period_number, name, started_at, ended_at")
    .eq("class_id", classId)
    .is("ended_at", null)
    .limit(1);
  if (openRows?.[0]) return { ok: true, period: openRows[0] };

  const { data: all } = await sb
    .from("grade_periods")
    .select("id, class_id, period_number, name, started_at, ended_at")
    .eq("class_id", classId)
    .order("period_number", { ascending: false })
    .limit(1);
  return { ok: true, period: all?.[0] ?? null };
}

function periodPayload(p: Record<string, unknown> | null) {
  if (!p) return null;
  return {
    id: p.id,
    period_number: p.period_number,
    name: p.name ?? null,
    label: periodLabel({
      name: p.name as string | null,
      period_number: Number(p.period_number),
    }),
    is_open: p.ended_at == null,
  };
}

async function toolGetClassStatistics(
  sb: SupabaseClient,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const classId = args.class_id;
  if (!isUuid(classId)) {
    return {
      ok: false,
      error: {
        code: "VALIDATION",
        message: "class_id est obligatoire et doit être un UUID.",
      },
    };
  }

  const { data: klass, error: kErr } = await sb
    .from("classes")
    .select("id, name, establishment_id, is_active")
    .eq("id", classId)
    .maybeSingle();
  if (kErr || !klass) {
    return { ok: false, error: { code: "NOT_FOUND", message: "Classe introuvable." } };
  }
  if (!(await hasAccess(sb, klass.establishment_id))) {
    return { ok: false, error: { code: "NOT_FOUND", message: "Classe introuvable." } };
  }

  const { data: est } = await sb
    .from("establishments")
    .select("id, name")
    .eq("id", klass.establishment_id)
    .maybeSingle();

  const periodRes = await resolvePeriod(
    sb,
    classId,
    typeof args.period_id === "string" ? args.period_id : null,
    args.period_number != null ? Number(args.period_number) : null,
  );
  if (!periodRes.ok) return { ok: false, error: periodRes.error };

  const { count: headcount } = await sb
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("class_id", classId)
    .is("archived_at", null);

  const emptyStats = (period: Record<string, unknown> | null): ToolOk => ({
    ok: true,
    data: {
      class: {
        id: klass.id,
        name: klass.name,
        establishment_id: klass.establishment_id,
        establishment_name: est?.name ?? "",
        is_active: klass.is_active,
      },
      period: periodPayload(period),
      headcount: headcount ?? 0,
      students_with_official_average: 0,
      class_average: null,
      passing_count: 0,
      excellent_count: 0,
      struggling_count: 0,
      pass_threshold: PASS_THRESHOLD,
      excellent_threshold: EXCELLENT_THRESHOLD,
      best_subject: null,
      worst_subject: null,
      subject_averages: [],
      top_students: [],
      struggling_students: [],
      source: "incomplete",
    },
  });

  const period = periodRes.period;
  if (!period) return emptyStats(null);

  const { data: cards } = await sb
    .from("student_report_cards")
    .select("student_id, general_average, subject_averages, document_id")
    .eq("class_id", classId)
    .eq("period_id", period.id as string);

  type CardRow = {
    student_id: string;
    general_average: number | null;
    subject_averages: Record<string, number | null> | null;
  };
  const withAvg = ((cards ?? []) as CardRow[]).filter((c) => {
    const v = c.general_average;
    return v !== null && v !== undefined && Number.isFinite(Number(v));
  });

  if (!withAvg.length) return emptyStats(period);

  const studentIds = withAvg.map((c) => c.student_id);
  const { data: students } = await sb
    .from("students")
    .select("id, first_name, last_name")
    .in("id", studentIds);
  const byId = new Map(
    (students ?? []).map((s) => [
      s.id,
      s as { id: string; first_name: string; last_name: string },
    ]),
  );

  const avgs = withAvg.map((c) => Number(c.general_average));
  const classAverage = round2(avgs.reduce((a, b) => a + b, 0) / avgs.length);
  const passing = withAvg.filter((c) => Number(c.general_average) >= PASS_THRESHOLD);
  const excellent = withAvg.filter(
    (c) => Number(c.general_average) >= EXCELLENT_THRESHOLD,
  );
  const struggling = withAvg.filter(
    (c) => Number(c.general_average) < PASS_THRESHOLD,
  );

  const subjectBuckets = new Map<string, number[]>();
  for (const c of withAvg) {
    const sa = (c.subject_averages ?? {}) as Record<string, unknown>;
    for (const [name, raw] of Object.entries(sa)) {
      if (raw === null || raw === undefined) continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      const arr = subjectBuckets.get(name) ?? [];
      arr.push(n);
      subjectBuckets.set(name, arr);
    }
  }
  const subject_averages = [...subjectBuckets.entries()]
    .map(([name, vals]) => ({
      name,
      average: round2(vals.reduce((a, b) => a + b, 0) / vals.length),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  let best_subject: { name: string; average: number } | null = null;
  let worst_subject: { name: string; average: number } | null = null;
  for (const s of subject_averages) {
    if (
      !best_subject ||
      s.average > best_subject.average ||
      (s.average === best_subject.average && s.name < best_subject.name)
    ) {
      best_subject = s;
    }
    if (
      !worst_subject ||
      s.average < worst_subject.average ||
      (s.average === worst_subject.average && s.name < worst_subject.name)
    ) {
      worst_subject = s;
    }
  }

  const ranked = [...withAvg].sort((a, b) => {
    const d = Number(b.general_average) - Number(a.general_average);
    if (d !== 0) return d;
    const sa = byId.get(a.student_id);
    const sb_ = byId.get(b.student_id);
    const ln = (sa?.last_name ?? "").localeCompare(sb_?.last_name ?? "", "fr");
    if (ln !== 0) return ln;
    return (sa?.first_name ?? "").localeCompare(sb_?.first_name ?? "", "fr");
  });

  const top_students = ranked.slice(0, LIST_LIMIT).map((c) => {
    const s = byId.get(c.student_id);
    return {
      student_id: c.student_id,
      full_name: s ? fullName(s.last_name, s.first_name) : c.student_id,
      average: round2(Number(c.general_average)),
    };
  });

  const strugglingSorted = [...struggling].sort((a, b) => {
    const d = Number(a.general_average) - Number(b.general_average);
    if (d !== 0) return d;
    const sa = byId.get(a.student_id);
    const sb_ = byId.get(b.student_id);
    const ln = (sa?.last_name ?? "").localeCompare(sb_?.last_name ?? "", "fr");
    if (ln !== 0) return ln;
    return (sa?.first_name ?? "").localeCompare(sb_?.first_name ?? "", "fr");
  });

  const struggling_students = strugglingSorted.slice(0, LIST_LIMIT).map((c) => {
    const s = byId.get(c.student_id);
    return {
      student_id: c.student_id,
      full_name: s ? fullName(s.last_name, s.first_name) : c.student_id,
      average: round2(Number(c.general_average)),
    };
  });

  return {
    ok: true,
    data: {
      class: {
        id: klass.id,
        name: klass.name,
        establishment_id: klass.establishment_id,
        establishment_name: est?.name ?? "",
        is_active: klass.is_active,
      },
      period: periodPayload(period),
      headcount: headcount ?? 0,
      students_with_official_average: withAvg.length,
      class_average: classAverage,
      passing_count: passing.length,
      excellent_count: excellent.length,
      struggling_count: struggling.length,
      pass_threshold: PASS_THRESHOLD,
      excellent_threshold: EXCELLENT_THRESHOLD,
      best_subject,
      worst_subject,
      subject_averages,
      top_students,
      struggling_students,
      source: "bulletin",
    },
  };
}

async function toolGetStudent(
  sb: SupabaseClient,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  let student: {
    id: string;
    first_name: string;
    last_name: string;
    gender: string;
    date_of_birth: string | null;
    archived_at: string | null;
    class_id: string | null;
    establishment_id: string;
  } | null = null;

  if (args.student_id != null && args.student_id !== "") {
    if (!isUuid(args.student_id)) {
      return {
        ok: false,
        error: { code: "VALIDATION", message: "student_id doit être un UUID." },
      };
    }
    const { data, error } = await sb
      .from("students")
      .select(
        "id, first_name, last_name, gender, date_of_birth, archived_at, class_id, establishment_id",
      )
      .eq("id", args.student_id as string)
      .maybeSingle();
    if (error || !data) {
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: "Élève introuvable." },
      };
    }
    if (!(await hasAccess(sb, data.establishment_id))) {
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: "Élève introuvable." },
      };
    }
    student = data;
  } else {
    const first = typeof args.first_name === "string" ? args.first_name.trim() : "";
    const last = typeof args.last_name === "string" ? args.last_name.trim() : "";
    if (!first || !last) {
      return {
        ok: false,
        error: {
          code: "VALIDATION",
          message: "Indiquez student_id ou le couple first_name et last_name.",
        },
      };
    }

    let q = sb
      .from("students")
      .select(
        "id, first_name, last_name, gender, date_of_birth, archived_at, class_id, establishment_id",
      )
      .ilike("first_name", first)
      .ilike("last_name", last);

    if (args.class_id) {
      if (!isUuid(args.class_id)) {
        return {
          ok: false,
          error: { code: "VALIDATION", message: "class_id doit être un UUID." },
        };
      }
      q = q.eq("class_id", args.class_id as string);
    }

    const { data: matches, error } = await q.limit(20);
    if (error) {
      console.error("student search", error.message);
      return {
        ok: false,
        error: { code: "INTERNAL", message: "Recherche impossible." },
      };
    }

    const accessible: NonNullable<typeof matches> = [];
    for (const m of matches ?? []) {
      if (await hasAccess(sb, m.establishment_id)) accessible.push(m);
    }

    if (!accessible.length) {
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: "Élève introuvable." },
      };
    }
    if (accessible.length > 1) {
      const classIds = [
        ...new Set(
          accessible.map((m) => m.class_id).filter((id): id is string => !!id),
        ),
      ];
      const estIds = [...new Set(accessible.map((m) => m.establishment_id))];
      const { data: classes } = classIds.length
        ? await sb.from("classes").select("id, name").in("id", classIds)
        : { data: [] as { id: string; name: string }[] };
      const { data: establishments } = await sb
        .from("establishments")
        .select("id, name")
        .in("id", estIds);
      const className = new Map((classes ?? []).map((c) => [c.id, c.name]));
      const estName = new Map((establishments ?? []).map((e) => [e.id, e.name]));
      const candidates = accessible.slice(0, LIST_LIMIT).map((m) => ({
        student_id: m.id,
        full_name: fullName(m.last_name, m.first_name),
        class_id: m.class_id,
        class_name: m.class_id ? className.get(m.class_id) ?? null : null,
        establishment_name: estName.get(m.establishment_id) ?? "",
      }));
      return {
        ok: false,
        error: {
          code: "VALIDATION",
          message:
            "Plusieurs élèves correspondent. Précisez student_id ou class_id.",
          candidates,
        },
      };
    }
    student = accessible[0];
  }

  if (!student) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Élève introuvable." },
    };
  }

  let classInfo: { id: string; name: string } | null = null;
  if (student.class_id) {
    const { data: c } = await sb
      .from("classes")
      .select("id, name")
      .eq("id", student.class_id)
      .maybeSingle();
    if (c) classInfo = c;
  }
  const { data: est } = await sb
    .from("establishments")
    .select("id, name")
    .eq("id", student.establishment_id)
    .maybeSingle();

  const identity = {
    student: {
      id: student.id,
      first_name: student.first_name,
      last_name: student.last_name,
      gender: student.gender,
      date_of_birth: student.date_of_birth,
      is_archived: student.archived_at != null,
      class: classInfo,
      establishment: {
        id: student.establishment_id,
        name: est?.name ?? "",
      },
    },
  };

  if (!student.class_id) {
    return {
      ok: true,
      data: {
        ...identity,
        period: null,
        general_average: null,
        subject_averages: [],
        grades_summary: [],
        has_generated_bulletin: false,
        source: "incomplete",
      },
    };
  }

  const periodRes = await resolvePeriod(
    sb,
    student.class_id,
    typeof args.period_id === "string" ? args.period_id : null,
    args.period_number != null ? Number(args.period_number) : null,
  );
  if (!periodRes.ok) {
    return {
      ok: false,
      error: {
        code: periodRes.error.code,
        message:
          periodRes.error.code === "NOT_FOUND"
            ? "Période introuvable pour cet élève."
            : periodRes.error.message,
      },
    };
  }

  const period = periodRes.period;
  if (!period) {
    return {
      ok: true,
      data: {
        ...identity,
        period: null,
        general_average: null,
        subject_averages: [],
        grades_summary: [],
        has_generated_bulletin: false,
        source: "incomplete",
      },
    };
  }

  const { data: card } = await sb
    .from("student_report_cards")
    .select("general_average, subject_averages, document_id")
    .eq("student_id", student.id)
    .eq("period_id", period.id as string)
    .maybeSingle();

  const official =
    card?.general_average !== null &&
    card?.general_average !== undefined &&
    Number.isFinite(Number(card.general_average));

  if (official) {
    const sa = (card!.subject_averages ?? {}) as Record<string, unknown>;
    const subject_averages = Object.entries(sa)
      .filter(
        ([, v]) => v !== null && v !== undefined && Number.isFinite(Number(v)),
      )
      .map(([subject, v]) => ({ subject, average: round2(Number(v)) }))
      .sort((a, b) => a.subject.localeCompare(b.subject, "fr"));

    return {
      ok: true,
      data: {
        ...identity,
        period: periodPayload(period),
        general_average: round2(Number(card!.general_average)),
        subject_averages,
        grades_summary: [],
        has_generated_bulletin: card!.document_id != null,
        source: "bulletin",
      },
    };
  }

  const { data: grades } = await sb
    .from("grades")
    .select("subject_id, nature, value, scale, sequence_number, created_at")
    .eq("student_id", student.id)
    .eq("period_id", period.id as string)
    .limit(GRADES_LIMIT);

  const subjectIds = [
    ...new Set((grades ?? []).map((g) => g.subject_id).filter(Boolean)),
  ];
  const { data: subjects } = subjectIds.length
    ? await sb.from("class_subjects").select("id, name").in("id", subjectIds)
    : { data: [] as { id: string; name: string }[] };
  const subName = new Map((subjects ?? []).map((s) => [s.id, s.name]));

  type G = {
    subject_id: string;
    nature: string;
    value: number;
    scale: number;
    sequence_number: number;
    created_at: string;
  };
  const bySubject = new Map<string, G[]>();
  for (const g of (grades ?? []) as G[]) {
    const arr = bySubject.get(g.subject_id) ?? [];
    arr.push(g);
    bySubject.set(g.subject_id, arr);
  }

  const grades_summary = [...bySubject.entries()]
    .map(([sid, gs]) => {
      const name = subName.get(sid) ?? sid;
      const comp = gs.find((x) => x.nature === "composition");
      const composition =
        comp && Number(comp.scale) > 0
          ? round2((Number(comp.value) / Number(comp.scale)) * 20)
          : null;
      const evaluations = gs
        .filter((x) => x.nature === "evaluation")
        .sort((a, b) => {
          const s = (a.sequence_number ?? 0) - (b.sequence_number ?? 0);
          if (s !== 0) return s;
          return String(a.created_at).localeCompare(String(b.created_at));
        })
        .filter((x) => Number(x.scale) > 0)
        .map((x) => round2((Number(x.value) / Number(x.scale)) * 20));
      return { subject: name, composition, evaluations };
    })
    .sort((a, b) => a.subject.localeCompare(b.subject, "fr"));

  return {
    ok: true,
    data: {
      ...identity,
      period: periodPayload(period),
      general_average: null,
      subject_averages: [],
      grades_summary,
      has_generated_bulletin: card?.document_id != null,
      source: "incomplete",
    },
  };
}

export async function runTool(
  sb: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (name === "get_class_statistics") return toolGetClassStatistics(sb, args);
  if (name === "get_student") return toolGetStudent(sb, args);
  return {
    ok: false,
    error: { code: "INTERNAL", message: "Tool inconnu." },
  };
}
