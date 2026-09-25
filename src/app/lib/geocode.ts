// Recherche d'adresses avec Photon (komoot), qui accepte l'autocomplétion.
import { fetchJson } from '../../engine/net.js';
import type { LonLat, Place } from './types';

const BASE = 'https://photon.komoot.io';

type PhotonFeature = {
  geometry: { coordinates: LonLat };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    district?: string;
    postcode?: string;
    state?: string;
    country?: string;
    osm_value?: string;
    extent?: [number, number, number, number];
  };
};

function toPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const label = p.name || street || p.city || 'Point sans nom';
  const detail = [p.name && street && street !== p.name ? street : null, p.city && p.city !== label ? p.city : null, p.city ? null : p.country]
    .filter(Boolean)
    .join(', ');
  return { label, detail: detail || undefined, coord: f.geometry.coordinates, extent: p.extent };
}

// Deux résultats au même endroit avec le même nom : on n'en garde qu'un.
function dedupe(places: Place[]) {
  const seen = new Set<string>();
  return places.filter((p) => {
    const k = `${p.label}|${p.coord.map((v) => v.toFixed(3)).join(',')}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Villes correspondant au texte saisi. */
export async function searchCities(q: string, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({ q, lang: 'fr', limit: '6' });
  for (const tag of ['place:city', 'place:town', 'place:village', 'place:municipality']) params.append('osm_tag', tag);
  const res = await fetchJson(`${BASE}/api/?${params}`, { signal, tries: 2, timeoutMs: 10000 });
  return dedupe((res.features as PhotonFeature[]).map(toPlace));
}

/** Lieux (adresses, places, parcs, stations…), de préférence dans la ville choisie. */
export async function searchPlaces(q: string, city?: Place, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({ q, lang: 'fr', limit: '6' });
  if (city) {
    params.set('lat', String(city.coord[1]));
    params.set('lon', String(city.coord[0]));
    if (city.extent) {
      const [w, n, e, s] = city.extent;
      params.set('bbox', [w, s, e, n].join(','));
    }
  }
  const res = await fetchJson(`${BASE}/api/?${params}`, { signal, tries: 2, timeoutMs: 10000 });
  return dedupe((res.features as PhotonFeature[]).map(toPlace));
}

/** Adresse la plus proche d'une position (pour « Ma position »). */
export async function reverse(coord: LonLat): Promise<{ place: Place; city?: Place }> {
  const params = new URLSearchParams({ lat: String(coord[1]), lon: String(coord[0]), lang: 'fr' });
  const res = await fetchJson(`${BASE}/reverse?${params}`, { tries: 2, timeoutMs: 10000 });
  const f = (res.features as PhotonFeature[])[0];
  if (!f) return { place: { label: 'Ma position', coord } };
  const near = toPlace(f);
  const cityName = f.properties.city;
  return {
    // On garde la position exacte du téléphone, avec le nom de l'adresse la plus proche.
    place: { label: 'Ma position', detail: [near.label, cityName].filter(Boolean).join(', '), coord },
    city: cityName ? { label: cityName, coord } : undefined,
  };
}
