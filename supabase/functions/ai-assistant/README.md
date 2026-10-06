# ai-assistant (Lot1 + Lot2 + Lot3)

Edge Function Gemini Function Calling pour Les Élites de Gao.

## Outils (34)

### Lecture
list_capabilities, get_complex_overview, list_students, search, list_classes, list_teachers,
get_class_statistics, rank_students, list_audit_logs, list_periods, get_student_grades,
check_grades_completeness, get_teacher_schedule, list_student_documents

### Écriture (HMAC confirm_token)
upsert_grade, delete_grade, open_period, close_period,
create_class, update_class, add_class_subject, remove_class_subject,
create_teacher, update_teacher, archive_teacher, delete_teacher_complete,
add_teacher_session, delete_teacher_session,
create_student, update_student, archive_student, unarchive_student, transfer_student,
generate_class_bulletins

## Secrets
- GEMINI_API_KEY (requis)
- CONFIRM_SECRET (optionnel, sinon SUPABASE_ANON_KEY)

## Déploiement
Coller le fichier `ai-assistant-LOT3-READY.ts` dans le Dashboard Edge Function puis Deploy.
Source de vérité runtime = déploiement Supabase.
