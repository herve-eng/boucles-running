// Types partagés par l'interface (le moteur, en JavaScript, produit ces objets).

export type LonLat = [number, number];

export type Place = {
  label: string; // ex. « Place de la République »
  detail?: string; // ex. « Paris 3e »
  coord: LonLat;
};

export type Prefs = { nature: boolean; water: boolean; lit: boolean; avoidRoads: boolean; flat: boolean };

export type LoopMetrics = {
  green: number;
  water: number;
  route: number;
  overlap: number;
  path: number | null;
  main: number | null;
  distErr: number;
};

export type Loop = {
  coords: LonLat[];
  lengthM: number;
  elevationGain: number;
  profile: [number, number][];
  score: number;
  reasons: string[];
  metrics: LoopMetrics;
};

export type Search = { start: Place; km: number; prefs: Prefs };

export type Favorite = { id: string; createdAt: number; search: Search; loop: Loop; name: string };
