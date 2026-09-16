import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/image";
import { describeError } from "@/lib/errors";
import { initials } from "@/lib/format";

/**
 * NOTE POUR CLAUDE :
 * Photo de profil d'un élève. Réutilise le bucket "student-photos" (public,
 * chemin `${establishment_id}/...` imposé par la policy storage existante),
 * la compression déjà présente (src/lib/image.ts) et la colonne
 * students.photo_url. Ne pas introduire d'autre système d'upload.
 */
export function StudentPhoto({
  studentId,
  establishmentId,
  photoUrl,
  firstName,
  lastName,
  compact = false,
}: {
  studentId: string;
  establishmentId: string;
  photoUrl: string | null;
  firstName: string;
  lastName: string;
  /** Affiche uniquement l'avatar (sans boutons) — pour les en-têtes de fiche. */
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["students"] });

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const compressed = await compressImage(file, 600, 0.8);
      const path = `${establishmentId}/${studentId}.jpg`;
      const { error } = await supabase.storage
        .from("student-photos")
        .upload(path, compressed, { contentType: "image/jpeg", upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("student-photos").getPublicUrl(path);
      const url = `${data.publicUrl}?v=${Date.now()}`;
      const { error: updateError } = await supabase.from("students").update({ photo_url: url }).eq("id", studentId);
      if (updateError) throw updateError;
      refresh();
      toast.success("Photo mise à jour");
    } catch (e) {
      toast.error(describeError(e, "Envoi de la photo impossible", "students"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await supabase.storage.from("student-photos").remove([`${establishmentId}/${studentId}.jpg`]);
      const { error } = await supabase.from("students").update({ photo_url: null }).eq("id", studentId);
      if (error) throw error;
      refresh();
      toast.success("Photo supprimée");
    } catch (e) {
      toast.error(describeError(e, "Suppression de la photo impossible", "students"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => photoUrl && setZoom(true)}
        className="rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={photoUrl ? "Agrandir la photo" : "Aucune photo"}
      >
        <Avatar className={compact ? "h-14 w-14 border border-border" : "h-16 w-16 border border-border"}>
          {photoUrl ? <AvatarImage src={photoUrl} alt={`${firstName} ${lastName}`} /> : null}
          <AvatarFallback>{initials(firstName, lastName)}</AvatarFallback>
        </Avatar>
      </button>
      {!compact && (
      <div className="flex flex-col gap-1.5">
        <Button variant="outline" size="sm" className="press" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Camera className="mr-1.5 h-4 w-4" />}
          {photoUrl ? "Remplacer" : "Ajouter une photo"}
        </Button>
        {photoUrl ? (
          <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={remove}>
            <Trash2 className="mr-1.5 h-4 w-4" /> Supprimer
          </Button>
        ) : null}
      </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-w-md p-2">
          <DialogTitle className="sr-only">
            Photo de {firstName} {lastName}
          </DialogTitle>
          {photoUrl ? <img src={photoUrl} alt={`${firstName} ${lastName}`} className="w-full rounded-md" /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
