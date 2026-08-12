CREATE OR REPLACE FUNCTION public.enforce_admin_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      new.role := 'administrative_staff';
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
$function$;