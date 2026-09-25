// Construit poc/results/report.html (carte + tableau) à partir de results.json.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'results');
const data = JSON.parse(await readFile(join(DIR, 'results.json'), 'utf8'));

// Allège les tracés (1 point sur 3, 5 décimales) pour garder un fichier léger.
for (const t of data.tests) {
  for (const c of t.candidates) {
    c.coords = c.coords.filter((_, i, a) => i % 3 === 0 || i === a.length - 1).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
  }
}

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Boucles – preuve de concept</title>
<link href="https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<style>
  :root { --bg:#f7f7f5; --fg:#1d1d1b; --muted:#6b6b66; --line:#e2e2dd; --ok:#1f7a4d; --ko:#b3261e; --c1:#e4572e; --c2:#2e86ab; --c3:#8e6bbf; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.45 system-ui, sans-serif; background:var(--bg); color:var(--fg); display:grid; grid-template-columns: 420px 1fr; height:100vh; }
  aside { overflow:auto; padding:16px; border-right:1px solid var(--line); }
  h1 { font-size:18px; margin:0 0 4px; } h2 { font-size:15px; margin:18px 0 6px; }
  .muted { color:var(--muted); font-size:12px; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; }
  th, td { text-align:left; padding:5px 4px; border-bottom:1px solid var(--line); }
  tr.test { cursor:pointer; } tr.test:hover, tr.sel { background:#ecebe6; }
  .ok { color:var(--ok); } .ko { color:var(--ko); font-weight:600; }
  #map { height:100vh; }
  .cand { border:1px solid var(--line); border-radius:8px; padding:8px 10px; margin:6px 0; background:#fff; }
  .cand b.dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:6px; }
  ul { margin:4px 0 0 18px; padding:0; }
  @media (max-width: 800px) { body { grid-template-columns: 1fr; grid-template-rows: 55vh auto; } #map { height:55vh; order:-1; } aside { border:0; } }
</style>
</head>
<body>
<aside>
  <h1>Boucles de course : preuve de concept</h1>
  <div class="muted">Généré le ${new Date(data.generatedAt).toLocaleString('fr-FR')} · Valhalla (FOSSGIS) + Overpass, sans clé</div>
  <div class="muted">Objectifs : écart de distance ≤ 5 %, génération &lt; 15 s, recouvrement &lt; 10 %</div>
  <h2>Résultats (cliquer une ligne)</h2>
  <table><thead><tr><th>Départ</th><th>km</th><th>Obtenu</th><th>Temps</th><th>Recouv.</th><th>Score</th></tr></thead><tbody id="rows"></tbody></table>
  <div id="detail"></div>
</aside>
<div id="map"></div>
<script>
const DATA = ${JSON.stringify(data)};
const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)'];
const HEX = ['#e4572e', '#2e86ab', '#8e6bbf'];
const startsById = Object.fromEntries(DATA.starts.map(s => [s.id, s]));
const pct = x => x == null ? '–' : Math.round(x * 100) + ' %';

const rows = document.getElementById('rows');
DATA.tests.forEach((t, i) => {
  const best = t.candidates.find(c => c.variant === t.top[0]);
  const err = best ? best.metrics.distErr : null;
  const tr = document.createElement('tr');
  tr.className = 'test'; tr.dataset.i = i;
  const s = startsById[t.startId];
  tr.innerHTML = '<td>' + s.query.split(',')[0] + '<div class="muted">' + s.city + '</div></td><td>' + t.targetKm + '</td>' +
    '<td class="' + (best && Math.abs(err) <= 0.05 ? 'ok' : 'ko') + '">' + (best ? (best.lengthM / 1000).toFixed(2) + ' km<br><span class="muted">' + (err * 100).toFixed(1) + ' %</span>' : 'échec') + '</td>' +
    '<td class="' + (t.ms <= 15000 ? 'ok' : 'ko') + '">' + (t.ms / 1000).toFixed(1) + ' s<div class="muted">' + t.calls + ' appels</div></td>' +
    '<td class="' + (best && best.metrics.overlap < 0.1 ? 'ok' : 'ko') + '">' + (best ? pct(best.metrics.overlap) : '–') + '</td>' +
    '<td>' + (best ? best.score : '–') + '</td>';
  tr.onclick = () => show(i);
  rows.appendChild(tr);
});

const map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/positron', center: [3.4, 49.8], zoom: 6 });
map.addControl(new maplibregl.NavigationControl());
let markers = [];

// Au premier affichage, le conteneur de la carte peut ne pas encore avoir de taille.
function fit(b, instant) {
  const c = map.getContainer();
  if (c.clientWidth < 100 || c.clientHeight < 100) return setTimeout(() => fit(b, instant), 200);
  map.resize();
  map.fitBounds(b, { padding: 40, duration: instant ? 0 : 600 });
}

function show(i, instant = false) {
  document.querySelectorAll('tr.test').forEach(r => r.classList.toggle('sel', +r.dataset.i === i));
  const t = DATA.tests[i];
  const s = startsById[t.startId];
  const topCands = t.top.map(v => t.candidates.find(c => c.variant === v));
  const others = t.candidates.filter(c => !t.top.includes(c.variant));
  const fc = { type: 'FeatureCollection', features: [
    ...others.map(c => ({ type: 'Feature', properties: { rank: 9 }, geometry: { type: 'LineString', coordinates: c.coords } })),
    ...topCands.map((c, k) => ({ type: 'Feature', properties: { rank: k }, geometry: { type: 'LineString', coordinates: c.coords } })).reverse(),
  ]};
  if (map.getSource('loops')) map.getSource('loops').setData(fc);
  else {
    map.addSource('loops', { type: 'geojson', data: fc });
    map.addLayer({ id: 'loops', type: 'line', source: 'loops', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: {
      'line-color': ['match', ['get', 'rank'], 0, HEX[0], 1, HEX[1], 2, HEX[2], '#9a9a94'],
      'line-width': ['match', ['get', 'rank'], 0, 5, 1, 3.5, 2, 3.5, 1.5],
      'line-opacity': ['match', ['get', 'rank'], 0, 0.95, 9, 0.5, 0.8],
    }});
  }
  markers.forEach(m => m.remove());
  markers = [new maplibregl.Marker({ color: '#1d1d1b' }).setLngLat(s.coord).setPopup(new maplibregl.Popup().setText('Départ : ' + s.label)).addTo(map)];
  if (topCands[0]) for (const w of topCands[0].waypoints) {
    const el = document.createElement('div');
    el.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#fff;border:3px solid ' + HEX[0];
    markers.push(new maplibregl.Marker({ element: el }).setLngLat(w).addTo(map));
  }
  const b = new maplibregl.LngLatBounds();
  t.candidates.forEach(c => c.coords.forEach(p => b.extend(p)));
  fit(b, instant);

  const d = document.getElementById('detail');
  d.innerHTML = '<h2>' + s.query + ' · ' + t.targetKm + ' km</h2>' +
    '<div class="muted">Géocodé : ' + s.label + ' · ' + t.candidates.length + ' candidats · ' + t.calls + ' appels Valhalla</div>' +
    topCands.map((c, k) => '<div class="cand"><b class="dot" style="background:' + COLORS[k] + '"></b><b>#' + (k + 1) + ' · ' + (c.lengthM / 1000).toFixed(2) + ' km · D+ ' + c.elevationGain + ' m · score ' + c.score + '</b>' +
      '<ul>' + (c.reasons.length ? c.reasons.map(r => '<li>' + r + '</li>').join('') : '<li>rien de notable</li>') + '</ul>' +
      '<div class="muted">parc ' + pct(c.metrics.green) + ' · eau ' + pct(c.metrics.water) + ' · balisé ' + pct(c.metrics.route) + ' · chemins ' + pct(c.metrics.path) + ' · grands axes ' + pct(c.metrics.main) + ' · recouvrement ' + pct(c.metrics.overlap) + '</div></div>').join('') +
    (s.osm.routes.length ? '<h2>Parcours balisés à proximité (OSM)</h2><ul>' + s.osm.routes.map(r => '<li>' + r.name + ' <span class="muted">(' + r.type + ', ' + (r.lengthM / 1000).toFixed(1) + ' km dans la zone)</span></li>').join('') + '</ul>' : '');
}
map.on('load', () => DATA.tests.length && show(0, true));
</script>
</body>
</html>`;

await writeFile(join(DIR, 'report.html'), html);
console.log('Rapport écrit :', join(DIR, 'report.html'));
