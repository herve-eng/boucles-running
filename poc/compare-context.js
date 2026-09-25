// Compare le contexte « tuiles vectorielles » (app) au contexte Overpass
// (tests) : mêmes boucles, parts en parc et au bord de l'eau selon chaque source.
//   node poc/compare-context.js
import './lib/node-setup.js';
import { readFile } from 'node:fs/promises';
import { makeProjection } from '../src/engine/geo.js';
import { loadContext } from './lib/overpass.js';
import { loadTileContext } from '../src/engine/context-tiles.js';
import { scoreLoop } from '../src/engine/score.js';

const data = JSON.parse(await readFile(new URL('./results/results.json', import.meta.url), 'utf8'));
const pct = (x) => `${Math.round(x * 100)}`.padStart(3) + ' %';
console.log('test'.padEnd(30), 'parc OSM  parc tuiles   eau OSM  eau tuiles   tuiles');
for (const s of data.starts) {
  const proj = makeProjection(s.coord[1], s.coord[0]);
  const radius = 21000 / Math.PI / 1.1 + 800;
  const osm = await loadContext(s.coord, radius, proj);
  const tiles = await loadTileContext(s.coord, radius, proj);
  for (const t of data.tests.filter((t) => t.startId === s.id)) {
    const c = t.candidates.find((c) => c.variant === t.top[0]);
    const xy = c.coords.map(proj.toXY);
    const a = scoreLoop(xy, osm, t.targetKm * 1000).metrics;
    const b = scoreLoop(xy, tiles, t.targetKm * 1000).metrics;
    console.log(`${s.id} ${t.targetKm}`.padEnd(30), pct(a.green).padStart(8), pct(b.green).padStart(11), pct(a.water).padStart(9), pct(b.water).padStart(11),
      `   ${tiles.source.tiles} tuiles, ${(tiles.source.bytes / 1e6).toFixed(1)} Mo`);
  }
}
