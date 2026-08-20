import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { loadQueue, QUEUE_CHANGED_EVENT, type QueueEntry } from "@/lib/offline-queue";
import { flushQueue } from "@/lib/offline-sync";
import { formatDateTime } from "@/lib/format";

const actionLabel: Record<QueueEntry["op"], string> = {
  insert: "Création",
  update: "Modification",
  delete: "Suppression",
  archive: "Archivage",
};

export function OfflineSyncIndicator() {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<QueueEntry[]>(() => loadQueue());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const refresh = () => setQueue(loadQueue());
    window.addEventListener(QUEUE_CHANGED_EVENT, refresh);

    const tryFlush = () => flushQueue(qc);
    window.addEventListener("online", tryFlush);
    // Filet de sécurité : au cas où l'événement "online" du navigateur soit raté.
    const interval = setInterval(() => {
      if (navigator.onLine) flushQueue(qc);
    }, 15000);
    tryFlush();

    return () => {
      window.removeEventListener(QUEUE_CHANGED_EVENT, refresh);
      window.removeEventListener("online", tryFlush);
      clearInterval(interval);
    };
  }, [qc]);

  if (queue.length === 0) return null;

  const hasError = queue.some((e) => e.error);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="press hidden gap-1.5 sm:inline-flex"
        onClick={() => setOpen(true)}
      >
        {hasError ? (
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
        ) : (
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        {queue.length} en attente
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Actions en attente de synchronisation</DialogTitle>
            <DialogDescription>
              Ces actions ont été enregistrées sur l'appareil et seront envoyées automatiquement dès que la
              connexion sera rétablie.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {queue.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {actionLabel[entry.op]} · {entry.label}
                  </span>
                  <Badge variant={entry.error ? "destructive" : "outline"} className="text-xs font-normal">
                    {entry.error ? "Erreur" : "En attente"}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(new Date(entry.createdAt).toISOString())}</p>
                {entry.error && <p className="mt-1 text-xs text-destructive">{entry.error}</p>}
              </div>
            ))}
          </div>

          <Button onClick={() => flushQueue(qc)} className="press">
            <RefreshCw className="mr-2 h-4 w-4" /> Réessayer maintenant
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}