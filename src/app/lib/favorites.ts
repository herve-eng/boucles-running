// Boucles favorites, enregistrées sur le téléphone uniquement (IndexedDB).
import { createStore, get, set } from 'idb-keyval';
import type { Favorite } from './types';

const store = createStore('boucles-favoris', 'favoris');
const KEY = 'liste';

export async function listFavorites(): Promise<Favorite[]> {
  try {
    return ((await get(KEY, store)) as Favorite[] | undefined) ?? [];
  } catch {
    return [];
  }
}

export async function saveFavorites(list: Favorite[]) {
  await set(KEY, list, store);
}
