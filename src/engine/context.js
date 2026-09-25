// Contexte géographique autour du départ : espaces verts, eau, parcours
// balisés, indexés pour des requêtes rapides. Indépendant de la source de
// données (tuiles vectorielles dans l'app, Overpass dans les scripts de test).
import { Grid, bboxOf, distToSegment, pointInRings, ringArea, resample } from './geo.js';

// Distances d'influence (m).
export const WATER_NEAR = 60;
export const ROUTE_NEAR = 20;
// En dessous de cette surface, un espace vert n'attire pas les points de passage.
const MIN_ATTRACT_AREA = 20000; // m² (2 ha)

export function createContext() {
  return {
    greens: [], // {rings, bbox, area, name}
    waterAreas: [], // {rings, bbox, name}
    lines: { water: new Grid(200), route: new Grid(200) }, // segments indexés
    attractors: new Grid(200), // points d'intérêt pour aimanter les points de passage
    greenGrid: new Grid(250),
    waterGrid: new Grid(250),
    routes: [], // parcours balisés {name, type, lengthM}
    counts: { green: 0, water: 0, route: 0, track: 0 },
  };
}

function addSegments(grid, pts, meta, pad) {
  for (let i = 1; i < pts.length; i++) {
    const seg = { a: pts[i - 1], b: pts[i], meta };
    grid.insert(seg, bboxOf([seg.a, seg.b]), pad);
  }
}

function addAttractors(ctx, pts, type, name) {
  if (pts.length < 2) return;
  for (const { p } of resample(pts, 40)) ctx.attractors.insert({ p, type, name }, [p[0], p[1], p[0], p[1]]);
}

/** Espace vert : anneaux fermés en coordonnées locales (m). */
export function addGreen(ctx, rings, name, area = rings.reduce((a, r) => a + ringArea(r), 0)) {
  if (!rings.length) return;
  const f = { rings, bbox: bboxOf(rings.flat()), area, name };
  ctx.greens.push(f);
  ctx.greenGrid.insert(f, f.bbox);
  ctx.counts.green++;
  if (area === 0 || area > MIN_ATTRACT_AREA) for (const pts of rings) addAttractors(ctx, pts, 'green', name);
}

/** Cours d'eau (ligne). */
export function addWaterLine(ctx, pts, name) {
  addSegments(ctx.lines.water, pts, { name }, WATER_NEAR);
  addAttractors(ctx, pts, 'water', name);
  ctx.counts.water++;
}

/** Plan d'eau (surface) : on est « au bord de l'eau » près du contour ou dessus (pont). */
export function addWaterArea(ctx, rings, name) {
  if (!rings.length) return;
  for (const pts of rings) {
    addSegments(ctx.lines.water, pts, { name }, WATER_NEAR);
    addAttractors(ctx, pts, 'water', name);
  }
  const f = { rings, bbox: bboxOf(rings.flat()), name };
  ctx.waterAreas.push(f);
  ctx.waterGrid.insert(f, f.bbox);
  ctx.counts.water++;
}

/** Parcours balisé ou piste d'athlétisme (lignes). */
export function addRoute(ctx, parts, { kind = 'route', name, type, lengthM } = {}) {
  const meta = { kind, name };
  for (const pts of parts) {
    addSegments(ctx.lines.route, pts, meta, ROUTE_NEAR);
    addAttractors(ctx, pts, kind, name);
  }
  ctx.counts[kind]++;
  if (kind === 'route') ctx.routes.push({ name: name || '(sans nom)', type, lengthM });
}

/** Trie les parcours balisés : les plus pertinents d'abord (course > fitness > rando). */
export function finalizeContext(ctx) {
  const rank = { running: 0, fitness_trail: 1, foot: 2, hiking: 3 };
  ctx.routes.sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9) || b.lengthM - a.lengthM);
  return ctx;
}

// --- Requêtes ponctuelles -------------------------------------------------

const inBbox = (p, [x0, y0, x1, y1]) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;

export function greenAt(ctx, p) {
  for (const f of ctx.greenGrid.query(p)) if (inBbox(p, f.bbox) && pointInRings(p, f.rings)) return f;
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
  for (const f of ctx.waterGrid.query(p)) if (inBbox(p, f.bbox) && pointInRings(p, f.rings)) return f;
  return null;
}

export function routeNear(ctx, p) {
  return nearestSegment(ctx.lines.route, p, ROUTE_NEAR)?.meta ?? null;
}
