create or replace function public.enforce_admin_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dg_exists boolean;
begin
  select exists (select 1 from public.admin_profiles where role = 'director_general' and is_active = true) into dg_exists;
  if tg_op = 'INSERT' then
    if not dg_exists then
      new.role := 'director_general';
      new.is_active := true;
      new.establishment_id := null;
    elsif not public.is_director_general() then
      new.role := 'staff';
      new.is_active := coalesce(new.is_active, true);
    end if;
  else
    if not public.is_director_general() then
      new.role := old.role;
      new.is_active := old.is_active;
      new.establishment_id := old.establishment_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_admin_role on public.admin_profiles;
create trigger trg_enforce_admin_role
before insert or update on public.admin_profiles
for each row execute function public.enforce_admin_role();

insert into public.establishments (name, type, description, is_active)
values
  ('Les Élites de Gao – Université', 'universite', 'Établissement universitaire du complexe scolaire Les Élites de Gao', true),
  ('Les Élites de Gao – Lycée', 'lycee', 'Lycée du complexe scolaire Les Élites de Gao', true),
  ('Les Élites de Gao – Collège', 'college', 'Collège du complexe scolaire Les Élites de Gao', true),
  ('Les Élites de Gao – Fondamentale', 'fondamentale', 'École fondamentale du complexe scolaire Les Élites de Gao', true);

insert into public.academic_years (name, start_date, end_date, is_active)
values ('2025-2026', '2025-10-01', '2026-07-31', true);

insert into public.subjects (name, code, is_active) values
  ('Mathématiques', 'MATH', true),
  ('Français', 'FRA', true),
  ('Anglais', 'ANG', true),
  ('Physique-Chimie', 'PC', true),
  ('Sciences de la Vie et de la Terre', 'SVT', true),
  ('Histoire-Géographie', 'HG', true),
  ('Éducation Civique et Morale', 'ECM', true),
  ('Philosophie', 'PHILO', true),
  ('Informatique', 'INFO', true),
  ('Éducation Physique et Sportive', 'EPS', true),
  ('Arabe', 'ARA', true),
  ('Économie', 'ECO', true);