/**
 * Page classe — point d'entrée mince (données + vue).
 * Structure modulaire pour stabilité des déploiements.
 */
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageLoading } from "@/components/app/page-loading";
import { useClassPage } from "./class-page/use-class-page";
import { ClassPageView } from "./class-page/class-page-view";

export function ClassPage() {
  const model = useClassPage();

  if (!model.loading && (!model.klass || !model.allowed)) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Accès refusé"
        description="Cette classe n'existe pas ou vous n'y avez pas accès."
      />
    );
  }
  if (!model.klass) {
    if (model.loading) return <PageLoading />;
    return null;
  }

  return <ClassPageView {...model} />;
}
