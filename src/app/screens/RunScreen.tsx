// Mode course : la boucle en plein écran, la position suivie en direct,
// et l'écran maintenu allumé pendant la course.
import { useEffect, useState } from 'react';
import MapView from '../components/MapView';
import { fmtKm } from '../lib/format';
import type { Loop, Search } from '../lib/types';

type Props = { search: Search; loops: Loop[]; selected: number; onStop: () => void };

export default function RunScreen({ search, loops, selected, onStop }: Props) {
  const [geoError, setGeoError] = useState<string>();

  // Garde l'écran allumé (si le navigateur le permet).
  useEffect(() => {
    let lock: WakeLockSentinel | undefined;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock?.request('screen');
      } catch {
        /* refusé ou non supporté : sans gravité */
      }
    };
    acquire();
    const onVisible = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, []);

  return (
    <div className="screen map-screen">
      <MapView
        loops={loops}
        selected={selected}
        start={search.start.coord}
        focus="selected"
        follow
        onGeolocateError={() =>
          setGeoError(window.isSecureContext ? 'Position indisponible : vérifie que la localisation est autorisée.' : 'Le suivi de position fonctionnera une fois l’app en ligne (https).')
        }
      />
      <div className="run-bar">
        <div>
          <b>{fmtKm(loops[selected].lengthM)} km</b>
          <span>{search.start.label}</span>
        </div>
        <button className="btn" onClick={onStop}>
          Terminer
        </button>
      </div>
      {geoError && <p className="toast floating">{geoError}</p>}
    </div>
  );
}
