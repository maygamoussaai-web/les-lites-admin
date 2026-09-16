CREATE TABLE public.report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  name text NOT NULL,
  file_path text NOT NULL,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  scale numeric NOT NULL DEFAULT 20,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_templates TO authenticated;
GRANT ALL ON public.report_templates TO service_role;

ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "report_templates_access" ON public.report_templates
  FOR ALL TO authenticated
  USING (public.has_establishment_access(establishment_id))
  WITH CHECK (public.has_establishment_access(establishment_id));

CREATE TRIGGER trg_report_templates_updated
  BEFORE UPDATE ON public.report_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_report_templates_class ON public.report_templates(class_id);
CREATE INDEX idx_report_templates_establishment ON public.report_templates(establishment_id);