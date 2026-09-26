/**
 * Page classe — stats via formules modèle Excel + design modernisé.
 * Priorité : bulletins validés. Repli : évaluation live des formules du modèle.
 *
 * RESTORE IN PROGRESS — full file being pushed.
 * Temporary safe stub that renders a message.
 */
import { EmptyState } from "@/components/app/empty-state";
import { AlertTriangle } from "lucide-react";

export function ClassPage() {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="Mise à jour en cours"
      description="La page classe est en cours de restauration. Rafraîchissez dans une minute."
    />
  );
}
