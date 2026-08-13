export const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: "Création",
  update: "Modification",
  delete: "Suppression",
  archive: "Archivage",
  invitation_created: "Invitation envoyée",
  invitation_accepted: "Invitation acceptée",
  admin_activated: "Accès activé",
  admin_deactivated: "Accès désactivé",
  admin_deleted: "Compte supprimé",
};

export const auditActionLabel = (action: string) => AUDIT_ACTION_LABELS[action] ?? action;

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  students: "élève",
  teachers: "enseignant",
  classes: "classe",
  fee_plans: "modèle de scolarité",
  fee_plan_installments: "tranche de scolarité",
  tuition_payments: "paiement de scolarité",
  teacher_assignments: "affectation enseignant",
  teacher_sessions: "séance enseignant",
  teacher_payments: "paiement enseignant",
  admin_profiles: "personnel administratif",
  invitations: "invitation",
  establishments: "établissement",
};

export const auditEntityLabel = (entity: string) => AUDIT_ENTITY_LABELS[entity] ?? entity;