import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="animate-rise flex flex-col gap-4 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="gold-underline font-display text-2xl font-semibold text-foreground sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-4 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
