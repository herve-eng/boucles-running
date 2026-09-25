// Notation d'une boucle candidate.
import { Grid, dist, resample } from './geo.js';
import { greenAt, waterNear, routeNear } from './overpass.js';

const STEP = 20; // pas d'échantillonnage (m)
const OVERLAP_NEAR = 20; // deux passages à moins de 20 m = recouvrement
const OVERLAP_GAP = 250; // ...s'ils sont séparés d'au moins 250 m de parcours

const PATH_USES = new Set(['footway', 'path', 'pedestrian', 'track', 'cycleway', 'living_street', 'sidewalk', 'bridleway', 'mountain_bike', 'pedestrian_crossing']);
const MAIN_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary']);

export const WEIGHTS = { green: 30, water: 20, route: 10, path: 20, main: -25, overlap: -80 };

/** Part du parcours empruntée deux fois (allers-retours). */
export function overlapShare(samples, total) {
  const grid = new Grid(50);
  samples.forEach((s, i) => grid.insert(i, [s.p[0], s.p[1], s.p[0], s.p[1]], OVERLAP_NEAR));
  let n = 0;
  for (const a of samples) {
    const hit = grid.query(a.p).some((j) => {
      const b = samples[j];
      const gap = Math.abs(a.s - b.s);
      return Math.min(gap, total - gap) > OVERLAP_GAP && dist(a.p, b.p) < OVERLAP_NEAR;
    });
    if (hit) n++;
  }
  return n / samples.length;
}

/** Part de A située à moins de `near` m de B (similarité entre deux boucles). */
export function similarity(aXY, bXY, near = 40) {
  const grid = new Grid(80);
  for (const { p } of resample(bXY, STEP)) grid.insert(p, [p[0], p[1], p[0], p[1]], near);
  const samples = resample(aXY, STEP);
  const n = samples.filter(({ p }) => grid.query(p).some((q) => dist(p, q) < near)).length;
  return n / samples.length;
}

// Nom le plus fréquent parmi les points concernés (pour les explications).
function topNames(names, k = 2) {
  const c = new Map();
  for (const n of names) if (n) c.set(n, (c.get(n) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([n]) => n);
}

/**
 * @param xy tracé en coordonnées locales (m)
 * @param edges attributs Valhalla (peut être vide si non demandés)
 */
export function scoreLoop(xy, ctx, targetM, edges = []) {
  const samples = resample(xy, STEP);
  const total = samples.at(-1).s;
  let green = 0, water = 0, route = 0;
  const greenNames = [], waterNames = [], routeNames = [];
  for (const { p } of samples) {
    const g = greenAt(ctx, p);
    if (g) { green++; greenNames.push(g.name); }
    const w = waterNear(ctx, p);
    if (w) { water++; waterNames.push(w.name); }
    const r = routeNear(ctx, p);
    if (r) { route++; routeNames.push(r.name); }
  }
  const n = samples.length;
  const m = {
    green: green / n,
    water: water / n,
    route: route / n,
    overlap: overlapShare(samples, total),
    path: null,
    main: null,
    distErr: (total - targetM) / targetM,
  };

  if (edges.length) {
    let len = 0, path = 0, main = 0;
    for (const e of edges) {
      len += e.length;
      if (PATH_USES.has(e.use)) path += e.length;
      if (e.use === 'road' && MAIN_CLASSES.has(e.road_class)) main += e.length;
    }
    m.path = path / len;
    m.main = main / len;
  }

  let score = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) score += w * (m[k] ?? 0);
  score -= 200 * Math.max(0, Math.abs(m.distErr) - 0.05);

  const pct = (x) => `${Math.round(x * 100)} %`;
  const reasons = [];
  if (m.green >= 0.1) reasons.push(`${pct(m.green)} en parc/bois${topNames(greenNames).length ? ` (${topNames(greenNames).join(', ')})` : ''}`);
  if (m.water >= 0.1) reasons.push(`${pct(m.water)} au bord de l'eau${topNames(waterNames, 1).length ? ` (${topNames(waterNames, 1)[0]})` : ''}`);
  if (m.route >= 0.1) reasons.push(`${pct(m.route)} sur des parcours balisés${topNames(routeNames, 1).length ? ` (${topNames(routeNames, 1)[0]})` : ''}`);
  if (m.path != null && m.path >= 0.3) reasons.push(`${pct(m.path)} sur chemins/voies piétonnes`);
  if (m.main != null && m.main >= 0.15) reasons.push(`⚠ ${pct(m.main)} le long de grands axes`);
  if (m.overlap >= 0.1) reasons.push(`⚠ ${pct(m.overlap)} d'allers-retours`);

  return { score: +score.toFixed(1), metrics: m, reasons, lengthM: Math.round(total) };
}

// Réglage choisi sur les 18 boucles de test (Paris, Bruxelles) : plus fort,
// le lissage descend sous la borne physique (écart entre point bas et point haut).
// Les altitudes du modèle de terrain sont bruitées en ville (bâtiments,
// ponts, résolution ~30 m) : sans lissage, chaque petite oscillation compte
// comme une montée et le dénivelé explose (≈ 200 m annoncés pour 10 km à Paris).
const SMOOTH_HALF_WINDOW = 4; // ±4 points à 30 m ≈ moyenne glissante sur 270 m
const GAIN_THRESHOLD = 4; // m : hystérésis, on ignore les variations plus petites

/**
 * @param rangeHeight [[distance, altitude|null], …] tous les ~30 m (Valhalla /height)
 * @returns {gain, profile} dénivelé positif (m) et profil lissé [[d, h], …]
 */
export function elevation(rangeHeight) {
  // Trous (null) comblés par la dernière valeur connue.
  let last = rangeHeight.find(([, h]) => h != null)?.[1] ?? 0;
  const raw = rangeHeight.map(([d, h]) => [d, h == null ? last : (last = h)]);
  const profile = raw.map(([d], i) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - SMOOTH_HALF_WINDOW); j <= Math.min(raw.length - 1, i + SMOOTH_HALF_WINDOW); j++) {
      sum += raw[j][1];
      n++;
    }
    return [d, sum / n];
  });
  let gain = 0;
  let ref = profile[0]?.[1];
  for (const [, h] of profile) {
    if (h - ref >= GAIN_THRESHOLD) { gain += h - ref; ref = h; }
    else if (ref - h >= GAIN_THRESHOLD) ref = h;
  }
  return { gain: Math.round(gain), profile };
}
