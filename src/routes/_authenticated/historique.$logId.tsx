import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronDown,
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
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
        content: "Visualisation détaillée d'une action enregistrée dans le journal de l'école.",
      },
    ],
  }),
  component: DetailPage,
});

function DetailPage() {
  const { logId } = Route.useParams();
  const { isDG } = useAdminProfile();
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  // Données de base
  const { data: establishments = [] } = useRows<Tables<"establishments">>("establishments", {
    order: { column: "name" },
  });
  const { data: admins = [] } = useRows<Tables<"admin_profiles">>("admin_profiles");
  const { data: classes = [] } = useRows<Tables<"classes">>("classes");

  // Chargement du log
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

  // Métadonnées du log
  const meta = ((log?.metadata as Record<string, unknown>) ?? {});
  const viaAi = !!meta.via_ai;
  const toolName = (meta.tool ?? meta.tool_name) as string | undefined;

  // Résolution contextuelle de l'entité (élève, professeur, classe)
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

  // Requête optionnelle sur l'élève lié
  const { data: linkedStudent } = useQuery({
    queryKey: ["audit_student", studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data } = await supabase
        .from("students")
        .select("id, first_name, last_name, matricule, photo_url, class_id")
        .eq("id", studentId!)
        .maybeSingle();
      return data;
    },
  });

  // Requête optionnelle sur le professeur lié
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
          description="Cette entrée a peut-être été déplacée ou n'existe plus."
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

  // Configuration visuelle du badge d'action
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
      case "mark_completed":
      case "renew":
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

  // Génération d'une description humaine fluide
  const getHumanNarrative = () => {
    const studentName = linkedStudent
      ? `${linkedStudent.first_name} ${linkedStudent.last_name}`
      : (meta.name as string) || (meta.student_name as string);

    const teacherName = linkedTeacher
      ? `${linkedTeacher.first_name} ${linkedTeacher.last_name}`
      : (meta.teacher_name as string);

    if (log.entity_type === "grades") {
      const val = meta.value ?? meta.grade;
      const scale = meta.scale ?? 20;
      const nature = meta.nature ? ` (${String(meta.nature)})` : "";
      return {
        headline: val !== undefined ? `Attribution de la note ${val} / ${scale}${nature}` : "Modification de note",
        context: studentName ? `Pour l'élève ${studentName}` : "Sur le carnet de notes",
      };
    }

    if (log.entity_type === "tuition_payments") {
      const amount = Number(meta.amount ?? 0);
      return {
        headline: amount > 0 ? `Encaissement de ${formatFCFA(amount)}` : "Enregistrement d'un paiement",
        context: studentName ? `Frais de scolarité de ${studentName}` : "Règlement de scolarité",
      };
    }

    if (log.entity_type === "students") {
      if (log.action === "create") return { headline: `Inscription de ${studentName || "l'élève"}`, context: targetClass ? `Affecté(e) en ${targetClass.name}` : "Nouveau dossier scolaire" };
      if (log.action === "update" && meta.restored) return { headline: `Désarchivage du dossier`, context: `Élève : ${studentName || "Dossier scolaire"}` };
      if (log.action === "update" && meta.transferred_to_class_id) return { headline: `Transfert de classe`, context: `Vers la classe ${targetClass?.name || "choisie"}` };
      return { headline: `${auditActionLabel(log.action)} de la fiche élève`, context: studentName || "Dossier scolaire" };
    }

    if (log.entity_type === "classes") {
      const cName = (meta.name as string) || targetClass?.name || "Classe";
      if (log.action === "renew") return { headline: `Renouvellement annuel de la classe ${cName}`, context: (meta.generation_name as string) || "Nouvelle promotion" };
      return { headline: `${auditActionLabel(log.action)} de la classe ${cName}`, context: est?.name || "Organisation scolaire" };
    }

    if (log.entity_type === "teachers") {
      return { headline: `${auditActionLabel(log.action)} de l'enseignant`, context: teacherName ? `M./Mme ${teacherName}` : "Corps enseignant" };
    }

    if (log.entity_type === "grade_periods") {
      const pNum = meta.period_number;
      return {
        headline: log.action === "open" ? `Ouverture de la Période ${pNum || ""}` : `Clôture de la Période ${pNum || ""}`,
        context: targetClass ? `Classe ${targetClass.name}` : "Calendrier des évaluations",
      };
    }

    if (log.entity_type === "student_report_cards") {
      return { headline: "Génération de bulletin", context: studentName ? `Bulletin de ${studentName}` : "Évaluation scolaire" };
    }

    // Repli général bienveillant
    return {
      headline: `${auditActionLabel(log.action)} · ${auditEntityLabel(log.entity_type)}`,
      context: (meta.summary as string) || (meta.name as string) || "Opération réalisée dans l'application",
    };
  };

  const narrative = getHumanNarrative();

  // Extraction propre des champs métier lisibles
  const readableBadges: { label: string; value: string; icon?: typeof Calendar }[] = [];
  if (meta.value !== undefined) {
    readableBadges.push({ label: "Note attribuée", value: `${meta.value} / ${meta.scale ?? 20}` });
  }
  if (meta.nature) {
    readableBadges.push({ label: "Type d'épreuve", value: String(meta.nature).toUpperCase() });
  }
  if (meta.amount !== undefined) {
    readableBadges.push({ label: "Montant", value: formatFCFA(Number(meta.amount)), icon: Coins });
  }
  if (meta.period_number !== undefined) {
    readableBadges.push({ label: "Période", value: `Période ${meta.period_number}` });
  }
  if (meta.method) {
    readableBadges.push({ label: "Mode de règlement", value: String(meta.method) });
  }
  if (meta.receipt_number) {
    readableBadges.push({ label: "Reçu N°", value: String(meta.receipt_number) });
  }
  if (meta.generation_name) {
    readableBadges.push({ label: "Nom d'archive", value: String(meta.generation_name) });
  }
  if (meta.total_amount) {
    readableBadges.push({ label: "Total grille", value: formatFCFA(Number(meta.total_amount)) });
  }

  // Filtrer les entrées techniques pour l'accordéon développeur
  const technicalKeys = Object.entries(meta).filter(
    ([k]) => !["via_ai", "tool", "tool_name", "summary"].includes(k)
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      {/* Bouton retour épuré */}
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
          <Link to="/historique">
            <ArrowLeft className="h-4 w-4" />
            Retour au journal complet
          </Link>
        </Button>
        <span className="text-xs font-mono text-muted-foreground/70">
          Réf. {log.id.slice(0, 8)}
        </span>
      </div>

      {/* Hero Card : Titre narratif & Statut visuel */}
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
                {viaAi ? (toolName ? `Outil ${toolName}` : "Validation admin") : roleLabel(actor?.role)}
              </p>
            </div>
          </div>

          {/* Horodatage */}
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Date & Heure</p>
              <p className="text-sm font-semibold text-foreground">
                {formatDateTime(log.created_at)}
              </p>
              <p className="text-xs text-muted-foreground">Enregistré dans le journal</p>
            </div>
          </div>

          {/* Établissement */}
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Établissement</p>
              <p className="text-sm font-semibold text-foreground">
                {est ? est.name : "Tout le complexe"}
              </p>
              <p className="text-xs text-muted-foreground">Périmètre scolaire</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cartes de valeurs métier (Notes, Paiements, etc.) */}
      {readableBadges.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Données de l'opération
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

      {/* Carte d'accès direct vers l'élève ou le personnel concerné */}
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
                  Voir ses notes
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
                  {linkedTeacher.specialty || "Enseignant"} {linkedTeacher.phone ? `· ${linkedTeacher.phone}` : ""}
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

      {/* Accordéon technique discret (pour les vérifications système ou développeurs) */}
      <Collapsible
        open={showTechnicalDetails}
        onOpenChange={setShowTechnicalDetails}
        className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden"
      >
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="flex w-full items-center justify-between p-4 text-xs font-medium text-muted-foreground hover:bg-muted/40"
          >
            <span>Détails techniques avancés & identifiants (Audit)</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${
                showTechnicalDetails ? "rotate-180" : ""
              }`}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border/60 p-4 space-y-3 bg-muted/10">
          <div className="grid gap-2 text-xs font-mono">
            <div className="flex flex-wrap justify-between gap-2 border-b border-border/40 pb-1.5">
              <span className="text-muted-foreground">Identifiant de l'action (UUID) :</span>
              <span className="break-all select-all font-semibold">{log.id}</span>
            </div>
            {log.entity_id && (
              <div className="flex flex-wrap justify-between gap-2 border-b border-border/40 pb-1.5">
                <span className="text-muted-foreground">Identifiant de l'entité :</span>
                <span className="break-all select-all">{log.entity_id}</span>
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-2 border-b border-border/40 pb-1.5">
              <span className="text-muted-foreground">Table source :</span>
              <span>{log.entity_type}</span>
            </div>
          </div>

          {technicalKeys.length > 0 && (
            <div className="pt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Charge utile (Payload JSON)
              </p>
              <pre className="overflow-x-auto rounded-lg bg-background p-3 text-[11px] text-foreground font-mono border border-border/60">
                {JSON.stringify(meta, null, 2)}
              </pre>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
