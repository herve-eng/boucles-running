import { describe, expect, it } from 'vitest';
import { gpxFileName, loopName, toGpx } from './gpx';
import type { Loop } from './types';

const loop = {
  coords: [[2.3639, 48.8675], [2.37, 48.87], [2.3639, 48.8675]],
  lengthM: 10240,
  elevationGain: 46,
  profile: [],
  score: 26,
  reasons: [],
  metrics: { green: 0, water: 0, route: 0, overlap: 0, path: null, main: null, distErr: 0 },
} as Loop;

describe('export GPX', () => {
  it('produit un GPX 1.1 valide avec tous les points (lat puis lon)', () => {
    const gpx = toGpx(loop, 'Boucle 10,2 km – Place de la République & co');
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx.match(/<trkpt /g)).toHaveLength(3);
    expect(gpx).toContain('<trkpt lat="48.867500" lon="2.363900"/>');
    expect(gpx).toContain('&amp; co'); // caractères spéciaux échappés
    expect(new DOMParserLike(gpx).ok).toBe(true);
  });
  it('nom de boucle et de fichier lisibles', () => {
    const name = loopName(loop, 'Place de la République');
    expect(name).toBe('Boucle 10,2 km – Place de la République');
    expect(gpxFileName(name)).toBe('boucle-10-2-km-place-de-la-republique.gpx');
  });
});

// Vérification minimale de bonne formation XML (balises ouvertes = fermées).
class DOMParserLike {
  ok: boolean;
  constructor(xml: string) {
    const stack: string[] = [];
    this.ok = true;
    for (const [, close, name, self] of xml.replace(/<\?.*?\?>/g, '').matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
      if (self) continue;
      if (close) this.ok &&= stack.pop() === name;
      else stack.push(name);
    }
    this.ok &&= stack.length === 0;
  }
}
