// Mes favoris : boucles enregistrées sur ce téléphone.
import { fmtDate, fmtDuration, fmtKm } from '../lib/format';
import type { Favorite } from '../lib/types';

type Props = { favorites: Favorite[]; onOpen: (f: Favorite) => void; onDelete: (f: Favorite) => void; onBack: () => void };

export default function FavoritesScreen({ favorites, onOpen, onDelete, onBack }: Props) {
  return (
    <div className="screen">
      <header className="appbar">
        <button className="icon-btn" onClick={onBack} aria-label="Retour">
          ←
        </button>
        <h1>Mes favoris</h1>
      </header>
      <div className="body">
        {favorites.length === 0 && <p className="empty">Aucun favori pour l'instant. Touche ♡ sur une boucle pour la retrouver ici.</p>}
        {favorites.map((f) => (
          <div key={f.id} className="fav">
            <button className="fav-main" onClick={() => onOpen(f)}>
              <b>{f.name}</b>
              <span>
                {fmtKm(f.loop.lengthM)} km · D+ {f.loop.elevationGain} m · {fmtDuration(f.loop.lengthM / 1000)}
              </span>
              <small>Enregistrée le {fmtDate(f.createdAt)}</small>
            </button>
            <button className="icon-btn" onClick={() => onDelete(f)} aria-label={`Supprimer ${f.name}`}>
              ✕
            </button>
          </div>
        ))}
        <p className="fine">Les favoris restent sur ce téléphone, ils ne sont partagés avec personne.</p>
      </div>
    </div>
  );
}
