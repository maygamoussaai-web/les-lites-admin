/**
 * Bibliothèque documents élève.
 *
 * - Regroupement par classe (bulletins liés aux fiches report_cards)
 * - Plus récents en haut
 * - Horodatage visible
 * - Actions (œil, télécharger, renommer, supprimer) sous chaque document
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FileText, Upload, Download, Eye, Pencil, Trash2, Loader2, Paperclip,
  FileSpreadsheet, GraduationCap,
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
import { downloadBlob, downloadFromUrl, openBlobInNewTab } from "@/lib/pdf-export";
import { formatDateTime } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";
import { describeError } from "@/lib/errors";
import { resolveStoredPath } from "@/lib/storage-upload";
import type { StudentReportCard } from "@/lib/grades";
import { cn } from "@/lib/utils";
import { useSchoolData } from "@/lib/school-data";

type StudentDocument = Tables<"student_documents">;

const BUCKET = "student-documents";
const MAX_SIZE = 8 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const OTHER_GROUP = "__autres__";

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
  classId: string | null;
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

type StorageAccess = {
  path: string;
  bucket: string;
  signedUrl: string | null;
  blob: Blob | null;
};

async function getStorageAccess(filePath: string): Promise<StorageAccess> {
  const resolved = resolveStoredPath(filePath);
  let path = (resolved.path || "").replace(/^\/+/, "").trim();
  if (!path) throw new Error("Chemin de fichier invalide");

  if (path.startsWith("student-documents/")) path = path.slice("student-documents/".length);
  if (path.startsWith("report-templates/")) path = path.slice("report-templates/".length);

  const buckets = Array.from(
    new Set<string>([resolved.bucket, "student-documents", "report-templates"]),
  );
  const errors: string[] = [];
  let signedUrl: string | null = null;
  let blob: Blob | null = null;
  let usedBucket = resolved.bucket;

  for (const b of buckets) {
    const { data: signed, error } = await supabase.storage.from(b).createSignedUrl(path, 3600);
    if (!error && signed?.signedUrl) {
      signedUrl = signed.signedUrl;
      usedBucket = b;
      break;
    }
    if (error) errors.push(`${b}/sign: ${error.message}`);
  }

  for (const b of buckets) {
    const { data, error } = await supabase.storage.from(b).download(path);
    if (!error && data && data.size > 0) {
      blob = data;
      if (!signedUrl) usedBucket = b;
      break;
    }
    if (error) errors.push(`${b}/dl: ${error.message}`);
  }

  if (!signedUrl && !blob) {
    throw new Error(
      errors.length
        ? `Fichier introuvable (${path}). ${errors.slice(0, 2).join(" · ")}`
        : `Fichier introuvable (${path})`,
    );
  }

  return { path, bucket: usedBucket, signedUrl, blob };
}

export function StudentDocuments({
  studentId,
  establishmentId,
  classId = null,
  compact = false,
}: {
  studentId: string;
  establishmentId: string;
  classId?: string | null;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const school = useSchoolData();
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

  const classNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of school.classes) m.set(c.id, c.name);
    return m;
  }, [school.classes]);

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
          if (!doc || !doc.file_path?.trim()) cardIdsToDelete.push(card.id);
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
            `${cardIdsToDelete.length + docIdsToDelete.length} entrée(s) sans fichier retirée(s).`,
          );
        }
      } catch {
        /* best-effort */
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
        classId: card?.class_id ?? (bulletin ? classId : null),
      });
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return out;
  }, [documents, cards, classId]);

  const groups = useMemo(() => {
    const map = new Map<string, LibraryItem[]>();
    for (const item of items) {
      const key = item.classId ?? OTHER_GROUP;
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    const entries = [...map.entries()].map(([id, list]) => {
      const sorted = [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const newest = sorted[0]?.createdAt ?? "";
      const isCurrent = !!classId && id === classId;
      const label =
        id === OTHER_GROUP
          ? "Documents personnels"
          : classNameById.get(id) ?? "Classe";
      return { id, label, items: sorted, newest, isCurrent };
    });
    entries.sort((a, b) => {
      if (a.isCurrent && !b.isCurrent) return -1;
      if (b.isCurrent && !a.isCurrent) return 1;
      return a.newest < b.newest ? 1 : -1;
    });
    return entries;
  }, [items, classNameById, classId]);

  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [docName, setDocName] = useState("");
  const [nameOpen, setNameOpen] = useState(false);
  const [renaming, setRenaming] = useState<StudentDocument | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; sheetName: string; rows: string[][] } | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

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
        file.type === "application/pdf" ? "pdf" : file.type.startsWith("image/") ? "jpg" : "bin";
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
      toast.success("Document ajouté");
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
      const access = await getStorageAccess(item.filePath);
      const spreadsheet = isSpreadsheet(item.fileType, item.filePath, item.name);
      const safeName = item.name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "document";
      const fileName = safeName.toLowerCase().endsWith(".xlsx") ? safeName : `${safeName}.xlsx`;

      if (mode === "download") {
        if (access.signedUrl) {
          downloadFromUrl(access.signedUrl, spreadsheet ? fileName : safeName);
          toast.success("Téléchargement lancé.", { duration: 4000 });
          return;
        }
        if (access.blob) {
          const typed =
            spreadsheet && (!access.blob.type || access.blob.type === "application/octet-stream")
              ? new Blob([await access.blob.arrayBuffer()], { type: XLSX_MIME })
              : access.blob;
          downloadBlob(typed, spreadsheet ? fileName : safeName);
          toast.success("Téléchargement démarré.");
          return;
        }
        throw new Error("Fichier inaccessible");
      }

      if (spreadsheet) {
        let blob = access.blob;
        if (!blob && access.signedUrl) {
          const res = await fetch(access.signedUrl);
          if (!res.ok) throw new Error(`Lecture impossible (HTTP ${res.status})`);
          blob = await res.blob();
        }
        if (!blob || blob.size === 0) throw new Error("Fichier Excel vide");
        const buf = await blob.arrayBuffer();
        // Import différé : xlsx chargé seulement à la prévisualisation (pas au démarrage)
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        const sheetName = wb.SheetNames[0] ?? "Feuille1";
        const sheet = wb.Sheets[sheetName];
        const matrix = sheet
          ? (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][])
          : [];
        const rows = matrix.slice(0, 80).map((row) =>
          (row as unknown[]).slice(0, 20).map((c) => (c == null || c === "" ? "" : String(c))),
        );
        setPreview({ title: item.name, sheetName, rows });
        return;
      }

      if (item.fileType === "application/pdf" || item.filePath.toLowerCase().endsWith(".pdf")) {
        if (access.signedUrl) {
          const w = window.open(access.signedUrl, "_blank", "noopener,noreferrer");
          if (!w) toast.message("Autorisez les pop-ups pour visionner le PDF.");
          return;
        }
        if (access.blob) {
          if (!openBlobInNewTab(access.blob)) toast.message("Popup bloquée — utilisez Télécharger.");
          return;
        }
        throw new Error("PDF inaccessible");
      }

      if (item.fileType.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(item.filePath)) {
        if (access.signedUrl) {
          setPreviewImageUrl(access.signedUrl);
          return;
        }
        if (access.blob) {
          setPreviewImageUrl(URL.createObjectURL(access.blob));
          return;
        }
        throw new Error("Image inaccessible");
      }

      if (access.signedUrl) {
        const w = window.open(access.signedUrl, "_blank", "noopener,noreferrer");
        if (!w) toast.message("Popup bloquée — utilisez Télécharger.");
        return;
      }
      toast.message("Aperçu non disponible. Utilisez Télécharger.");
    } catch (e) {
      console.error("[bibliothèque] openItem", item.filePath, e);
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
      if (path) await supabase.storage.from(bucket).remove([path]).catch(() => undefined);
      await supabase.from("student_report_cards").update({ document_id: null }).eq("document_id", doc.id);
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

  const renderCard = (item: LibraryItem) => {
    const docRow = documents.find((d) => d.id === item.documentId) ?? null;
    const busy = busyKey === item.key;
    return (
      <article
        key={item.key}
        className="group overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
      >
        <div className="flex items-start gap-3 p-4 pb-3">
          <span
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
              item.kind === "bulletin"
                ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                : "bg-primary/10 text-primary",
            )}
          >
            {item.kind === "bulletin" ? (
              <FileSpreadsheet className="h-5 w-5" />
            ) : (
              <FileText className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <h4 className="truncate text-[15px] font-semibold leading-snug text-foreground">
                {item.name}
              </h4>
              {item.kind === "bulletin" && (
                <Badge
                  variant="secondary"
                  className="rounded-md px-1.5 py-0 text-[10px] font-medium"
                >
                  Bulletin
                </Badge>
              )}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <time dateTime={item.createdAt} className="tabular-nums">
                {formatDateTime(item.createdAt)}
              </time>
              <span>·</span>
              <span>{formatSize(item.fileSize)}</span>
              {item.average != null && Number.isFinite(item.average) && (
                <>
                  <span>·</span>
                  <span className="font-medium text-foreground">MG {item.average.toFixed(2)}</span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 border-t border-border/40 bg-muted/20 px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs"
            disabled={busy}
            onClick={() => void openItem(item, "view")}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            Voir
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs"
            disabled={busy}
            onClick={() => void openItem(item, "download")}
          >
            <Download className="h-3.5 w-3.5" />
            Télécharger
          </Button>
          {docRow && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs"
                disabled={busy}
                onClick={() => {
                  setRenaming(docRow);
                  setRenameValue(docRow.name);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                Renommer
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
                    disabled={busy}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Supprimer
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      « {item.name} » sera retiré définitivement de la bibliothèque et du stockage.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => void remove(docRow)}
                    >
                      Supprimer
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className={cn("space-y-6", compact && "space-y-4")}>
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold tracking-tight">Bibliothèque</h3>
            <p className="text-sm text-muted-foreground">
              Bulletins et documents, classés par classe — les plus récents en premier.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,application/pdf,.xlsx,.xls,.doc,.docx"
              onChange={(e) => {
                onPick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="sm"
              className="press gap-1.5"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Ajouter
            </Button>
          </div>
        </div>
      )}

      {compact && (
        <div className="flex justify-end">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,application/pdf,.xlsx,.xls,.doc,.docx"
            onChange={(e) => {
              onPick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            Joindre
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
          <FileText className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium text-foreground">Aucun document</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Les bulletins générés et les fichiers ajoutés apparaîtront ici.
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.id} className="space-y-3">
            <div className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold text-foreground">
                {g.label}
                {g.isCurrent && (
                  <Badge variant="secondary" className="ml-2 text-[10px]">
                    Classe actuelle
                  </Badge>
                )}
              </h4>
              <span className="text-xs text-muted-foreground">({g.items.length})</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">{g.items.map(renderCard)}</div>
          </section>
        ))
      )}

      <Dialog open={nameOpen} onOpenChange={setNameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nom du document</DialogTitle>
            <DialogDescription>Choisissez un nom clair pour le retrouver facilement.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="doc-name">Nom</Label>
            <Input
              id="doc-name"
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              placeholder="Ex. Certificat médical"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNameOpen(false)}>
              Annuler
            </Button>
            <Button type="button" onClick={() => void confirmUpload()} disabled={!docName.trim()}>
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renommer</DialogTitle>
          </DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
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

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>{preview?.title}</DialogTitle>
            <DialogDescription>Aperçu — feuille « {preview?.sheetName} »</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <table className="w-full border-collapse text-xs">
              <tbody>
                {preview?.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border/40">
                    {row.map((cell, j) => (
                      <td key={j} className="whitespace-nowrap border-r border-border/30 px-2 py-1">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewImageUrl} onOpenChange={(o) => !o && setPreviewImageUrl(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Aperçu image</DialogTitle>
          </DialogHeader>
          {previewImageUrl && (
            <img src={previewImageUrl} alt="Aperçu" className="max-h-[70vh] w-full object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function StudentDocumentsCard(props: {
  studentId: string;
  establishmentId: string;
  classId?: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Documents</CardTitle>
      </CardHeader>
      <CardContent>
        <StudentDocuments {...props} compact />
      </CardContent>
    </Card>
  );
}
