-- Moyennes calculées par le modèle Excel (formules rejouées), à conserver
-- avec le bulletin validé : source unique pour ce qui doit ensuite s'afficher
-- ailleurs dans l'app (fiche élève, historique) pour cet élève et cette période.
alter table public.student_report_cards
  add column if not exists general_average numeric,
  add column if not exists subject_averages jsonb not null default '{}'::jsonb;
