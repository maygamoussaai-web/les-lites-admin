revoke all on function public.enforce_admin_role() from public, anon, authenticated;
revoke all on function public.validate_school_integrity() from public, anon, authenticated;
revoke execute on function public.is_director_general() from anon;
revoke execute on function public.current_admin_establishment() from anon;
revoke execute on function public.current_admin_role() from anon;
revoke execute on function public.has_establishment_access(uuid) from anon;
revoke execute on function public.has_class_access(uuid) from anon;
revoke execute on function public.has_student_access(uuid) from anon;
revoke execute on function public.has_teacher_access(uuid) from anon;