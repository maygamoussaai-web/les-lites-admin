import { Link } from "@tanstack/react-router";
import { ArrowRight, GraduationCap, Users, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatFCFA } from "@/lib/format";
import { establishmentTypeLabel } from "@/lib/format";
import { ESTABLISHMENT_VISUALS, type Establishment } from "@/lib/school";

export function EstablishmentCard({
  establishment,
  students,
  classes,
  collected,
  expected,
  delay = 0,
}: {
  establishment: Establishment;
  students: number;
  classes: number;
  collected: number;
  expected: number;
  delay?: number;
}) {
  const visual = ESTABLISHMENT_VISUALS[establishment.type] ?? ESTABLISHMENT_VISUALS['universite']!;
  const ratio = expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : 0;

  return (
    <Link
      to="/etablissements/$id"
      params={{ id: establishment.id }}
      className="card-lift animate-rise group block overflow-hidden rounded-2xl border border-border bg-card"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={cn("shine-gold relative bg-gradient-to-br p-5 text-white", visual!.gradient)}>
        <span
          aria-hidden
          className="animate-glow-pulse absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/15 blur-2xl"
        />
        <p className="relative text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
          {establishmentTypeLabel(establishment.type)}
        </p>
        <h3 className="relative mt-1 font-display text-xl font-semibold">{establishment.name}</h3>
        <p className="relative mt-3 inline-flex items-center gap-1.5 text-sm text-white/85">
          Ouvrir la gestion
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
        </p>
      </div>
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <Metric icon={Users} label="Élèves" value={String(students)} />
          <Metric icon={GraduationCap} label="Classes" value={String(classes)} />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" /> Scolarité encaissée
            </span>
            <span className="font-medium text-foreground">{ratio}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
              style={{ width: `${ratio}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {formatFCFA(collected)} sur {formatFCFA(expected)}
          </p>
        </div>
      </div>
    </Link>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/40 p-3">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-1 font-display text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
