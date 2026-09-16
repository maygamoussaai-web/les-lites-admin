/**
 * Onglet Classes — cartes compactes : nom + barre effectif / capacité.
 * Un clic ouvre la page résultats de la classe.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus, GraduationCap } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useSaveRow } from "@/lib/data";
import type { SchoolData } from "@/lib/school-data";
import { formatFCFA } from "@/lib/format";

type Data = SchoolData;

export function ClassesTab({ establishmentId, data }: { establishmentId: string; data: Data }) {
  const navigate = useNavigate();
  const save = useSaveRow("classes", "Classe");
  const [open, setOpen] = useState(false);

  const rows = data.classes.filter((c) => c.establishment_id === establishmentId);
  const plans = data.feePlans.filter((p) => p.establishment_id === establishmentId);

  const fields: Field[] = [
    { name: "name", label: "Nom de la classe", required: true, colSpan: 2, placeholder: "6ème A" },
    { name: "capacity", label: "Capacité", type: "number", defaultValue: 40 },
    {
      name: "fee_plan_id",
      label: "Modèle de scolarité",
      type: "select",
      options: plans.map((p) => ({ value: p.id, label: `${p.name} — ${formatFCFA(p.total_amount)}` })),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((c, index) => {
            const effectif = data.students.filter((s) => s.class_id === c.id).length;
            const capacity = Number(c.capacity) || 0;
            const ratio = capacity > 0 ? Math.min(100, (effectif / capacity) * 100) : 0;
            return (
              <Card
                key={c.id}
                className="card-lift animate-rise cursor-pointer border-border/70 transition-colors hover:border-primary/40"
                style={{ animationDelay: `${index * 40}ms` }}
                onClick={() => navigate({ to: "/classes/$classId", params: { classId: c.id } })}
              >
                <CardContent className="space-y-2 p-4">
                  <p className="truncate font-display text-sm font-semibold text-foreground">{c.name}</p>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>
                        {effectif} élève{effectif > 1 ? "s" : ""}
                      </span>
                      <span>{capacity > 0 ? `${effectif} / ${capacity}` : "Capacité non définie"}</span>
                    </div>
                    <Progress value={capacity > 0 ? ratio : 0} className="h-1.5" />
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
