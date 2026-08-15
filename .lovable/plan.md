# Corriger les invitations et la suppression des professeurs

## Résultat attendu
- Les nouveaux liens d’invitation sont valides et peuvent être copiés immédiatement.
- La liste des invitations en attente propose de générer à nouveau un lien lorsqu’il n’est plus disponible.
- Supprimer un professeur efface sa fiche, ses affectations, séances et paiements afin qu’aucun montant sans nom ne reste affiché.

## Mise en œuvre
1. Déplacer la création et la validation des invitations dans des fonctions serveur sécurisées, avec contrôle du rôle Directeur Général et messages d’erreur précis.
2. Ajouter dans Personnel les actions copier, renouveler et révoquer pour les invitations en attente, sans stocker le jeton secret en clair dans la base.
3. Remplacer l’archivage des professeurs par une suppression définitive côté serveur, transactionnelle en base grâce aux suppressions en cascade.
4. Filtrer les affectations et paiements sur les professeurs actifs dans toutes les statistiques et vues, pour neutraliser aussi les anciennes données incohérentes.
5. Vérifier les flux dans l’application et contrôler qu’aucune affectation ni paiement orphelin ne reste.

## Détails techniques
- Les fonctions serveur protégées utiliseront la session Supabase et vérifieront le rôle en base.
- Le jeton d’invitation restera uniquement visible au moment de sa création ou de son renouvellement ; seul son hash sera conservé.
- Une migration ajoutera une fonction SQL atomique de suppression complète, autorisée uniquement au Directeur Général.
