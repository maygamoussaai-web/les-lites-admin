/** Formatage et libellés d'audit (FR). */

export function initials(first?: string | null, last?: string | null) {
  const a = (first ?? "").trim().charAt(0);
  const b = (last ?? "").trim().charAt(0);
  return `${a}${b}`.toUpperCase() || "?";
}

export function formatDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("fr-FR");
  } catch {
    return value;
  }
}

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

export function formatNumber(value?: number | null, digits?: number) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (digits !== undefined) {
    return new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }
  return new Intl.NumberFormat("fr-FR").format(value);
}

export function formatFCFA(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${new Intl.NumberFormat("fr-FR").format(Math.round(value))} FCFA`;
}

export function roleLabel(role?: string | null) {
  if (role === "director_general") return "Directeur général";
  if (role === "administrative_staff") return "Personnel administratif";
  return role ?? "—";
}

export function establishmentTypeLabel(type?: string | null) {
  if (type === "lycee") return "Lycée";
  if (type === "college") return "Collège";
  if (type === "fondamentale") return "Fondamentale";
  return type ?? "Établissement";
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: "Création",
  update: "Modification",
  delete: "Suppression",
  archive: "Archivage",
  unarchive: "Désarchivage",
  upsert: "Enregistrement",
  bulk_upsert: "Saisie groupée",
  open: "Ouverture",
  close: "Clôture",
  reopen: "Réouverture",
  login: "Connexion",
  logout: "Déconnexion",
  mark_completed: "Validation séance",
  transfer: "Transfert",
  enroll: "Inscription",
  end_enrollment: "Fin d'inscription",
  assign: "Affectation",
  unassign: "Désaffectation",
  renew: "Renouvellement",
  generate: "Génération",
  record: "Enregistrement",
};

export const AUDIT_TABLE_LABELS: Record<string, string> = {
  establishments: "Établissement",
  classes: "Classe",
  students: "Élève",
  student_enrollments: "Inscription",
  fee_plans: "Grille tarifaire",
  fee_plan_installments: "Tranche",
  tuition_payments: "Paiement scolarité",
  teachers: "Enseignant",
  teacher_assignments: "Affectation",
  teacher_sessions: "Séance",
  teacher_session_completions: "Séance effectuée",
  teacher_payments: "Paiement enseignant",
  admin_profiles: "Compte personnel",
  admin_invitations: "Invitation",
  audit_logs: "Journal",
  grades: "Note",
  grade_periods: "Période",
  class_subjects: "Matière",
  report_templates: "Modèle de bulletin",
  student_documents: "Document",
  student_report_cards: "Bulletin",
  class_reports: "Rapport de classe",
};

export function auditActionLabel(action?: string | null) {
  if (!action) return "—";
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function auditEntityLabel(entity?: string | null) {
  if (!entity) return "—";
  return AUDIT_TABLE_LABELS[entity] ?? entity;
}

/** Libellé riche pour une entrée d'audit (outil IA + action + entité). */
export function auditLogTitle(log: {
  action?: string | null;
  entity_type?: string | null;
  metadata?: unknown;
}): string {
  const meta = (log.metadata ?? {}) as Record<string, unknown>;
  const tool = typeof meta.tool === "string" ? meta.tool : typeof meta.tool_name === "string" ? meta.tool_name : null;
  const viaAi = !!meta.via_ai;
  const action = auditActionLabel(log.action);
  const entity = auditEntityLabel(log.entity_type);
  if (viaAi && tool) return `IA · ${tool} · ${action} · ${entity}`;
  if (viaAi) return `IA · ${action} · ${entity}`;
  return `${action} · ${entity}`;
}

export function auditLogSummary(log: { metadata?: unknown }): string {
  const meta = (log.metadata ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (meta.name) parts.push(String(meta.name));
  if (meta.fields && Array.isArray(meta.fields)) parts.push(`champs: ${(meta.fields as string[]).join(", ")}`);
  if (meta.value !== undefined) parts.push(`note: ${meta.value}${meta.scale ? `/${meta.scale}` : ""}`);
  if (meta.nature) parts.push(String(meta.nature));
  if (meta.count !== undefined) parts.push(`${meta.count} élément(s)`);
  if (meta.period_number !== undefined) parts.push(`période ${meta.period_number}`);
  if (meta.amount !== undefined) parts.push(`${meta.amount} FCFA`);
  if (meta.weekday !== undefined) parts.push(`jour ${meta.weekday}`);
  if (meta.summary && typeof meta.summary === "string") parts.push(meta.summary);
  return parts.join(" · ") || "—";
}
