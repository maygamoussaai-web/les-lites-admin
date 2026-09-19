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

export function formatNumber(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("fr-FR").format(value);
}

export function formatFCFA(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${new Intl.NumberFormat("fr-FR").format(Math.round(value))} FCFA`;
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
