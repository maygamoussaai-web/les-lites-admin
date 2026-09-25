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
  const [flushing, setFlushing] = useState(false);
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const refresh = () => setQueue(loadQueue());
    window.addEventListener(QUEUE_CHANGED_EVENT, refresh);

    const tryFlush = () => {
      void flushQueue(qc);
    };
    window.addEventListener("online", tryFlush);
    const interval = setInterval(() => {
      if (navigator.onLine) void flushQueue(qc);
    }, 20000);
    tryFlush();

    return () => {
      window.removeEventListener(QUEUE_CHANGED_EVENT, refresh);
      window.removeEventListener("online", tryFlush);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(interval);
    };
  }, [qc]);

  if (queue.length === 0 && online) return null;

  const hasError = queue.some((e) => e.error);

  const retry = async () => {
    setFlushing(true);
    try {
      await flushQueue(qc);
      setQueue(loadQueue());
    } finally {
      setFlushing(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="press h-8 gap-1.5 px-2 text-xs sm:px-3"
        onClick={() => setOpen(true)}
        aria-label={
          queue.length
            ? `${queue.length} actions en attente`
            : "État de synchronisation"
        }
      >
        {hasError ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
        ) : !online ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
        ) : (
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        {queue.length > 0 ? (
          <>
            <span className="tabular-nums">{queue.length}</span>
            <span className="hidden sm:inline">en attente</span>
          </>
        ) : (
          <span className="hidden sm:inline">Hors ligne</span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Actions en attente</DialogTitle>
            <DialogDescription>
              Enregistrées sur cet appareil. Envoi automatique dès que la connexion revient.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {queue.map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-sm"
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {actionLabel[entry.op]} · {entry.label}
                  </span>
                  <Badge
                    variant={entry.error ? "destructive" : "outline"}
                    className="shrink-0 text-[10px] font-normal"
                  >
                    {entry.error ? "Erreur" : "Attente"}
                  </Badge>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatDateTime(new Date(entry.createdAt).toISOString())}
                </p>
                {entry.error && <p className="mt-1 text-xs text-destructive">{entry.error}</p>}
              </div>
            ))}
          </div>

          <Button onClick={() => void retry()} disabled={flushing} className="press w-full">
            <RefreshCw className={`mr-2 h-4 w-4 ${flushing ? "animate-spin" : ""}`} />
            {flushing ? "Synchronisation…" : "Réessayer maintenant"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
