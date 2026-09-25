// Client du serveur Valhalla public de FOSSGIS (sans clé).
//
// Le serveur limite le débit (au-delà d'environ 1 requête/s, les réponses
// sont retardées) et accepte au plus 10 points d'arrêt par itinéraire.
// Le levier pour aller vite est donc de faire PEU de requêtes : on regroupe
// plusieurs boucles dans chaque appel.
import { fetchJson } from './net.js';
import { decodePolyline } from './geo.js';

const BASE = 'https://valhalla1.openstreetmap.de';
const HEADERS = { 'X-Client-Id': 'boucles-running' }; // identifiant demandé par FOSSGIS
const MAX_LOCATIONS = 10;

// Réglages du profil piéton qui favorisent les chemins et voies piétonnes.
export const PEDESTRIAN_OPTIONS = {
  walkway_factor: 0.7, // < 1 : préfère trottoirs dédiés, chemins
  sidewalk_factor: 0.9,
  alley_factor: 2,
  driveway_factor: 5,
  step_penalty: 30, // les escaliers cassent le rythme
  use_hills: 0.4,
  use_lit: 0, // 1 pour l'option « éclairé »
  service_penalty: 15,
};

const toLoc = ([lon, lat], type) => ({ lat: +lat.toFixed(6), lon: +lon.toFixed(6), type, radius: type === 'break' ? 0 : 60 });
const toShape = (coords) => coords.map(([lon, lat]) => ({ lat: +lat.toFixed(5), lon: +lon.toFixed(5) }));

async function routeRequest(locations, options, signal) {
  const body = JSON.stringify({
    locations,
    costing: 'pedestrian',
    costing_options: { pedestrian: { ...PEDESTRIAN_OPTIONS, ...options } },
    units: 'kilometers',
    directions_type: 'none',
  });
  return fetchJson(`${BASE}/route`, { body, headers: HEADERS, signal });
}

/**
 * Calcule plusieurs boucles partant du même point `start`.
 * Chaque boucle = liste de points de passage ([lon, lat]). Les boucles sont
 * enchaînées dans une même requête (départ → P1…Pn → départ → Q1…Qn → départ) ;
 * le départ est un arrêt (« break »), donc chaque boucle devient un tronçon
 * (« leg ») distinct de la réponse. Les points de passage sont de type
 * « through » : pas de demi-tour autorisé dessus, ce qui limite les étoiles.
 *
 * @returns {results: [{coords, lengthKm} | {error}], requests}
 */
export async function routeLoops(start, loops, options = {}, signal) {
  // Groupes de boucles tenant dans MAX_LOCATIONS points d'arrêt.
  const groups = [];
  let cur = [];
  let used = 1;
  loops.forEach((wps, i) => {
    const need = wps.length + 1;
    if (cur.length && used + need > MAX_LOCATIONS) {
      groups.push(cur);
      cur = [];
      used = 1;
    }
    cur.push(i);
    used += need;
  });
  if (cur.length) groups.push(cur);

  const results = new Array(loops.length);
  let requests = 0;
  for (const group of groups) {
    const locations = [toLoc(start, 'break')];
    for (const i of group) {
      for (const p of loops[i]) locations.push(toLoc(p, 'through'));
      locations.push(toLoc(start, 'break'));
    }
    const res = await routeRequest(locations, options, signal);
    requests++;
    if (res.trip && res.trip.legs.length === group.length) {
      group.forEach((i, k) => {
        const leg = res.trip.legs[k];
        results[i] = { coords: decodePolyline(leg.shape, 6), lengthKm: leg.summary.length };
      });
      continue;
    }
    // Une boucle impossible fait échouer tout le groupe : on les reprend une par une.
    for (const i of group) {
      if (group.length === 1) {
        results[i] = { error: res.error || 'pas de trajet' };
        continue;
      }
      const single = await routeRequest([toLoc(start, 'break'), ...loops[i].map((p) => toLoc(p, 'through')), toLoc(start, 'break')], options, signal);
      requests++;
      results[i] = single.trip
        ? { coords: decodePolyline(single.trip.legs[0].shape, 6), lengthKm: single.trip.legs[0].summary.length }
        : { error: single.error || 'pas de trajet' };
    }
  }
  return { results, requests };
}

/**
 * Type de voie des tronçons parcourus, pour plusieurs boucles en une requête.
 * Les tracés sont mis bout à bout (ils partent et reviennent tous au même
 * point, donc la trace reste continue). Chaque point d'entrée est rattaché à
 * un tronçon (matched.edge_index), ce qui permet de redistribuer les tronçons
 * entre les boucles.
 * @returns liste, par boucle, des tronçons {length, use, road_class, …}
 */
export async function traceLoops(coordsList, signal) {
  const body = JSON.stringify({
    shape: toShape(coordsList.flat()),
    shape_match: 'walk_or_snap',
    costing: 'pedestrian',
    filters: { attributes: ['edge.length', 'edge.use', 'edge.road_class', 'edge.surface', 'edge.names', 'matched.edge_index'], action: 'include' },
  });
  const res = await fetchJson(`${BASE}/trace_attributes`, { body, headers: HEADERS, signal });
  const edges = res.edges ?? [];
  const matched = res.matched_points ?? [];
  let offset = 0;
  return coordsList.map((coords) => {
    const ids = new Set();
    for (let k = offset; k < offset + coords.length; k++) {
      const e = matched[k]?.edge_index;
      if (e != null && e < edges.length) ids.add(e);
    }
    offset += coords.length;
    return [...ids].sort((a, b) => a - b).map((e) => edges[e]);
  });
}

/**
 * Altitudes de plusieurs tracés en une requête. Les tracés doivent déjà être
 * rééchantillonnés régulièrement ; on renvoie, par tracé, [[distance, altitude]].
 * @param sampled liste de {coords, dists} (dists = abscisse de chaque point, en m)
 */
export async function heightsLoops(sampled, signal) {
  const body = JSON.stringify({ shape: toShape(sampled.flatMap((s) => s.coords)) });
  const res = await fetchJson(`${BASE}/height`, { body, headers: HEADERS, signal });
  const h = res.height ?? [];
  let offset = 0;
  return sampled.map((s) => {
    const out = s.dists.map((d, k) => [d, h[offset + k] ?? null]);
    offset += s.coords.length;
    return out;
  });
}
