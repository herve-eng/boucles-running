// Contexte OpenStreetMap via Overpass (scripts de test uniquement : l'app
// utilise les tuiles vectorielles, voir src/engine/context-tiles.js).
import { fetchJson } from '../../src/engine/net.js';
import { lineLength, ringArea } from '../../src/engine/geo.js';
import { createContext, addGreen, addWaterLine, addWaterArea, addRoute, finalizeContext } from '../../src/engine/context.js';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function buildQuery([s, w, n, e]) {
  const bb = `${s},${w},${n},${e}`;
  return `[out:json][timeout:180][bbox:${bb}];
(
  way[leisure~"^(park|nature_reserve|recreation_ground)$"];
  rel[leisure~"^(park|nature_reserve)$"];
  way[landuse~"^(forest|recreation_ground|meadow|village_green)$"];
  rel[landuse=forest];
  way[natural~"^(wood|scrub|grassland)$"];
  rel[natural=wood];
  way[waterway~"^(river|canal|stream)$"];
  way[natural=water];
  rel[natural=water];
  way[leisure=track];
);
out geom;
rel[route~"^(running|fitness_trail|foot|hiking)$"];
out geom(${bb});`;
}

function classify(tags = {}) {
  if (tags.route) return 'route';
  if (tags.leisure === 'track') return 'track';
  if (tags.waterway || tags.natural === 'water') return 'water';
  return 'green';
}

const toLonLat = (geom) => geom.filter(Boolean).map((g) => [g.lon, g.lat]);
const isClosed = (p) => p.length > 3 && p[0][0] === p.at(-1)[0] && p[0][1] === p.at(-1)[1];

/** Télécharge et indexe le contexte OSM dans un carré de demi-côté `radius` mètres. */
export async function loadContext(start, radius, proj) {
  const dLat = radius / 110540;
  const dLon = radius / (111320 * Math.cos((start[1] * Math.PI) / 180));
  const bbox = [start[1] - dLat, start[0] - dLon, start[1] + dLat, start[0] + dLon].map((v) => +v.toFixed(4));
  const t0 = Date.now();
  const json = await fetchJson(MIRRORS, { body: buildQuery(bbox), form: true, tries: 8, timeoutMs: 200000 });
  const ctx = createContext();

  for (const el of json.elements) {
    const kind = classify(el.tags);
    const name = el.tags?.name;
    // Rivières canalisées ou souterraines (ex. la Senne à Bruxelles) : invisibles pour le coureur.
    if (kind === 'water' && (el.tags.tunnel || el.tags.location === 'underground' || el.tags.covered === 'yes')) continue;

    // Géométries : un way = une ligne/anneau ; une relation = ses membres.
    let parts = [];
    if (el.type === 'way' && el.geometry) parts = [toLonLat(el.geometry).map(proj.toXY)];
    else if (el.type === 'relation' && el.members) {
      parts = el.members.filter((m) => m.geometry).map((m) => toLonLat(m.geometry).map(proj.toXY));
    }
    parts = parts.filter((p) => p.length >= 2);
    if (!parts.length) continue;

    if (kind === 'route' || kind === 'track') {
      addRoute(ctx, parts, {
        kind,
        name: name || (kind === 'track' ? "piste d'athlétisme" : undefined),
        type: el.tags.route,
        lengthM: Math.round(parts.reduce((a, p) => a + lineLength(p), 0)),
      });
      continue;
    }
    // Aires : ways fermés ; pour les relations, membres tels quels (test pair-impair).
    if (kind === 'water') {
      if (el.tags?.waterway) for (const pts of parts) addWaterLine(ctx, pts, name);
      else addWaterArea(ctx, el.type === 'relation' ? parts : parts.filter(isClosed), name);
      continue;
    }
    const rings = el.type === 'way' ? (isClosed(parts[0]) ? parts : []) : parts;
    const area = el.type === 'way' ? (rings.length ? ringArea(rings[0]) : 0) : rings.filter(isClosed).reduce((a, r) => a + ringArea(r), 0);
    addGreen(ctx, rings, name, area);
  }
  ctx.source = { kind: 'overpass', ms: Date.now() - t0 };
  ctx.overpassMs = ctx.source.ms;
  return finalizeContext(ctx);
}
