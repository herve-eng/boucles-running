// Diagnostic : liste les éléments d'eau des tuiles portant un nom donné.
//   node poc/find-feature.js <lat> <lon> <nom>
import './lib/node-setup.js';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { fetchJson } from '../src/engine/net.js';
import { tilesAround, contextRadius } from '../src/engine/context-tiles.js';

const [lat, lon, name] = [+process.argv[2], +process.argv[3], process.argv[4]];
const tpl = (await fetchJson('https://tiles.openfreemap.org/planet')).tiles[0];
const seen = new Map();
for (const t of tilesAround([lon, lat], contextRadius(10))) {
  const vt = new VectorTile(new PbfReader(await fetchJson(tpl.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y), { as: 'bytes' })));
  for (const L of ['water', 'waterway']) {
    const layer = vt.layers[L];
    for (let i = 0; layer && i < layer.length; i++) {
      const p = layer.feature(i).properties;
      if ((p.name || '').includes(name)) seen.set(JSON.stringify({ couche: L, ...p, 'name:en': undefined }), 1);
    }
  }
}
for (const k of seen.keys()) console.log(k);
