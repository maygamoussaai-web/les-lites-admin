/**
 * Import + vérification d'un modèle de bulletin Excel pour une classe.
 * - Upload .xlsx → storage bucket report-templates
 * - Détection automatique des zones (xlsx-template.detectMapping)
 * - Écran de confirmation des colonnes / champs
 * - À la validation : enregistrement report_templates + synchronisation class_subjects
 *   à partir des matières du modèle (plus de création libre de matières).
 */
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, Loader2, Upload, Check, AlertTriangle } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { writeAudit, useRows } from "@/lib/data";
import { describeError } from "@/lib/errors";
import {
  readTemplate,
  detectMapping,
  COLUMN_ROLE_LABELS,
  FIELD_ROLE_LABELS,
  colLetter,
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
  created_at: string;
};

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
  const active = templates.find((t) => t.is_active) ?? templates[0] ?? null;

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

  const reset = () => {
    setStep("idle");
    setFileName("");
    setBuffer(null);
    setSheet(null);
    setMapping(null);
    setWarnings([]);
    setScale("20");
    setTemplateName("");
    setBusy(false);
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

      await supabase.from("report_templates").update({ is_active: false }).eq("class_id", classId);

      const { data: created, error } = await supabase
        .from("report_templates")
        .insert({
          establishment_id: establishmentId,
          class_id: classId,
          name: templateName.trim() || `Bulletin ${className}`,
          file_path: path,
          mapping: mapping as never,
          scale: Number(scale) || 20,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;

      const existing = await supabase.from("class_subjects").select("id, name").eq("class_id", classId);
      if (existing.error) throw existing.error;
      const byNorm = new Map(
        (existing.data ?? []).map((s) => [s.name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim(), s]),
      );
      for (const label of subjectLabels) {
        const key = label.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
        if (byNorm.has(key)) continue;
        const { data: sub, error: subErr } = await supabase
          .from("class_subjects")
          .insert({ class_id: classId, establishment_id: establishmentId, name: label })
          .select()
          .single();
        if (subErr) throw subErr;
        byNorm.set(key, sub);
      }

      await writeAudit("create", "report_templates" as never, created.id, {
        class_id: classId,
        subjects: subjectLabels,
      });
      qc.invalidateQueries({ queryKey: ["report_templates"] });
      qc.invalidateQueries({ queryKey: ["class_subjects"] });
      toast.success("Modèle de bulletin enregistré — matières synchronisées");
      setOpen(false);
      reset();
    } catch (e) {
      toast.error(describeError(e, "Enregistrement du modèle impossible", "report_templates"));
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
            Modèle de bulletin
          </p>
          {active ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Actif : <span className="font-medium text-foreground">{active.name}</span>
              {" · "}barème /{active.scale}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Aucun modèle — importez un Excel pour définir les matières et le rendu des bulletins.
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" className="press" onClick={() => setOpen(true)}>
          <Upload className="mr-1.5 h-4 w-4" />
          {active ? "Remplacer le modèle" : "Importer un modèle"}
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
              Importez le fichier .xlsx de la classe. L'app repère le tableau des matières et les balises […].
              Vous confirmez, puis seules les notes et les balises seront remplies — la mise en page Excel reste
              intacte. Les matières du modèle deviennent les seules matières de la classe.
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
                <span className="text-xs text-muted-foreground">Une seule feuille analysée (la première utile)</span>
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
                <p className="mb-2 text-sm font-medium">Colonnes du tableau des matières</p>
                <div className="space-y-1.5">
                  {Object.keys(mapping.columns).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucune colonne détectée — vérifiez le fichier.</p>
                  ) : (
                    Object.entries(mapping.columns).map(([letter, role]) => (
                      <div key={letter} className="flex items-center gap-2">
                        <Badge variant="outline" className="w-10 justify-center font-mono">
                          {letter}
                        </Badge>
                        <Select
                          value={role}
                          onValueChange={(v) =>
                            setMapping((m) => (m ? { ...m, columns: { ...m.columns, [letter]: v as ColumnRole } } : m))
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
                    ))
                  )}
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Cases isolées (en-tête / pied)</p>
                <p className="mb-2 text-xs text-muted-foreground">
                  L'app ne remplit que les <strong>balises</strong> que vous placez dans Excel (rien d'autre hors
                  tableau des notes). Écrivez le jeton <em>dans la case à remplir</em>, par exemple{" "}
                  <code className="rounded bg-muted px-1">[prenom]</code>,{" "}
                  <code className="rounded bg-muted px-1">[nom de famille]</code>,{" "}
                  <code className="rounded bg-muted px-1">[nom]</code>,{" "}
                  <code className="rounded bg-muted px-1">[classe]</code>,{" "}
                  <code className="rounded bg-muted px-1">[date]</code>,{" "}
                  <code className="rounded bg-muted px-1">[effectif]</code>,{" "}
                  <code className="rounded bg-muted px-1">[rang]</code>,{" "}
                  <code className="rounded bg-muted px-1">[moyenne du premier]</code>. Les formules Excel
                  (moyennes, appréciations SI…) sont rejouées ; la mise en page du fichier reste intacte.
                </p>
                <div className="space-y-1.5">
                  {Object.keys(mapping.fields).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucune case isolée détectée.</p>
                  ) : (
                    Object.entries(mapping.fields).map(([address, role]) => (
                      <div key={address} className="flex items-center gap-2">
                        <Badge variant="outline" className="w-14 justify-center font-mono">
                          {address}
                        </Badge>
                        <Select
                          value={role}
                          onValueChange={(v) =>
                            setMapping((m) => (m ? { ...m, fields: { ...m.fields, [address]: v as FieldRole } } : m))
                          }
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(FIELD_ROLE_LABELS) as FieldRole[]).map((r) => (
                              <SelectItem key={r} value={r}>
                                {FIELD_ROLE_LABELS[r]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {subjectLabels.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">Matières détectées ({subjectLabels.length})</p>
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
                  <p className="mb-1 flex items-center gap-1.5 font-medium text-warning-foreground">
                    <AlertTriangle className="h-4 w-4" /> Avertissements
                  </p>
                  <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (step === "review") reset();
                else {
                  setOpen(false);
                  reset();
                }
              }}
            >
              {step === "review" ? "Recommencer" : "Annuler"}
            </Button>
            {step === "review" && (
              <Button onClick={save} disabled={busy || !mapping}>
                {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                Valider le modèle
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
