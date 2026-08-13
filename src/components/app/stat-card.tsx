import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
  loading,
  delay = 0,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: "primary" | "accent" | "success" | "destructive";
  loading?: boolean;
  delay?: number;
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    accent: "bg-accent/20 text-[oklch(0.50_0.13_80)]",
    success: "bg-success/15 text-success",
    destructive: "bg-destructive/12 text-destructive",
  };

  return (
    <Card
      className="card-lift animate-rise panel-gradient overflow-hidden"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-2.5 h-7 w-28" />
          ) : (
            <p className="mt-2 truncate font-display text-2xl font-semibold text-foreground">{value}</p>
          )}
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {Icon ? (
          <span className={cn("rounded-xl p-2.5", tones[tone])}>
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}
