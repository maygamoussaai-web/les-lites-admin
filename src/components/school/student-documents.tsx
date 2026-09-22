/**
 * Bibliothèque de l'élève (page dédiée + embed).
 *
 * Concept d'origine :
 * - une bibliothèque personnelle par élève
 * - bulletins générés + pièces (acte, photo, diplôme…)
 * - vérité : on n'affiche que des fichiers réellement stockés
 *
 * - Purge auto des fiches « Fichier manquant »
 * - Ouverture : storage.download puis signed URL (2 buckets)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FileText, Upload, Download, Eye, Pencil, Trash2, Loader2, Paperclip,
  FileSpreadsheet, FolderOpen,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useRows, writeAudit } from "@/lib/data";
import { compressImage } from "@/lib/image";
import { imageToPdfBlob, downloadBlob, openBlobInNewTab } from "@/lib/pdf-export";
import { formatDateTime } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";
import { describeError } from "@/lib/errors";
import { resolveStoredPath } from "@/lib/storage-upload";
import type { StudentReportCard } from "@/lib/grades";
import { cn } from "@/lib/utils";

type StudentDocument = Tables<"student_documents">;

const BUCKET = "student-documents";
const MAX_SIZE = 8 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type LibraryItem = {
  key: string;
  kind: "bulletin" | "document";
  name: string;
  createdAt: string;
  fileSize: number;
  fileType: string;
  filePath: string;
  documentId: string;
  average?: number | null;
  cardId?: string | null;
};

function isSpreadsheet(fileType: string, filePath: string, name: string) {
  const t = (fileType || "").toLowerCase();
  const p = (filePath || "").toLowerCase();
  const n = (name || "").toLowerCase();
  return (
    t.includes("spreadsheet") ||
    t.includes("excel") ||
    t === XLSX_MIME ||
    p.endsWith(".xlsx") ||
    p.endsWith(".xls") ||
    n.includes("bulletin")
  );
}

function formatSize(bytes: number) {
  if (!bytes || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Récupère le fichier depuis Storage.
 * 1) storage.download  2) createSignedUrl + fetch
 * Essaie student-documents et report-templates.
 */
async function downloadFromStorage(filePath: string): Promise<{ blob: Blob; bucket: string }> {
  const resolved = resolveStoredPath(filePath);
  let path = (resolved.path || "").replace(/^\/+/, "").trim();
  if (!path) throw new Error("Chemin de fichier invalide");

  if (path.startsWith("student-documents/")) path = path.slice("student-documents/".length);
  if (path.startsWith("report-templates/")) path = path.slice("report-templates/".length);

  const buckets = Array.from(
    new Set<string>([resolved.bucket, "student-documents", "report-templates"]),
  );
  const errors: string[] = [];

  for (const b of buckets) {
    const { data, error } = await supabase.storage.from(b).download(path);
    if (!error && data && data.size > 0) return { blob: data, bucket: b };
    if (error) errors.push(`${b}: ${error.message}`);
  }

  for (const b of buckets) {
    const { data: signed, error } = await supabase.storage.from(b).createSignedUrl(path, 3600);
    if (error || !signed?.signedUrl) {
      if (error) errors.push(`${b}/sign: ${error.message}`);
      continue;
    }
    try {
      const res = await fetch(signed.signedUrl);
      if (!res.ok) {
        errors.push(`${b}/http: ${res.status}`);
        continue;
      }
      const blob = await res.blob();
      if (blob.size > 0) return { blob, bucket: b };
      errors.push(`${b}/http: fichier vide`);
    } catch (e) {
      errors.push(`${b}/fetch: ${e instanceof Error ? e.message : "échec"}`);
    }
  }

  throw new Error(
    errors.length
      ? `Fichier introuvable (${path}). ${errors.slice(0, 2).join(" · ")}`
      : `Fichier introuvable (${path})`,
  );
}

export function StudentDocuments({
  studentId,
  establishmentId,
  compact = false,
}: {
  studentId: string;
  establishmentId: string;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const purgedRef = useRef(false);

  const docsQuery = useRows<StudentDocument>("student_documents", {
    eq: { student_id: studentId },
    order: { column: "created_at", ascending: false },
  });
  const cardsQuery = useRows<StudentReportCard>("student_report_cards", {
    eq: { student_id: studentId },
    order: { column: "created_at", ascending: false },
  });

  const documents = docsQuery.data ?? [];
  const cards = cardsQuery.data ?? [];
  const isLoading = docsQuery.isLoading || cardsQuery.isLoading;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["student_documents"] });
    void qc.invalidateQueries({ queryKey: ["student_report_cards"] });
  };

  useEffect(() => {
    if (isLoading || purgedRef.current) return;
    if (!docsQuery.isFetched || !cardsQuery.isFetched) return;

    purgedRef.current = true;

    void (async () => {
      try {
        const byId = new Map(documents.map((d) => [d.id, d]));
        const cardIdsToDelete: string[] = [];
        const docIdsToDelete: string[] = [];

        for (const d of documents) {
          if (!d.file_path?.trim()) docIdsToDelete.push(d.id);
        }

        for (const card of cards) {
          if (!card.document_id) {
            cardIdsToDelete.push(card.id);
            continue;
          }
          const doc = byId.get(card.document_id);
          if (!doc || !doc.file_path?.trim()) {
            cardIdsToDelete.push(card.id);
          }
        }

        if (cardIdsToDelete.length) {
          await supabase.from("student_report_cards").delete().in("id", cardIdsToDelete);
        }
        if (docIdsToDelete.length) {
          await supabase.from("student_documents").delete().in("id", docIdsToDelete);
        }

        if (cardIdsToDelete.length || docIdsToDelete.length) {
          invalidate();
          toast.message(
            `${cardIdsToDelete.length + docIdsToDelete.length} entrée(s) sans fichier retirée(s) de la bibliothèque.`,
          );
        }
      } catch {
        /* purge best-effort */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, docsQuery.isFetched, cardsQuery.isFetched, documents, cards]);

  const items = useMemo((): LibraryItem[] => {
    const cardByDoc = new Map<string, StudentReportCard>();
    for (const c of cards) {
      if (c.document_id) cardByDoc.set(c.document_id, c);
    }

    const out: LibraryItem[] = [];
    for (const doc of documents) {
      const path = doc.file_path?.trim();
      if (!path) continue;

      const card = cardByDoc.get(doc.id);
      const bulletin =
        isSpreadsheet(doc.file_type, path, doc.name) ||
        !!card ||
        doc.name.toLowerCase().includes("bulletin");

      out.push({
        key: `doc-${doc.id}`,
        kind: bulletin ? "bulletin" : "document",
        name: doc.name,
        createdAt: doc.created_at,
        fileSize: doc.file_size ?? 0,
        fileType: doc.file_type || "application/octet-stream",
        filePath: path,
        documentId: doc.id,
        average: card?.general_average != null ? Number(card.general_average) : null,
        cardId: card?.id ?? null,
      });
    }

    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return out;
  }, [documents, cards]);

  const bulletins = items.filter((i) => i.kind === "bulletin");
  const others = items.filter((i) => i.kind === "document");

  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [docName, setDocName] = useState("");
  const [nameOpen, setNameOpen] = useState(false);
  const [renaming, setRenaming] = useState<StudentDocument | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const onPick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_SIZE && !file.type.startsWith("image/")) {
      toast.error("Le fichier dépasse 8 Mo.");
      return;
    }
    setPendingFile(file);
    setDocName(file.name.replace(/\.[^.]+$/, ""));
    setNameOpen(true);
  };

  const confirmUpload = async () => {
    if (!pendingFile || !docName.trim()) return;
    setNameOpen(false);
    setUploading(true);
    try {
      let file = pendingFile;
      if (file.type.startsWith("image/") && file.type !== "image/gif") {
        file = await compressImage(file, 1600, 0.85);
      }
      if (file.size > MAX_SIZE) {
        toast.error("Le fichier dépasse 8 Mo même après compression.");
        return;
      }
      const ext =
        file.type === "application/pdf"
          ? "pdf"
          : file.type.startsWith("image/")
            ? "jpg"
            : "bin";
      const path = `${establishmentId}/${studentId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type,
        upsert: true,
      });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("student_documents").insert({
        student_id: studentId,
        establishment_id: establishmentId,
        name: docName.trim(),
        file_path: path,
        file_type: file.type,
        file_size: file.size,
      });
      if (insertError) throw insertError;

      await writeAudit("create", "student_documents" as never, null, {
        student_id: studentId,
        name: docName.trim(),
      });
      invalidate();
      toast.success("Document ajouté à la bibliothèque");
    } catch (e) {
      toast.error(describeError(e, "Envoi impossible"));
    } finally {
      setUploading(false);
      setPendingFile(null);
      setDocName("");
    }
  };

  const openItem = async (item: LibraryItem, mode: "view" | "download") => {
    setBusyKey(item.key);
    try {
      if (!item.filePath?.trim()) {
        toast.error("Aucun fichier lié à ce document.");
        return;
      }

      const { blob } = await downloadFromStorage(item.filePath);
      if (!blob || blob.size === 0) {
        throw new Error("Fichier vide ou inaccessible dans le stockage");
      }

      const spreadsheet = isSpreadsheet(item.fileType, item.filePath, item.name);
      const safeName = item.name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "document";

      if (spreadsheet) {
        const typed =
          blob.type && blob.type !== "application/octet-stream"
            ? blob
            : new Blob([await blob.arrayBuffer()], { type: XLSX_MIME });
        const fileName = safeName.toLowerCase().endsWith(".xlsx") ? safeName : `${safeName}.xlsx`;
        downloadBlob(typed, fileName);
        toast.success(
          mode === "view"
            ? "Bulletin téléchargé — ouvrez-le avec Excel ou Google Sheets."
            : "Téléchargement du bulletin démarré.",
        );
        return;
      }

      if (item.fileType === "application/pdf" || item.filePath.toLowerCase().endsWith(".pdf")) {
        const typed =
          blob.type === "application/pdf"
            ? blob
            : new Blob([await blob.arrayBuffer()], { type: "application/pdf" });
        if (mode === "view") {
          const ok = openBlobInNewTab(typed);
          if (!ok) {
            downloadBlob(typed, safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`);
            toast.message("Popup bloquée — fichier téléchargé à la place.");
          }
        } else {
          downloadBlob(typed, safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`);
          toast.success("Téléchargement démarré.");
        }
        return;
      }

      if (item.fileType.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(item.filePath)) {
        if (mode === "view") {
          const ok = openBlobInNewTab(blob);
          if (!ok) {
            downloadBlob(blob, safeName);
            toast.message("Popup bloquée — image téléchargée.");
          }
        } else {
          const url = URL.createObjectURL(blob);
          try {
            const pdf = await imageToPdfBlob(url);
            downloadBlob(pdf, `${safeName}.pdf`);
          } catch {
            downloadBlob(blob, safeName);
          } finally {
            URL.revokeObjectURL(url);
          }
          toast.success("Téléchargement démarré.");
        }
        return;
      }

      downloadBlob(blob, safeName);
      toast.success("Téléchargement démarré.");
    } catch (e) {
      console.error("[bibliothèque] openItem", item.filePath, e);
      toast.error(describeError(e, "Impossible d'ouvrir ou télécharger le document"));
    } finally {
      setBusyKey(null);
    }
  };

  const rename = async () => {
    if (!renaming || !renameValue.trim()) return;
    setBusyKey(`doc-${renaming.id}`);
    try {
      const { error } = await supabase
        .from("student_documents")
        .update({ name: renameValue.trim() })
        .eq("id", renaming.id);
      if (error) throw error;
      invalidate();
      toast.success("Document renommé");
    } catch (e) {
      toast.error(describeError(e, "Renommage impossible"));
    } finally {
      setBusyKey(null);
      setRenaming(null);
    }
  };

  const remove = async (doc: StudentDocument) => {
    setBusyKey(`doc-${doc.id}`);
    try {
      const { bucket, path } = resolveStoredPath(doc.file_path);
      if (path) {
        await supabase.storage.from(bucket).remove([path]).catch(() => undefined);
      }
      await supabase
        .from("student_report_cards")
        .update({ document_id: null })
        .eq("document_id", doc.id);
      const { error } = await supabase.from("student_documents").delete().eq("id", doc.id);
      if (error) throw error;
      await writeAudit("delete", "student_documents" as never, doc.id, { name: doc.name });
      invalidate();
      toast.success("Document supprimé");
    } catch (e) {
      toast.error(describeError(e, "Suppression impossible"));
    } finally {
      setBusyKey(null);
    }
  };

  const renderList = (list: LibraryItem[], emptyLabel: string) => {
    if (list.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/15 py-8 text-center">
          <Paperclip className="h-6 w-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        </div>
      );
    }
    return (
      <ul className="space-y-2">
        {list.map((item) => {
          const docRow = documents.find((d) => d.id === item.documentId) ?? null;
          const busy = busyKey === item.key;
          return (
            <li
              key={item.key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-sm shadow-sm transition hover:border-primary/30"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                    item.kind === "bulletin"
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  {item.kind === "bulletin" ? (
                    <FileSpreadsheet className="h-4 w-4" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate font-medium text-foreground">{item.name}</p>
                    {item.kind === "bulletin" && (
                      <Badge variant="secondary" className="text-[10px]">
                        Bulletin
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {formatSize(item.fileSize)} · {formatDateTime(item.createdAt)}
                    {item.average != null ? ` · MG ${item.average.toFixed(2)}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  disabled={busy}
                  onClick={() => void openItem(item, "view")}
                  aria-label="Voir / ouvrir"
                  title="Voir"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  disabled={busy}
                  onClick={() => void openItem(item, "download")}
                  aria-label="Télécharger"
                  title="Télécharger"
                >
                  <Download className="h-4 w-4" />
                </Button>
                {docRow && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      disabled={busy}
                      onClick={() => {
                        setRenaming(docRow);
                        setRenameValue(docRow.name);
                      }}
                      aria-label="Renommer"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-destructive"
                          disabled={busy}
                          aria-label="Supprimer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Supprimer « {docRow.name} » ?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Le fichier sera retiré de la bibliothèque. Action définitive.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annuler</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void remove(docRow)}>
                            Supprimer
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!compact && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FolderOpen className="h-4 w-4 text-primary" />
            <span>
              {items.length} document{items.length > 1 ? "s" : ""} · {bulletins.length} bulletin
              {bulletins.length > 1 ? "s" : ""}
            </span>
          </div>
        )}
        <Button
          type="button"
          size="sm"
          className="press"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-1.5 h-4 w-4" />
          )}
          Ajouter
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            onPick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement de la bibliothèque…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/80 bg-muted/20 py-12 text-center">
          <Paperclip className="h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm font-medium text-foreground">Bibliothèque vide</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Les bulletins générés depuis la page classe apparaissent ici automatiquement. Vous
            pouvez aussi ajouter un acte de naissance, une photo ou un diplôme.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="font-display text-sm font-semibold text-foreground">
                Bulletins
              </h3>
              <Badge variant="outline" className="text-[10px]">
                {bulletins.length}
              </Badge>
            </div>
            {renderList(
              bulletins,
              "Aucun bulletin. Générez-les depuis la page de la classe.",
            )}
          </section>
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <h3 className="font-display text-sm font-semibold text-foreground">
                Autres documents
              </h3>
              <Badge variant="outline" className="text-[10px]">
                {others.length}
              </Badge>
            </div>
            {renderList(others, "Aucune pièce jointe. Utilisez « Ajouter ».")}
          </section>
        </div>
      )}

      <Dialog open={nameOpen} onOpenChange={(v) => !v && setNameOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nom du document</DialogTitle>
            <DialogDescription>Ex. : Acte de naissance, Photo, Diplôme…</DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1.5 block text-sm">Nom</Label>
            <Input value={docName} onChange={(e) => setDocName(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setNameOpen(false);
                setPendingFile(null);
              }}
            >
              Annuler
            </Button>
            <Button type="button" onClick={() => void confirmUpload()} disabled={!docName.trim()}>
              Ajouter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renaming} onOpenChange={(v) => !v && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Renommer</DialogTitle>
          </DialogHeader>
          <div>
            <Label className="mb-1.5 block text-sm">Nom</Label>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
              Annuler
            </Button>
            <Button type="button" onClick={() => void rename()} disabled={!renameValue.trim()}>
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function StudentDocumentsCard(props: {
  studentId: string;
  establishmentId: string;
}) {
  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Documents</CardTitle>
      </CardHeader>
      <CardContent>
        <StudentDocuments {...props} compact />
      </CardContent>
    </Card>
  );
}
