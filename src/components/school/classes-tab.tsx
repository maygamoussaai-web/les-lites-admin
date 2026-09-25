/**
 * Onglet Classes — cartes compactes : nom + barre effectif / capacité.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { GraduationCap, Plus, Users } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ClassFormDialog } from "@/components/school/class-form-dialog";
import type { SchoolData } from "@/lib/school-data";

export function ClassesTab({
  establishmentId,
  data,
}: {
  establishmentId: string;
  data: SchoolData;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rows = data.classes.filter((c) => c.establishment_id === establishmentId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold">Classes</h2>
          <p className="text-sm text-muted-foreground">
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
          action={
            <Button className="press" onClick={() => setOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Nouvelle classe
            </Button>
          }
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
                <CardContent className="p-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="font-display font-semibold leading-tight text-foreground group-hover:text-primary">
                      {c.name}
                    </p>
                    {full && <Badge variant="destructive">Complet</Badge>}
                  </div>
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" /> Effectif
                    </span>
                    <span className="tabular-nums font-medium text-foreground">
                      {effectif}
                      {capacity > 0 ? ` / ${capacity}` : ""}
                    </span>
                  </div>
                  {capacity > 0 && <Progress value={ratio} className="h-1.5" />}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ClassFormDialog
        open={open}
        onClose={() => setOpen(false)}
        establishmentId={establishmentId}
        data={data}
      />
    </div>
  );
}
