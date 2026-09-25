// Enchaîne la génération d'une recherche : lecture du contexte dans les
// tuiles de la carte, puis calcul et notation des boucles par le moteur.
import { makeProjection } from '../../engine/geo.js';
import { loadTileContext, contextRadius } from '../../engine/context-tiles.js';
import { generateLoops } from '../../engine/loop.js';
import type { Loop, Search } from './types';

export type Progress = { label: string; ratio: number };

export type Generation = { loops: Loop[]; ms: number; calls: number };

// Part approximative de chaque étape dans la barre de progression.
const PHASES = { context: [0, 0.2], routes: [0.2, 0.8], score: [0.8, 0.9], elevation: [0.9, 1] } as const;

export async function generate(search: Search, { seed, onProgress, signal }: { seed: number; onProgress: (p: Progress) => void; signal: AbortSignal }): Promise<Generation> {
  const t0 = Date.now();
  const { start, km, prefs } = search;
  const proj = makeProjection(start.coord[1], start.coord[0]);

  onProgress({ label: 'Lecture de la carte…', ratio: 0.02 });
  const ctx = await loadTileContext(start.coord, contextRadius(km), proj, {
    signal,
    onProgress: (done: number, total: number) => {
      const [a, b] = PHASES.context;
      onProgress({ label: `Lecture de la carte (${done}/${total})…`, ratio: a + ((b - a) * done) / total });
    },
  });

  const out = await generateLoops(start.coord, km, ctx, proj, {
    seed,
    prefs,
    signal,
    onProgress: ({ phase, round, maxRounds }: { phase: 'routes' | 'score' | 'elevation'; round?: number; maxRounds?: number }) => {
      const [a, b] = PHASES[phase];
      if (phase === 'routes') onProgress({ label: `Recherche des itinéraires (essai ${round})…`, ratio: a + ((b - a) * (round! - 1)) / maxRounds! });
      if (phase === 'score') onProgress({ label: 'Analyse des chemins…', ratio: a });
      if (phase === 'elevation') onProgress({ label: 'Calcul du dénivelé…', ratio: a });
    },
  });

  const loops = out.top.map((v: number) => out.candidates.find((c: { variant: number }) => c.variant === v)) as Loop[];
  onProgress({ label: 'Terminé', ratio: 1 });
  return { loops, ms: Date.now() - t0, calls: out.calls };
}
