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
  };
};

// Type de lieu en clair, pour distinguer des homonymes (la place, la station…).
const TYPE_FR: Record<string, string> = {
  square: 'place',
  pedestrian: 'voie piétonne',
  station: 'station',
  halt: 'gare',
  subway_entrance: 'entrée de métro',
  stop: 'arrêt',
  platform: 'arrêt',
  park: 'parc',
  garden: 'jardin',
  wood: 'bois',
  forest: 'forêt',
  nature_reserve: 'réserve naturelle',
  bridge: 'pont',
  city: 'ville',
  town: 'ville',
  village: 'village',
  suburb: 'quartier',
  neighbourhood: 'quartier',
  quarter: 'quartier',
  house: 'adresse',
  residential: 'rue',
  primary: 'rue',
  secondary: 'rue',
  tertiary: 'rue',
  living_street: 'rue',
  stadium: 'stade',
  track: 'piste',
  sports_centre: 'centre sportif',
};

function toPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const label = p.name || street || p.city || 'Point sans nom';
  const type = TYPE_FR[p.osm_value ?? ''];
  const detail = [type, p.name && street && street !== p.name ? street : null, p.city && p.city !== label ? p.city : null, p.city ? null : p.country]
    .filter(Boolean)
    .join(', ');
  return { label, detail: detail || undefined, coord: f.geometry.coordinates };
}

// Même nom, même description, à moins de ~300 m : on n'en garde qu'un.
function dedupe(places: Place[]) {
  const kept: Place[] = [];
  for (const p of places) {
    const twin = kept.some((k) => k.label === p.label && k.detail === p.detail && Math.abs(k.coord[0] - p.coord[0]) < 0.004 && Math.abs(k.coord[1] - p.coord[1]) < 0.003);
    if (!twin) kept.push(p);
  }
  return kept;
}

/**
 * Lieux (adresses, places, parcs, stations, villes…). La ville se tape dans
 * la même recherche (« Parc du Cinquantenaire, Bruxelles ») ; `near` fait
 * passer en premier les résultats proches (ex. dernier départ utilisé).
 */
export async function searchPlaces(q: string, near?: Place, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({ q, lang: 'fr', limit: '6' });
  if (near) {
    params.set('lat', String(near.coord[1]));
    params.set('lon', String(near.coord[0]));
    // Préférence légère pour les lieux proches : une ville tapée dans la
    // recherche (« République Paris ») doit l'emporter sur la proximité.
    params.set('zoom', '10');
    params.set('location_bias_scale', '0.5');
  }
  const res = await fetchJson(`${BASE}/api/?${params}`, { signal, tries: 2, timeoutMs: 10000 });
  return dedupe((res.features as PhotonFeature[]).map(toPlace));
}

/** Adresse la plus proche d'une position (pour « Ma position »). */
export async function reverse(coord: LonLat): Promise<Place> {
  const params = new URLSearchParams({ lat: String(coord[1]), lon: String(coord[0]), lang: 'fr' });
  const res = await fetchJson(`${BASE}/reverse?${params}`, { tries: 2, timeoutMs: 10000 });
  const f = (res.features as PhotonFeature[])[0];
  if (!f) return { label: 'Ma position', coord };
  // On garde la position exacte du téléphone, avec le nom de l'adresse la plus proche.
  return { label: 'Ma position', detail: [toPlace(f).label, f.properties.city].filter(Boolean).join(', '), coord };
}
