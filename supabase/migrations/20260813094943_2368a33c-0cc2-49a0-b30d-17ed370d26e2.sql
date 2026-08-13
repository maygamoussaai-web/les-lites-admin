-- ============ 1. Nettoyage de l'ancien modèle ============
drop table if exists public.grades cascade;
drop table if exists public.assessments cascade;
drop table if exists public.assessment_types cascade;
drop table if exists public.class_subject_configs cascade;
drop table if exists public.student_payments cascade;
drop table if exists public.student_tuition cascade;
drop table if exists public.tuition_plans cascade;
drop table if exists public.student_enrollments cascade;
drop table if exists public.teacher_work_logs cascade;
drop table if exists public.teacher_payments cascade;
drop table if exists public.teacher_assignments cascade;
drop table if exists public.students cascade;
drop table if exists public.teachers cascade;
drop table if exists public.classes cascade;
drop table if exists public.subjects cascade;
drop table if exists public.academic_years cascade;

drop function if exists public.has_class_access(uuid) cascade;
drop function if exists public.has_student_access(uuid) cascade;
drop function if exists public.has_teacher_access(uuid) cascade;
drop function if exists public.validate_school_integrity() cascade;

-- ============ 2. Helpers ============
grant execute on function public.is_director_general() to authenticated;
grant execute on function public.current_admin_establishment() to authenticated;
grant execute on function public.current_admin_role() to authenticated;
grant execute on function public.has_establishment_access(uuid) to authenticated;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

alter table public.admin_profiles
  add column if not exists notifications_enabled boolean not null default true;

-- ============ 3. Modèles de scolarité ============
create table public.fee_plans (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null,
  total_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.fee_plans to authenticated;
grant all on public.fee_plans to service_role;
alter table public.fee_plans enable row level security;
create policy "fee_plans_access" on public.fee_plans for all to authenticated
  using (public.has_establishment_access(establishment_id))
  with check (public.has_establishment_access(establishment_id));
create trigger trg_fee_plans_updated before update on public.fee_plans
  for each row execute function public.set_updated_at();

create table public.fee_plan_installments (
  id uuid primary key default gen_random_uuid(),
  fee_plan_id uuid not null references public.fee_plans(id) on delete cascade,
  label text not null default 'Tranche',
  amount numeric not null default 0,
  due_date date not null,
  position integer not null default 1,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.fee_plan_installments to authenticated;
grant all on public.fee_plan_installments to service_role;
alter table public.fee_plan_installments enable row level security;
create policy "fee_plan_installments_access" on public.fee_plan_installments for all to authenticated
  using (exists (select 1 from public.fee_plans p where p.id = fee_plan_id and public.has_establishment_access(p.establishment_id)))
  with check (exists (select 1 from public.fee_plans p where p.id = fee_plan_id and public.has_establishment_access(p.establishment_id)));

-- ============ 4. Classes ============
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null,
  fee_plan_id uuid references public.fee_plans(id) on delete set null,
  capacity integer not null default 40,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.classes to authenticated;
grant all on public.classes to service_role;
alter table public.classes enable row level security;
create policy "classes_access" on public.classes for all to authenticated
  using (public.has_establishment_access(establishment_id))
  with check (public.has_establishment_access(establishment_id));
create trigger trg_classes_updated before update on public.classes
  for each row execute function public.set_updated_at();

-- ============ 5. Élèves ============
create table public.students (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  first_name text not null,
  last_name text not null,
  gender text not null default 'M' check (gender in ('M','F')),
  date_of_birth date,
  parent_phone_1 text,
  parent_phone_2 text,
  enrolled_at date not null default current_date,
  term1_average numeric check (term1_average is null or (term1_average >= 0 and term1_average <= 20)),
  term2_average numeric check (term2_average is null or (term2_average >= 0 and term2_average <= 20)),
  term3_average numeric check (term3_average is null or (term3_average >= 0 and term3_average <= 20)),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.students to authenticated;
grant all on public.students to service_role;
alter table public.students enable row level security;
create policy "students_access" on public.students for all to authenticated
  using (public.has_establishment_access(establishment_id))
  with check (public.has_establishment_access(establishment_id));
create trigger trg_students_updated before update on public.students
  for each row execute function public.set_updated_at();
create index idx_students_class on public.students(class_id);

create table public.student_transfers (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  from_establishment_id uuid references public.establishments(id) on delete set null,
  from_class_id uuid references public.classes(id) on delete set null,
  to_establishment_id uuid references public.establishments(id) on delete set null,
  to_class_id uuid references public.classes(id) on delete set null,
  moved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert on public.student_transfers to authenticated;
grant all on public.student_transfers to service_role;
alter table public.student_transfers enable row level security;
create policy "student_transfers_select" on public.student_transfers for select to authenticated
  using (public.is_director_general()
    or public.has_establishment_access(coalesce(from_establishment_id, to_establishment_id))
    or public.has_establishment_access(coalesce(to_establishment_id, from_establishment_id)));
create policy "student_transfers_insert" on public.student_transfers for insert to authenticated
  with check (public.is_director_general() or public.has_establishment_access(from_establishment_id));

-- ============ 6. Paiements de scolarité ============
create table public.tuition_payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  amount numeric not null check (amount > 0),
  paid_at date not null default current_date,
  method text not null default 'especes',
  note text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.tuition_payments to authenticated;
grant all on public.tuition_payments to service_role;
alter table public.tuition_payments enable row level security;
create policy "tuition_payments_access" on public.tuition_payments for all to authenticated
  using (public.has_establishment_access(establishment_id))
  with check (public.has_establishment_access(establishment_id));
create index idx_tuition_payments_student on public.tuition_payments(student_id);

-- ============ 7. Enseignants ============
create table public.teachers (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  phone text,
  domain text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.teachers to authenticated;
grant all on public.teachers to service_role;
alter table public.teachers enable row level security;
create trigger trg_teachers_updated before update on public.teachers
  for each row execute function public.set_updated_at();

create table public.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  payment_method text not null default 'fixed_salary' check (payment_method in ('fixed_salary','hourly')),
  salary_amount numeric not null default 0,
  hourly_rate numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id, establishment_id)
);
grant select, insert, update, delete on public.teacher_assignments to authenticated;
grant all on public.teacher_assignments to service_role;
alter table public.teacher_assignments enable row level security;
create trigger trg_teacher_assignments_updated before update on public.teacher_assignments
  for each row execute function public.set_updated_at();

create policy "teachers_select" on public.teachers for select to authenticated
  using (public.is_director_general() or exists (
    select 1 from public.teacher_assignments ta
    where ta.teacher_id = teachers.id and ta.establishment_id = public.current_admin_establishment()));
create policy "teachers_insert_dg" on public.teachers for insert to authenticated
  with check (public.is_director_general());
create policy "teachers_update_dg" on public.teachers for update to authenticated
  using (public.is_director_general()) with check (public.is_director_general());
create policy "teachers_delete_dg" on public.teachers for delete to authenticated
  using (public.is_director_general());

create policy "teacher_assignments_select" on public.teacher_assignments for select to authenticated
  using (public.has_establishment_access(establishment_id));
create policy "teacher_assignments_insert_dg" on public.teacher_assignments for insert to authenticated
  with check (public.is_director_general());
create policy "teacher_assignments_update" on public.teacher_assignments for update to authenticated
  using (public.has_establishment_access(establishment_id))
  with check (public.has_establishment_access(establishment_id));
create policy "teacher_assignments_delete_dg" on public.teacher_assignments for delete to authenticated
  using (public.is_director_general());

create table public.teacher_sessions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.teacher_assignments(id) on delete cascade,
  name text not null,
  weekday smallint not null default 1 check (weekday between 0 and 6),
  duration_minutes integer not null default 60 check (duration_minutes > 0),
  is_done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.teacher_sessions to authenticated;
grant all on public.teacher_sessions to service_role;
alter table public.teacher_sessions enable row level security;
create policy "teacher_sessions_access" on public.teacher_sessions for all to authenticated
  using (exists (select 1 from public.teacher_assignments ta where ta.id = assignment_id and public.has_establishment_access(ta.establishment_id)))
  with check (exists (select 1 from public.teacher_assignments ta where ta.id = assignment_id and public.has_establishment_access(ta.establishment_id)));
create trigger trg_teacher_sessions_updated before update on public.teacher_sessions
  for each row execute function public.set_updated_at();

create table public.teacher_payments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  amount numeric not null check (amount > 0),
  paid_at date not null default current_date,
  note text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.teacher_payments to authenticated;
grant all on public.teacher_payments to service_role;
alter table public.teacher_payments enable row level security;
create policy "teacher_payments_access" on public.teacher_payments for all to authenticated
  using (public.has_establishment_access(establishment_id))
  with check (public.has_establishment_access(establishment_id));
