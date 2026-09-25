# Boucles

Application web pour téléphone (PWA) qui propose des **boucles de course à pied** de la distance voulue, depuis un point de départ, en privilégiant les parcs, les bois et les bords de l'eau. Export GPX pour Garmin (et Strava, Komoot…).

Tout est gratuit et sans clé d'API : les calculs se font dans le téléphone, qui interroge directement des services publics basés sur OpenStreetMap.

## Utiliser l'app en local

```bash
npm install
npm run dev
```

- Sur l'ordinateur : http://localhost:5173/boucles-running/
- Sur le téléphone (même wifi) : l'adresse « Network » affichée par `npm run dev`.
  « Ma position », le suivi pendant la course et l'installation sur l'écran d'accueil demandent une adresse `https://` : ils ne fonctionneront qu'une fois l'app en ligne.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Lance l'app en développement |
| `npm run build` | Vérifie les types et construit l'app dans `dist/` |
| `npm run preview` | Sert la version construite |
| `npm test` | Tests automatiques (moteur, export GPX) |
| `npm run poc` | Tests réels Paris/Bruxelles (6 départs × 3 distances), résultats dans `poc/results/` |
| `npm run report` | Rapport visuel des tests (`poc/results/report.html`) |
| `npm run icons` | Régénère les icônes depuis `public/favicon.svg` |

Options de `npm run poc` : `POC_NO_CACHE=1` (mesure des vrais temps), `POC_DEBUG=1` (durée de chaque appel), `POC_OVERPASS=1` (ancienne source de données). Filtre : `npm run poc -- bruxelles 10`.

## Comment une boucle est calculée

1. **Carte** : les parcs, bois et plans d'eau autour du départ sont lus dans les tuiles vectorielles OpenFreeMap (zoom 13, les mêmes que le fond de carte).
2. **Points de passage** : 3 points sur un cercle passant par le départ, attirés vers les parcs et l'eau proches, pour 6 orientations différentes.
3. **Itinéraires** : Valhalla (serveur FOSSGIS) relie les points à pied ; 2 boucles par requête, car le serveur limite le débit.
4. **Distance** : le cercle est agrandi ou réduit (par encadrement) jusqu'à ±5 % de la distance demandée ; les culs-de-sac sont retirés.
5. **Note** : part en parc, au bord de l'eau, sur chemins piétons, le long de grands axes, allers-retours. Les 3 meilleures boucles distinctes sont proposées, avec leur dénivelé (lissé).

Le code du moteur est dans `src/engine/`, l'interface dans `src/app/`.

## Services utilisés (gratuits, sans clé)

| Besoin | Service |
|---|---|
| Fond de carte et contexte (parcs, eau) | [OpenFreeMap](https://openfreemap.org) (© OpenMapTiles, données © OpenStreetMap) |
| Itinéraires à pied, type de voie, altitude | [Valhalla – FOSSGIS](https://valhalla1.openstreetmap.de) |
| Recherche d'adresses | [Photon – komoot](https://photon.komoot.io) |

Ces services sont prévus pour un usage raisonnable : parfait pour un usage personnel ou un petit cercle.

## Limites connues

- Les petits squares (moins d'environ 1 ha) ne sont pas vus par le moteur (zoom 13).
- Les parcours balisés (GR, parcours de course) ne sont plus pris en compte dans l'app : ils ne figurent pas dans les tuiles.
- Le dénivelé est une estimation (modèle de terrain lissé).
- Les favoris restent sur le téléphone (pas de synchronisation).
