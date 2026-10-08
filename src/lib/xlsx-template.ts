/**
 * MODELES DE BULLETIN EXCEL — lecture, detection des zones, remplissage.
 *
 * Politique stricte (périodique) :
 * - Champs identité / stats : UNIQUEMENT balises [token] ou {token}
 *   ([prenom], [nom], [classe], [effectif], [rang], [date], [premier]…).
 *   Aucun libellé en texte libre (« Moyen Général », « Prénom : »…) n'est
 *   une cible d'écriture.
 * - Colonnes notes : balises [eval], [compo], [moy]… en priorité ;
 *   sinon détection par libellés d'en-tête (structure de grille uniquement).
 * - Toute valeur calculée (moyenne matière, MG, appréciation…) vient
 *   EXCLUSIVEMENT des formules Excel du modèle.
 */
