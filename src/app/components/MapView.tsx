// Carte MapLibre (fond OpenFreeMap) affichant les boucles et le départ.
import { useEffect, useRef } from 'react';
import { Map as MlMap, Marker, LngLatBounds, GeolocateControl, AttributionControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre cherche son « worker » (dessin de la carte en arrière-plan) à côté
// de son propre fichier, que Vite déplace : on le fait empaqueter par Vite.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { LonLat, Loop } from '../lib/types';

setWorkerUrl(maplibreWorkerUrl);

export const LOOP_COLORS = ['#ff5a1f', '#2e86ab', '#8e6bbf'];
const STYLE = 'https://tiles.openfreemap.org/styles/positron';

type Props = {
  loops: Loop[];
  selected: number;
  start: LonLat;
  /** 'all' : cadre toutes les boucles ; 'selected' : seulement celle choisie. */
  focus: 'all' | 'selected';
  padding?: { top: number; bottom: number; left: number; right: number };
  /** Mode course : suit la position de l'utilisateur. */
  follow?: boolean;
  onGeolocateError?: (message: string) => void;
};

function loopsData(loops: Loop[], selected: number, focus: Props['focus']) {
  return {
    type: 'FeatureCollection' as const,
    features: loops
      .map((l, i) => ({
        type: 'Feature' as const,
        properties: { i, sel: i === selected ? 1 : 0 },
        geometry: { type: 'LineString' as const, coordinates: l.coords },
      }))
      .filter((f) => focus === 'all' || f.properties.sel === 1)
      // La boucle sélectionnée est dessinée en dernier, donc au-dessus.
      .sort((a, b) => a.properties.sel - b.properties.sel),
  };
}

export default function MapView({ loops, selected, start, focus, padding = { top: 40, bottom: 40, left: 30, right: 30 }, follow, onGeolocateError }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);
  const startMarker = useRef<Marker | null>(null);

  // Création de la carte (une seule fois).
  useEffect(() => {
    const map = new MlMap({ container: container.current!, style: STYLE, center: start, zoom: 13, attributionControl: false });
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map: MlMap }).__map = map; // inspection en développement
    const el = document.createElement('div');
    el.className = 'start-marker';
    startMarker.current = new Marker({ element: el }).setLngLat(start).addTo(map);

    if (follow) {
      const geo = new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true });
      map.addControl(geo, 'top-right');
      geo.on('error', (e: { message?: string }) => onGeolocateError?.(e.message || 'Position indisponible'));
      map.on('load', () => geo.trigger());
    }

    map.on('load', () => {
      map.addSource('loops', { type: 'geojson', data: loopsData(loops, selected, focus) });
      const color = ['match', ['get', 'i'], 0, LOOP_COLORS[0], 1, LOOP_COLORS[1], LOOP_COLORS[2]];
      map.addLayer({ id: 'loops-casing', type: 'line', source: 'loops', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['case', ['==', ['get', 'sel'], 1], 9, 6] } });
      map.addLayer({
        id: 'loops',
        type: 'line',
        source: 'loops',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': color as never, 'line-width': ['case', ['==', ['get', 'sel'], 1], 5, 3], 'line-opacity': ['case', ['==', ['get', 'sel'], 1], 1, 0.55] },
      });
      readyRef.current = true;
      fitRef.current();
    });
    // Le conteneur peut changer de taille (mise en page initiale, rotation…) :
    // on redimensionne et on recadre, sauf en mode course (la carte suit le coureur).
    let refit: number | undefined;
    const ro = new ResizeObserver(() => {
      map.resize();
      window.clearTimeout(refit);
      if (!follow) refit = window.setTimeout(() => fitRef.current(), 150);
    });
    ro.observe(container.current!);
    return () => {
      window.clearTimeout(refit);
      ro.disconnect();
      readyRef.current = false;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fit() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const shown = focus === 'all' ? loops : loops.slice(selected, selected + 1);
    const b = new LngLatBounds(start, start);
    shown.forEach((l) => l.coords.forEach((p) => b.extend(p)));
    map.fitBounds(b, { padding, duration: 500, maxZoom: 16 });
  }
  // Toujours la version à jour de fit() pour les rappels créés au montage.
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // Mise à jour des boucles et du cadrage.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource('loops') as GeoJSONSource | undefined)?.setData(loopsData(loops, selected, focus));
    startMarker.current?.setLngLat(start);
    if (!follow) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loops, selected, focus, start[0], start[1], padding.bottom]);

  return <div ref={container} className="map" />;
}
