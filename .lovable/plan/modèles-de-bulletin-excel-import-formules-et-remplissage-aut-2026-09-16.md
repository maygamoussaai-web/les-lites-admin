# Modèles de bulletin Excel : import, formules et remplissage automatique

## Réponse courte à votre question

Oui, c'est possible **sans IA externe** (pas besoin de Gemini).

Un fichier Excel n'est pas une image : l'application peut lire sa structure exacte — chaque case, chaque titre de colonne, chaque formule déjà écrite dedans. Elle peut donc :
- repérer où se trouvent les matières, les colonnes de notes, les cases « nom », « moyenne générale », « rang », « effectif », etc.
- reprendre les formules **telles que vous les avez écrites dans le fichier** et les appliquer élève par élève ;
- accepter des modèles différents d'une classe à l'autre, puisque chaque modèle est analysé séparément.

La seule chose qu'une IA ferait en plus : deviner un modèle très inhabituel sans aucune confirmation de votre part. On remplace ça par un **écran de vérification** affiché une seule fois par modèle : l'app propose sa lecture du fichier, vous confirmez ou corrigez, et c'est mémorisé pour toujours. C'est plus fiable, gratuit, et ça fonctionne hors ligne.

## Ce qui sera construit

### 1. Bibliothèque de modèles (par classe)
- Nouvelle page « Modèles de bulletin » accessible depuis la fiche de classe.
- Import d'un fichier Excel (.xlsx) → stocké dans Supabase, rattaché à une classe.
- Un modèle peut être réutilisé par plusieurs classes ; on peut en avoir plusieurs et choisir l'actif.

### 2. Analyse automatique à l'import
À l'import, l'app lit le fichier et détecte :
- le **tableau des matières** (colonne des libellés + première ligne de données) ;
- les **colonnes** et leur rôle, à partir de leur intitulé (note de composition, notes d'évaluation, moyenne, coefficient, rang, appréciation, professeur…) ;
- les **cases d'en-tête / pied** : nom de l'élève, classe, période, effectif, moyenne générale, moyenne du premier, moyenne du dernier, moyenne de classe, moyenne de composition ;
- le **barème / note maximale** (lu dans le fichier s'il y figure, sinon saisi une fois) ;
- les **formules déjà présentes** dans les cellules.

### 3. Écran de vérification du modèle
Aperçu du modèle avec, pour chaque zone détectée, une étiquette modifiable par menu déroulant (« cette colonne = notes de composition », « cette case = rang », …). Les zones non reconnues sont signalées. Validation → la correspondance est enregistrée avec le modèle.

### 4. Formules
- Les formules écrites dans le fichier Excel sont reprises et recalculées pour chaque élève (opérations, MOYENNE/SOMME/MIN/MAX/ARRONDI, SI imbriqués pour les appréciations, RANG).
- Plusieurs formules différentes par modèle et par colonne : chaque colonne garde la sienne.
- Si une formule utilise une fonction non gérée, elle est signalée à l'import (et non silencieusement ignorée) ; on pourra alors la saisir dans l'app pour ce modèle.
- Les moyennes de synthèse (moyenne de classe sur les évaluations seules, moyenne de composition sur les compositions seules, rang, effectif, moyennes du premier/dernier) proviennent des calculs déjà existants du projet — source unique de vérité, pas de recalcul parallèle.

### 5. Génération
Le parcours « Créer les bulletins » déjà en place ne change pas : élèves par ordre alphabétique, prévisualisation, avertissements en cas de note manquante, « Modifier les notes », « Valider ». Ce qui change : la prévisualisation reproduit **votre modèle Excel** (mise en page, titres, tableau, en-têtes) et non le modèle provisoire actuel. Le bulletin validé est produit en **PDF** et archivé dans les documents de l'élève, comme aujourd'hui.

## Détails techniques

- Lecture .xlsx côté navigateur avec SheetJS (`xlsx`) : valeurs, formules (`f`), fusions, largeurs de colonnes, styles de base. Une seule dépendance ajoutée.
- Nouvelle table `report_templates` (id, establishment_id, class_id nullable, name, storage_path, mapping jsonb, scale, is_active) + bucket de stockage des fichiers modèles ; RLS via `has_establishment_access`, avec GRANTs.
- `mapping` jsonb = zones détectées/confirmées (adresse de cellule ou de colonne → rôle) + formules par colonne. Format versionné pour évoluer sans casser les modèles existants.
- Petit évaluateur de formules interne (`src/lib/xlsx-formula.ts`) : résolution des références A1/plages sur la grille remplie, fonctions arithmétiques + MOYENNE/SUM/IF/MIN/MAX/ROUND/RANK et leurs équivalents français. Toute fonction inconnue remonte un avertissement.
- Rendu : la grille remplie est dessinée sur canvas (réutilisation de `drawReportCard`, refondu en moteur générique piloté par le modèle) puis convertie en PDF via `canvasToPdfBlob` — aucune nouvelle dépendance PDF.
- `src/lib/report-card.ts` conserve ses types `ReportCardData` / `ReportRow` (contrat existant) ; `src/lib/grades.ts` reste la seule source des moyennes. Commentaires « NOTE POUR CLAUDE » sur les points de reprise.

## Ordre de réalisation

1. Table, bucket et RLS des modèles.
2. Import + lecture du .xlsx, détection automatique des zones.
3. Écran de vérification / correction de la correspondance.
4. Évaluateur de formules et remplissage d'un bulletin.
5. Branchement au parcours « Créer les bulletins » + PDF dans les documents de l'élève.
6. Tests avec un vrai modèle.

## Ce qu'il me faut de votre côté

Un **modèle Excel réel** d'une classe, dès que possible : la détection sera calibrée dessus. Sans lui, je construis la mécanique sur des intitulés supposés et il faudra l'ajuster ensuite.
