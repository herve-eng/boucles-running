// Contexte géographique lu dans les tuiles vectorielles OpenFreeMap (schéma
// OpenMapTiles) : les mêmes tuiles que le fond de carte, servies par un CDN,
// sans clé ni quota. Remplace Overpass dans l'app (lent, réponses lourdes,
// blocage des clients trop gourmands).
//
// Zoom 13 : ~250 Ko par tuile de ~3 km de côté. On y trouve les grands parcs,
// les bois et toute l'eau ; les petits squares (< ~1 ha) n'y figurent plus,
// ce qui est acceptable pour choisir un parcours de course.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { fetchJson } from './net.js';
import { createContext, addGreen, addWaterLine, addWaterArea, finalizeContext } from './context.js';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
export const CONTEXT_ZOOM = 13;

// Classes retenues (schéma OpenMapTiles).
const GREEN_SUBCLASSES = new Set(['park', 'grassland', 'meadow', 'village_green', 'recreation_ground', 'nature_reserve', 'heath']);
const PARK_CLASSES = new Set(['nature_reserve', 'national_park']); // « protected_area » couvre ex. les rives de la Seine entières
const WATER_CLASSES = new Set(['river', 'lake', 'pond', 'dock', 'ocean', 'basin']);
const WATERWAY_CLASSES = new Set(['river', 'canal', 'stream']); // longer un ruisseau en forêt est agréable

let tileUrlTemplate = null;

// L'adresse des tuiles contient la date de la dernière mise à jour des données :
// on la lit dans le TileJSON (mis en cache comme le reste).
async function tileUrl(z, x, y, signal) {
  if (!tileUrlTemplate) tileUrlTemplate = (await fetchJson(TILEJSON, { signal })).tiles[0];
  return tileUrlTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

const lonToTileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToTileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/**
 * Rayon de contexte nécessaire pour une boucle de `km` kilomètres : le tracé
 * reste dans un disque d'environ un diamètre de cercle autour du départ, plus
 * le déplacement des points aimantés (21 km -> ~6,9 km).
 */
export const contextRadius = (km) => (km * 1000) / Math.PI / 1.1 + 800;

/** Tuiles couvrant un carré de demi-côté `radius` (m) autour de `start` [lon, lat]. */
export function tilesAround(start, radius, z = CONTEXT_ZOOM) {
  const dLat = radius / 110540;
  const dLon = radius / (111320 * Math.cos((start[1] * Math.PI) / 180));
  const x0 = lonToTileX(start[0] - dLon, z), x1 = lonToTileX(start[0] + dLon, z);
  const y0 = latToTileY(start[1] + dLat, z), y1 = latToTileY(start[1] - dLat, z);
  const tiles = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push({ z, x, y });
  return tiles;
}

// Géométrie GeoJSON -> listes d'anneaux / de lignes en coordonnées locales.
function polygons(geom, toXY) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.map((rings) => rings.map((ring) => ring.map(toXY)));
}
function lines(geom, toXY) {
  const ls = geom.type === 'LineString' ? [geom.coordinates] : geom.type === 'MultiLineString' ? geom.coordinates : [];
  return ls.map((l) => l.map(toXY));
}

function addTile(ctx, vt, { z, x, y }, toXY) {
  const each = (layer, fn) => {
    const L = vt.layers[layer];
    if (!L) return;
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i);
      fn(f.properties, () => f.toGeoJSON(x, y, z).geometry);
    }
  };
  each('landcover', (p, geom) => {
    if (p.class === 'wood' || GREEN_SUBCLASSES.has(p.subclass)) for (const rings of polygons(geom(), toXY)) addGreen(ctx, rings, undefined);
  });
  each('park', (p, geom) => {
    if (PARK_CLASSES.has(p.class)) for (const rings of polygons(geom(), toXY)) addGreen(ctx, rings, p.name);
  });
  each('water', (p, geom) => {
    // Rivières canalisées ou souterraines (ex. la Senne à Bruxelles) : invisibles pour le coureur.
    if (p.brunnel === 'tunnel' || !WATER_CLASSES.has(p.class)) return;
    for (const rings of polygons(geom(), toXY)) addWaterArea(ctx, rings, undefined);
  });
  each('waterway', (p, geom) => {
    if (p.brunnel === 'tunnel' || !WATERWAY_CLASSES.has(p.class)) return;
    if (p.class === 'stream' && p.intermittent === 1) return; // fossés souvent à sec
    for (const pts of lines(geom(), toXY)) addWaterLine(ctx, pts, p['name:fr'] || p.name);
  });
}

/**
 * Charge le contexte dans un carré de demi-côté `radius` mètres.
 * `onProgress(fait, total)` est appelé à chaque tuile reçue.
 * @param {[number, number]} start
 * @param {number} radius
 * @param {any} proj
 * @param {{onProgress?: (done: number, total: number) => void, signal?: AbortSignal}} [options]
 * @returns {Promise<any>}
 */
export async function loadTileContext(start, radius, proj, { onProgress, signal } = {}) {
  const t0 = Date.now();
  const tiles = tilesAround(start, radius);
  const ctx = createContext();
  let done = 0;
  let bytes = 0;
  await Promise.all(
    tiles.map(async (t) => {
      const buf = await fetchJson(await tileUrl(t.z, t.x, t.y, signal), { as: 'bytes', signal, timeoutMs: 20000 });
      bytes += buf.length;
      addTile(ctx, new VectorTile(new PbfReader(buf)), t, proj.toXY);
      onProgress?.(++done, tiles.length);
    }),
  );
  ctx.source = { kind: 'tuiles', zoom: CONTEXT_ZOOM, tiles: tiles.length, bytes, ms: Date.now() - t0 };
  return finalizeContext(ctx);
}
