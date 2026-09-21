-- Autoriser aussi le fallback report-templates pour les chemins bulletin (élève)
-- si student-documents refuse l'upload (policy / bucket).

insert into storage.buckets (id, name, public)
values ('report-templates', 'report-templates', false)
on conflict (id) do nothing;

drop policy if exists "report_templates_authenticated_all" on storage.objects;
create policy "report_templates_authenticated_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'report-templates')
  with check (bucket_id = 'report-templates');

-- Renforcer student-documents (idempotent)
insert into storage.buckets (id, name, public)
values ('student-documents', 'student-documents', false)
on conflict (id) do nothing;

drop policy if exists "student_documents_files_access" on storage.objects;
create policy "student_documents_files_access" on storage.objects
  for all to authenticated
  using (bucket_id = 'student-documents')
  with check (bucket_id = 'student-documents');
