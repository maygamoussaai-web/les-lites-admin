-- Séances emploi du temps : classe + matière
ALTER TABLE public.teacher_sessions
  ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.class_subjects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS teacher_sessions_class_id_idx ON public.teacher_sessions(class_id);
CREATE INDEX IF NOT EXISTS teacher_sessions_subject_id_idx ON public.teacher_sessions(subject_id);
