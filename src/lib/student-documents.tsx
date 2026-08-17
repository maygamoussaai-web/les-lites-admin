import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Upload, Download, Eye, Pencil, Trash2, Loader2, Paperclip } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useRows, writeAudit } from "@/lib/data";
import { compressImage } from "@/lib/image";
import { imageToPdfBlob, downloadBlob } from "@/lib/pdf-export";
import { formatDateTime } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

type StudentDocument = Tables<"student_documents">;

const BUCKET = "student-documents";
const MAX_SIZE = 8 * 1024 * 1024;

function formatSize(bytes: number) {
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

  const { data: documents = [], isLoading } = useRows<StudentDocument>("student_documents", {
    eq: { student_id: studentId },
    order: { column: "created_at", ascending: false },
  });

  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [docName, setDocName] = useState("");
  const [nameOpen, setNameOpen] = useState(false);
  const [renaming, setRenaming] = useState<StudentDocument | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["student_documents"] });

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

      await writeAudit("create", "student_documents" as never, null, { student_id: studentId, name: docName.trim() });
      invalidate();
      toast.success("Document ajouté");
    } catch (e) {
      toast.error((e as Error).message || "Envoi impossible");
    } finally {
      setUploading(false);
      setPendingFile(null);
      setDocName("");
    }
  };

  const view = async (doc: StudentDocument) => {
    setBusyId(doc.id);
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 300);
      if (error || !data) throw error ?? new Error("Lien indisponible");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message || "Impossible d'ouvrir le document");
    } finally {
      setBusyId(null);
    }
  };

  const downloadAsPdf = async (doc: StudentDocument) => {
    setBusyId(doc.id);
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 300);
      if (error || !data) throw error ?? new Error("Lien indisponible");

      if (doc.file_type === "application/pdf") {
        const res = await fetch(data.signedUrl);
        const blob = await res.blob();
        downloadBlob(blob, `${doc.name}.pdf`);
      } else {
        const blob = await imageToPdfBlob(data.signedUrl, doc.file_type);
        downloadBlob(blob, `${doc.name}.pdf`);
      }
    } catch (e) {
      toast.error((e as Error).message || "Génération du PDF impossible");
    } finally {
      setBusyId(null);
    }
  };

  const rename = async () => {
    if (!renaming || !renameValue.trim()) return;
    setBusyId(renaming.id);
    try {
      const { error } = await supabase
        .from("student_documents")
        .update({ name: renameValue.trim() })
        .eq("id", renaming.id);
      if (error) throw error;
      invalidate();
      toast.success("Document renommé");
    } catch (e) {
      toast.error((e as Error).message || "Renommage impossible");
    } finally {
      setBusyId(null);
      setRenaming(null);
    }
  };

  const remove = async (doc: StudentDocument) => {
    setBusyId(doc.id);
    try {
      await supabase.storage.from(BUCKET).remove([doc.file_path]);
      const { error } = await supabase.from("student_documents").delete().eq("id", doc.id);
      if (error) throw error;
      await writeAudit("delete", "student_documents" as never, doc.id, { name: doc.name });
      invalidate();
      toast.success("Document supprimé");
    } catch (e) {
      toast.error((e as Error).message || "Suppression impossible");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Documents</CardTitle>
        <Button size="sm" className="press" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
          Ajouter un document
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
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-8 text-center">
            <Paperclip className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Aucun document. Actes de naissance, photos, diplômes, bulletins…
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatSize(doc.file_size)} · {formatDateTime(doc.created_at)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busyId === doc.id} onClick={() => view(doc)} aria-label="Voir">
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={busyId === doc.id}
                    onClick={() => downloadAsPdf(doc)}
                    aria-label="Télécharger en PDF"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={busyId === doc.id}
                    onClick={() => {
                      setRenaming(doc);
                      setRenameValue(doc.name);
                    }}
                    aria-label="Renommer"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" disabled={busyId === doc.id} aria-label="Supprimer">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Supprimer "{doc.name}" ?</AlertDialogTitle>
                        <AlertDialogDescription>Cette action est définitive.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(doc)}>Supprimer</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={nameOpen} onOpenChange={(v) => !v && setNameOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nom du document</DialogTitle>
            <DialogDescription>Ex : Acte de naissance, Bulletin 2024, Diplôme…</DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1.5 block text-sm">Nom</Label>
            <Input value={docName} onChange={(e) => setDocName(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNameOpen(false); setPendingFile(null); }}>
              Annuler
            </Button>
            <Button onClick={confirmUpload} disabled={!docName.trim()}>
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
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Annuler
            </Button>
            <Button onClick={rename} disabled={!renameValue.trim() || busyId === renaming?.id}>
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}