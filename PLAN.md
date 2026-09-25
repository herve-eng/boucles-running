# Étude de faisabilité et plan : app de parcours de course en boucle (PWA)

## Contexte
Nouveau projet, on part de zéro. L'app doit générer sur téléphone des **boucles de course** à partir de trois données : la ville, le point de départ et la distance voulue en km. Elle doit privilégier les **zones où l'on court beaucoup**, les **parcours existants** et les **chemins agréables** (parcs, bords d'eau, peu de voitures).

Choix déjà faits :
- **PWA** : une app web installable sur le téléphone, sans passer par les stores
- **boucles uniquement**
- **usage perso / petit cercle**
- **aucune clé d'API ni compte à créer** : on n'utilise que des services publics ouverts, sans inscription

Cette phase sert à évaluer ce qui est possible et à planifier. On ne code pas encore.

## 1. Les services gratuits retenus (sans clé)

| Besoin | Choix | Conditions |
|---|---|---|
| Calcul d'itinéraire à pied | **Valhalla** sur le serveur public FOSSGIS (`valhalla1.openstreetmap.de`), profil `pedestrian` | Sans clé, en usage raisonnable. Quota non publié. En-tête `X-Client-Id` demandé. Pas de mode boucle intégré : on construit la boucle nous-mêmes (voir §2). |
| Secours pour l'itinéraire | **OSRM à pied** sur `routing.openstreetmap.de` | Sans clé, en usage raisonnable. |
| Données « chemins agréables » et parcours existants | **Overpass API** (données OpenStreetMap) | Sans clé. Environ 10 000 req/jour par IP. Mettre en cache. |
| Recherche de ville / adresse | **Photon** (komoot) pour l'autocomplétion, **Nominatim** en secours pour une recherche validée | Sans clé. Nominatim : 1 req/s maximum et pas d'autocomplétion. |
| Fond de carte | **MapLibre GL JS** avec les tuiles **OpenFreeMap** | Sans clé ni quota. Attribution obligatoire. |
| Dénivelé | Valhalla `/height`, sinon l'API d'altitude **Open-Meteo** | Sans clé. À vérifier en phase 0 : `/height` est-il actif sur le serveur FOSSGIS ? |
| Position de l'utilisateur | API Geolocation du navigateur | Gratuite. |

**Plus tard, si besoin :** OpenRouteService, qui a un mode boucle intégré (`round_trip`), avec une clé gratuite. Uniquement si les serveurs publics ne suffisent pas.

### Ce qui n'est PAS faisable (et pourquoi)
- **Strava** : depuis juin 2026, le contrat interdit d'afficher les données d'autres athlètes et d'agréger des données géographiques. La heatmap n'est pas disponible via l'API et Segment Explore est réservé aux partenaires. Strava est donc **exclu**.
- **Komoot, Wikiloc, OpenRunner** : aucune API publique.
- **Traces GPS publiques d'OSM** : couverture faible et points désordonnés. La politique de l'API déconseille ce genre d'usage en lecture seule. Au mieux, ce serait un bonus expérimental pour plus tard.

**Conséquence :** aucune source libre ne fournit une vraie « heatmap des coureurs ». On **approche la popularité** avec les données OpenStreetMap :
- **Parcours existants :**
  - relations `route=running`, `route=fitness_trail` et `route=foot` / `hiking`
  - pistes d'athlétisme `leisure=track`
  - parcours sportifs `leisure=fitness_station`
- **Zones populaires (approximation) :**
  - parcs `leisure=park`
  - bois et forêts `landuse=forest` / `natural=wood`
  - berges : `waterway=river`, `natural=water` et les chemins qui les longent
- **Qualité du chemin :**
  - voies piétonnes et cyclables : `highway=footway|path|track|pedestrian|cycleway`
  - éclairage : `lit=yes`
  - on pénalise `highway=primary|secondary|trunk` et les nombreux croisements

## 2. Principe de génération d'une boucle (construite par nous)

1. **Entrée** : ville et point de départ (adresse, clic sur la carte ou GPS), plus la distance D.
2. **Contexte OSM** : une seule requête Overpass sur la zone autour du départ (rayon ≈ D/π + marge). Elle récupère les parcs, les bois, l'eau, les parcours existants, les grands axes et les voies piétonnes. Le résultat est mis en cache par zone.
3. **Points de passage** : on place 3 ou 4 points sur un cercle qui passe par le départ.
   - Rayon de départ : r ≈ D / (2π × 1,3). Le facteur 1,3 compense les détours du réseau de rues.
   - On fait tourner le cercle d'un angle au hasard pour obtenir des variantes.
   - **Aimantation vers les lieux agréables** : chaque point est déplacé vers le parc, le bois, la berge ou le parcours existant le plus proche, dans une limite de 0,3 × r environ.
4. **Itinéraire** : un appel Valhalla `pedestrian` pour le trajet départ → P1 → P2 → P3 (→ P4) → départ.
   - Réglages qui favorisent les chemins : `walkway_factor` bas, et `use_lit` pour l'option « éclairé ».
   - Si Valhalla ne répond pas, repli sur OSRM à pied.
5. **Correction de distance** : si l'écart dépasse 5 %, on relance avec r × D / distance_obtenue, 3 itérations au maximum.
6. **Candidats** : on répète les étapes 3 à 5 avec 6 à 8 orientations ou nombres de points différents. On espace les appels (environ 1 par seconde) pour rester raisonnable envers les serveurs publics.
7. **Score** de chaque candidat, sur ce qu'il y a à moins de 30 m du tracé (calculs avec Turf.js) :
   - bonus pour la part du tracé dans un parc, un bois ou le long de l'eau
   - bonus pour la part du tracé sur un parcours existant ou une voie piétonne
   - malus pour la part du tracé sur un grand axe
   - **malus fort pour les recouvrements** : les allers-retours sur la même rue sont un risque plus fréquent quand on construit la boucle nous-mêmes
   - malus pour l'écart à la distance voulue
8. **Résultat** : les 3 meilleures boucles, avec la distance, le dénivelé et les raisons du score (« 60 % en parc, longe la Seine »).
9. **Complément « parcours existants »** : si une relation `route=running` ou `fitness_trail` se trouve près du départ et a une longueur proche de D, on la propose directement comme option.

## 3. Architecture

- **Front** : Vite + TypeScript + React (ou Svelte), MapLibre GL, Turf.js, et `vite-plugin-pwa` pour le manifeste, le service worker et l'installation.
- **Pas de backend obligatoire**, puisqu'il n'y a aucune clé à cacher. Les appels partent directement du navigateur vers Valhalla, Overpass et Photon.
  - En option plus tard : un Cloudflare Worker gratuit, pour mettre les réponses en cache et limiter le débit si plusieurs personnes utilisent l'app.
- **Stockage local** : IndexedDB pour les favoris, l'historique et le cache Overpass. Pas de comptes utilisateurs.
- **Export GPX** du parcours, pour le charger dans une montre ou dans Strava.
- **Hébergement** : Cloudflare Pages ou GitHub Pages, tous deux gratuits.

## 4. Feuille de route

**Phase 0 : preuve de concept (quelques heures)**
- Un script Node ou une page HTML unique. Pour des départs à Paris et à Bruxelles, elle :
  1. interroge Overpass ;
  2. place et aimante les points de passage ;
  3. calcule les itinéraires avec Valhalla ;
  4. affiche les candidats et leur score sur une carte.
- Validation :
  - écart de distance ;
  - nombre d'itérations et temps de réponse ;
  - taux de recouvrement ;
  - qualité perçue des boucles ;
  - disponibilité de `/height` sur le serveur FOSSGIS.

**Phase 1 : MVP de la PWA**
- Recherche de ville et d'adresse (Photon), choix du départ par GPS ou par clic sur la carte, curseur de distance.
- Génération de la boucle (cercle, Valhalla, correction de distance) et affichage de la meilleure sur la carte.
- Installation sur l'écran d'accueil.

**Phase 2 : « inspiration »**
- Aimantation vers les lieux agréables, scoring, 3 propositions avec leurs explications.
- Détection des parcours existants proches.
- Préférences : « plutôt nature », « plutôt éclairé », « éviter les routes ».

**Phase 3 : confort**
- Export GPX, favoris, profil de dénivelé, suivi de la position pendant la course.
- Option expérimentale : densité des traces GPS OSM comme signal de popularité.

## 5. Risques et points à vérifier
- **Serveurs publics sans garantie** (Valhalla FOSSGIS, OSRM, Overpass, Photon) : ils peuvent être lents, limités ou indisponibles. Parades : cache, espacement des appels, repli OSRM, puis repli sur OpenRouteService (avec clé) si ça ne suffit vraiment pas.
- **Boucles en « étoile » ou avec allers-retours** quand un point de passage tombe dans une impasse. Parades : malus de recouvrement, aimantation des points vers des chemins accessibles, tirage de nouveaux candidats.
- **Nombre d'appels** : 6 à 8 candidats × 1 à 3 itérations, soit environ 10 à 25 appels Valhalla par génération. C'est acceptable pour un usage perso, mais on espace les appels.
- Toujours afficher les attributions obligatoires : OSM, OpenFreeMap, Valhalla/FOSSGIS.

## 6. Vérification (une fois le code écrit)
- **Villes de test : Bruxelles et Paris**, avec D = 5, 10 et 21 km. On vise un écart de distance ≤ 5 %, une génération en moins de 15 s et un recouvrement inférieur à 10 %.
  - Paris : départs Place de la République (très urbain), bords de Seine près du pont de Bir-Hakeim (berges), et près du Bois de Vincennes (Porte Dorée).
  - Bruxelles : départs Grand-Place (centre dense et pavé), parc du Cinquantenaire, et près de la forêt de Soignes / bois de la Cambre.
  - Contrôle attendu : les boucles notées en tête passent par les bois, les berges et les parcs. Côté Bruxelles, on vérifie aussi que Photon gère bien les adresses bilingues FR/NL.
- Vérifier à l'œil sur la carte que la boucle choisie passe bien par les parcs et les berges proches.
- Installer la PWA sur iPhone et sur Android, et tester le GPS et l'export GPX.
- Faire vraiment une course sur un parcours généré.
