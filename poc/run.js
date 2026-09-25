// Preuve de concept : génère des boucles pour 6 départs (Paris, Bruxelles)
// et 3 distances, puis écrit poc/results/results.json.
//   npm run poc                 -> tous les tests
//   npm run poc -- bruxelles 5  -> filtre sur le départ et/ou la distance
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './lib/node-setup.js';
import { fetchJson, stats } from '../src/engine/net.js';
import { makeProjection } from '../src/engine/geo.js';
import { loadContext } from './lib/overpass.js';
import { loadTileContext, contextRadius } from '../src/engine/context-tiles.js';
import { generateLoops } from '../src/engine/loop.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const STARTS = [
  { id: 'paris-republique', city: 'Paris', query: 'Place de la République, Paris' },
  { id: 'paris-bir-hakeim', city: 'Paris', query: 'Pont de Bir-Hakeim, Paris' },
  { id: 'paris-porte-doree', city: 'Paris', query: 'Porte Dorée, Paris' },
  { id: 'bruxelles-grand-place', city: 'Bruxelles', query: 'Grand-Place, Bruxelles' },
  { id: 'bruxelles-cinquantenaire', city: 'Bruxelles', query: 'Parc du Cinquantenaire, Bruxelles' },
  { id: 'bruxelles-cambre', city: 'Bruxelles', query: 'Bois de la Cambre, Bruxelles' },
];
const DISTANCES = [5, 10, 21];

async function geocode(q) {
  const url = `https://photon.komoot.io/api/?${new URLSearchParams({ q, limit: 1 })}`;
  const f = (await fetchJson(url)).features[0];
  return { coord: f.geometry.coordinates, label: [f.properties.name, f.properties.city].filter(Boolean).join(', ') };
}

const args = process.argv.slice(2);
const startFilter = args.find((a) => isNaN(+a));
const distFilter = args.filter((a) => !isNaN(+a)).map(Number);

const results = { generatedAt: new Date().toISOString(), tests: [], starts: [] };
for (const s of STARTS.filter((s) => !startFilter || s.id.includes(startFilter))) {
  const g = await geocode(s.query);
  const proj = makeProjection(g.coord[1], g.coord[0]);
  // Contexte assez large pour la plus grande boucle : le tracé reste dans un
  // disque de rayon ≈ diamètre du cercle (21 km -> ~5 km).
  const maxD = Math.max(...(distFilter.length ? distFilter : DISTANCES));
  // Par défaut, comme l'app : tuiles vectorielles. POC_OVERPASS=1 : ancienne source.
  const ctx = process.env.POC_OVERPASS
    ? await loadContext(g.coord, contextRadius(maxD), proj)
    : await loadTileContext(g.coord, contextRadius(maxD), proj);
  console.log(`\n▶ ${s.query} -> ${g.label} ${g.coord.map((v) => v.toFixed(5))}`);
  console.log(`  Contexte (${ctx.source.kind}) : ${ctx.greens.length} espaces verts, ${ctx.waterAreas.length} plans d'eau, ${ctx.routes.length} parcours balisés (${ctx.source.ms} ms)`);
  results.starts.push({ ...s, ...g, osm: { greens: ctx.greens.length, waterAreas: ctx.waterAreas.length, routes: ctx.routes.slice(0, 8) } });

  for (const d of DISTANCES.filter((d) => !distFilter.length || distFilter.includes(d))) {
    const netBefore = stats.network;
    const out = await generateLoops(g.coord, d, ctx, proj, { seed: d * 7 + s.id.length });
    const best = out.candidates.find((c) => c.variant === out.top[0]);
    results.tests.push({ startId: s.id, targetKm: d, ...out, networkCalls: stats.network - netBefore });
    const m = best?.metrics;
    console.log(
      `  ${String(d).padStart(2)} km : ${out.candidates.length} candidats, ${out.calls} appels, ${(out.ms / 1000).toFixed(1)} s` +
        (best ? ` | meilleure ${(best.lengthM / 1000).toFixed(2)} km (${(m.distErr * 100).toFixed(1)} %), score ${best.score}, recouvrement ${Math.round(m.overlap * 100)} %, D+ ${best.elevationGain} m` : ' | aucune boucle'),
    );
    if (best) console.log(`       ${best.reasons.join(' · ') || '(rien de notable)'}`);
  }
}

await mkdir(join(HERE, 'results'), { recursive: true });
await writeFile(join(HERE, 'results', 'results.json'), JSON.stringify(results));
console.log(`\nAppels réseau : ${stats.network} (cache : ${stats.cached}, échecs réessayés : ${stats.retries})`);
