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
  const readOnly =
    school.archivedStudents.some((s) => s.id === studentId) ||
    (!!classId && school.archivedClasses.some((c) => c.id === classId));
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
  const [previewOffice, setPreviewOffice] = useState<{ title: string; url: string } | null>(null);
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
        if (access.signedUrl) {
          const officeUrl =
            "https://view.officeapps.live.com/op/embed.aspx?src=" +
            encodeURIComponent(access.signedUrl);
          setPreviewOffice({ title: item.name, url: officeUrl });
          return;
        }
        if (access.blob) {
          const typed =
            !access.blob.type || access.blob.type === "application/octet-stream"
              ? new Blob([await access.blob.arrayBuffer()], { type: XLSX_MIME })
              : access.blob;
          if (!openBlobInNewTab(typed)) {
            downloadBlob(typed, fileName);
            toast.message("Aperçu bloqué — fichier téléchargé.");
          }
          return;
        }
        throw new Error("Fichier Excel inaccessible");
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

  // NOTE: UI render intentionally minimal restore - see full push file if incomplete
  return (
    <Card className={cn(compact && "border-0 shadow-none")}>
      <CardHeader className={cn(compact && "px-0 pt-0")}>
        <CardTitle className="flex items-center gap-2 text-base">
          <Paperclip className="h-4 w-4" />
          Bibliothèque
        </CardTitle>
      </CardHeader>
      <CardContent className={cn(compact && "px-0")}>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun document.</p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.id}>
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">{g.label}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {g.items.map((item) => (
                    <div key={item.key} className="rounded-xl border p-3">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <div className="mt-2 flex gap-1">
                        <Button size="sm" variant="ghost" disabled={busyKey === item.key} onClick={() => void openItem(item, "view")}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busyKey === item.key} onClick={() => void openItem(item, "download")}>
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <Dialog open={!!previewOffice} onOpenChange={(o) => !o && setPreviewOffice(null)}>
        <DialogContent className="max-w-[95vw] w-[1100px] h-[85vh] flex flex-col gap-2 p-4">
          <DialogHeader className="shrink-0">
            <DialogTitle className="truncate pr-8">{previewOffice?.title}</DialogTitle>
            <DialogDescription>Bulletin formaté (identique au fichier téléchargé)</DialogDescription>
          </DialogHeader>
          {previewOffice?.url && (
            <iframe title={previewOffice.title} src={previewOffice.url} className="min-h-0 flex-1 w-full rounded-md border bg-white" allowFullScreen />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!previewImageUrl} onOpenChange={(o) => !o && setPreviewImageUrl(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Aperçu</DialogTitle></DialogHeader>
          {previewImageUrl && <img src={previewImageUrl} alt="" className="max-h-[70vh] w-full object-contain" />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
