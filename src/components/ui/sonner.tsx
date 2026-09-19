import { Toaster as Sonner } from "sonner";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Notifications institutionnelles — pas de fond rouge/blanc « alerte ».
 * Tons discrets alignés sur le design system (carte, bordure, accent).
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="top-center"
      closeButton
      gap={10}
      offset={16}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            "group toast w-[min(100vw-1.5rem,24rem)] items-start gap-3 rounded-xl border border-border/80 bg-card px-4 py-3.5 text-card-foreground shadow-lg shadow-black/5 " +
            "data-[type=error]:border-border data-[type=error]:bg-card " +
            "data-[type=success]:border-border data-[type=success]:bg-card " +
            "data-[type=warning]:border-border data-[type=warning]:bg-card " +
            "data-[type=info]:border-border data-[type=info]:bg-card",
          title: "text-sm font-semibold leading-snug tracking-tight text-foreground",
          description: "text-xs leading-relaxed text-muted-foreground",
          actionButton:
            "rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground",
          cancelButton: "rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground",
          closeButton:
            "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
          icon: "mt-0.5",
        },
      }}
      icons={{
        success: <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={2} />,
        error: <AlertCircle className="h-4 w-4 text-destructive" strokeWidth={2} />,
        warning: <TriangleAlert className="h-4 w-4 text-warning" strokeWidth={2} />,
        info: <Info className="h-4 w-4 text-primary" strokeWidth={2} />,
      }}
      {...props}
    />
  );
};

export { Toaster };
