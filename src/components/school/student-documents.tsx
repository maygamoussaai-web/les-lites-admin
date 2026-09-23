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
import * as XLSX from "xlsx";

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
              <span className="text-border">·</span>
              <span>{formatSize(item.fileSize)}</span>
              {item.average != null && (
                <>
                  <span className="text-border">·</span>
                  <span className="font-medium text-foreground/80">
                    MG {item.average.toFixed(2)}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-around gap-0.5 border-t border-border/40 bg-muted/20 px-2 py-1.5 sm:justify-start sm:gap-1 sm:px-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 flex-1 gap-1.5 rounded-xl text-xs font-medium sm:flex-none sm:px-3"
            disabled={busy}
            onClick={() => void openItem(item, "view")}
            title="Visionner"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            <span>Voir</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 flex-1 gap-1.5 rounded-xl text-xs font-medium sm:flex-none sm:px-3"
            disabled={busy}
            onClick={() => void openItem(item, "download")}
            title="Télécharger"
          >
            <Download className="h-4 w-4" />
            <span>Télécharger</span>
          </Button>
          {docRow && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl"
                disabled={busy}
                onClick={() => {
                  setRenaming(docRow);
                  setRenameValue(docRow.name);
                }}
                title="Renommer"
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
                    className="h-10 w-10 shrink-0 rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy}
                    title="Supprimer"
                    aria-label="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Supprimer « {docRow.name} » ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Le fichier sera retiré définitivement de la bibliothèque.
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
      </article>
    );
  };

  return (
    <div className={cn("space-y-6", compact && "space-y-4")}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {items.length === 0
            ? "Aucun document"
            : `${items.length} document${items.length > 1 ? "s" : ""}`}
        </p>
        <Button
          type="button"
          size="sm"
          className="press rounded-xl shadow-sm"
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
        <div className="space-y-3 py-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted/40" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/10 px-6 py-16 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/40">
            <Paperclip className="h-6 w-6 text-muted-foreground/60" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Bibliothèque vide</p>
            <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
              Les bulletins générés depuis la page classe apparaissent ici automatiquement.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1 rounded-xl"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-1.5 h-4 w-4" />
            Ajouter un document
          </Button>
        </div>
      ) : (
        <div className="space-y-7">
          {groups.map((g) => (
            <section key={g.id} className="space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <GraduationCap className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-sm font-semibold tracking-tight text-foreground">
                      {g.label}
                    </h3>
                    {g.isCurrent && (
                      <Badge className="rounded-md bg-primary/15 px-1.5 py-0 text-[10px] font-medium text-primary hover:bg-primary/15">
                        Classe actuelle
                      </Badge>
                    )}
                  </div>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                  {g.items.length}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-1">{g.items.map(renderCard)}</div>
            </section>
          ))}
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
            <Button type="button" variant="outline" onClick={() => { setNameOpen(false); setPendingFile(null); }}>
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
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenaming(null)}>Annuler</Button>
            <Button type="button" onClick={() => void rename()} disabled={!renameValue.trim()}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!preview} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="flex max-h-[90vh] max-w-[95vw] flex-col gap-3 sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="pr-6">{preview?.title ?? "Aperçu"}</DialogTitle>
            <DialogDescription>
              Feuille « {preview?.sheetName ?? "—"} » — aperçu uniquement. Pour enregistrer, utilisez
              Télécharger.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/60 bg-muted/20">
            {preview && preview.rows.length > 0 ? (
              <table className="w-max min-w-full border-collapse text-left text-[11px] sm:text-xs">
                <tbody>
                  {preview.rows.map((row, ri) => (
                    <tr key={ri} className={ri === 0 ? "bg-muted/40 font-medium" : undefined}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="max-w-[12rem] truncate border border-border/40 px-2 py-1 whitespace-nowrap" title={cell}>
                          {cell || "\u00a0"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">Feuille vide.</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPreview(null)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!previewImageUrl}
        onOpenChange={(v) => {
          if (!v) {
            if (previewImageUrl?.startsWith("blob:")) URL.revokeObjectURL(previewImageUrl);
            setPreviewImageUrl(null);
          }
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Aperçu</DialogTitle>
          </DialogHeader>
          {previewImageUrl && (
            <img src={previewImageUrl} alt="Aperçu" className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg object-contain" />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (previewImageUrl?.startsWith("blob:")) URL.revokeObjectURL(previewImageUrl);
                setPreviewImageUrl(null);
              }}
            >
              Fermer
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
  classId?: string | null;
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
