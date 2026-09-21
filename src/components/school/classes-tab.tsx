/**
 * Onglet Classes — cartes compactes : nom + barre effectif / capacité.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus, GraduationCap, Users, ArrowRight } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useSaveRow } from "@/lib/data";
import type { SchoolData } from "@/lib/school-data";
import { formatFCFA } from "@/lib/format";
import { cn } from "@/lib/utils";

type Data = SchoolData;

export function ClassesTab({ establishmentId, data }: { establishmentId: string; data: Data }) {
  const navigate = useNavigate();
  const save = useSaveRow("classes", "Classe");
  const [open, setOpen] = useState(false);

  const rows = data.classes
    .filter((c) => c.establishment_id === establishmentId)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const plans = data.feePlans.filter((p) => p.establishment_id === establishmentId);

  const fields: Field[] = [
    { name: "name", label: "Nom de la classe", required: true, colSpan: 2, placeholder: "6ème A" },
    { name: "capacity", label: "Capacité", type: "number", defaultValue: 40 },
    {
      name: "fee_plan_id",
      label: "Modèle de scolarité",
      type: "select",
      options: plans.map((p) => ({
        value: p.id,
        label: `${p.name} — ${formatFCFA(p.total_amount)}`,
      })),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">Classes</h2>
          <p className="text-xs text-muted-foreground">
            {rows.length} classe{rows.length > 1 ? "s" : ""} dans cet établissement
          </p>
        </div>
        <Button className="press" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Nouvelle classe
        </Button>
      </div>

      {rows.length === 0 && !data.loading ? (
        <EmptyState
          icon={GraduationCap}
          title="Aucune classe"
          description="Créez la première classe de cet établissement."
        />
      ) : (
        <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((c) => {
            const effectif = data.students.filter((s) => s.class_id === c.id).length;
            const capacity = Number(c.capacity) || 0;
            const ratio = capacity > 0 ? Math.min(100, (effectif / capacity) * 100) : 0;
            const full = capacity > 0 && effectif >= capacity;
            return (
              <Card
                key={c.id}
                role="button"
                tabIndex={0}
                className="card-lift group cursor-pointer overflow-hidden border-border/60 transition-colors hover:border-primary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => navigate({ to: "/classes/$classId", params: { classId: c.id } })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate({ to: "/classes/$classId", params: { classId: c.id } });
                  }
                }}
              >
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform duration-200 group-hover:scale-105">
                      <Users className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-sm font-semibold text-foreground">
                        {c.name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {effectif} élève{effectif > 1 ? "s" : ""}
                        {capacity > 0 ? ` · cap. ${capacity}` : ""}
                      </p>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Effectif</span>
                      <span
                        className={cn(
                          "tabular-nums",
                          full ? "font-medium text-destructive" : "text-foreground",
                        )}
                      >
                        {capacity > 0 ? `${effectif} / ${capacity}` : effectif}
                      </span>
                    </div>
                    <Progress
                      value={capacity > 0 ? ratio : 0}
                      className={cn("h-1.5", full && "[&>div]:bg-destructive")}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title="Nouvelle classe"
        fields={fields}
        submitting={save.isPending}
        onSubmit={(values) =>
          save.mutate(
            { id: null, values: { ...values, establishment_id: establishmentId } },
            { onSuccess: () => setOpen(false) },
          )
        }
      />
    </div>
  );
}
