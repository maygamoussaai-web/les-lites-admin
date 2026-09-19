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
  login: "Connexion",
  logout: "Déconnexion",
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
