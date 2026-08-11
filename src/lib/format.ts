export const formatFCFA = (value: number | null | undefined) =>
  new Intl.NumberFormat("fr-ML", { maximumFractionDigits: 0 }).format(Number(value ?? 0)) + " FCFA";

export const formatNumber = (value: number | null | undefined, digits = 2) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(Number(value ?? 0));

export const formatDate = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value)) : "—";

export const formatDateTime = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

export const ESTABLISHMENT_TYPES = [
  { value: "universite", label: "Université" },
  { value: "lycee", label: "Lycée" },
  { value: "college", label: "Collège" },
  { value: "fondamentale", label: "Fondamentale" },
] as const;

export const establishmentTypeLabel = (type: string) =>
  ESTABLISHMENT_TYPES.find((t) => t.value === type)?.label ?? type;

export const ADMIN_ROLES = [
  { value: "director_general", label: "Directeur Général" },
  { value: "director", label: "Directeur d'établissement" },
  { value: "accountant", label: "Comptable" },
  { value: "secretary", label: "Secrétaire" },
  { value: "staff", label: "Personnel" },
] as const;

export const roleLabel = (role: string | null | undefined) =>
  ADMIN_ROLES.find((r) => r.value === role)?.label ?? role ?? "—";

export const initials = (first?: string | null, last?: string | null) =>
  `${(first ?? "").charAt(0)}${(last ?? "").charAt(0)}`.toUpperCase() || "?";
