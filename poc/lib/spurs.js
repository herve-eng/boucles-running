// Suppression des culs-de-sac : quand un point de passage tombe au bout
// d'une impasse, le tracé fait un aller-retour « en épingle ». Le retour peut
// emprunter le même chemin ou le trottoir d'en face (quelques mètres d'écart).
//
// Méthode : on parcourt le tracé tous les 5 m et on cherche les endroits où
// il se replie sur lui-même (la « pointe » de l'épingle), puis on remonte des
// deux côtés tant que l'aller et le retour restent parallèles et proches.
// On coupe l'épingle et on relie ses deux bases.
import { dist } from './geo.js';

const PARALLEL = 25; // m : écart max entre l'aller et le retour (largeur de rue)
const MIN_ARM = 25; // m : bras minimal pour parler d'épingle
const MAX_ARM = 800; // m : au-delà, le malus de recouvrement prend le relais
const STEP = 5; // m : pas de progression le long des bras

function cumulative(xy) {
  const s = [0];
  for (let i = 1; i < xy.length; i++) s.push(s[i - 1] + dist(xy[i - 1], xy[i]));
  return s;
}

// Point à l'abscisse t (recherche dichotomique).
function pointAt(xy, s, t) {
  t = Math.max(0, Math.min(s.at(-1), t));
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid] <= t) lo = mid;
    else hi = mid;
  }
  const seg = s[hi] - s[lo];
  const k = seg ? (t - s[lo]) / seg : 0;
  return [xy[lo][0] + k * (xy[hi][0] - xy[lo][0]), xy[lo][1] + k * (xy[hi][1] - xy[lo][1])];
}

// Longueur des bras parallèles de part et d'autre de l'abscisse t.
function armLength(xy, s, t) {
  let h = STEP;
  while (h <= MAX_ARM && t - h >= 0 && t + h <= s.at(-1)) {
    if (dist(pointAt(xy, s, t - h), pointAt(xy, s, t + h)) > PARALLEL) break;
    h += STEP;
  }
  return h - STEP;
}

/**
 * @param xy tracé en coordonnées locales (m), `coords` le même en [lon, lat]
 * @param toLonLat conversion inverse (pour les points de jonction créés)
 * @returns {xy, coords, removedM, count}
 */
export function trimSpurs(xy, coords, toLonLat) {
  let removedM = 0;
  let count = 0;
  for (let guard = 0; guard < 20; guard++) {
    const s = cumulative(xy);
    const total = s.at(-1);
    // Meilleure épingle : chaque position est testée comme pointe possible.
    // Filtre rapide : à MIN_ARM de part et d'autre, le tracé est-il replié ?
    let best = null;
    for (let t = MIN_ARM; t <= total - MIN_ARM; t += STEP) {
      if (dist(pointAt(xy, s, t - MIN_ARM), pointAt(xy, s, t + MIN_ARM)) > PARALLEL) continue;
      const h = armLength(xy, s, t);
      // On ne touche pas au départ/arrivée : la boucle doit rester fermée.
      if (h >= MIN_ARM && t - h > 0 && t + h < total && (!best || h > best.h)) best = { t, h };
    }
    if (!best) break;

    const t0 = best.t - best.h;
    const t1 = best.t + best.h;
    const i0 = s.findIndex((v) => v > t0); // premier sommet coupé
    const i1 = s.findLastIndex((v) => v < t1); // dernier sommet coupé
    const a = pointAt(xy, s, t0);
    const b = pointAt(xy, s, t1);
    xy = [...xy.slice(0, i0), a, b, ...xy.slice(i1 + 1)];
    coords = [...coords.slice(0, i0), toLonLat(a), toLonLat(b), ...coords.slice(i1 + 1)];
    removedM += 2 * best.h - dist(a, b);
    count++;
  }
  return { xy, coords, removedM: Math.round(removedM), count };
}
