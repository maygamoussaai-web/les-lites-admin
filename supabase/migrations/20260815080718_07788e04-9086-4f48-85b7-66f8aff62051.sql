CREATE OR REPLACE FUNCTION public.delete_teacher_complete(target_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_director_general() THEN
    RAISE EXCEPTION 'Seul le Directeur Général peut supprimer un enseignant.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.teachers WHERE id = target_teacher_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enseignant introuvable.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_teacher_complete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_teacher_complete(uuid) TO authenticated, service_role;