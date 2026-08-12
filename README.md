# Les Élites Admin

Construis maintenant l’application web complète « Les Élites de Gao – Administration », une application interne de gestion administrative pour UN SEUL complexe scolaire au Mali, « Les Élites de Gao ». Ne crée PAS une architecture multi-tenant/SaaS : il existe un seul complexe, avec quatre établissements possibles : Université, Lycée, Collège et Fondamentale. L’application doit être une PWA offline-first : elle doit rester utilisable sans connexion pour les opérations et consultations déjà synchronisées, mettre les changements locaux en file d’attente et les synchroniser automatiquement avec Supabase dès que la connexion revient. Utilise React + TypeScript + Tailwind + shadcn/ui, architecture propre et modulaire, et Supabase Auth/PostgreSQL comme backend. IMPORTANT : le projet Supabase existe déjà et doit être utilisé, référence gxsdbmbynplatmxrpkkj, URL https://gxsdbmbynplatmxrpkkj.supabase.co. Ne recrée pas une base parallèle et ne remplace pas le schéma existant. Respecte strictement les tables, relations, contraintes et RLS déjà présents dans Supabase. Commence par inspecter la structure Supabase et adapte l’application à celle-ci.

OBJECTIF PRODUIT
Créer une application d’administration professionnelle permettant au Directeur Général et au Personnel administratif de gérer tout le complexe : établissements, années académiques, classes, élèves, inscriptions/transferts, matières et règles de notation, évaluations, notes/résultats, enseignants, affectations, heures/séances, rémunérations et paiements des enseignants, plans de scolarité, paiements échelonnés des élèves, personnel administratif, invitations et journal d’audit.

RÔLES ET ACCÈS
1. Directeur Général : accès global à tous les établissements et toutes les données. Peut créer/modifier/supprimer établissements, classes, élèves, enseignants, configurations, paiements et personnel administratif. Les actions critiques comme suppression d’établissement doivent demander une confirmation explicite avec résumé de l’impact.
2. Personnel administratif : est invité par le Directeur Général et assigné à UN SEUL établissement. Après invitation, il renseigne nom, prénom, téléphone et crée son mot de passe via une page dédiée. Ensuite il ne peut voir/modifier que les données de son établissement. Ne contourne jamais les RLS Supabase côté client.
3. Pas de page d’inscription publique. La connexion doit proposer deux choix visuels : « Directeur Général » et « Personnel administratif ». Le DG est un compte système préconfiguré. Pour le premier démarrage, le mot de passe initial demandé est « Gao 2026 ». Après première connexion, force le DG à définir un nouveau mot de passe dans « Mon compte » et ne stocke jamais le mot de passe en clair dans le code ou la base. Utilise Supabase Auth pour l’authentification. Si le compte DG n’existe pas encore dans Auth, prévois le flux sécurisé nécessaire pour son initialisation plutôt que d’exposer des secrets côté frontend.

STRUCTURE DES DONNÉES À RESPECTER
- establishments : établissement, type université/lycée/collège/fondamentale, coordonnées, actif.
- academic_years : années académiques et année active.
- classes : établissement + année académique + nom/niveau/section.
- students : identité de l’élève, matricule, coordonnées, tuteur, statut.
- student_enrollments : historique établissement/classe/année, avec transferts.
- subjects : matières.
- class_subject_configs : matière par classe, coefficient, barème, méthode de calcul.
- assessment_types : types d’évaluation configurables et pondération.
- assessments : évaluations.
- grades : notes par élève et évaluation.
- teachers : identité et domaines/spécialités.
- teacher_assignments : enseignant ↔ établissement ↔ classe ↔ matière ↔ année, avec type de rémunération et tarif éventuel.
- teacher_work_logs : heures/séances réellement effectuées, validation et statut.
- teacher_payments : paiements réellement effectués.
- tuition_plans : plans de scolarité par établissement/année/classe, montant total.
- student_tuition : montant dû par élève et statut.
- student_payments : paiements échelonnés avec reçu/référence.
- admin_profiles : profils DG/personnel administratif avec établissement assigné.
- invitations : invitations du personnel.
- audit_logs : journal des actions importantes.

NOTES ET RÉSULTATS — TRÈS IMPORTANT
Ne suppose jamais que toutes les classes utilisent le même système de notation. Les coefficients, barèmes, types d’évaluation, pondérations et méthodes de calcul peuvent varier selon les établissements et les classes. Construis une interface « Configuration pédagogique » permettant de configurer ces règles par classe. Les moyennes doivent être calculées dynamiquement à partir des configurations enregistrées. Prévois une architecture extensible pour ajouter plus tard d’autres méthodes de calcul sans casser les données existantes. Affiche clairement la moyenne par matière, moyenne générale, rang si applicable, appréciations et résultats par période. Ne code pas en dur une moyenne sur 20.

PAIEMENT DES ENSEIGNANTS — TRÈS IMPORTANT
Les professeurs peuvent être payés à l’heure et les montants peuvent varier. Ne mets jamais un salaire fixe obligatoire. L’affectation doit permettre de définir le type de rémunération et éventuellement un tarif. Les heures/séances réellement travaillées sont enregistrées dans teacher_work_logs, peuvent être approuvées, puis servent à préparer le paiement. teacher_payments représente uniquement les paiements réellement effectués. Affiche : heures/séances réalisées, montant théorique, montant déjà payé, solde éventuel et historique.

SCOLARITÉ
Permets de définir des plans de scolarité, un montant dû par élève et plusieurs paiements échelonnés. Affiche montant total, montant payé, reste à payer, pourcentage payé et historique des transactions. Prévois reçus imprimables/téléchargeables. Les montants doivent être en FCFA/XOF.

PAGES ET NAVIGATION À CONSTRUIRE
A. Authentification
- Écran de connexion premium avec choix DG / Personnel administratif.
- Connexion par Supabase Auth.
- Flux d’invitation du personnel avec token sécurisé.
- Page première configuration du compte DG.
- Page première activation du compte invité.
- Mot de passe oublié/changement de mot de passe.

B. Layout principal
- Sidebar desktop élégante et collapsible.
- Bottom navigation adaptée mobile/PWA.
- Header avec recherche globale, notifications, année académique active, établissement courant pour le personnel administratif, profil.
- Breadcrumbs.
- Command palette avec raccourci clavier.

C. Dashboard DG
- Vue globale du complexe.
- Cartes KPI : établissements actifs, élèves, enseignants, classes, scolarité encaissée, reste à recouvrer, paiements enseignants, etc.
- Graphiques élégants et lisibles.
- Activité récente / audit.
- Alertes : impayés importants, paiements enseignants à traiter, classes sans configuration, etc.

D. Dashboard personnel administratif
- Même philosophie mais uniquement pour son établissement.
- KPI locaux et activité locale.

E. Établissements
- Liste, recherche, filtres.
- Création/modification.
- Fiche détaillée d’un établissement avec statistiques.
- Suppression avec confirmation renforcée et affichage des dépendances.

F. Années académiques
- Liste et création.
- Activation d’une année.
- Vue de transition entre années.

G. Classes
- Liste par établissement et année.
- Création/modification/suppression.
- Fiche classe : élèves, enseignants, matières, résultats, statistiques.

H. Élèves
- Liste avec recherche instantanée, filtres établissement/classe/statut.
- Création/modification.
- Profil élève complet.
- Historique scolaire.
- Inscription annuelle.
- Transfert de classe et transfert d’établissement avec confirmation et motif.
- Scolarité et paiements.
- Notes/résultats.
- Impression d’une fiche élève et reçu.

I. Enseignants
- Liste et recherche.
- Profil enseignant.
- Établissements où il intervient.
- Classes et matières.
- Affectations.
- Heures/séances.
- Paiements et solde.

J. Configuration pédagogique
- Matières.
- Matières d’une classe.
- Coefficients.
- Barèmes.
- Types d’évaluations et pondérations.
- Méthode de calcul.
- Prévisualisation d’un calcul de moyenne avant validation.

K. Notes & résultats
- Sélection établissement → année → classe → matière → évaluation.
- Saisie rapide des notes façon tableau.
- Validation et détection d’erreurs.
- Calcul dynamique des moyennes.
- Bulletins/résultats imprimables.
- Historique des résultats.

L. Scolarité
- Plans tarifaires.
- Élèves et montants dus.
- Encaissements.
- Paiements partiels.
- Reçus.
- Impayés et relances/alertes.
- Historique financier.

M. Paiement des enseignants
- Affectations.
- Saisie/validation des heures ou séances.
- Calcul du montant dû selon la configuration.
- Paiements effectués.
- Historique.
- États mensuels/périodiques.

N. Personnel administratif
- Réservé au DG.
- Liste du personnel.
- Invitation par établissement.
- Statut de l’invitation.
- Activation/désactivation.
- Révocation d’accès.

O. Mon compte
- Nom, prénom, téléphone.
- Changement de mot de passe.
- Informations du compte.
- Pour le DG : compte « Awdou Moussa MAYGA » à afficher comme identité initiale.

P. Audit & paramètres
- Journal des actions sensibles.
- Filtres par utilisateur, établissement, action et date.
- Paramètres généraux du complexe.

DESIGN UI/UX — EXIGENCES FORTES
Je veux un design premium digne d’un logiciel SaaS moderne utilisé par une grande institution éducative, mais adapté à une administration scolaire africaine. Palette principale : bleu premium profond, avec surfaces claires, blanc cassé, nuances de bleu et accents subtils. Évite le rendu générique « dashboard template ».
- Interface très épurée, beaucoup d’espace, hiérarchie visuelle forte.
- Typography moderne et excellente lisibilité.
- Cartes élégantes avec bordures fines, ombres très légères et profondeur maîtrisée.
- Boutons avec micro-interactions : hover, press, focus, loading.
- Animations fluides et professionnelles : transitions de pages, apparition progressive des cartes, skeleton loaders, dropdowns, modales, feedback de succès/erreur.
- Utilise des animations subtiles, jamais excessives ni gênantes.
- Graphiques modernes.
- Tables professionnelles avec tri, recherche, filtres, pagination et actions contextuelles.
- Drawer/modal pour les détails et formulaires lorsque pertinent.
- Toasts élégants.
- États vides soignés.
- États loading/error/offline très explicites.
- Responsive mobile/tablette/desktop.
- PWA installable avec manifest, service worker et stratégie offline-first adaptée.
- Afficher un indicateur discret « Hors connexion / Synchronisation / Synchronisé ».
- Prévoir une file d’attente locale des mutations et une résolution de conflits raisonnable.
- Accessibilité correcte : focus visible, labels, contrastes, navigation clavier.

IMPORTANT POUR L’ARCHITECTURE
- Ne mets aucune clé secrète Supabase dans le frontend.
- Utilise les variables d’environnement publiques appropriées pour Supabase.
- Ne contourne jamais RLS.
- Ne désactive jamais RLS.
- Ne recrée pas les tables existantes.
- N’utilise pas une base locale comme source de vérité permanente : IndexedDB est un cache/offline store, Supabase reste la source de vérité dès que la connexion est disponible.
- Centralise les types TypeScript correspondant au schéma Supabase.
- Sépare clairement composants UI, pages, services Supabase, logique métier, offline store et calculs de résultats.
- Ajoute des validations côté formulaire et gère proprement les erreurs Supabase.
- Les suppressions doivent être confirmées et idéalement utiliser des confirmations renforcées pour les données sensibles.

COMMENCE PAR
1. Inspecter la base Supabase existante et ses RLS.
2. Configurer Supabase Auth correctement.
3. Mettre en place l’architecture React/TypeScript.
4. Créer le design system premium bleu et les composants réutilisables.
5. Construire l’authentification et le shell de l’application.
6. Construire ensuite les dashboards puis les modules métier.
7. Implémenter le mode offline-first PWA.
8. Tester les principaux parcours et corriger les erreurs TypeScript/runtime.
9. Ne fais pas une simple maquette : construis une vraie application fonctionnelle connectée à Supabase.

Le nom affiché de l’application est « Les Élites de Gao ». Le ton doit être professionnel, institutionnel, moderne et simple. Toute l’interface est en français. Les dates et montants doivent être adaptés au contexte malien, devise FCFA/XOF.

IMPORTANT : ne te contente pas de me décrire ce que tu vas faire. Implémente directement l’application et vérifie le résultat dans le preview. Si une décision technique est nécessaire, privilégie la robustesse, la sécurité Supabase, l’UX et la cohérence avec le schéma existant.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/2cabf4ce-16ac-4da4-bb47-38e7e73b1945).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
