-- Bibliothèque élève : table + policies storage (bulletins .xlsx inclus)

create table if not exists public.student_documents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null,
  file_path text not null,
  file_type text not null,
  file_size integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_student_documents_student on public.student_documents(student_id);
create index if not exists idx_student_documents_establishment on public.student_documents(establishment_id);

alter table public.student_documents enable row level security;

drop policy if exists "student_documents_access" on public.student_documents;
create policy "student_documents_access" on public.student_documents
  for all to authenticated
  using (public.has_establishment_access(establishment_id))
  with check (public.has_establishment_access(establishment_id));

grant select, insert, update, delete on public.student_documents to authenticated;
grant all on public.student_documents to service_role;

insert into storage.buckets (id, name, public)
values ('student-documents', 'student-documents', false)
on conflict (id) do nothing;

drop policy if exists "student_documents_files_access" on storage.objects;
create policy "student_documents_files_access" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'student-documents'
    and public.has_establishment_access(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'student-documents'
    and public.has_establishment_access(((storage.foldername(name))[1])::uuid)
  );
