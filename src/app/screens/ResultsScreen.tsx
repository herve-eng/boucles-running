// Écran 2 : les 3 boucles proposées sur la carte, avec leurs points forts.
import MapView, { LOOP_COLORS } from '../components/MapView';
import { fmtDuration, fmtKm, pct } from '../lib/format';
import type { Loop, Search } from '../lib/types';

type Props = {
  search: Search;
  loops: Loop[];
  selected: number;
  onSelect: (i: number) => void;
  onOpen: (i: number) => void;
  onBack: () => void;
  onRetry: () => void;
};

// Les explications du moteur, raccourcies pour tenir sur une étiquette.
const shortTag = (r: string) =>
  r
    .replace(/\s*\(.*?\)/, '')
    .replace('sur chemins/voies piétonnes', 'chemins piétons')
    .replace("au bord de l'eau", "bord de l'eau")
    .replace('sur des parcours balisés', 'balisé')
    .replace('en parc/bois', 'parc/bois');
const placeOf = (r: string) => (r.match(/\((.*?)\)/) || [])[1];

export default function ResultsScreen({ search, loops, selected, onSelect, onOpen, onBack, onRetry }: Props) {
  return (
    <div className="screen map-screen">
      <MapView loops={loops} selected={selected} start={search.start.coord} focus="all" padding={{ top: 80, bottom: 270, left: 30, right: 30 }} />
      <div className="overlay-top">
        <button className="icon-btn" onClick={onBack} aria-label="Modifier la recherche">
          ←
        </button>
        <div className="pill">
          {search.start.label} · {search.km} km
        </div>
        <button className="icon-btn" onClick={onRetry} aria-label="Proposer d'autres boucles">
          ↻
        </button>
      </div>
      <div className="sheet">
        <div className="grab" />
        <h2>
          {loops.length} boucle{loops.length > 1 ? 's' : ''} trouvée{loops.length > 1 ? 's' : ''}
        </h2>
        <div className="cards">
          {loops.map((l, i) => {
            const places = [...new Set(l.reasons.map(placeOf).filter(Boolean))].slice(0, 2).join(' · ');
            const m = l.metrics;
            return (
              <button key={i} className={`lcard${i === selected ? ' sel' : ''}`} style={{ '--c': LOOP_COLORS[i] } as React.CSSProperties} onClick={() => (i === selected ? onOpen(i) : onSelect(i))}>
                <span className="lcard-top">
                  <span className="dot" />
                  <span className="km">{fmtKm(l.lengthM)} km</span>
                  <span className="meta">
                    D+ {l.elevationGain} m<br />
                    {fmtDuration(l.lengthM / 1000)}
                  </span>
                </span>
                {places && <span className="places">{places}</span>}
                <span className="tags">
                  {l.reasons.map((r, k) => (
                    <span key={k} className={`tag${r.startsWith('⚠') ? ' warn' : ''}`}>
                      {shortTag(r)}
                    </span>
                  ))}
                </span>
                <span className="bar">
                  <span style={{ width: pct(m.green), background: 'var(--green)' }} />
                  <span style={{ width: pct(m.water), background: 'var(--water)' }} />
                </span>
                <span className="legend">
                  <span>
                    <i style={{ background: 'var(--green)' }} />
                    parc {pct(m.green)}
                  </span>
                  <span>
                    <i style={{ background: 'var(--water)' }} />
                    eau {pct(m.water)}
                  </span>
                </span>
                <span className="open-hint">{i === selected ? 'Toucher pour le détail →' : ' '}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
