// Enchaînement des écrans et état de l'app.
import { useEffect, useRef, useState } from 'react';
import FormScreen from './screens/FormScreen';
import ResultsScreen from './screens/ResultsScreen';
import DetailScreen from './screens/DetailScreen';
import RunScreen from './screens/RunScreen';
import FavoritesScreen from './screens/FavoritesScreen';
import { generate, type Progress } from './lib/generate';
import { listFavorites, saveFavorites } from './lib/favorites';
import { loopName } from './lib/gpx';
import type { Favorite, Loop, Search } from './lib/types';

type Screen = 'form' | 'results' | 'detail' | 'run' | 'favorites';

const LAST_SEARCH_KEY = 'boucles:derniere-recherche';

function loadLastSearch(): Search | null {
  try {
    return JSON.parse(localStorage.getItem(LAST_SEARCH_KEY) || 'null');
  } catch {
    return null;
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('form');
  const [search, setSearch] = useState<Search | null>(loadLastSearch);
  const [loops, setLoops] = useState<Loop[]>([]);
  const [selected, setSelected] = useState(0);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string>();
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  // Favori ouvert depuis la liste (sinon : boucle issue de la recherche en cours).
  const [openedFavorite, setOpenedFavorite] = useState<Favorite | null>(null);
  const ctrl = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    listFavorites().then(setFavorites);
  }, []);

  // Bouton/geste « retour » du téléphone : on revient à l'écran précédent.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setScreen((e.state?.screen as Screen) ?? 'form');
    window.addEventListener('popstate', onPop);
    history.replaceState({ screen: 'form' }, '');
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (s: Screen) => {
    history.pushState({ screen: s }, '');
    setScreen(s);
  };
  const back = () => history.back();

  async function run(s: Search) {
    setSearch(s);
    setError(undefined);
    setOpenedFavorite(null);
    try {
      localStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(s));
    } catch {
      /* stockage indisponible : on ne retiendra pas la recherche */
    }
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    setProgress({ label: 'Préparation…', ratio: 0 });
    try {
      const g = await generate(s, { seed: Math.floor(Math.random() * 1e9), onProgress: setProgress, signal: ctrl.current.signal });
      if (!g.loops.length) throw new Error('aucune boucle');
      setLoops(g.loops);
      setSelected(0);
      if (screen !== 'results') go('results');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(
        (e as Error).message === 'aucune boucle'
          ? 'Aucune boucle trouvée depuis ce départ. Essaie une autre distance ou un départ plus proche d’une rue.'
          : 'Le calcul n’a pas abouti : un des services gratuits (carte ou itinéraires) ne répond pas. Réessaie dans un instant.',
      );
    } finally {
      setProgress(null);
    }
  }

  function cancel() {
    ctrl.current?.abort();
    setProgress(null);
  }

  // Boucle et recherche affichées dans le détail / la course.
  const detailSearch = openedFavorite?.search ?? search;
  const detailLoops = openedFavorite ? [openedFavorite.loop] : loops;
  const detailSelected = openedFavorite ? 0 : selected;
  const current = detailLoops[detailSelected];
  const name = openedFavorite?.name ?? (current && detailSearch ? loopName(current, detailSearch.start.label) : '');
  const favOf = (l?: Loop) => favorites.find((f) => l && f.loop.coords.length === l.coords.length && f.loop.lengthM === l.lengthM && f.loop.coords[1]?.join() === l.coords[1]?.join());

  async function toggleFavorite() {
    if (!current || !detailSearch) return;
    const existing = favOf(current);
    const next = existing
      ? favorites.filter((f) => f !== existing)
      : [{ id: crypto.randomUUID(), createdAt: Date.now(), search: detailSearch, loop: current, name }, ...favorites];
    setFavorites(next);
    await saveFavorites(next);
  }

  async function deleteFavorite(f: Favorite) {
    const next = favorites.filter((x) => x.id !== f.id);
    setFavorites(next);
    await saveFavorites(next);
  }

  return (
    <div className="app">
      {screen === 'form' && <FormScreen initial={search} onSubmit={run} onFavorites={() => go('favorites')} favoritesCount={favorites.length} />}
      {screen === 'results' && search && (
        <ResultsScreen
          search={search}
          loops={loops}
          selected={selected}
          onSelect={setSelected}
          onOpen={(i) => {
            setSelected(i);
            setOpenedFavorite(null);
            go('detail');
          }}
          onBack={back}
          onRetry={() => run(search)}
        />
      )}
      {screen === 'detail' && detailSearch && current && (
        <DetailScreen
          search={detailSearch}
          loops={detailLoops}
          selected={detailSelected}
          name={name}
          isFavorite={!!favOf(current)}
          onToggleFavorite={toggleFavorite}
          onBack={back}
          onRun={() => go('run')}
        />
      )}
      {screen === 'run' && detailSearch && current && <RunScreen search={detailSearch} loops={detailLoops} selected={detailSelected} onStop={back} />}
      {screen === 'favorites' && (
        <FavoritesScreen
          favorites={favorites}
          onOpen={(f) => {
            setOpenedFavorite(f);
            go('detail');
          }}
          onDelete={deleteFavorite}
          onBack={back}
        />
      )}

      {progress && (
        <div className="loading" role="status" aria-live="polite">
          <div className="loading-card">
            <div className="spinner" aria-hidden />
            <p>{progress.label}</p>
            <div className="progress">
              <span style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
            </div>
            <button className="btn" onClick={cancel}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="loading" role="alert">
          <div className="loading-card">
            <p>{error}</p>
            <button className="btn primary" onClick={() => setError(undefined)}>
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
