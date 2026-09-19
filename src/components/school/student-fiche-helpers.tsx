import type { ReactNode } from "react";

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

export function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | null | undefined;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-primary/40 bg-primary/5" : "border-border/70"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-lg font-semibold tabular-nums ${highlight ? "text-primary" : "text-foreground"}`}>
        {value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "—"}
      </p>
    </div>
  );
}
