-- Nom affiché de la période (ex. « 1er Trimestre ») — utilisé sur les bulletins.
-- Nullable : repli = « Période N » via period_number.
ALTER TABLE public.grade_periods
  ADD COLUMN IF NOT EXISTS name text;

COMMENT ON COLUMN public.grade_periods.name IS
  'Libellé affiché sur bulletins (ex. 1er Trimestre). NULL → Période {period_number}.';
