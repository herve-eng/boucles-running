// Préférences de l'utilisateur -> réglages du moteur.
//   nature     : plus de parcs et de bois
//   water      : plus de bords de l'eau
//   lit        : rues éclairées (course de nuit)
//   avoidRoads : éviter les grands axes
//   flat       : peu de dénivelé
import { WEIGHTS } from './score.js';
import { PEDESTRIAN_OPTIONS } from './valhalla.js';

export const DEFAULT_PREFS = { nature: true, water: true, lit: false, avoidRoads: true, flat: false };

// Préférence d'aimantation des points de passage : coût = distance × biais.
// Un biais plus faible rend ce type de lieu plus attirant.
const BASE_BIAS = { route: 0.8, track: 0.8, water: 0.9, green: 1 };

export function profileFor(prefs = DEFAULT_PREFS) {
  const weights = { ...WEIGHTS };
  const attractBias = { ...BASE_BIAS };
  const pedestrian = { ...PEDESTRIAN_OPTIONS };
  if (prefs.nature) {
    weights.green = 45;
    attractBias.green = 0.75;
  }
  if (prefs.water) {
    weights.water = 35;
    attractBias.water = 0.7;
  }
  if (prefs.lit) pedestrian.use_lit = 1;
  if (prefs.avoidRoads) {
    weights.main = -50;
    pedestrian.walkway_factor = 0.5;
  }
  if (prefs.flat) pedestrian.use_hills = 0.05;
  return { weights, attractBias, pedestrian };
}
