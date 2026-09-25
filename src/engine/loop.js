// Génération de boucles : points de passage sur un cercle passant par le
// départ, aimantés vers les lieux agréables, reliés par Valhalla, puis
// ajustement du rayon jusqu'à obtenir la distance voulue.
import { dist, lineLength, mulberry32, resample } from './geo.js';
import { trimSpurs } from './spurs.js';
import { routeLoops, traceLoops, heightsLoops } from './valhalla.js';
import { scoreLoop, similarity, elevation } from './score.js';
import { profileFor } from './preferences.js';

const TOLERANCE = 0.05; // écart de distance accepté
const MAX_ITER = 5;
const POINTS_PER_LOOP = 3;
function snapToAttractor(ctx, p, maxShift, avoid, bias) {
  let best = null;
  let bestCost = Infinity;
  for (const a of ctx.attractors.queryRadius(p, maxShift)) {
    const d = dist(p, a.p);
    if (d > maxShift) continue;
    if (avoid.some((q) => dist(q, a.p) < maxShift * 0.5)) continue; // évite deux points collés
    const cost = d * (bias[a.type] ?? 1);
    if (cost < bestCost) {
      bestCost = cost;
      best = a;
    }
  }
  return best;
}

function waypoints(ctx, startXY, r, theta, n, bias) {
  // Le cercle passe par le départ : son centre est à distance r dans la direction theta.
  const c = [startXY[0] + r * Math.cos(theta), startXY[1] + r * Math.sin(theta)];
  const phi0 = theta + Math.PI; // angle du départ vu depuis le centre
  const pts = [];
  const snaps = [];
  for (let j = 1; j <= n; j++) {
    const phi = phi0 + (j * 2 * Math.PI) / (n + 1);
    const ideal = [c[0] + r * Math.cos(phi), c[1] + r * Math.sin(phi)];
    const a = snapToAttractor(ctx, ideal, Math.max(150, 0.35 * r), [startXY, ...pts], bias);
    pts.push(a ? a.p : ideal);
    snaps.push(a ? a.type : null);
  }
  return { pts, snaps };
}

/**
 * Ajuste le rayon d'une variante d'après le dernier essai.
 * Comme la distance varie par sauts (les points basculent d'un parc à
 * l'autre), on encadre : dès qu'on a un essai trop court et un trop long,
 * on vise entre les deux plutôt que d'appliquer une simple règle de trois.
 */
function nextRadius(st, lenM, targetM) {
  if (lenM < targetM && (!st.short || lenM > st.short.len)) st.short = { r: st.r, len: lenM };
  if (lenM > targetM && (!st.long || lenM < st.long.len)) st.long = { r: st.r, len: lenM };
  if (st.short && st.long) {
    const k = (targetM - st.short.len) / (st.long.len - st.short.len);
    return st.short.r + Math.min(0.85, Math.max(0.15, k)) * (st.long.r - st.short.r);
  }
  return st.r * Math.min(2, Math.max(0.5, targetM / lenM));
}

// Les boucles dans la tolérance de distance passent toujours devant les autres.
const inTolerance = (c) => Math.abs(c.metrics.distErr) <= TOLERANCE;
const byRank = (a, b) => inTolerance(b) - inTolerance(a) || b.score - a.score;

/**
 * Génère les boucles et renvoie les candidates notées et les 3 meilleures.
 * Options : `prefs` (voir preferences.js), `onProgress({phase, round, maxRounds})`
 * avec phase = 'routes' | 'score' | 'elevation', `signal` pour annuler.
 * @param {[number, number]} start [lon, lat]
 * @param {number} targetKm
 * @param {any} ctx
 * @param {any} proj
 * @param {{variants?: number, seed?: number, prefs?: object, onProgress?: (p: any) => void, signal?: AbortSignal}} [options]
 * @returns {Promise<{candidates: any[], top: number[], calls: number, ms: number}>}
 */
export async function generateLoops(start, targetKm, ctx, proj, { variants = 6, seed = 1, prefs, onProgress, signal } = {}) {
  const t0 = Date.now();
  const rand = mulberry32(seed);
  const targetM = targetKm * 1000;
  const startXY = proj.toXY(start);
  const { weights, attractBias, pedestrian: opts } = profileFor(prefs);
  let calls = 0;
  // Rapport « longueur réelle / périmètre du cercle », appris au fil des tours.
  let detour = 1.3;

  // 3 points de passage par boucle : 2 boucles tiennent dans une requête
  // (départ + 3 + départ + 3 + départ = 9 arrêts, limite du serveur : 10).
  const states = Array.from({ length: variants }, (_, v) => ({
    v,
    theta: (2 * Math.PI * v) / variants + (rand() - 0.5) * 0.6,
    n: POINTS_PER_LOOP,
    r: targetM / (2 * Math.PI * detour),
    best: null, short: null, long: null, attempts: [], done: false,
  }));

  // Tours d'ajustement : à chaque tour, toutes les variantes pas encore
  // à la bonne distance sont recalculées ensemble (requêtes groupées).
  for (let round = 0; round < MAX_ITER; round++) {
    const active = states.filter((st) => !st.done);
    if (!active.length) break;
    onProgress?.({ phase: 'routes', round: round + 1, maxRounds: MAX_ITER });
    for (const st of active) st.wp = waypoints(ctx, startXY, st.r, st.theta, st.n, attractBias);
    const { results, requests } = await routeLoops(start, active.map((st) => st.wp.pts.map(proj.toLonLat)), opts, signal);
    calls += requests;

    const ratios = [];
    active.forEach((st, k) => {
      const res = results[k];
      if (res.error) {
        st.attempts.push({ r: Math.round(st.r), error: res.error });
        st.r *= 0.85; // souvent un point inaccessible : on resserre
        return;
      }
      // Culs-de-sac retirés avant de mesurer : c'est la longueur réellement courue.
      const trimmed = trimSpurs(res.coords.map(proj.toXY), res.coords, proj.toLonLat);
      const lenM = lineLength(trimmed.xy);
      const err = (lenM - targetM) / targetM;
      st.attempts.push({ r: Math.round(st.r), lengthM: Math.round(lenM), err: +err.toFixed(3), spurs: trimmed.count, spurM: trimmed.removedM });
      if (!st.best || Math.abs(err) < Math.abs(st.best.err)) {
        st.best = { coords: trimmed.coords, err, waypoints: st.wp.pts.map(proj.toLonLat), snaps: st.wp.snaps, spurs: trimmed.count, spurM: trimmed.removedM };
      }
      ratios.push(lenM / (2 * Math.PI * st.r));
      if (Math.abs(err) <= TOLERANCE) st.done = true;
      else st.r = nextRadius(st, lenM, targetM);
    });
    if (ratios.length) detour = ratios.reduce((a, b) => a + b) / ratios.length;
  }
  const candidates = states.filter((st) => st.best).map((st) => ({ variant: st.v, theta: +st.theta.toFixed(2), n: st.n, attempts: st.attempts, ...st.best }));

  // 1re passe de notation sans le type de voie (aucun appel réseau)…
  for (const c of candidates) {
    c.xy = c.coords.map(proj.toXY);
    Object.assign(c, scoreLoop(c.xy, ctx, targetM, [], weights));
  }
  candidates.sort(byRank);
  // …puis note complète (type de voie) pour les 4 meilleures, en une requête.
  const finalists = candidates.slice(0, 4);
  onProgress?.({ phase: 'score' });
  const edgesList = await traceLoops(finalists.map((c) => c.coords), signal);
  calls++;
  finalists.forEach((c, k) => Object.assign(c, scoreLoop(c.xy, ctx, targetM, edgesList[k], weights)));
  finalists.sort(byRank);

  // Les 3 meilleures, en écartant les quasi-doublons.
  const top = [];
  for (const c of finalists) {
    if (top.length === 3) break;
    if (top.some((t) => similarity(c.xy, t.xy) > 0.6)) continue;
    top.push(c);
  }
  // Dénivelé des 3 meilleures, en une requête (tracés rééchantillonnés tous les 30 m).
  const sampled = top.map((c) => {
    const pts = resample(c.xy, 30);
    return { coords: pts.map(({ p }) => proj.toLonLat(p)), dists: pts.map(({ s }) => s) };
  });
  onProgress?.({ phase: 'elevation' });
  const ranges = await heightsLoops(sampled, signal);
  calls++;
  top.forEach((c, k) => {
    const { gain, profile } = elevation(ranges[k]);
    c.elevationGain = gain;
    // Profil allégé (≈ 1 point tous les 90 m) pour l'affichage.
    c.profile = profile.filter((_, i) => i % 3 === 0).map(([d, h]) => [Math.round(d), Math.round(h)]);
  });
  for (const c of candidates) delete c.xy;

  const ordered = [...finalists, ...candidates.slice(4)];
  return { candidates: ordered, top: top.map((c) => c.variant), calls, ms: Date.now() - t0 };
}
