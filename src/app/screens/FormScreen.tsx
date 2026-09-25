// Écran 1 : point de départ, distance, préférences.
import { useState } from 'react';
import PlaceField from '../components/PlaceField';
import { searchPlaces, reverse } from '../lib/geocode';
import { fmtDuration } from '../lib/format';
import type { Place, Prefs, Search } from '../lib/types';

const PRESETS = [
  { km: 5, label: '5 km' },
  { km: 10, label: '10 km' },
  { km: 21, label: 'Semi' },
  { km: 30, label: '30 km' },
];

const PREF_CHIPS: { key: keyof Prefs; label: string }[] = [
  { key: 'nature', label: '🌳 Nature' },
  { key: 'water', label: "💧 Bord de l'eau" },
  { key: 'avoidRoads', label: '🚗 Éviter les routes' },
  { key: 'lit', label: '💡 Éclairé' },
  { key: 'flat', label: '⛰ Peu de dénivelé' },
];

type Props = { initial: Search | null; onSubmit: (s: Search) => void; onFavorites: () => void; favoritesCount: number };

export default function FormScreen({ initial, onSubmit, onFavorites, favoritesCount }: Props) {
  const [start, setStart] = useState<Place | undefined>(initial?.start);
  const [km, setKm] = useState(initial?.km ?? 10);
  const [prefs, setPrefs] = useState<Prefs>(initial?.prefs ?? { nature: true, water: true, avoidRoads: true, lit: false, flat: false });
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string>();

  function locate() {
    if (!navigator.geolocation) return setGeoError('La localisation n’est pas disponible sur cet appareil.');
    setLocating(true);
    setGeoError(undefined);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coord: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        try {
          setStart(await reverse(coord));
        } catch {
          setStart({ label: 'Ma position', coord });
        }
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Localisation refusée. Autorise-la dans les réglages du navigateur, ou tape une adresse.'
            : window.isSecureContext
              ? 'Position introuvable. Réessaie ou tape une adresse.'
              : 'La localisation demande une adresse sécurisée (https) : elle fonctionnera une fois l’app en ligne. Tape une adresse en attendant.',
        );
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  return (
    <div className="screen">
      <header className="appbar">
        <h1>Nouvelle boucle</h1>
        <button className="icon-btn" onClick={onFavorites} aria-label="Mes favoris">
          ♡{favoritesCount > 0 && <span className="badge">{favoritesCount}</span>}
        </button>
      </header>
      <div className="body">
        <PlaceField
          label="Point de départ"
          placeholder="Ex. Parc du Cinquantenaire, Bruxelles"
          value={start}
          onChange={setStart}
          // Les résultats proches du dernier départ utilisé passent en premier.
          search={(q, s) => searchPlaces(q, start ?? initial?.start, s)}
          action={
            <button type="button" className="gps" onClick={locate} disabled={locating}>
              {locating ? 'Recherche…' : '◎ Ma position'}
            </button>
          }
        />
        {geoError && <p className="hint warn">{geoError}</p>}

        <div className="dist">
          <div className="big">
            {km}
            <small>km</small>
          </div>
          <div className="sub">≈ {fmtDuration(km)} à 5:30/km</div>
        </div>
        <input type="range" min={3} max={42} step={1} value={km} onChange={(e) => setKm(+e.target.value)} aria-label="Distance en kilomètres" />
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.km} type="button" className={km === p.km ? 'on' : ''} onClick={() => setKm(p.km)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="section-t">Je préfère</div>
        <div className="chips">
          {PREF_CHIPS.map((c) => (
            <button key={c.key} type="button" className="chip" aria-pressed={prefs[c.key]} onClick={() => setPrefs({ ...prefs, [c.key]: !prefs[c.key] })}>
              {c.label}
            </button>
          ))}
        </div>

        <button className="cta" disabled={!start} onClick={() => start && onSubmit({ start, km, prefs })}>
          {start ? 'TROUVER MES BOUCLES' : 'CHOISIS UN POINT DE DÉPART'}
        </button>
        <p className="fine">3 propositions en 10 à 15 s · données © OpenStreetMap</p>
      </div>
    </div>
  );
}
