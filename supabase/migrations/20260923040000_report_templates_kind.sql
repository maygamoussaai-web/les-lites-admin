-- Type de modèle : période (défaut) ou annuel — un actif par (classe, kind)
ALTER TABLE public.report_templates
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'period';

UPDATE public.report_templates
  SET kind = 'period'
  WHERE kind IS NULL OR kind = '';

ALTER TABLE public.report_templates
  DROP CONSTRAINT IF EXISTS report_templates_kind_check;

ALTER TABLE public.report_templates
  ADD CONSTRAINT report_templates_kind_check
  CHECK (kind IN ('period', 'annual'));

CREATE INDEX IF NOT EXISTS report_templates_class_kind_active_idx
  ON public.report_templates (class_id, kind)
  WHERE is_active = true;
