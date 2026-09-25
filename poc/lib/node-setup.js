// Configuration du moteur pour les scripts Node : cache disque dans
// poc/cache/, User-Agent identifiable, options de mesure.
//   POC_NO_CACHE=1 : ne relit pas le cache Valhalla (mesure des vrais temps)
//   POC_DEBUG=1    : affiche la durée de chaque appel réseau
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureNet } from '../../src/engine/net.js';

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'cache');

const fileCache = {
  async get(key) {
    // Tuiles (binaire) en .pbf, le reste en .json.
    try {
      return new Uint8Array(await readFile(join(CACHE_DIR, `${key}.pbf`)));
    } catch {}
    try {
      return JSON.parse(await readFile(join(CACHE_DIR, `${key}.json`), 'utf8'));
    } catch {
      return undefined;
    }
  },
  async set(key, value) {
    await mkdir(CACHE_DIR, { recursive: true });
    if (value instanceof Uint8Array) await writeFile(join(CACHE_DIR, `${key}.pbf`), value);
    else await writeFile(join(CACHE_DIR, `${key}.json`), JSON.stringify(value));
  },
};

configureNet({
  cache: fileCache,
  headers: { 'User-Agent': 'boucles-running-poc/0.1 (usage personnel)', 'X-Client-Id': 'boucles-running' },
  noCacheHosts: process.env.POC_NO_CACHE ? ['valhalla1.openstreetmap.de'] : [],
  debug: !!process.env.POC_DEBUG,
  // Même format de clé que la première version des scripts (cache existant réutilisé).
  keyFn: (url, body) => `${new URL(url).host}-${createHash('sha1').update(url + '\n' + (body ?? '')).digest('hex')}`,
});
