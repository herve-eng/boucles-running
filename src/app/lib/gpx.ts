// Export GPX d'une boucle, importable dans Garmin Connect (Parcours → Importer),
// Strava, Komoot, Coros, Suunto…
import type { Loop } from './types';

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

export function loopName(loop: Loop, startLabel: string) {
  return `Boucle ${(loop.lengthM / 1000).toFixed(1).replace('.', ',')} km – ${startLabel}`;
}

export function toGpx(loop: Loop, name: string) {
  const pts = loop.coords.map(([lon, lat]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Boucles" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(name)}</name><time>${new Date().toISOString()}</time></metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <type>running</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

// Nom de fichier sans accents ni caractères spéciaux (certains outils les refusent).
export function gpxFileName(name: string) {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${base || 'boucle'}.gpx`;
}

/**
 * Sur téléphone : feuille de partage du système (« Enregistrer dans Fichiers »,
 * « Garmin Connect »…). Sinon : téléchargement classique.
 */
export async function exportGpx(loop: Loop, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const fileName = gpxFileName(name);
  const file = new File([toGpx(loop, name)], fileName, { type: 'application/gpx+xml' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled';
      // Partage refusé par le système : on retombe sur le téléchargement.
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}
