# Pronostics du jour : consensus presse et cotes

Le pipeline hippique utilise uniquement le PDF de la course du jour. Les anciens
scripts historiques sont conservés, mais ne sont plus appelés par ce pipeline.
Aucune migration ni import historique n'est nécessaire.

## Calcul, version consensus_v1

- Chaque partenaire donne 5, 4, 3, 2 et 1 points à ses cinq premiers partants.
  Les non-partants sont retirés avant d'attribuer les points. Chaque source compte
  une seule fois ; deux versions contradictoires de la même source sont refusées.
- Chaque colonne complète de cotes (Paris Turf, Tiercé Magazine) donne les mêmes
  points aux cinq plus petites cotes. Les ex aequo partagent les points des rangs
  occupés, y compris si le groupe dépasse le cinquième rang.
- Une colonne incomplète est écartée et les colonnes utilisées sont affichées.
  Il faut au moins une colonne complète, deux partenaires et sept partants.
- Les deux totaux sont ramenés sur 100 : presse / (5 × nombre de partenaires),
  cotes / (5 × nombre de colonnes), puis multipliés par 100.
- Score cheval = 70 % presse + 30 % cotes. En cas d'égalité : score presse,
  cote décimale moyenne croissante, puis numéro croissant.
- Les sept premiers sont retenus. On énumère les groupes sans répétition de
  trois (tiercé), quatre (quarté) ou cinq chevaux (quinté et 4+1).
- Les groupes sont classés par somme des scores de leurs chevaux. On conserve
  vingt groupes (sur 35, 35 ou 21). L'ordre affiché est l'ordre de préférence,
  pas une prédiction probabiliste de l'ordre exact d'arrivée.
- Le score affiché d'un groupe est la moyenne des scores de ses chevaux, sur 100.
  Aucun de ces scores n'est une probabilité de réussite.

## Extraction et stockage

Les cotes et les listes des partenaires sont extraites directement du texte de
la section CHEVAUX du PDF. Le LLM extrait les métadonnées de la course, les noms
complets et les mentions explicites de non-partants. Il ne décide pas des sélections.
Le pipeline refuse les dates incorrectes et les données incohérentes. Un échec
de régénération conserve le pronostic précédent ; un pronostic déjà lié à une
arrivée ne peut pas être remplacé.

Les vingt groupes sont stockés dans le champ JSON proposals existant. Le premier
conserve l'identifiant prono_du_jour, utilisé pour le SMS. Il contient aussi la
sélection des sept chevaux, les scores détaillés, les listes sources et la version
du calcul. Les anciens pronostics restent lisibles avec leur ancienne confiance.
Les résultats comparent les groupes à l'arrivée en désordre, en excluant les
arrivées incomplètes des taux. Aucun envoi de SMS n'est déclenché par la génération.

## Vérification locale sans API ni base

Depuis la racine du projet, avec les dépendances Python installées :

    py -3.12 -B -m unittest discover -s ai-engine/tests -v
    node --test backend/tests/hippique.test.cjs

Les tests couvrent le programme de référence du 31 juillet 2026, les groupes
distincts, les non-partants, les ex aequo, les données manquantes, l'extraction,
le pipeline simulé, le format des SMS et la comparaison des arrivées.
Les PDF présents dans le cache local sont également vérifiés lorsqu'ils existent.
Ces vérifications portent sur le calcul ; elles ne prouvent pas sa performance
prédictive, qui doit être mesurée sur des courses ultérieures.
