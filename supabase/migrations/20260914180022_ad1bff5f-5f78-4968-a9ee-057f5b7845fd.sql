-- Une seule composition par (période, matière, élève). Les évaluations restent illimitées.
CREATE UNIQUE INDEX IF NOT EXISTS grades_one_composition_per_subject
  ON public.grades (period_id, subject_id, student_id)
  WHERE nature = 'composition';

-- Un bulletin validé est figé : on interdit le retour arrière et la suppression.
CREATE OR REPLACE FUNCTION public.protect_validated_report_card()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'validated' THEN
      RAISE EXCEPTION 'Un bulletin validé ne peut pas être supprimé.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'validated' AND NEW.status <> 'validated' THEN
    RAISE EXCEPTION 'Un bulletin validé ne peut pas repasser en brouillon.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_validated_report_card ON public.student_report_cards;
CREATE TRIGGER trg_protect_validated_report_card
  BEFORE UPDATE OR DELETE ON public.student_report_cards
  FOR EACH ROW EXECUTE FUNCTION public.protect_validated_report_card();