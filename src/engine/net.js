// Accès HTTP aux services publics, utilisable dans le navigateur comme dans
// Node : cache (branché de l'extérieur), espacement des appels par hôte
// (courtoisie envers les serveurs gratuits) et nouvelles tentatives.

// Courtoisie par hôte : nombre d'appels simultanés et intervalle minimal
// entre deux départs d'appel (ms). Valhalla limite de toute façon le débit
// (réponses retardées au-delà d'environ 1 requête/s) : paralléliser ne sert
// à rien, c'est le nombre de requêtes qu'il faut réduire (voir valhalla.js).
const LIMITS = {
  'valhalla1.openstreetmap.de': { concurrent: 1, interval: 300 },
  'photon.komoot.io': { concurrent: 1, interval: 300 },
  'tiles.openfreemap.org': { concurrent: 6, interval: 0 },
  default: { concurrent: 1, interval: 1000 },
};

const config = {
  cache: null, // {get(key) -> Promise<valeur|undefined>, set(key, valeur) -> Promise}
  headers: {}, // en-têtes ajoutés à chaque requête (ex. User-Agent côté Node)
  noCacheHosts: [], // hôtes dont on ne relit pas le cache (mesure des vrais temps)
  debug: false,
  keyFn: null, // (url, body) -> clé de cache ; par défaut hôte + empreinte
};

/** Branche le cache et les options (appelé une fois au démarrage). */
export function configureNet(options) {
  Object.assign(config, options);
}

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

// Empreinte courte d'une chaîne (clé de cache), identique dans Node et le navigateur.
export function hashKey(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Requête HTTP avec cache. POST si `body` est fourni, GET sinon.
 * `urls` peut être une liste de miroirs : on passe au suivant en cas d'échec.
 * `as` : 'json' (défaut) ou 'bytes' (Uint8Array, pour les tuiles).
 */
export async function fetchJson(urls, { body, headers = {}, form = false, tries = 4, timeoutMs = 60000, as = 'json', signal } = {}) {
  urls = [].concat(urls);
  const host0 = new URL(urls[0]).host;
  const key = config.keyFn ? config.keyFn(urls[0], body) : `${host0}-${hashKey(urls[0] + '\n' + (body ?? ''))}`;
  if (config.cache && !config.noCacheHosts.includes(host0)) {
    const cached = await config.cache.get(key);
    if (cached !== undefined) {
      stats.cached++;
      return cached;
    }
  }

  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    signal?.throwIfAborted();
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
        headers: { ...config.headers, ...(body && !form ? { 'Content-Type': 'application/json' } : {}), ...headers },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      });
      const payload = as === 'bytes' ? new Uint8Array(await res.arrayBuffer()) : await res.text();
      if (config.debug) {
        console.error(`  [http] ${new URL(url).pathname.slice(0, 18).padEnd(18)} attente ${String(tStart - tQueue).padStart(5)} ms · réseau ${String(Date.now() - tStart).padStart(5)} ms · ${res.status}`);
      }
      if (res.status === 429 || res.status >= 500) throw new Error(`${host} HTTP ${res.status}`);
      if (as === 'bytes') {
        if (!res.ok) throw new Error(`${host} HTTP ${res.status}`);
        await config.cache?.set(key, payload);
        return payload;
      }
      const json = JSON.parse(payload);
      // Les erreurs 400 de Valhalla (ex. pas d'itinéraire) sont des réponses
      // valides : on les renvoie sans les mettre en cache.
      if (!res.ok) return json;
      await config.cache?.set(key, json);
      return json;
    } catch (err) {
      if (signal?.aborted) throw err;
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
