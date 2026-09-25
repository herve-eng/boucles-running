export const PACE_MIN_PER_KM = 5.5; // allure indicative : 5:30/km

export const fmtKm = (m: number) => (m / 1000).toFixed(1).replace('.', ',');

export function fmtDuration(km: number) {
  const min = Math.round(km * PACE_MIN_PER_KM);
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
}

export const pct = (x: number | null | undefined) => `${Math.round((x ?? 0) * 100)} %`;

export function fmtDate(t: number) {
  return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
