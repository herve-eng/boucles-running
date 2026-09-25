// Champ de saisie avec suggestions (villes ou lieux), via Photon.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Place } from '../lib/types';

type Props = {
  label: string;
  placeholder: string;
  value?: Place;
  onChange: (p: Place | undefined) => void;
  search: (q: string, signal: AbortSignal) => Promise<Place[]>;
  action?: ReactNode; // ex. bouton « Ma position »
};

export default function PlaceField({ label, placeholder, value, onChange, search, action }: Props) {
  const [text, setText] = useState(value?.label ?? '');
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const ctrl = useRef<AbortController | undefined>(undefined);

  useEffect(() => setText(value?.label ?? ''), [value]);

  function onType(q: string) {
    setText(q);
    onChange(undefined);
    setOpen(true);
    window.clearTimeout(timer.current);
    ctrl.current?.abort();
    if (q.trim().length < 3) return setResults([]);
    // On attend une courte pause dans la frappe avant d'interroger le service.
    timer.current = window.setTimeout(async () => {
      ctrl.current = new AbortController();
      try {
        setError(false);
        setResults(await search(q.trim(), ctrl.current.signal));
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError(true);
      }
    }, 350);
  }

  function pick(p: Place) {
    onChange(p);
    setText(p.label);
    setOpen(false);
    setResults([]);
  }

  return (
    <div className="field-wrap">
      <label className="field">
        <span className="field-label">{label}</span>
        <span className="field-row">
          <input value={text} placeholder={placeholder} onChange={(e) => onType(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} autoComplete="off" enterKeyHint="search" />
          {action}
        </span>
        {value?.detail && <span className="field-detail">{value.detail}</span>}
      </label>
      {open && (results.length > 0 || error) && (
        <ul className="suggest" role="listbox">
          {error && <li className="suggest-error">Recherche indisponible, réessaie dans un instant.</li>}
          {results.map((p, i) => (
            <li key={i} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
              {p.label} {p.detail && <small>· {p.detail}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
