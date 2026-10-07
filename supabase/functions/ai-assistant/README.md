# ai-assistant (Lot1–Lot5 + protocole)

> **Production** = code collé dans le Dashboard Supabase.
> `index.ts` du repo est un stub volontaire : ne pas auto-déployer depuis GitHub.

## Lot 5 (ajout)

enroll_student, end_enrollment, get_teacher, list_teacher_sessions,
update_teacher_session, get_student_bulletin, get_class_bulletins,
delete_tuition_payment, delete_teacher_payment, mark_session_completed,
list_session_completions, create_fee_plan, update_fee_plan,
list_fee_plan_installments, get_establishment, update_establishment,
list_student_transfers, assign_teacher, unassign_teacher,
list_teacher_assignments, search_grades, export_class_roster

## Perfs (Lot5)
- Historique : 12 messages (au lieu de 20)
- Rounds Gemini : 5 max (au lieu de 8)
- Modèle : flash-lite uniquement (plus rapide)
- Réponses courtes demandées dans le SYSTEM

## Protocole confirmation
pendingByUser + détection « oui / je confirme / vas-y » → exécution directe.

## Déploiement
1. Coller `ai-assistant-LOT5-READY.ts` (artefact chat) dans Edge Function
2. Deploy
3. Verify JWT = ON

## Background / app fermée
Une Edge Function s’arrête si le client coupe la requête. Pour continuer
en arrière-plan il faudrait une file d’attente (hors scope actuel).
Gardez l’app ouverte jusqu’à la réponse, ou augmentez le timeout frontend.
