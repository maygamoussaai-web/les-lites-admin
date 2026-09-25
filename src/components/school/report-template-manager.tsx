/**
 * Import modele bulletin — balises ([prenom], [classe]…) auto-detectees.
 * Support type période | annuel (un modèle actif par kind).
 */
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, Loader2, Upload, Check, AlertTriangle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { writeAudit, useRows } from "@/lib/data";
import { describeError } from "@/lib/errors";
import {
  readTemplate,
  detectMapping,
  COLUMN_ROLE_LABELS,
  FIELD_ROLE_LABELS,
  isSubjectLabel,
  type TemplateSheet,
  type TemplateMapping,
  type ColumnRole,
  type FieldRole,
} from "@/lib/xlsx-template";

type ReportTemplate = {
  id: string;
  name: string;
  class_id: string | null;
  establishment_id: string;
  file_path: string;
  mapping: TemplateMapping | Record<string, unknown>;
  scale: number;
  is_active: boolean;
  kind?: string;
  created_at: string;
};

type TemplateKind = "period" | "annual";

export function ReportTemplateManager({
  classId,
  establishmentId,
  className,
}: {
  classId: string;
  establishmentId: string;
  className: string;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const templatesQ = useRows<ReportTemplate>("report_templates", {
    eq: { class_id: classId },
    order: { column: "created_at", ascending: false },
  });
  const templates = templatesQ.data ?? [];
  const activePeriod =
    templates.find((t) => t.is_active && (t.kind ?? "period") === "period") ??
    templates.find((t) => t.is_active && !t.kind) ??
    null;
  const activeAnnual =
    templates.find((t) => t.is_active && t.kind === "annual") ?? null;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"idle" | "review">("idle");
  const [fileName, setFileName] = useState("");
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [sheet, setSheet] = useState<TemplateSheet | null>(null);
  const [mapping, setMapping] = useState<TemplateMapping | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [scale, setScale] = useState("20");
  const [templateName, setTemplateName] = useState("");
  const [templateKind, setTemplateKind] = useState<TemplateKind>("period");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const reset = () => {
    setStep("idle");
    setFileName("");
    setBuffer(null);
    setSheet(null);
    setMapping(null);
    setWarnings([]);
    setScale("20");
    setTemplateName("");
    setTemplateKind("period");
    setBusy(false);
    setAdvancedOpen(false);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.xlsx?$/i.test(file.name)) {
      toast.error("Choisissez un fichier Excel (.xlsx).");
      return;
    }
    setBusy(true);
    try {
      const ab = await file.arrayBuffer();
      const s = readTemplate(ab);
      const detected = detectMapping(s);
      setBuffer(ab);
      setSheet(s);
      setMapping(detected.mapping);
      setWarnings(detected.warnings);
      setFileName(file.name);
      setTemplateName(file.name.replace(/\.xlsx?$/i, "") || `Bulletin ${className}`);
      setStep("review");
    } catch (e) {
      toast.error((e as Error).message || "Lecture du fichier impossible");
    } finally {
      setBusy(false);
    }
  };

  const subjectLabels = useMemo(() => {
    if (!sheet || !mapping || mapping.headerRow <= 0) return [] as string[];
    const subjectCol = Object.entries(mapping.columns).find(([, r]) => r === "subject")?.[0];
    if (!subjectCol) return [];
    const labels: string[] = [];
    for (let r = mapping.firstSubjectRow; r <= mapping.lastSubjectRow; r++) {
      const cell = sheet.cells[`${subjectCol}${r}`];
      const label = cell && cell.v !== null ? String(cell.v).trim() : "";
      if (label && isSubjectLabel(label)) labels.push(label);
    }
    return labels;
  }, [sheet, mapping]);

  const save = async () => {
    if (!buffer || !mapping || !sheet) return;
    setBusy(true);
    try {
      const path = `${establishmentId}/${classId}/${Date.now()}-${fileName.replace(/[^\w.\-]+/g, "_")}`;
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const { error: upErr } = await supabase.storage.from("report-templates").upload(path, blob, {
        contentType: blob.type,
        upsert: false,
      });
      if (upErr) throw upErr;

      const kind: TemplateKind = templateKind;
      await supabase
        .from("report_templates")
        .update({ is_active: false })
        .eq("class_id", classId)
        .eq("kind", kind);

      const { data: created, error } = await supabase
        .from("report_templates")
        .insert({
          establishment_id: establishmentId,
          class_id: classId,
          name:
            templateName.trim() ||
            (kind === "annual" ? `Annuel ${className}` : `Bulletin ${className}`),
          file_path: path,
          mapping: mapping as never,
          scale: Number(scale) || 20,
          is_active: true,
          kind,
        })
        .select()
        .single();
      if (error) throw error;

      if (kind === "period") {
        const existing = await supabase.from("class_subjects").select("id, name").eq("class_id", classId);
        if (existing.error) throw existing.error;
        const normKey = (name: string) =>
          name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
        const wanted = new Set(subjectLabels.map(normKey));
        const toDelete = (existing.data ?? []).filter((s) => {
          if (!isSubjectLabel(s.name)) return true;
          if (wanted.size === 0) return false;
          return !wanted.has(normKey(s.name));
        });
        if (toDelete.length) {
          const { error: delErr } = await supabase
            .from("class_subjects")
            .delete()
            .in(
              "id",
              toDelete.map((s) => s.id),
            );
          if (delErr) throw delErr;
        }
        const remaining = (existing.data ?? []).filter((s) => !toDelete.some((d) => d.id === s.id));
        const byNorm = new Map(remaining.map((s) => [normKey(s.name), s]));
        for (const label of subjectLabels) {
          const key = normKey(label);
          if (byNorm.has(key)) continue;
          const { data: sub, error: subErr } = await supabase
            .from("class_subjects")
            .insert({ class_id: classId, establishment_id: establishmentId, name: label })
            .select()
            .single();
          if (subErr) throw subErr;
          byNorm.set(key, sub);
        }
      }

      await writeAudit("create", "report_templates" as never, created.id, {
        class_id: classId,
        kind,
        subjects: subjectLabels,
      });
      qc.invalidateQueries({ queryKey: ["report_templates"] });
      qc.invalidateQueries({ queryKey: ["class_subjects"] });
      qc.invalidateQueries({ queryKey: ["active-report-template"] });
      toast.success(
        kind === "annual"
          ? "Modèle annuel enregistré"
          : "Modèle de période enregistré — matières synchronisées",
      );
      setOpen(false);
      reset();
    } catch (e) {
      toast.error(describeError(e, "Enregistrement impossible", "report_templates"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileSpreadsheet className="h-4 w-4 text-primary" />
            Modèles de bulletin
          </p>
          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {activePeriod ? (
              <p>
                Période :{" "}
                <span className="font-medium text-foreground">{activePeriod.name}</span> · /
                {activePeriod.scale}
              </p>
            ) : (
              <p>Période : aucun modèle</p>
            )}
            {activeAnnual ? (
              <p>
                Annuel :{" "}
                <span className="font-medium text-foreground">{activeAnnual.name}</span> · /
                {activeAnnual.scale}
              </p>
            ) : (
              <p>Annuel : aucun modèle</p>
            )}
          </div>
        </div>
        <Button size="sm" variant="outline" className="press" onClick={() => setOpen(true)}>
          <Upload className="mr-1.5 h-4 w-4" />
          Importer
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            setOpen(false);
            reset();
          } else setOpen(true);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Modèle de bulletin Excel</DialogTitle>
            <DialogDescription>
              Les balises ([prenom], [nom], [classe]…) et colonnes sont reconnues automatiquement.
              Choisissez le type : période ou annuel — n'importe quel plan de colonnes est accepté.
            </DialogDescription>
          </DialogHeader>

          {step === "idle" && (
            <div className="space-y-4 py-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-10 text-center transition hover:border-primary/40 hover:bg-muted/50"
              >
                {busy ? (
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                ) : (
                  <Upload className="h-8 w-8 text-primary" />
                )}
                <span className="text-sm font-medium">Choisir un fichier .xlsx</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  void onFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {step === "review" && mapping && sheet && (
            <div className="space-y-4 py-1">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1.5 block text-sm">Nom du modèle</Label>
                  <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm">Barème (note max)</Label>
                  <Input type="number" step="any" value={scale} onChange={(e) => setScale(e.target.value)} />
                </div>
              </div>

              <div>
                <Label className="mb-1.5 block text-sm">Type de modèle</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={templateKind === "period" ? "default" : "outline"}
                    onClick={() => setTemplateKind("period")}
                  >
                    Période
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={templateKind === "annual" ? "default" : "outline"}
                    onClick={() => setTemplateKind("annual")}
                  >
                    Annuel
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-success/30 bg-success/10 p-3 space-y-2">
                <p className="text-sm font-medium text-success">Vérification du modèle</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>
                    {Object.values(mapping.columns).includes("subject") ? "✓" : "✗"} Colonne matières
                  </li>
                  <li>
                    {Object.values(mapping.columns).some(
                      (r) =>
                        r === "evaluation" ||
                        r === "composition" ||
                        r === "subject_average" ||
                        r === "evaluation_average",
                    )
                      ? "✓"
                      : "✗"}{" "}
                    Colonnes notes ou moyennes
                  </li>
                  <li>
                    {Object.values(mapping.columns).includes("subject_average") ? "✓" : "✗"} Colonne
                    moyenne matière
                  </li>
                  <li>
                    {Object.values(mapping.fields).includes("general_average") ? "✓" : "✗"} Moyenne
                    générale
                  </li>
                  <li>
                    {Object.keys(mapping.fields).length > 0 ? "✓" : "✗"} Balises identité
                  </li>
                </ul>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {Object.entries(mapping.columns)
                    .filter(([, r]) => r !== "ignore")
                    .map(([letter, role]) => (
                      <Badge key={letter} variant="secondary" className="font-normal">
                        Col. {letter} → {COLUMN_ROLE_LABELS[role]}
                      </Badge>
                    ))}
                  {Object.entries(mapping.fields)
                    .filter(([, r]) => r !== "ignore")
                    .map(([addr, role]) => (
                      <Badge key={addr} variant="secondary" className="font-normal">
                        {addr} → {FIELD_ROLE_LABELS[role]}
                      </Badge>
                    ))}
                </div>
              </div>

              {subjectLabels.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">Matières ({subjectLabels.length})</p>
                  <div className="flex flex-wrap gap-1.5">
                    {subjectLabels.map((s) => (
                      <Badge key={s} variant="secondary">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {warnings.length > 0 && (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  <p className="mb-1 flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-4 w-4" /> Avertissements
                  </p>
                  <ul className="list-inside list-disc text-xs text-muted-foreground">
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between">
                    Modifier la correspondance (optionnel)
                    <ChevronDown className={`h-4 w-4 transition ${advancedOpen ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-2">
                  <div className="space-y-1.5">
                    {Object.entries(mapping.columns).map(([letter, role]) => (
                      <div key={letter} className="flex items-center gap-2">
                        <Badge variant="outline" className="w-10 justify-center font-mono">
                          {letter}
                        </Badge>
                        <Select
                          value={role}
                          onValueChange={(v) =>
                            setMapping((m) =>
                              m ? { ...m, columns: { ...m.columns, [letter]: v as ColumnRole } } : m,
                            )
                          }
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(COLUMN_ROLE_LABELS) as ColumnRole[]).map((r) => (
                              <SelectItem key={r} value={r}>
                                {COLUMN_ROLE_LABELS[r]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <DialogFooter>
                <Button variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={busy}>
                  Annuler
                </Button>
                <Button className="press" disabled={busy} onClick={() => void save()}>
                  {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                  Enregistrer le modèle
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
