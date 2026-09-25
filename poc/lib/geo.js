// Outils géométriques minimalistes (sans dépendance).
// On travaille dans une projection locale en mètres centrée sur le départ :
// suffisante à l'échelle d'une boucle de course (< 30 km).

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQ = 111320;

export function makeProjection(lat0, lon0) {
  const kx = M_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180);
  return {
    toXY: ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * M_PER_DEG_LAT],
    toLonLat: ([x, y]) => [lon0 + x / kx, lat0 + y / M_PER_DEG_LAT],
  };
}

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function lineLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

// Distance d'un point p au segment [a, b].
export function distToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Rééchantillonne une polyligne tous les `step` mètres.
// Retourne [{p, s}] avec s = abscisse curviligne.
export function resample(pts, step) {
  const out = [{ p: pts[0], s: 0 }];
  let s = 0;
  let next = step;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = dist(a, b);
    while (seg > 0 && next <= s + seg) {
      const t = (next - s) / seg;
      out.push({ p: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], s: next });
      next += step;
    }
    s += seg;
  }
  return out;
}

// Test pair-impair sur un ensemble d'anneaux : fonctionne pour les
// multipolygones (anneaux extérieurs + trous) sans avoir à les assembler,
// tant que chaque anneau est fermé.
export function pointInRings(p, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

export function bboxOf(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

// Index spatial en grille : chaque élément est rangé dans les cellules
// couvertes par sa bbox (élargie de `pad` mètres).
export class Grid {
  constructor(cell = 250) {
    this.cell = cell;
    this.cells = new Map();
  }
  key(cx, cy) {
    return cx * 100003 + cy;
  }
  insert(item, [minX, minY, maxX, maxY], pad = 0) {
    const c = this.cell;
    for (let cx = Math.floor((minX - pad) / c); cx <= Math.floor((maxX + pad) / c); cx++) {
      for (let cy = Math.floor((minY - pad) / c); cy <= Math.floor((maxY + pad) / c); cy++) {
        const k = this.key(cx, cy);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(item);
      }
    }
  }
  query([x, y]) {
    return this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(y / this.cell))) || [];
  }
  // Éléments des cellules dans un rayon donné (candidats, à filtrer ensuite).
  queryRadius([x, y], r) {
    const c = this.cell;
    const seen = new Set();
    const out = [];
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++) {
      for (let cy = Math.floor((y - r) / c); cy <= Math.floor((y + r) / c); cy++) {
        for (const it of this.cells.get(this.key(cx, cy)) || []) {
          if (!seen.has(it)) {
            seen.add(it);
            out.push(it);
          }
        }
      }
    }
    return out;
  }
}

// Décodage d'une polyligne encodée (précision 6 pour Valhalla).
export function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision;
  const coords = [];
  let index = 0, lat = 0, lon = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, b;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lon += delta;
    }
    coords.push([lon / factor, lat / factor]);
  }
  return coords;
}

// Générateur pseudo-aléatoire déterministe (résultats reproductibles).
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
