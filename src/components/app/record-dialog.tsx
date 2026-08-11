import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type FieldType = "text" | "number" | "date" | "textarea" | "select" | "switch";

export type Field = {
  name: string;
  label: string;
  type?: FieldType;
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: unknown;
  colSpan?: 1 | 2;
};

export type RecordValues = Record<string, any>;

export function RecordDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  initial,
  submitting,
  onSubmit,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: Field[];
  initial?: RecordValues | null;
  submitting?: boolean;
  onSubmit: (values: RecordValues) => void;
  trigger?: ReactNode;
}) {
  const [values, setValues] = useState<RecordValues>({});

  useEffect(() => {
    if (!open) return;
    const next: RecordValues = {};
    for (const f of fields) {
      const raw = initial?.[f.name];
      next[f.name] =
        raw !== undefined && raw !== null
          ? raw
          : f.defaultValue !== undefined
            ? f.defaultValue
            : f.type === "switch"
              ? true
              : "";
    }
    setValues(next);
  }, [open, initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (name: string, value: unknown) => setValues((v) => ({ ...v, [name]: value }));

  const submit = () => {
    const payload: RecordValues = {};
    for (const f of fields) {
      const v = values[f.name];
      if (f.type === "switch") payload[f.name] = !!v;
      else if (f.type === "number") payload[f.name] = v === "" || v === null ? null : Number(v);
      else payload[f.name] = v === "" ? null : v;
    }
    onSubmit(payload);
  };

  const missing = fields.some((f) => f.required && (values[f.name] === "" || values[f.name] == null));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.name} className={f.colSpan === 2 || f.type === "textarea" ? "sm:col-span-2" : ""}>
              <Label htmlFor={f.name} className="mb-1.5 block text-sm">
                {f.label}
                {f.required ? <span className="ml-0.5 text-destructive">*</span> : null}
              </Label>
              {f.type === "textarea" ? (
                <Textarea id={f.name} value={values[f.name] ?? ""} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />
              ) : f.type === "select" ? (
                <Select value={values[f.name] ? String(values[f.name]) : ""} onValueChange={(v) => set(f.name, v)}>
                  <SelectTrigger id={f.name}>
                    <SelectValue placeholder={f.placeholder ?? "Sélectionner"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(f.options ?? []).map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.type === "switch" ? (
                <div className="flex h-9 items-center">
                  <Switch id={f.name} checked={!!values[f.name]} onCheckedChange={(v) => set(f.name, v)} />
                </div>
              ) : (
                <Input
                  id={f.name}
                  type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  step={f.type === "number" ? "any" : undefined}
                  value={values[f.name] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              )}
              {f.help ? <p className="mt-1 text-xs text-muted-foreground">{f.help}</p> : null}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={submitting || missing}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
