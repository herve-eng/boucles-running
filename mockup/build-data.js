// Extrait un test de poc/results/results.json vers mockup/data.js.
//   node mockup/build-data.js [startId] [km]   (défaut : paris-republique 10)
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [startId = 'paris-republique', km = '10'] = process.argv.slice(2);

const data = JSON.parse(await readFile(join(HERE, '..', 'poc', 'results', 'results.json'), 'utf8'));
const test = data.tests.find((t) => t.startId === startId && t.targetKm === +km);
if (!test) throw new Error(`Test introuvable : ${startId} ${km} km`);
const start = data.starts.find((s) => s.id === startId);

const round5 = (x) => +x.toFixed(5);
const loops = test.top
  .map((v) => test.candidates.find((c) => c.variant === v))
  .map((c) => ({
    lengthM: c.lengthM,
    elevationGain: c.elevationGain,
    score: c.score,
    reasons: c.reasons,
    metrics: c.metrics,
    profile: c.profile,
    coords: c.coords.filter((_, i, a) => i % 2 === 0 || i === a.length - 1).map(([x, y]) => [round5(x), round5(y)]),
  }));

const demo = { start: { label: start.label, coord: start.coord, query: start.query }, targetKm: test.targetKm, loops };
await writeFile(join(HERE, 'data.js'), `// Données réelles : ${start.query}, ${test.targetKm} km (sortie de npm run poc).\nwindow.DEMO = ${JSON.stringify(demo)};\n`);
console.log(`mockup/data.js : ${start.query}, ${test.targetKm} km, ${loops.length} boucles`);
