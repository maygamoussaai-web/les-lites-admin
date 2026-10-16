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
  /** Doublon (même nom normalisé, plus ancien que le fichier gardé) */
  isDuplicate?: boolean;
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


function normalizeDocName(name: string) {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const DUPLICATE_TTL_MS = 24 * 60 * 60 * 1000;
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
    for (const c of school.archivedClasses ?? []) m.set(c.id, c.name);
    return m;
  }, [school.classes, school.archivedClasses]);

  /** Ids de classes archivées (générations) — exclus de la bibliothèque élève active. */
  const archivedClassIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of school.archivedClasses ?? []) s.add(c.id);
    return s;
  }, [school.archivedClasses]);

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
      // MG : fiche période si liée ; sinon extraire « MG 12.34 » du nom (bulletin annuel)
      let avg: number | null =
        card?.general_average != null && Number.isFinite(Number(card.general_average))
          ? Number(card.general_average)
          : null;
      if (avg === null || avg === 0) {
        const m = /(?:MG|Moy\.?|Moyenne)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i.exec(doc.name);
        if (m) {
          const n = Number(String(m[1]).replace(",", "."));
          if (Number.isFinite(n) && n > 0) avg = n;
        }
      }
      // Ne jamais afficher 0 (souvent corruption / placeholder)
      if (avg === 0) avg = null;
      out.push({
        key: `doc-${doc.id}`,
        kind: bulletin ? "bulletin" : "document",
        name: doc.name,
        createdAt: doc.created_at,
        fileSize: doc.file_size ?? 0,
        fileType: doc.file_type || "application/octet-stream",
        filePath: path,
        documentId: doc.id,
        average: avg,
        cardId: card?.id ?? null,
        classId: card?.class_id ?? (bulletin ? classId : null),
      });
    }
    // Doublons : même nom normalisé + même classe (ou docs perso). Le plus récent reste maître.
    const byNorm = new Map<string, LibraryItem[]>();
    for (const it of out) {
      const k = `${it.classId ?? OTHER_GROUP}::${normalizeDocName(it.name)}`;
      const list = byNorm.get(k) ?? [];
      list.push(it);
      byNorm.set(k, list);
    }
    const now = Date.now();
    for (const list of byNorm.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      for (let i = 1; i < list.length; i++) {
        list[i]!.isDuplicate = true;
      }
    }
    // Masquer les doublons de plus de 24 h (purge UI ; suppression réelle via effect)
    const visible = out.filter((it) => {
      if (!it.isDuplicate) return true;
      const age = now - new Date(it.createdAt).getTime();
      return age < DUPLICATE_TTL_MS;
    });
    visible.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return visible;
  }, [documents, cards, classId]);


  // Purge auto des doublons > 24 h (une fois par chargement bibliothèque)
  useEffect(() => {
    if (!documents.length) return;
    const byNorm = new Map<string, StudentDocument[]>();
    for (const doc of documents) {
      const k = normalizeDocName(doc.name);
      const list = byNorm.get(k) ?? [];
      list.push(doc);
      byNorm.set(k, list);
    }
    const now = Date.now();
    const toDelete: string[] = [];
    for (const list of byNorm.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      for (let i = 1; i < list.length; i++) {
        const d = list[i]!;
        if (now - new Date(d.created_at).getTime() >= DUPLICATE_TTL_MS) {
          toDelete.push(d.id);
        }
      }
    }
    if (!toDelete.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const { error } = await supabase.from("student_documents").delete().in("id", toDelete);
        if (error || cancelled) return;
        void qc.invalidateQueries({ queryKey: ["student_documents"] });
      } catch {
        /* silencieux */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documents, qc]);

  const groups = useMemo(() => {
    const map = new Map<string, LibraryItem[]>();
    for (const item of items) {
      // Générations archivées : visibles uniquement via Archives → classe figée, pas ici.
      if (item.classId && archivedClassIds.has(item.classId)) continue;
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
  }, [items, classNameById, classId, archivedClassIds]);

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

  return (
    <Card className={cn(compact && "border-0 shadow-none")}>
      <CardHeader className={cn("flex flex-row items-center justify-between gap-3 space-y-0", compact && "px-0 pt-0")}>
        <CardTitle className="flex items-center gap-2 text-base">
          <Paperclip className="h-4 w-4" />
          Bibliothèque
        </CardTitle>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,application/pdf,.pdf,.xlsx,.xls,.doc,.docx"
              onChange={(e) => {
                onPick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={uploading}
              className="press"
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
              Ajouter
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className={cn(compact && "px-0")}>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            Aucun document pour le moment.
          </p>
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.id} className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {g.label}
                    {g.isCurrent ? (
                      <Badge variant="secondary" className="ml-2 align-middle text-[10px] font-medium normal-case tracking-normal">
                        Classe actuelle
                      </Badge>
                    ) : null}
                  </h3>
                  <span className="text-[11px] tabular-nums text-muted-foreground/80">
                    {g.items.length} fichier{g.items.length > 1 ? "s" : ""}
                  </span>
                </div>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {g.items.map((item) => {
                    const busy = busyKey === item.key;
                    const spreadsheet = isSpreadsheet(item.fileType, item.filePath, item.name);
                    return (
                      <li
                        key={item.key}
                        className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-card p-3.5 shadow-sm transition hover:border-border"
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={cn(
                              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                              item.kind === "bulletin"
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {spreadsheet ? (
                              <FileSpreadsheet className="h-4 w-4" />
                            ) : item.kind === "bulletin" ? (
                              <GraduationCap className="h-4 w-4" />
                            ) : (
                              <FileText className="h-4 w-4" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate text-sm font-medium leading-snug text-foreground"
                              title={item.name}
                            >
                              {item.name.replace(/\s*[—–-]\s*MG\s*0+(?:[.,]0+)?\s*$/i, "").trim() || item.name}
                            </p>
                            {item.isDuplicate ? (
                              <p className="mt-0.5">
                                <Badge
                                  variant="outline"
                                  className="max-w-full truncate text-[9px] font-medium normal-case tracking-normal text-amber-700 dark:text-amber-300"
                                >
                                  Doublon · auto 24h
                                </Badge>
                              </p>
                            ) : null}
                            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
                              <time dateTime={item.createdAt} className="tabular-nums">
                                {formatDateTime(item.createdAt)}
                              </time>
                              <span aria-hidden className="text-border">·</span>
                              <span>{formatSize(item.fileSize)}</span>
                              {item.kind === "bulletin" && item.average != null && Number.isFinite(item.average) ? (
                                <>
                                  <span aria-hidden className="text-border">·</span>
                                  <span className="font-medium text-foreground/80">
                                    Moy. {Number(item.average).toFixed(2)}
                                  </span>
                                </>
                              ) : null}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1 border-t border-border/40 pt-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 text-xs"
                            disabled={busy}
                            onClick={() => void openItem(item, "view")}
                            title="Aperçu"
                          >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                            <span className="ml-1 hidden sm:inline">Voir</span>
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 text-xs"
                            disabled={busy}
                            onClick={() => void openItem(item, "download")}
                            title="Télécharger"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span className="ml-1 hidden sm:inline">Télécharger</span>
                          </Button>
                          {!readOnly && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 text-xs"
                              disabled={busy}
                              onClick={() => {
                                const doc = documents.find((d) => d.id === item.documentId);
                                if (!doc) {
                                  toast.error("Document introuvable.");
                                  return;
                                }
                                setRenaming(doc);
                                setRenameValue(doc.name);
                              }}
                              title="Renommer"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              <span className="ml-1 hidden sm:inline">Renommer</span>
                            </Button>
                          )}
                          {!readOnly && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 px-2 text-xs text-destructive hover:text-destructive"
                                  disabled={busy}
                                  title="Supprimer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span className="ml-1 hidden sm:inline">Supprimer</span>
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    « {item.name} » sera définitivement retiré de la bibliothèque.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={() => {
                                      const doc = documents.find((d) => d.id === item.documentId);
                                      if (doc) void remove(doc);
                                    }}
                                  >
                                    Supprimer
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </CardContent>

      {/* Nom à l'upload */}
      <Dialog open={nameOpen} onOpenChange={(o) => { if (!o) { setNameOpen(false); setPendingFile(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nom du document</DialogTitle>
            <DialogDescription>
              Choisissez un libellé clair. La date et l&apos;heure d&apos;ajout seront enregistrées automatiquement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="doc-name">Libellé</Label>
            <Input
              id="doc-name"
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              placeholder="Ex. Acte de naissance"
              maxLength={120}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void confirmUpload();
                }
              }}
            />
            {pendingFile && (
              <p className="text-[12px] text-muted-foreground">
                Fichier : {pendingFile.name} · {formatSize(pendingFile.size)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setNameOpen(false); setPendingFile(null); }}>
              Annuler
            </Button>
            <Button type="button" disabled={!docName.trim() || uploading} onClick={() => void confirmUpload()}>
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renommer */}
      <Dialog open={!!renaming} onOpenChange={(o) => { if (!o) setRenaming(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renommer le document</DialogTitle>
            <DialogDescription>
              Seul le nom affiché change. Le fichier et sa date d&apos;ajout restent inchangés.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="rename-doc">Nouveau nom</Label>
            <Input
              id="rename-doc"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={120}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void rename();
                }
              }}
            />
            {renaming?.created_at && (
              <p className="text-[12px] text-muted-foreground">
                Ajouté le {formatDateTime(renaming.created_at)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
              Annuler
            </Button>
            <Button type="button" disabled={!renameValue.trim()} onClick={() => void rename()}>
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewOffice} onOpenChange={(o) => !o && setPreviewOffice(null)}>
        <DialogContent className="flex h-[85vh] w-[1100px] max-w-[95vw] flex-col gap-2 p-4">
          <DialogHeader className="shrink-0">
            <DialogTitle className="truncate pr-8">{previewOffice?.title}</DialogTitle>
            <DialogDescription>Aperçu du fichier</DialogDescription>
          </DialogHeader>
          {previewOffice?.url && (
            <iframe
              title={previewOffice.title}
              src={previewOffice.url}
              className="min-h-0 w-full flex-1 rounded-md border bg-white"
              allowFullScreen
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!previewImageUrl} onOpenChange={(o) => !o && setPreviewImageUrl(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Aperçu</DialogTitle>
          </DialogHeader>
          {previewImageUrl && (
            <img src={previewImageUrl} alt="" className="max-h-[70vh] w-full object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
