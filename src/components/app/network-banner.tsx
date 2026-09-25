import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";
import { useOnlineStatus } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

/**
 * Bandeau global hors ligne / retour en ligne.
 * Visible immédiatement, sans bloquer l’usage de l’app.
 */
export function NetworkBanner() {
  const online = useOnlineStatus();
  const [showBackOnline, setShowBackOnline] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    if (!online) {
      setWasOffline(true);
      setShowBackOnline(false);
      return;
    }
    if (wasOffline) {
      setShowBackOnline(true);
      const t = window.setTimeout(() => setShowBackOnline(false), 3500);
      return () => window.clearTimeout(t);
    }
  }, [online, wasOffline]);

  if (online && !showBackOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-2 px-3 py-1.5 text-center text-xs font-medium",
        online
          ? "bg-emerald-600 text-white"
          : "bg-amber-600 text-white",
      )}
    >
      {online ? (
        <>
          <Wifi className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Connexion rétablie — synchronisation en cours si nécessaire
        </>
      ) : (
        <>
          <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Hors ligne — vos actions sont enregistrées localement et seront envoyées au retour du réseau
        </>
      )}
    </div>
  );
}
