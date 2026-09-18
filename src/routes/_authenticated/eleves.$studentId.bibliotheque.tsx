/**
 * Bibliotheque de l'eleve — tous les documents, classes par date et par classe.
 * Plus recents en bas. Icons selon le format. Responsive + scroll.
 */
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  FileText,
  FileSpreadsheet,
  FileImage,
  File,
  Download,
  Eye,
  ShieldAlert,
  Library,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAdminProfile } from "@/hooks/use-auth";
import { useSchoolData } from "@/lib/school-data";
import { useRows } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { downloadBlob } from "@/lib/pdf-export";
import type { Tables } from "@/integrations/supabase/types";

type StudentDocument = Tables<"student_documents">;

export const Route = createFileRoute("/_authenticated/eleves/$studentId/bibliotheque")({
  head: () => ({
    meta: [
      { title: "Bibliotheque eleve – Les Elites de Gao" },
      { name: "description", content: "Tous les documents de l'eleve, classes par date et par classe." },
    ],
  }),
  component: Page,
});

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function fileKind(doc: StudentDocument): "pdf" | "excel" | "image" | "other" {
  const t = (doc.file_type || "").toLowerCase();
  const p = (doc.file_path || "").toLowerCase();
  if (t.includes("pdf") || p.endsWith(".pdf")) return "pdf";
  if (t.includes("sheet") || t.includes("excel") || p.endsWith(".xlsx") || p.endsWith(".xls")) return "excel";
  if (t.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(p)) return "image";
  return "other";
}

function FileIcon({ kind }: { kind: ReturnType<typeof fileKind> }) {
  const cls = "h-6 w-6";
  if (kind === "pdf") return <FileText className={`${cls} text-destructive`} />;
  if (kind === "excel") return <FileSpreadsheet className={`${cls} text-success`} />;
  if (kind === "image") return <FileImage className={`${cls} text-primary`} />;
  return <File className={`${cls} text-muted-foreground`} />;
}

function resolveBucketPath(filePath: string): { bucket: string; path: string } {
  if (filePath.includes(":") && !filePath.startsWith("http")) {
    const [b, ...rest] = filePath.split(":");
    if (b === "report-templates" || b === "student-documents") {
      return { bucket: b, path: rest.join(":") };
    }
  }
  return { bucket: "student-documents", path: filePath };
}

function Page() {
  const { studentId } = Route.useParams();
  const navigate = useNavigate();
  const { isDG, establishmentIds, establishmentIdsLoading } = useAdminProfile();
  const data = useSchoolData();
  const [busyId, setBusyId] = useState<string | null>(null);

  const student = data.students.find((s) => s.id === studentId);
  const allowed = student && (isDG || establishmentIds.includes(student.establishment_id));

  const docsQuery = useRows<StudentDocument>("student_documents", {
    eq: { student_id: studentId },
    order: { column: "created_at", ascending: true },
  });
  const documents = docsQuery.data ?? [];

  const enrollments = useMemo(
    () =>
      data.enrollments
        .filter((e) => e.student_id === studentId)
        .sort((a, b) => (a.started_at < b.started_at ? -1 : 1)),
    [data.enrollments, studentId],
  );

  const classLabelFor = (createdAt: string) => {
    const t = new Date(createdAt).getTime();
    for (const e of enrollments) {
      const start = new Date(e.started_at).getTime();
      const end = e.ended_at ? new Date(e.ended_at).getTime() : Infinity;
      if (t >= start && t <= end) return e.class_name || "Classe";
    }
    const current = data.classes.find((c) => c.id === student?.class_id);
    return current?.name ?? "Classe inconnue";
  };

  const groups = useMemo(() => {
    const map = new Map<string, StudentDocument[]>();
    for (const d of documents) {
      const label = classLabelFor(d.created_at);
      const list = map.get(label) ?? [];
      list.push(d);
      map.set(label, list);
    }
    return [...map.entries()];
  }, [documents, enrollments, student?.class_id, data.classes]);

  const openDoc = async (doc: StudentDocument) => {
    setBusyId(doc.id);
    try {
      const { bucket, path } = resolveBucketPath(doc.file_path);
      const { data: signed, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
      if (error || !signed) throw error ?? new Error("Lien indisponible");
      window.open(signed.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message || "Ouverture impossible");
    } finally {
      setBusyId(null);
    }
  };

  const downloadDoc = async (doc: StudentDocument) => {
    setBusyId(doc.id);
    try {
      const { bucket, path } = resolveBucketPath(doc.file_path);
      const { data: signed, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
      if (error || !signed) throw error ?? new Error("Lien indisponible");
      const res = await fetch(signed.signedUrl);
      const blob = await res.blob();
      const kind = fileKind(doc);
      const ext =
        kind === "excel" ? (path.endsWith(".xls") ? "xls" : "xlsx") : kind === "pdf" ? "pdf" : kind === "image" ? "jpg" : "bin";
      downloadBlob(blob, `${doc.name}.${ext}`);
    } catch (e) {
      toast.error((e as Error).message || "Telechargement impossible");
    } finally {
      setBusyId(null);
    }
  };

  if (!data.loading && !establishmentIdsLoading && (!student || !allowed)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Eleve introuvable"
        description="Cet eleve n'existe pas ou vous n'y avez pas acces."
      />
    );
  }
  if (!student) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit"
        onClick={() => navigate({ to: "/eleves/$studentId", params: { studentId } })}
      >
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour a la fiche
      </Button>

      <PageHeader
        eyebrow="Documents"
        title={`Bibliotheque — ${student.last_name} ${student.first_name}`}
        description="Fichiers ranges par classe et par date (les plus recents en bas)."
      />

      {docsQuery.isPending ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : documents.length === 0 ? (
        <EmptyState
          icon={Library}
          title="Bibliotheque vide"
          description="Aucun document pour cet eleve. Bulletins, actes, photos… apparaitront ici."
        />
      ) : (
        <div className="max-h-[calc(100vh-12rem)] space-y-6 overflow-y-auto pb-8">
          {groups.map(([className, docs]) => (
            <section key={className} className="space-y-2">
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 py-1 backdrop-blur">
                <h2 className="font-display text-sm font-semibold text-foreground">{className}</h2>
                <Badge variant="secondary" className="text-[11px]">
                  {docs.length} fichier{docs.length > 1 ? "s" : ""}
                </Badge>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {docs.map((doc) => {
                  const kind = fileKind(doc);
                  return (
                    <li key={doc.id}>
                      <Card className="h-full transition hover:border-primary/40">
                        <CardContent className="flex gap-3 p-3">
                          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                            <FileIcon kind={kind} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{doc.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {formatDateTime(doc.created_at)} · {formatSize(doc.file_size)}
                            </p>
                            <div className="mt-1.5 flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                disabled={busyId === doc.id}
                                onClick={() => void openDoc(doc)}
                                aria-label="Voir"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                disabled={busyId === doc.id}
                                onClick={() => void downloadDoc(doc)}
                                aria-label="Telecharger"
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
