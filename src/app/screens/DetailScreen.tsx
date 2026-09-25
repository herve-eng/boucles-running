// Écran 3 : détail d'une boucle, export GPX (Garmin), favori, départ.
import { useState } from 'react';
import MapView, { LOOP_COLORS } from '../components/MapView';
import ElevationProfile from '../components/ElevationProfile';
import { exportGpx } from '../lib/gpx';
import { fmtDuration, fmtKm } from '../lib/format';
import type { Loop, Search } from '../lib/types';

type Props = {
  search: Search;
  loops: Loop[];
  selected: number;
  name: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onBack: () => void;
  onRun: () => void;
};

export default function DetailScreen({ search, loops, selected, name, isFavorite, onToggleFavorite, onBack, onRun }: Props) {
  const loop = loops[selected];
  const color = LOOP_COLORS[selected] ?? LOOP_COLORS[0];
  const [toast, setToast] = useState<string>();

  async function onExport() {
    const r = await exportGpx(loop, name);
    if (r === 'downloaded') setToast('Fichier GPX téléchargé. Importe-le dans Garmin Connect : Entraînement → Parcours → Importer.');
    if (r === 'shared') setToast('Fichier GPX partagé.');
    if (r !== 'cancelled') setTimeout(() => setToast(undefined), 7000);
  }

  return (
    <div className="screen detail">
      <div className="mapbox">
        <MapView loops={loops} selected={selected} start={search.start.coord} focus="selected" padding={{ top: 70, bottom: 24, left: 24, right: 24 }} />
        <div className="overlay-top">
          <button className="icon-btn" onClick={onBack} aria-label="Retour">
            ←
          </button>
          <div style={{ flex: 1 }} />
          <button className={`icon-btn${isFavorite ? ' fav-on' : ''}`} onClick={onToggleFavorite} aria-label={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}>
            {isFavorite ? '♥' : '♡'}
          </button>
        </div>
      </div>
      <div className="body">
        <h2 className="loop-name">{name}</h2>
        <div className="stats">
          <div className="stat">
            <b>{fmtKm(loop.lengthM)} km</b>
            <span>distance</span>
          </div>
          <div className="stat">
            <b>{loop.elevationGain} m</b>
            <span>dénivelé +</span>
          </div>
          <div className="stat">
            <b>{fmtDuration(loop.lengthM / 1000)}</b>
            <span>à 5:30/km</span>
          </div>
        </div>
        <div className="card">
          <div className="section-t">Profil d'altitude</div>
          <ElevationProfile profile={loop.profile} color={color} />
        </div>
        <div className="card">
          <div className="section-t">Pourquoi cette boucle</div>
          <ul className="why">{loop.reasons.length ? loop.reasons.map((r, i) => <li key={i}>{r}</li>) : <li>Parcours urbain, sans parc ni bord de l'eau notable.</li>}</ul>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={onRun}>
            ▶ DÉMARRER
          </button>
          <button className="btn" onClick={onExport}>
            ⤓ Exporter GPX (Garmin)
          </button>
          <button className="btn" onClick={onToggleFavorite}>
            {isFavorite ? '♥ Dans mes favoris' : '♡ Ajouter aux favoris'}
          </button>
        </div>
        {toast && (
          <p className="toast" role="status">
            {toast}
          </p>
        )}
      </div>
    </div>
  );
}
