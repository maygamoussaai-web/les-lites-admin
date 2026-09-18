/**
 * Traduction centralisee des erreurs (Supabase / PostgREST / Postgres / reseau)
 * en messages francais precis et actionnables pour l'utilisateur.
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
  establishments: "etablissement",
  classes: "classe",
  students: "eleve",
  student_enrollments: "inscription",
  fee_plans: "grille tarifaire",
  fee_plan_installments: "tranche",
  tuition_payments: "paiement de scolarite",
  teachers: "enseignant",
  teacher_assignments: "affectation",
  teacher_sessions: "seance",
  teacher_session_completions: "seance effectuee",
  teacher_payments: "paiement enseignant",
  admin_profiles: "compte personnel",
  admin_invitations: "invitation",
  audit_logs: "journal",
  grades: "note",
  grade_periods: "periode",
  class_subjects: "matiere",
  report_templates: "modele de bulletin",
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

export function describeError(error: unknown, fallback = "Operation impossible", table?: string): string {
  const e = readError(error);
  const message = e?.message ?? e?.error_description ?? "";
  const code = String(e?.code ?? e?.statusCode ?? "");
  const status = Number(e?.status ?? 0);
  const details = e?.details ?? "";
  const subject = table ? TABLE_LABELS[table] ?? "element" : "element";

  if (isOffline()) return `${fallback} — vous etes hors ligne. L'action sera envoyee des le retour du reseau.`;
  if (isNetworkFailure(message)) return `${fallback} — connexion interrompue ou trop lente. Reessayez.`;

  switch (code) {
    case "23505":
      if (/email/i.test(details) || /email/i.test(message)) return "Cette adresse e-mail est deja utilisee.";
      if (/matricule|student_number/i.test(details)) return "Ce matricule est deja attribue a un autre eleve.";
      if (/phone/i.test(details)) return "Ce numero de telephone est deja enregistre.";
      return `Un ${subject} identique existe deja. Modifiez les informations en double.`;
    case "23503":
      return `Impossible : ce ${subject} est encore lie a d'autres donnees (classes, paiements, inscriptions). Retirez d'abord ces liens.`;
    case "23502":
      return "Un champ obligatoire est vide. Completez le formulaire avant d'enregistrer.";
    case "23514":
      return "Une valeur saisie n'est pas autorisee (montant negatif, date incoherente ou moyenne hors de 0-20).";
    case "22P02":
      return "Format de donnee invalide : verifiez les nombres et les dates saisis.";
    case "22003":
      return "Le montant saisi est trop grand.";
    case "42501":
      return `Acces refuse : votre role ne permet pas cette action sur ce ${subject}.`;
    case "PGRST301":
      return "Votre session a expire. Reconnectez-vous pour continuer.";
    case "PGRST116":
      return `Ce ${subject} est introuvable — il a peut-etre ete supprime entre-temps.`;
    case "PGRST204":
      return "Champ inconnu envoye au serveur. Rechargez la page pour recuperer la derniere version de l'application.";
  }

  if (/invalid login credentials/i.test(message)) return "E-mail ou mot de passe incorrect.";
  if (/email not confirmed/i.test(message)) return "Adresse e-mail non confirmee.";
  if (/user already registered/i.test(message)) return "Un compte existe deja avec cette adresse e-mail.";
  if (/password should be at least/i.test(message)) return "Mot de passe trop court : 8 caracteres minimum.";
  if (/same.*password/i.test(message)) return "Le nouveau mot de passe doit etre different de l'ancien.";
  if (/jwt expired|invalid claim|refresh token/i.test(message)) return "Session expiree. Reconnectez-vous.";
  if (/rate limit|too many requests/i.test(message) || status === 429)
    return "Trop de tentatives. Patientez une minute avant de reessayer.";

  if (/exceeded the maximum allowed size|payload too large/i.test(message) || status === 413)
    return "Fichier trop volumineux. Compressez-le ou choisissez un fichier plus leger.";
  if (/mime type|not supported/i.test(message))
    return "Le stockage a refuse ce type de fichier. L'app retente en Excel ou PDF.";
  if (/object not found|not_found/i.test(message) || status === 404)
    return "Fichier introuvable : il a peut-etre ete supprime.";
  if (/bucket not found/i.test(message)) return "Espace de stockage indisponible. Contactez l'administrateur.";

  if (status === 401) return "Session expiree ou non autorisee. Reconnectez-vous.";
  if (status === 403) return "Action non autorisee pour votre role.";
  if (status >= 500) return "Le serveur est momentanement indisponible. Reessayez dans un instant.";

  if (message && /[eeeeaauocEEEE]|impossible|invalide|expir|autoris/i.test(message)) return message;

  return message ? `${fallback} (${message})` : fallback;
}
