// Cache persistant du navigateur (IndexedDB) pour les réponses réseau :
// tuiles de contexte, itinéraires, recherches d'adresses. Les entrées de
// plus de 30 jours sont purgées au démarrage pour ne pas grossir sans fin.
import { createStore, get, set, entries, delMany } from 'idb-keyval';

const store = createStore('boucles-cache', 'responses');
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

type Entry = { v: unknown; t: number };

export const netCache = {
  async get(key: string) {
    try {
      const e = (await get(key, store)) as Entry | undefined;
      return e && Date.now() - e.t < MAX_AGE_MS ? e.v : undefined;
    } catch {
      return undefined; // navigation privée, stockage bloqué… : on fait sans cache
    }
  },
  async set(key: string, v: unknown) {
    try {
      await set(key, { v, t: Date.now() } satisfies Entry, store);
    } catch {
      /* stockage plein ou indisponible : sans conséquence */
    }
  },
};

export async function purgeOldEntries() {
  try {
    const old = (await entries(store)).filter(([, e]) => Date.now() - (e as Entry).t >= MAX_AGE_MS).map(([k]) => k);
    if (old.length) await delMany(old, store);
  } catch {
    /* idem */
  }
}
