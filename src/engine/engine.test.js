// Tests du moteur (sans réseau) : npm test
import { describe, expect, it } from 'vitest';
import { decodePolyline, lineLength, makeProjection, pointInRings } from './geo.js';
import { trimSpurs } from './spurs.js';
import { elevation, overlapShare, scoreLoop } from './score.js';
import { createContext, addGreen, addWaterLine, greenAt, waterNear } from './context.js';
import { tilesAround, contextRadius } from './context-tiles.js';
import { profileFor } from './preferences.js';
import { resample } from './geo.js';

const id = (p) => p;
const square = (x0, y0, s) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]];

describe('géométrie', () => {
  it('décode une polyligne Valhalla (précision 6)', () => {
    // Exemple de la documentation Google, ré-encodé en précision 5.
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  });
  it('projection locale aller-retour', () => {
    const proj = makeProjection(48.85, 2.35);
    const [lon, lat] = proj.toLonLat(proj.toXY([2.36, 48.86]));
    expect(lon).toBeCloseTo(2.36, 9);
    expect(lat).toBeCloseTo(48.86, 9);
  });
  it('point dans un polygone à trou (pair-impair)', () => {
    const rings = [square(0, 0, 100), square(40, 40, 20)];
    expect(pointInRings([10, 10], rings)).toBe(true);
    expect(pointInRings([50, 50], rings)).toBe(false); // dans le trou
  });
});

describe('culs-de-sac', () => {
  it('coupe un aller-retour par le même chemin', () => {
    const p = [[0, 0], [100, 0], [200, 0], [200, -50], [200, -100], [200, -50], [200, 0], [300, 0], [400, 0], [400, 400], [0, 400], [0, 0]];
    const r = trimSpurs(p, p, id);
    expect(r.count).toBe(1);
    expect(r.removedM).toBeGreaterThan(190);
  });
  it('coupe un aller-retour par les trottoirs opposés', () => {
    const p = [[0, 0], [100, 0], [195, 0], [195, -100], [205, -100], [205, 0], [300, 0], [400, 0], [400, 400], [0, 400], [0, 0]];
    expect(trimSpurs(p, p, id).count).toBe(1);
  });
  it('ne touche pas une vraie boucle', () => {
    const sq = square(0, 0, 400);
    expect(trimSpurs(sq, sq, id).count).toBe(0);
  });
});

describe('dénivelé', () => {
  it('ignore le bruit sur terrain plat', () => {
    const noisy = Array.from({ length: 334 }, (_, i) => [i * 30, 40 + (i % 2 ? 3 : -3)]);
    expect(elevation(noisy).gain).toBeLessThan(10);
  });
  it('mesure une vraie colline', () => {
    const hill = Array.from({ length: 334 }, (_, i) => [i * 30, 40 + 60 * Math.sin((Math.PI * i) / 333)]);
    expect(elevation(hill).gain).toBeGreaterThan(50);
    expect(elevation(hill).gain).toBeLessThanOrEqual(60);
  });
});

describe('notation', () => {
  it('compte la part en parc et au bord de l’eau', () => {
    const ctx = createContext();
    addGreen(ctx, [square(0, -50, 1000)], 'Parc test'); // couvre le côté bas
    addWaterLine(ctx, [[-100, 1030], [1100, 1030]], 'Rivière test'); // longe le côté haut
    const loop = square(0, 0, 1000);
    const { metrics, reasons } = scoreLoop(loop, ctx, 4000);
    expect(greenAt(ctx, [500, 0])?.name).toBe('Parc test');
    expect(waterNear(ctx, [500, 1000])?.name).toBe('Rivière test');
    expect(metrics.green).toBeGreaterThan(0.2);
    expect(metrics.water).toBeGreaterThan(0.2);
    expect(Math.abs(metrics.distErr)).toBeLessThan(0.01);
    expect(reasons.join(' ')).toContain('Parc test');
  });
  it('détecte les allers-retours longs', () => {
    const outBack = [[0, 0], [2000, 0], [0, 0]];
    const s = resample(outBack, 20);
    expect(overlapShare(s, lineLength(outBack))).toBeGreaterThan(0.8);
  });
});

describe('préférences et tuiles', () => {
  it('« éviter les routes » pénalise plus les grands axes', () => {
    expect(profileFor({ avoidRoads: true }).weights.main).toBeLessThan(profileFor({ avoidRoads: false }).weights.main);
    expect(profileFor({ lit: true }).pedestrian.use_lit).toBe(1);
  });
  it('nombre de tuiles raisonnable selon la distance', () => {
    const paris = [2.35, 48.86];
    expect(tilesAround(paris, contextRadius(5)).length).toBeLessThanOrEqual(9);
    expect(tilesAround(paris, contextRadius(21)).length).toBeLessThanOrEqual(36);
  });
});
