import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="animate-rise flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card/50 px-5 py-12 text-center sm:px-8 sm:py-14">
      <span className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:h-16 sm:w-16">
        <span aria-hidden className="animate-glow-pulse absolute inset-0 rounded-2xl bg-accent/15 blur-xl" />
        <Icon className="relative h-6 w-6 sm:h-7 sm:w-7" />
      </span>
      <p className="font-display text-base font-semibold text-foreground sm:text-lg">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
