import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable, type Column } from "@/components/app/data-table";
import { RecordDialog, type Field } from "@/components/app/record-dialog";
import { RowActions } from "@/components/app/row-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRows, useSaveRow, useDeleteRow } from "@/lib/data";
import { formatDate, formatNumber } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/notes")({
  head: () => ({
    meta: [
      { title: "Évaluations & notes – Les Élites de Gao" },
      { name: "description", content: "Saisie des évaluations et des notes des élèves du complexe Les Élites de Gao." },
      { property: "og:title", content: "Évaluations & notes – Les Élites de Gao" },
      { property: "og:description", content: "Créez les évaluations et saisissez les notes par classe et matière." },
    ],
  }),
  component: Page,
});

type Assessment = Tables<"assessments">;

function Page() {
  const { data: configs = [] } = useRows<Tables<"class_subject_configs">>("class_subject_configs");
  const { data: classes = [] } = useRows<Tables<"classes">>("classes");
  const { data: subjects = [] } = useRows<Tables<"subjects">>("subjects");
  const { data: assessments = [], isLoading } = useRows<Assessment>("assessments", {
    order: { column: "assessment_date", ascending: false },
  });
  const save = useSaveRow("assessments", "Évaluation");
  const remove = useDeleteRow("assessments", "Évaluation");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Assessment | null>(null);
  const [gradesFor, setGradesFor] = useState<Assessment | null>(null);

  const configLabel = (id: string) => {
    const c = configs.find((x) => x.id === id);
    if (!c) return "—";
    return `${classes.find((k) => k.id === c.class_id)?.name ?? "?"} · ${subjects.find((s) => s.id === c.subject_id)?.name ?? "?"}`;
  };

  const fields: Field[] = [
    { name: "title", label: "Intitulé", required: true, colSpan: 2, placeholder: "Devoir n°1" },
    {
      name: "class_subject_config_id",
      label: "Classe & matière",
      type: "select",
      required: true,
      colSpan: 2,
      options: configs.map((c) => ({ value: c.id, label: configLabel(c.id) })),
    },
    { name: "assessment_date", label: "Date", type: "date" },
    { name: "max_score", label: "Barème", type: "number", defaultValue: 20, required: true },
    {
      name: "academic_period",
      label: "Période",
      type: "select",
      options: [
        { value: "trimestre_1", label: "1er trimestre" },
        { value: "trimestre_2", label: "2e trimestre" },
        { value: "trimestre_3", label: "3e trimestre" },
      ],
    },
  ];

  const columns: Column<Assessment>[] = [
    { key: "title", header: "Évaluation", cell: (r) => <span className="font-medium">{r.title}</span> },
    { key: "cfg", header: "Classe & matière", cell: (r) => configLabel(r.class_subject_config_id) },
    { key: "date", header: "Date", cell: (r) => formatDate(r.assessment_date) },
    { key: "max", header: "Barème", cell: (r) => formatNumber(r.max_score, 0) },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button variant="outline" size="sm" onClick={() => setGradesFor(r)}>
            Notes
          </Button>
          <RowActions
            onEdit={() => {
              setEditing(r);
              setOpen(true);
            }}
            onDelete={() => remove.mutate(r.id)}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Évaluations & notes"
        description="Créez les évaluations par classe et matière, puis saisissez les notes des élèves."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Nouvelle évaluation
          </Button>
        }
      />
      <DataTable columns={columns} rows={assessments} loading={isLoading} emptyLabel="Aucune évaluation. Configurez d'abord les matières d'une classe." />
      <RecordDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Modifier l'évaluation" : "Nouvelle évaluation"}
        fields={fields}
        initial={editing}
        submitting={save.isPending}
        onSubmit={(values) => save.mutate({ id: editing?.id, values }, { onSuccess: () => setOpen(false) })}
      />
      <GradesDialog assessment={gradesFor} onClose={() => setGradesFor(null)} />
    </>
  );
}

function GradesDialog({ assessment, onClose }: { assessment: Assessment | null; onClose: () => void }) {
  const { data: configs = [] } = useRows<Tables<"class_subject_configs">>("class_subject_configs");
  const config = configs.find((c) => c.id === assessment?.class_subject_config_id);
  const { data: enrollments = [] } = useRows<Tables<"student_enrollments">>("student_enrollments", {
    eq: { class_id: config?.class_id },
    enabled: !!config,
  });
  const { data: students = [] } = useRows<Tables<"students">>("students");
  const { data: grades = [] } = useRows<Tables<"grades">>("grades", {
    eq: { assessment_id: assessment?.id },
    enabled: !!assessment,
  });
  const save = useSaveRow("grades", "Note");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const rows = enrollments
    .map((e) => students.find((s) => s.id === e.student_id))
    .filter(Boolean) as Tables<"students">[];

  return (
    <Dialog open={!!assessment} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Notes — {assessment?.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Aucun élève inscrit dans cette classe.</p>
          ) : (
            rows.map((s) => {
              const existing = grades.find((g) => g.student_id === s.id);
              const value = drafts[s.id] ?? (existing ? String(existing.score) : "");
              return (
                <div key={s.id} className="flex items-center gap-3 rounded-md border border-border p-2.5">
                  <span className="flex-1 text-sm">
                    {s.last_name} {s.first_name}
                  </span>
                  <input
                    type="number"
                    step="any"
                    className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"
                    value={value}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                  />
                  <span className="text-xs text-muted-foreground">/ {formatNumber(assessment?.max_score, 0)}</span>
                  <Button
                    size="sm"
                    disabled={value === "" || save.isPending}
                    onClick={() =>
                      save.mutate({
                        id: existing?.id,
                        values: { assessment_id: assessment!.id, student_id: s.id, score: Number(value) },
                      })
                    }
                  >
                    Enregistrer
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
