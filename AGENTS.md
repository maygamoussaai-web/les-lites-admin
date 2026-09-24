<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->


# Les Élites Admin — contexte pour agents IA

## Stack verrouillée (ne pas changer sans demande explicite)
- Frontend : TanStack Start / Router, React, TypeScript, Tailwind, shadcn/ui
- Backend data : Supabase (Postgres + Auth + Storage)
- Bulletins : modèles Excel (.xlsx) par classe, SheetJS (xlsx) en writeback
- Déploiement : Lovable (ne jamais force-push / rebase l’historique publié)

## Règles métier critiques
1. **Vérité UI** : jamais de message de succès sans fichier réel en Storage + lien document.
2. **Formules Excel** : l’app n’écrit que les cellules d’entrée (notes, balises) ; ne pas écraser les formules.
3. **Périodes** : 3 fins de période uniquement — bouton Nouvelle période, génération bulletins classe, renouvellement/suppression classe (avec règles notes sans bulletin).
4. **Types de notes** : `evaluation` | `composition` — libellés UI = en-têtes du modèle Excel (`natureLabels`).
5. **Bibliothèque élève** : documents groupés par classe, horodatés, œil = visionner, télécharger séparé ; purger orphelins « Fichier manquant ».
6. **Modèles** : import **par classe**, kind `period` | `annual`, mapping colonnes + balises.

## Workflow agent (vibecoding production)
- Changements **incrémentaux** ; un commit = un objectif vérifiable.
- **Lire** le fichier cible avant d’éditer ; ne pas réécrire un module entier pour un fix local.
- Après push GitHub : **vérifier** taille/contenu du fichier distant (éviter placeholders/troncatures).
- Ne pas inventer de succès : si non pushé / non testé, le dire.
- Préférer optimiser (cache, import dynamique, mapping) plutôt que refondre l’architecture.
- Sécurité : pas de secrets en clair ; RLS Supabase respectées ; mots de passe avec toggle œil.

## Performance déjà en place
- React Query : `staleTime` 180s, `refetchOnWindowFocus: false`, cache persisté 7 jours
- `useRows` : `placeholderData` + `structuralSharing`
- Prévisualisation Excel : import dynamique de `xlsx` (éviter poids initial)

## Ce qu’il ne faut PAS faire
- Réécrire class-page / bulletin pipeline « pour nettoyer » sans bug précis
- Ajouter des dépendances non demandées
- Changer le stack (Next, Firebase, etc.)
- Prétendre qu’une génération a réussi sans fichier en bibliothèque
