// Accès HTTP aux services publics : cache disque, espacement des appels
// par hôte (courtoisie envers les serveurs gratuits) et nouvelles tentatives.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'cache');
const USER_AGENT = 'boucles-running-poc/0.1 (usage personnel)';

// Courtoisie par hôte : nombre d'appels simultanés et intervalle minimal
// entre deux départs d'appel (ms). Valhalla limite de toute façon le débit
// (réponses retardées au-delà d'environ 1 requête/s) : paralléliser ne sert
// à rien, c'est le nombre de requêtes qu'il faut réduire (voir valhalla.js).
const LIMITS = {
  'valhalla1.openstreetmap.de': { concurrent: 1, interval: 300 },
  'photon.komoot.io': { concurrent: 1, interval: 1000 },
  default: { concurrent: 1, interval: 1000 },
};
// POC_NO_CACHE=1 : ne relit pas le cache Valhalla (pour mesurer les vrais temps).
const NO_CACHE_HOSTS = process.env.POC_NO_CACHE ? ['valhalla1.openstreetmap.de'] : [];

const lastStart = new Map();
const active = new Map();
const waiting = new Map();
export const stats = { network: 0, cached: 0, retries: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const limits = (host) => LIMITS[host] ?? LIMITS.default;

async function acquire(host) {
  while ((active.get(host) ?? 0) >= limits(host).concurrent) {
    await new Promise((r) => {
      if (!waiting.has(host)) waiting.set(host, []);
      waiting.get(host).push(r);
    });
  }
  active.set(host, (active.get(host) ?? 0) + 1);
  // Réservation synchrone du créneau pour que les appels parallèles s'étalent.
  const now = Date.now();
  const start = Math.max(now, (lastStart.get(host) ?? 0) + limits(host).interval);
  lastStart.set(host, start);
  if (start > now) await sleep(start - now);
}

function release(host) {
  active.set(host, active.get(host) - 1);
  waiting.get(host)?.shift()?.();
}

/**
 * POST (ou GET si body absent) avec cache disque.
 * `urls` peut être une liste de miroirs : on passe au suivant en cas d'échec.
 */
export async function fetchJson(urls, { body, headers = {}, form = false, tries = 4, timeoutMs = 60000 } = {}) {
  urls = [].concat(urls);
  const key = createHash('sha1').update(urls[0] + '\n' + (body ?? '')).digest('hex');
  const cacheFile = join(CACHE_DIR, `${new URL(urls[0]).host}-${key}.json`);
  if (!NO_CACHE_HOSTS.includes(new URL(urls[0]).host)) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
      stats.cached++;
      return cached;
    } catch {}
  }

  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    const url = urls[attempt % urls.length];
    const host = new URL(url).host;
    const tQueue = Date.now();
    await acquire(host);
    const tStart = Date.now();
    try {
      stats.network++;
      const res = await fetch(url, {
        method: body ? 'POST' : 'GET',
        body: form ? new URLSearchParams({ data: body }) : body,
        headers: {
          'User-Agent': USER_AGENT,
          ...(body && !form ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (process.env.POC_DEBUG) {
        console.error(`  [http] ${new URL(url).pathname.padEnd(18)} attente ${String(tStart - tQueue).padStart(5)} ms · réseau ${String(Date.now() - tStart).padStart(5)} ms · ${res.status}`);
      }
      if (res.status === 429 || res.status >= 500) throw new Error(`${host} HTTP ${res.status}`);
      const json = JSON.parse(text);
      // Les erreurs 400 de Valhalla (ex. pas d'itinéraire) sont des réponses
      // valides : on les renvoie sans les mettre en cache.
      if (!res.ok) return json;
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(cacheFile, JSON.stringify(json));
      return json;
    } catch (err) {
      lastErr = err;
      stats.retries++;
    } finally {
      release(host);
    }
    // On n'arrive ici qu'après un échec : pause hors créneau avant de réessayer.
    await sleep(1500 * (attempt + 1));
  }
  throw lastErr;
}
