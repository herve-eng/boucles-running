// Contexte OpenStreetMap autour du départ, via Overpass :
// espaces verts, eau, parcours existants et pistes d'athlétisme.
import { fetchJson } from './http.js';
import { Grid, bboxOf, lineLength, pointInRings, distToSegment, ringArea, resample } from './geo.js';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Distances d'influence (m).
export const WATER_NEAR = 60;
export const ROUTE_NEAR = 20;

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

/** Télécharge et indexe le contexte OSM dans un carré de demi-côté `radius` mètres. */
export async function loadContext(start, radius, proj) {
  const dLat = radius / 110540;
  const dLon = radius / (111320 * Math.cos((start[1] * Math.PI) / 180));
  const bbox = [start[1] - dLat, start[0] - dLon, start[1] + dLat, start[0] + dLon].map((v) => +v.toFixed(4));
  const t0 = Date.now();
  const json = await fetchJson(MIRRORS, { body: buildQuery(bbox), form: true, tries: 8, timeoutMs: 200000 });
  const ms = Date.now() - t0;

  const ctx = {
    greens: [], // {rings, bbox, area, name}
    waterAreas: [], // {rings, bbox, name}
    lines: { water: new Grid(200), route: new Grid(200) }, // segments indexés
    attractors: new Grid(200), // points d'intérêt pour aimanter les points de passage
    greenGrid: new Grid(250),
    waterGrid: new Grid(250),
    routes: [], // parcours existants {name, type, lengthM}
    counts: { green: 0, water: 0, route: 0, track: 0 },
    overpassMs: ms,
  };

  const addSegments = (grid, pts, meta, pad) => {
    for (let i = 1; i < pts.length; i++) {
      const seg = { a: pts[i - 1], b: pts[i], meta };
      grid.insert(seg, bboxOf([seg.a, seg.b]), pad);
    }
  };
  const addAttractors = (pts, type, name) => {
    if (pts.length < 2) return;
    for (const { p } of resample(pts, 40)) ctx.attractors.insert({ p, type, name }, [p[0], p[1], p[0], p[1]]);
  };

  for (const el of json.elements) {
    const kind = classify(el.tags);
    // Rivières canalisées ou souterraines (ex. la Senne à Bruxelles) : invisibles pour le coureur.
    if (kind === 'water' && (el.tags.tunnel || el.tags.location === 'underground' || el.tags.covered === 'yes')) continue;
    const name = el.tags?.name;
    ctx.counts[kind]++;

    // Géométries : un way = une ligne/anneau ; une relation = ses membres.
    let parts = [];
    if (el.type === 'way' && el.geometry) parts = [toLonLat(el.geometry).map(proj.toXY)];
    else if (el.type === 'relation' && el.members) {
      parts = el.members.filter((m) => m.geometry).map((m) => toLonLat(m.geometry).map(proj.toXY));
    }
    parts = parts.filter((p) => p.length >= 2);
    if (!parts.length) continue;

    if (kind === 'route' || kind === 'track') {
      const meta = { kind, name: name || (kind === 'track' ? "piste d'athlétisme" : undefined) };
      let lengthM = 0;
      for (const pts of parts) {
        addSegments(ctx.lines.route, pts, meta, ROUTE_NEAR);
        addAttractors(pts, kind, meta.name);
        lengthM += lineLength(pts);
      }
      if (kind === 'route') ctx.routes.push({ name: name || '(sans nom)', type: el.tags.route, lengthM: Math.round(lengthM), ref: el.tags.ref });
      continue;
    }

    // Aires : on considère fermés les ways dont les extrémités coïncident ;
    // pour les relations, on garde les membres tels quels (test pair-impair).
    const isClosed = (p) => p.length > 3 && p[0][0] === p.at(-1)[0] && p[0][1] === p.at(-1)[1];
    if (kind === 'water') {
      const lineLike = el.tags?.waterway;
      for (const pts of parts) addSegments(ctx.lines.water, pts, { name }, WATER_NEAR);
      if (!lineLike) {
        const rings = el.type === 'relation' ? parts : parts.filter(isClosed);
        if (rings.length) {
          const f = { rings, bbox: bboxOf(rings.flat()), name };
          ctx.waterAreas.push(f);
          ctx.waterGrid.insert(f, f.bbox);
        }
      }
      for (const pts of parts) addAttractors(pts, 'water', name);
      continue;
    }

    // Espace vert.
    const rings = el.type === 'way' ? (isClosed(parts[0]) ? parts : []) : parts;
    if (!rings.length) continue;
    const area = el.type === 'way' ? ringArea(rings[0]) : rings.filter(isClosed).reduce((a, r) => a + ringArea(r), 0);
    const f = { rings, bbox: bboxOf(rings.flat()), area, name };
    ctx.greens.push(f);
    ctx.greenGrid.insert(f, f.bbox);
    // Les tout petits squares n'attirent pas les points de passage.
    if (area === 0 || area > 20000) for (const pts of rings) addAttractors(pts, 'green', name);
  }

  // Parcours existants : les plus pertinents d'abord (course > fitness > rando).
  const rank = { running: 0, fitness_trail: 1, foot: 2, hiking: 3 };
  ctx.routes.sort((a, b) => rank[a.type] - rank[b.type] || b.lengthM - a.lengthM);
  return ctx;
}

// --- Requêtes ponctuelles sur le contexte --------------------------------

export function greenAt(ctx, p) {
  for (const f of ctx.greenGrid.query(p)) {
    const [x0, y0, x1, y1] = f.bbox;
    if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue;
    if (pointInRings(p, f.rings)) return f;
  }
  return null;
}

function nearestSegment(grid, p, maxD) {
  let best = null;
  let bestD = maxD;
  for (const seg of grid.query(p)) {
    const d = distToSegment(p, seg.a, seg.b);
    if (d <= bestD) {
      bestD = d;
      best = seg;
    }
  }
  return best;
}

export function waterNear(ctx, p) {
  const seg = nearestSegment(ctx.lines.water, p, WATER_NEAR);
  if (seg) return seg.meta;
  for (const f of ctx.waterGrid.query(p)) {
    const [x0, y0, x1, y1] = f.bbox;
    if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1 && pointInRings(p, f.rings)) return f;
  }
  return null;
}

export function routeNear(ctx, p) {
  return nearestSegment(ctx.lines.route, p, ROUTE_NEAR)?.meta ?? null;
}
