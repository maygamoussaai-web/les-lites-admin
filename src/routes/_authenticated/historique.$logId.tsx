import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  Coins,
  FileCheck,
  FileText,
  GraduationCap,
  Layers,
  Sparkles,
  Trash2,
  User,
  UserCheck,
  ExternalLink,
  BookOpen,
  ArrowRightLeft,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAdminProfile } from "@/hooks/use-auth";
import { useRows } from "@/lib/data";
import {
  auditActionLabel,
  auditEntityLabel,
  formatDateTime,
  formatFCFA,
  initials,
  roleLabel,
} from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/historique/$logId")({
  head: () => ({
    meta: [
      { title: "Détail de l'action – Journal – Les Élites de Gao" },
      {
        name: "description",
        content: "Détail compréhensible d'une action enregistrée dans le journal de l'école.",
      },
    ],
  }),
  component: DetailPage,
});

function DetailPage() {
  const { logId } = Route.useParams();
  const { isDG } = useAdminProfile();

  const { data: establishments = [] } = useRows<Tables<"establishments">>("establishments", {
    order: { column: "name" },
  });
  const { data: admins = [] } = useRows<Tables<"admin_profiles">>("admin_profiles");
  const { data: classes = [] } = useRows<Tables<"classes">>("classes");

  const { data: log, isLoading, error } = useQuery({
    queryKey: ["audit_log", logId],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("id", logId)
        .maybeSingle();
      if (err) throw err;
      return data as Tables<"audit_logs"> | null;
    },
  });

  const meta = ((log?.metadata as Record<string, unknown>) ?? {});
  const viaAi = !!meta.via_ai;
  const toolName = (meta.tool ?? meta.tool_name) as string | undefined;

  const studentId =
    log?.entity_type === "students"
      ? log.entity_id
      : (meta.student_id as string | undefined);

  const teacherId =
    log?.entity_type === "teachers"
      ? log.entity_id
      : (meta.teacher_id as string | undefined);

  const classId =
    log?.entity_type === "classes"
      ? log.entity_id
      : (meta.class_id as string | undefined) ??
        (meta.transferred_to_class_id as string | undefined);

  // Informations sur l'élève lié
  const { data: linkedStudent } = useQuery({
    queryKey: ["audit_student", studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data } = await supabase
        .from("students")
        .select("id, first_name, last_name, matricule, photo_url, class_id, archived_at")
        .eq("id", studentId!)
        .maybeSingle();
      return data;
    },
  });

  // Informations sur le professeur lié
  const { data: linkedTeacher } = useQuery({
    queryKey: ["audit_teacher", teacherId],
    enabled: !!teacherId,
    queryFn: async () => {
      const { data } = await supabase
        .from("teachers")
        .select("id, first_name, last_name, phone, specialty")
        .eq("id", teacherId!)
        .maybeSingle();
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHeader eyebrow="Journal" title="Chargement de l'action…" description="" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted/40" />
      </div>
    );
  }

  if (error || !log) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHeader
          eyebrow="Journal"
          title="Action introuvable"
          description="Cette action n'existe pas ou vous n'avez pas l'autorisation d'y accéder."
        />
        <Button asChild variant="outline">
          <Link to="/historique">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour à l'historique
          </Link>
        </Button>
      </div>
    );
  }

  const actor = admins.find((a) => a.id === log.actor_id);
  const est = establishments.find((e) => e.id === log.establishment_id);
  const targetClass = classes.find((c) => c.id === classId || c.id === linkedStudent?.class_id);

  const getActionTheme = (action: string) => {
    switch (action) {
      case "create":
      case "enroll":
      case "open":
        return {
          icon: Sparkles,
          color: "text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
          dot: "bg-emerald-500",
        };
      case "delete":
      case "archive":
      case "close":
        return {
          icon: Trash2,
          color: "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
          dot: "bg-amber-500",
        };
      case "generate":
      case "renew":
      case "bulk_upsert":
        return {
          icon: FileCheck,
          color: "text-purple-700 bg-purple-50 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800",
          dot: "bg-purple-500",
        };
      default:
        return {
          icon: CheckCircle2,
          color: "text-blue-700 bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
          dot: "bg-blue-500",
        };
    }
  };

  const theme = getActionTheme(log.action);
  const ActionIcon = theme.icon;

  // Récit narratif humain et détaillé
  const getHumanNarrative = () => {
    const studentFullName = linkedStudent
      ? `${linkedStudent.first_name} ${linkedStudent.last_name}`
      : (meta.student_name as string) || (meta.name as string);

    const teacherFullName = linkedTeacher
      ? `${linkedTeacher.first_name} ${linkedTeacher.last_name}`
      : (meta.teacher_name as string);

    const className = targetClass?.name || (meta.class_name as string) || (meta.name as string) || "Classe";

    // 1. Bulletins groupés de classe
    if (log.action === "generate" && (log.entity_type === "classes" || meta.count !== undefined)) {
      const count = meta.count ?? "Tous les";
      const pNum = meta.period_number ? `Période ${meta.period_number}` : "période active";
      return {
        headline: `Génération des bulletins de la classe ${className}`,
        context: `${count} bulletins créés et déposés en bibliothèque pour la ${pNum}`,
      };
    }

    // 2. Saisie groupée de notes pour toute une classe
    if (log.action === "bulk_upsert" || (log.entity_type === "grades" && meta.count !== undefined)) {
      const count = meta.count ?? "plusieurs";
      const subj = (meta.subject_name as string) || "la discipline";
      return {
        headline: `Saisie groupée de notes — Classe ${className}`,
        context: `${count} note(s) enregistrée(s) en ${subj}`,
      };
    }

    // 3. Note individuelle
    if (log.entity_type === "grades") {
      const val = meta.value ?? meta.grade;
      const scale = meta.scale ?? 20;
      const nature = meta.nature ? ` (${String(meta.nature).toUpperCase()})` : "";
      return {
        headline: val !== undefined ? `Attribution d'une note de ${val} / ${scale}${nature}` : "Mise à jour de note",
        context: studentFullName
          ? `Pour l'élève ${studentFullName} · Classe : ${className}`
          : `Attribuée dans la classe ${className}`,
      };
    }

    // 4. Paiement de scolarité
    if (log.entity_type === "tuition_payments") {
      const amount = Number(meta.amount ?? 0);
      const receipt = meta.receipt_number ? ` (Reçu N° ${meta.receipt_number})` : "";
      return {
        headline: amount > 0 ? `Encaissement de ${formatFCFA(amount)}` : "Enregistrement d'un versement",
        context: studentFullName
          ? `Scolarité de l'élève ${studentFullName}${receipt} · Classe : ${className}`
          : `Paiement de scolarité reçu${receipt}`,
      };
    }

    // 5. Élèves (Archivage, Inscription, Restauration, Transfert)
    if (log.entity_type === "students") {
      if (log.action === "archive") {
        return {
          headline: `Archivage de l'élève ${studentFullName || "sélectionné"}`,
          context: `Dossier transféré dans les archives · Classe d'origine : ${className}`,
        };
      }
      if (log.action === "update" && meta.restored) {
        return {
          headline: `Restauration du dossier de ${studentFullName || "l'élève"}`,
          context: `Dossier réactivé avec succès · Classe : ${className}`,
        };
      }
      if (log.action === "update" && meta.transferred_to_class_id) {
        return {
          headline: `Transfert de classe de l'élève ${studentFullName || ""}`,
          context: `Affecté(e) vers la nouvelle classe ${className}`,
        };
      }
      if (log.action === "create" || log.action === "enroll") {
        return {
          headline: `Inscription de l'élève ${studentFullName || "Nouveau"}`,
          context: `Inscrit(e) et affecté(e) dans la classe ${className}`,
        };
      }
      return {
        headline: `${auditActionLabel(log.action)} de la fiche élève`,
        context: studentFullName ? `Élève : ${studentFullName} · Classe : ${className}` : "Dossier scolaire",
      };
    }

    // 6. Classes (Renouvellement annuel, création, clôture)
    if (log.entity_type === "classes") {
      if (log.action === "renew") {
        const genName = (meta.generation_name as string) || "Promotion archivée";
        return {
          headline: `Renouvellement annuel de la classe ${className}`,
          context: `Nouvelle promotion archivée : « ${genName} » · Nouvelle classe prête pour l'année`,
        };
      }
      return {
        headline: `${auditActionLabel(log.action)} de la classe ${className}`,
        context: est ? `Établissement : ${est.name}` : "Complexe scolaire",
      };
    }

    // 7. Enseignants
    if (log.entity_type === "teachers" || log.entity_type === "teacher_assignments") {
      return {
        headline: `${auditActionLabel(log.action)} pour l'enseignant ${teacherFullName || ""}`,
        context: linkedTeacher?.specialty
          ? `Discipline : ${linkedTeacher.specialty} ${linkedTeacher.phone ? `· Tél : ${linkedTeacher.phone}` : ""}`
          : `Affectation scolaire`,
      };
    }

    // 8. Périodes de notes
    if (log.entity_type === "grade_periods") {
      const pNum = meta.period_number;
      return {
        headline: log.action === "open" ? `Ouverture de la Période ${pNum || ""}` : `Clôture de la Période ${pNum || ""}`,
        context: `Classe ${className} · ${log.action === "open" ? "Saisie des notes activée" : "Notes verrouillées pour les bulletins"}`,
      };
    }

    return {
      headline: (meta.summary as string) || `${auditActionLabel(log.action)} · ${auditEntityLabel(log.entity_type)}`,
      context: (meta.name as string) || "Opération réalisée dans l'application",
    };
  };

  const narrative = getHumanNarrative();

  // Badges d'information métier lisibles
  const readableBadges: { label: string; value: string; icon?: typeof Calendar }[] = [];
  if (meta.value !== undefined) {
    readableBadges.push({ label: "Note attribuée", value: `${meta.value} / ${meta.scale ?? 20}` });
  }
  if (meta.nature) {
    readableBadges.push({ label: "Type d'épreuve", value: String(meta.nature).toUpperCase() });
  }
  if (meta.amount !== undefined) {
    readableBadges.push({ label: "Montant encaissé", value: formatFCFA(Number(meta.amount)), icon: Coins });
  }
  if (meta.count !== undefined) {
    readableBadges.push({ label: "Nombre d'éléments", value: `${meta.count} généré(s)` });
  }
  if (meta.period_number !== undefined) {
    readableBadges.push({ label: "Période scolaire", value: `Période ${meta.period_number}` });
  }
  if (meta.method) {
    readableBadges.push({ label: "Mode de règlement", value: String(meta.method) });
  }
  if (meta.receipt_number) {
    readableBadges.push({ label: "Numéro de reçu", value: `N° ${meta.receipt_number}` });
  }
  if (meta.generation_name) {
    readableBadges.push({ label: "Archive créée", value: String(meta.generation_name) });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      {/* Bouton retour épuré */}
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
          <Link to="/historique">
            <ArrowLeft className="h-4 w-4" />
            Retour à la liste du journal
          </Link>
        </Button>
      </div>

      {/* Carte principale de l'action */}
      <Card className="overflow-hidden border-border/80 shadow-sm">
        <div className="border-b border-border/60 bg-muted/20 p-6 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${theme.color}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${theme.dot}`} />
                <ActionIcon className="h-3.5 w-3.5" />
                {auditActionLabel(log.action)}
              </span>

              <Badge variant="outline" className="bg-background text-xs">
                {auditEntityLabel(log.entity_type)}
              </Badge>
            </div>

            {viaAi ? (
              <Badge className="bg-amber-500/15 text-amber-900 border-amber-300 dark:text-amber-200 dark:border-amber-700/60 font-medium text-xs gap-1.5 py-1">
                <Bot className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                Assistant IA (Action confirmée)
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs gap-1 py-1">
                <User className="h-3.5 w-3.5" />
                Action manuelle
              </Badge>
            )}
          </div>

          <div className="mt-4">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {narrative.headline}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
              {narrative.context}
            </p>
          </div>
        </div>

        {/* Détails essentiels en 3 colonnes */}
        <CardContent className="grid gap-6 p-6 sm:grid-cols-3">
          {/* Auteur */}
          <div className="flex items-start gap-3">
            <Avatar className="h-10 w-10 border border-border/60 bg-primary/10 text-primary">
              <AvatarFallback className="text-xs font-semibold">
                {viaAi ? "IA" : initials(actor?.first_name, actor?.last_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Auteur</p>
              <p className="text-sm font-semibold text-foreground truncate">
                {viaAi ? "Assistant IA" : actor ? `${actor.last_name} ${actor.first_name}` : "Direction Générale"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {viaAi ? (toolName ? `Outil exécuté : ${toolName}` : "Exécution automatique") : roleLabel(actor?.role)}
              </p>
            </div>
          </div>

          {/* Date */}
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Date & Heure</p>
              <p className="text-sm font-semibold text-foreground">
                {formatDateTime(log.created_at)}
              </p>
              <p className="text-xs text-muted-foreground">Horodatage certifié</p>
            </div>
          </div>

          {/* Établissement */}
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Établissement</p>
              <p className="text-sm font-semibold text-foreground truncate">
                {est ? est.name : "Tout le complexe"}
              </p>
              <p className="text-xs text-muted-foreground">Périmètre concerné</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cartes de valeurs métier */}
      {readableBadges.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Spécificités de l'opération
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {readableBadges.map((item, idx) => (
              <div
                key={idx}
                className="flex flex-col rounded-xl border border-border/70 bg-card p-4 shadow-xs"
              >
                <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
                <span className="mt-1 text-lg font-bold text-foreground tracking-tight">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Carte Élève lié */}
      {linkedStudent && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Élève concerné(e)
          </h2>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-border/70 bg-card p-4 shadow-xs">
            <div className="flex items-center gap-3.5">
              <Avatar className="h-12 w-12 border border-border/60">
                <AvatarFallback className="font-semibold text-sm bg-primary/10 text-primary">
                  {initials(linkedStudent.first_name, linkedStudent.last_name)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold text-foreground">
                  {linkedStudent.last_name} {linkedStudent.first_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {linkedStudent.matricule ? `Matricule : ${linkedStudent.matricule}` : "Élève actif"}
                  {targetClass ? ` · Classe : ${targetClass.name}` : ""}
                  {linkedStudent.archived_at ? " (Dossier Archivé)" : ""}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <Button asChild size="sm" variant="outline" className="flex-1 sm:flex-initial gap-1.5">
                <Link to="/eleves/$studentId" params={{ studentId: linkedStudent.id }}>
                  <UserCheck className="h-3.5 w-3.5" />
                  Dossier élève
                </Link>
              </Button>
              <Button asChild size="sm" variant="secondary" className="flex-1 sm:flex-initial gap-1.5">
                <Link to="/eleves/$studentId/notes" params={{ studentId: linkedStudent.id }}>
                  <GraduationCap className="h-3.5 w-3.5" />
                  Consulter ses notes
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Carte Enseignant lié */}
      {linkedTeacher && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Enseignant concerné
          </h2>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-border/70 bg-card p-4 shadow-xs">
            <div className="flex items-center gap-3.5">
              <Avatar className="h-12 w-12 border border-border/60 bg-muted">
                <AvatarFallback className="font-semibold text-sm">
                  {initials(linkedTeacher.first_name, linkedTeacher.last_name)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold text-foreground">
                  {linkedTeacher.last_name} {linkedTeacher.first_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {linkedTeacher.specialty || "Enseignant"} {linkedTeacher.phone ? `· Tél : ${linkedTeacher.phone}` : ""}
                </p>
              </div>
            </div>

            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link to="/enseignants/$teacherId" params={{ teacherId: linkedTeacher.id }}>
                <ExternalLink className="h-3.5 w-3.5" />
                Fiche enseignant
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
