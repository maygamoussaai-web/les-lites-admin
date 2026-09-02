/**
 * Traduction centralisée des erreurs (Supabase / PostgREST / Postgres / réseau)
 * en messages français précis et actionnables pour l'utilisateur.
 */

type AnyError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
  statusCode?: string | number;
  error_description?: string;
} | null | undefined;

const TABLE_LABELS: Record<string, string> = {
  establishments: "établissement",
  classes: "classe",
  students: "élève",
  student_enrollments: "inscription",
  fee_plans: "grille tarifaire",
  fee_plan_installments: "tranche",
  tuition_payments: "paiement de scolarité",
  teachers: "enseignant",
  teacher_assignments: "affectation",
  teacher_sessions: "séance",
  teacher_session_completions: "séance effectuée",
  teacher_payments: "paiement enseignant",
  admin_profiles: "compte personnel",
  admin_invitations: "invitation",
  audit_logs: "journal",
};

export function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function isNetworkFailure(message?: string) {
  if (!message) return false;
  return /failed to fetch|network ?error|networkrequestfailed|load failed|timeout|aborted|ERR_INTERNET|ERR_NETWORK|fetch failed/i.test(
    message,
  );
}

function readError(error: unknown): AnyError {
  if (!error) return null;
  if (typeof error === "string") return { message: error };
  return error as AnyError;
}

/**
 * @param error   erreur brute
 * @param fallback message générique décrivant l'action ("Enregistrement impossible")
 * @param table   table concernée, pour préciser l'objet en cause
 */
export function describeError(error: unknown, fallback = "Opération impossible", table?: string): string {
  const e = readError(error);
  const message = e?.message ?? e?.error_description ?? "";
  const code = String(e?.code ?? e?.statusCode ?? "");
  const status = Number(e?.status ?? 0);
  const details = e?.details ?? "";
  const subject = table ? TABLE_LABELS[table] ?? "élément" : "élément";

  if (isOffline()) return `${fallback} — vous êtes hors ligne. L'action sera envoyée dès le retour du réseau.`;
  if (isNetworkFailure(message)) return `${fallback} — connexion interrompue ou trop lente. Réessayez.`;

  // --- Postgres ---
  switch (code) {
    case "23505":
      if (/email/i.test(details) || /email/i.test(message)) return "Cette adresse e-mail est déjà utilisée.";
      if (/matricule|student_number/i.test(details)) return "Ce matricule est déjà attribué à un autre élève.";
      if (/phone/i.test(details)) return "Ce numéro de téléphone est déjà enregistré.";
      return `Un ${subject} identique existe déjà. Modifiez les informations en double.`;
    case "23503":
      return `Impossible : ce ${subject} est encore lié à d'autres données (classes, paiements, inscriptions). Retirez d'abord ces liens.`;
    case "23502":
      return "Un champ obligatoire est vide. Complétez le formulaire avant d'enregistrer.";
    case "23514":
      return "Une valeur saisie n'est pas autorisée (montant négatif, date incohérente ou moyenne hors de 0–20).";
    case "22P02":
      return "Format de donnée invalide : vérifiez les nombres et les dates saisis.";
    case "22003":
      return "Le montant saisi est trop grand.";
    case "42501":
      return `Accès refusé : votre rôle ne permet pas cette action sur ce ${subject}.`;
    case "PGRST301":
      return "Votre session a expiré. Reconnectez-vous pour continuer.";
    case "PGRST116":
      return `Ce ${subject} est introuvable — il a peut-être été supprimé entre-temps.`;
    case "PGRST204":
      return "Champ inconnu envoyé au serveur. Rechargez la page pour récupérer la dernière version de l'application.";
  }

  // --- Auth Supabase ---
  if (/invalid login credentials/i.test(message)) return "E-mail ou mot de passe incorrect.";
  if (/email not confirmed/i.test(message)) return "Adresse e-mail non confirmée.";
  if (/user already registered/i.test(message)) return "Un compte existe déjà avec cette adresse e-mail.";
  if (/password should be at least/i.test(message)) return "Mot de passe trop court : 8 caractères minimum.";
  if (/same.*password/i.test(message)) return "Le nouveau mot de passe doit être différent de l'ancien.";
  if (/jwt expired|invalid claim|refresh token/i.test(message)) return "Session expirée. Reconnectez-vous.";
  if (/rate limit|too many requests/i.test(message) || status === 429)
    return "Trop de tentatives. Patientez une minute avant de réessayer.";

  // --- Storage ---
  if (/exceeded the maximum allowed size|payload too large/i.test(message) || status === 413)
    return "Fichier trop volumineux. Compressez-le ou choisissez une image plus légère.";
  if (/mime type|not supported/i.test(message)) return "Format de fichier non pris en charge (JPEG, PNG ou PDF).";
  if (/object not found|not_found/i.test(message) || status === 404)
    return "Fichier introuvable : il a peut-être été supprimé.";
  if (/bucket not found/i.test(message)) return "Espace de stockage indisponible. Contactez l'administrateur.";

  // --- HTTP ---
  if (status === 401) return "Session expirée ou non autorisée. Reconnectez-vous.";
  if (status === 403) return "Action non autorisée pour votre rôle.";
  if (status >= 500) return "Le serveur est momentanément indisponible. Réessayez dans un instant.";

  // --- Messages métier déjà en français (levés par nos fonctions serveur) ---
  if (message && /[éèêàùôçÉÈ]|impossible|invalide|expir|autoris/i.test(message)) return message;

  return message ? `${fallback} (${message})` : fallback;
}
