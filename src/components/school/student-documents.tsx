/**
 * Bibliothèque documents élève.
 *
 * Affiche student_documents + bulletins validés (student_report_cards).
 * Un bulletin n'est téléchargeable que s'il a un file_path réel.
 */
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FileText, Upload, Download, Eye, Pencil, Trash2, Loader2, Paperclip, FileSpreadsheet,
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
import { imageToPdfBlob, downloadBlob } from "@/lib/pdf-export";
import { formatDateTime } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";
import { describeError } from "@/lib/errors";
import { resolveStoredPath } from "@/lib/storage-upload";
import type { StudentReportCard } from "@/lib/grades";

type StudentDocument = Tables<"student_documents">;

const BUCKET = "student-documents";
const MAX_SIZE = 8 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type LibraryItem = {
  key: string;
  kind: "document" | "bulletin";
  name: string;
  createdAt: string;
  fileSize: number;
  fileType: string;
  filePath: string | null;
  documentId: string | null;
  average?: number | null;
};

function isSpreadsheetType(fileType: string, filePath: string, name: string) {
  return (
    fileType === XLSX_MIME ||
    fileType.includes("spreadsheet") ||
    filePath.toLowerCase().endsWith(".xlsx") ||
    name.toLowerCase().includes("bulletin")
  );
}

function formatSize(bytes: number) {
  if (!bytes || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function StudentDocuments({
  studentId,
  establishmentId,
}: {
  studentId: string;
  establishmentId: string;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const missingDocIds = useMemo(() => {
    const known = new Set(documents.map((d) => d.id));
    return cards
      .map((c) => c.document_id)
      .filter((id): id is string => !!id && !known.has(id));
  }, [documents, cards]);

  const extraDocsQuery = useQuery({
    queryKey: ["student_documents_by_ids", studentId, missingDocIds],
    enabled: missingDocIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_documents")
        .select("*")
        .in("id", missingDocIds);
      if (error) throw error;
      return (data ?? []) as StudentDocument[];
    },
  });

  const allDocuments = useMemo(() => {
    const map = new Map<string, StudentDocument>();
    for (const d of documents) map.set(d.id, d);
    for (const d of extraDocsQuery.data ?? []) map.set(d.id, d);
    return [...map.values()];
  }, [documents, extraDocsQuery.data]);

  const isLoading = docsQuery.isLoading || cardsQuery.isLoading;

  const items = useMemo((): LibraryItem[] => {
    const byDocId = new Map(allDocuments.map((d) => [d.id, d]));
    const usedDocIds = new Set<string>();
    const out: LibraryItem[] = [];

    for (const card of cards) {
      if (
        card.status !== "validated" &&
        !card.document_id &&
        card.general_average == null
      ) {
        continue;
      }
      const doc = card.document_id ? byDocId.get(card.document_id) : undefined;
      if (doc) usedDocIds.add(doc.id);

      const filePath = doc?.file_path?.trim() || null;
      const avgLabel =
        card.general_average != null
          ? Number(card.general_average).toFixed(2)
          : "—";

      out.push({
        key: `card-${card.id}`,
        kind: "bulletin",
        name: doc?.name?.trim() ? doc.name : `Bulletin (moyenne ${avgLabel})`,
        createdAt: card.validated_at ?? card.created_at,
        fileSize: doc?.file_size ?? 0,
        fileType: doc?.file_type ?? XLSX_MIME,
        filePath,
        documentId: doc?.id ?? card.document_id,
        average: card.general_average != null ? Number(card.general_average) : null,
      });
    }

    for (const doc of allDocuments) {
      if (usedDocIds.has(doc.id)) continue;
      const path = doc.file_path?.trim() || null;
      out.push({
        key: `doc-${doc.id}`,
        kind: isSpreadsheetType(doc.file_type, doc.file_path ?? "", doc.name)
          ? "bulletin"
          : "document",
        name: doc.name,
        createdAt: doc.created_at,
        fileSize: doc.file_size,
        fileType: doc.file_type,
        filePath: path,
        documentId: doc.id,
      });
    }

    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return out;
  }, [allDocuments, cards]);

  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [docName, setDocName] = useState("");
  const [nameOpen, setNameOpen] = useState(false);
  const [renaming, setRenaming] = useState<StudentDocument | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["student_documents"] });
    void qc.invalidateQueries({ queryKey: ["student_documents_by_ids"] });
    void qc.invalidateQueries({ queryKey: ["student_report_cards"] });
  };

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
      const ext = file.type === "application/pdf" ? "pdf" : "jpg";
      const path = `${establishmentId}/${studentId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type,
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
      toast.success("Document ajouté");
    } catch (e) {
      toast.error(describeError(e, "Envoi impossible"));
    } finally {
      setUploading(false);
      setPendingFile(null);
      setDocName("");
    }
  };

  const deliverFile = async (item: LibraryItem, mode: "view" | "download", signedUrl: string) => {
    const spreadsheet = isSpreadsheetType(item.fileType, item.filePath ?? "", item.name);
    if (spreadsheet || mode === "download") {
      const res = await fetch(signedUrl);
      if (!res.ok) throw new Error("Téléchargement du fichier impossible");
      const blob = await res.blob();
      if (spreadsheet) {
        downloadBlob(blob, `${item.name}.xlsx`);
      } else if (item.fileType === "application/pdf") {
        downloadBlob(blob, `${item.name}.pdf`);
      } else if (item.fileType.startsWith("image/")) {
        if (mode === "view") {
          window.open(signedUrl, "_blank", "noopener,noreferrer");
        } else {
          const pdf = await imageToPdfBlob(signedUrl);
          downloadBlob(pdf, `${item.name}.pdf`);
        }
      } else {
        downloadBlob(blob, `${item.name}.bin`);
      }
      return;
    }
    window.open(signedUrl, "_blank", "noopener,noreferrer");
  };

  const openItem = async (item: LibraryItem, mode: "view" | "download") => {
    if (!item.filePath) {
      toast.error(
        "Fichier absent. Régénérez le bulletin depuis la page de la classe (Créer les bulletins) pour l’enregistrer dans la bibliothèque.",
      );
      return;
    }
    setBusyKey(item.key);
    try {
      const { bucket, path } = resolveStoredPath(item.filePath);
      if (!path) throw new Error("Chemin de fichier invalide");

      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 600);
      if (error || !data?.signedUrl) {
        const altBucket = bucket === "student-documents" ? "report-templates" : "student-documents";
        const alt = await supabase.storage.from(altBucket).createSignedUrl(path, 600);
        if (alt.error || !alt.data?.signedUrl) {
          throw error ?? alt.error ?? new Error("Lien indisponible");
        }
        await deliverFile(item, mode, alt.data.signedUrl);
        return;
      }
      await deliverFile(item, mode, data.signedUrl);
    } catch (e) {
      toast.error(describeError(e, "Impossible d'ouvrir le document"));
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
      if (path) await supabase.storage.from(bucket).remove([path]);
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

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Documents</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Bulletins générés et pièces jointes de l'élève
          </p>
        </div>
        <Button
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
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/80 bg-muted/20 py-10 text-center">
            <Paperclip className="h-7 w-7 text-muted-foreground/70" />
            <p className="text-sm font-medium text-foreground">Aucun document</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Les bulletins apparaissent ici après « Créer les bulletins » sur la page classe.
              Vous pouvez aussi ajouter un acte, une photo ou un diplôme.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => {
              const docRow = item.documentId
                ? allDocuments.find((d) => d.id === item.documentId)
                : null;
              const hasFile = !!item.filePath;
              return (
                <li
                  key={item.key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/80 px-3 py-2.5 text-sm transition hover:border-primary/30 hover:bg-muted/30"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        item.kind === "bulletin"
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : "bg-primary/10 text-primary"
                      }`}
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
                        {!hasFile && (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-amber-700 dark:text-amber-400"
                          >
                            Fichier manquant
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {formatSize(item.fileSize)} · {formatDateTime(item.createdAt)}
                        {item.average != null ? ` · MG ${item.average.toFixed(2)}` : ""}
                      </p>
                      {!hasFile && item.kind === "bulletin" && (
                        <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                          Régénérez depuis la page classe pour attacher le fichier Excel.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={busyKey === item.key || !hasFile}
                      onClick={() => void openItem(item, "view")}
                      aria-label="Voir"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={busyKey === item.key || !hasFile}
                      onClick={() => void openItem(item, "download")}
                      aria-label="Télécharger"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    {docRow && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={busyKey === item.key}
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
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              disabled={busyKey === item.key}
                              aria-label="Supprimer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Supprimer « {docRow.name} » ?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Cette action est définitive.
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
        )}
      </CardContent>

      <Dialog open={nameOpen} onOpenChange={(v) => !v && setNameOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nom du document</DialogTitle>
            <DialogDescription>
              Ex. : Acte de naissance, Photo, Diplôme…
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1.5 block text-sm">Nom</Label>
            <Input value={docName} onChange={(e) => setDocName(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNameOpen(false);
                setPendingFile(null);
              }}
            >
              Annuler
            </Button>
            <Button onClick={() => void confirmUpload()} disabled={!docName.trim()}>
              Ajouter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renaming} onOpenChange={(v) => !v && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Renommer le document</DialogTitle>
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
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Annuler
            </Button>
            <Button onClick={() => void rename()} disabled={!renameValue.trim()}>
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
