import {
  preindexMercadonaCatalog,
  type PreindexedMercadonaEntry,
  type StaticMercadonaCatalogEntry,
} from '../domain/shoppingCatalog';

export interface MercadonaCatalogAssetMeta {
  version: number;
  source: string;
  license: string;
  disclaimer: string;
  generatedAt: string;
  count: number;
}

export interface LoadedMercadonaCatalog {
  meta: MercadonaCatalogAssetMeta;
  items: PreindexedMercadonaEntry[];
}

const CATALOG_ASSET_URL = '/data/mercadona-catalog.v1.json';
const CACHE_NAME = 'nido-mercadona-catalog-v1';

let memoryCache: LoadedMercadonaCatalog | null = null;
let inFlightLoad: Promise<LoadedMercadonaCatalog> | null = null;

function parseCatalogPayload(raw: unknown): LoadedMercadonaCatalog {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Formato de catálogo inválido.');
  }
  const obj = raw as Record<string, unknown>;
  const rawItems = Array.isArray(obj.items) ? obj.items : null;
  if (!rawItems || rawItems.length === 0) {
    throw new Error('El catálogo recibido está vacío o dañado.');
  }
  const validItems: StaticMercadonaCatalogEntry[] = [];
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue;
    const rec = it as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id : '';
    const name = typeof rec.name === 'string' ? rec.name : '';
    const section = typeof rec.section === 'string' ? rec.section : 'Otros de supermercado';
    if (!id || !name) continue;
    validItems.push({
      id,
      name,
      ...(typeof rec.brand === 'string' && rec.brand ? { brand: rec.brand } : {}),
      ...(typeof rec.variant === 'string' && rec.variant ? { variant: rec.variant } : {}),
      ...(typeof rec.format === 'string' && rec.format ? { format: rec.format } : {}),
      section: section as StaticMercadonaCatalogEntry['section'],
      ...(typeof rec.defaultUnit === 'string' && rec.defaultUnit ? { defaultUnit: rec.defaultUnit } : {}),
      sourceRef: typeof rec.sourceRef === 'string' ? rec.sourceRef : id,
      source: typeof rec.source === 'string' ? rec.source : 'openfoodfacts_odbl',
      addedAt: typeof rec.addedAt === 'string' ? rec.addedAt : '',
    });
  }

  if (validItems.length === 0) {
    throw new Error('No se encontraron productos válidos en el catálogo.');
  }

  return {
    meta: {
      version: Number(obj.version ?? 1),
      source: String(obj.source ?? 'Open Food Facts (ODbL 1.0)'),
      license: String(obj.license ?? 'ODbL 1.0'),
      disclaimer: String(
        obj.disclaimer ??
          'Catálogo de referencia no oficial. El surtido puede variar según tienda y fecha.'
      ),
      generatedAt: String(obj.generatedAt ?? ''),
      count: validItems.length,
    },
    items: preindexMercadonaCatalog(validItems),
  };
}

function isLikelyJsonResponse(res: Response): boolean {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct) return true;
  return ct.includes('json') || ct.includes('text/plain');
}

async function readFromBrowserCache(): Promise<Response | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(CATALOG_ASSET_URL);
    return cached ?? null;
  } catch {
    return null;
  }
}

async function deleteFromBrowserCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(CATALOG_ASSET_URL);
  } catch {
    // Ignore CacheStorage errors
  }
}

async function writeToBrowserCache(response: Response): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(CATALOG_ASSET_URL, response);
  } catch {
    // Ignore CacheStorage quota or private-mode errors
  }
}

export async function loadMercadonaCatalogOnDemand(): Promise<LoadedMercadonaCatalog> {
  if (memoryCache) return memoryCache;
  if (inFlightLoad) return inFlightLoad;

  inFlightLoad = (async () => {
    try {
      // 1) Try CacheStorage first so already-loaded catalog works instantaneously & offline.
      // Validate payload; if cache entry is corrupt/HTML, evict it instead of failing permanently.
      const cachedRes = await readFromBrowserCache();
      if (cachedRes && cachedRes.ok) {
        try {
          if (!isLikelyJsonResponse(cachedRes)) {
            throw new Error('Respuesta en caché no es JSON');
          }
          const json = (await cachedRes.json()) as unknown;
          const parsed = parseCatalogPayload(json);
          memoryCache = parsed;
          return parsed;
        } catch {
          await deleteFromBrowserCache();
        }
      }

      // 2) Fetch on demand, validate JSON & schema BEFORE persisting in CacheStorage.
      const networkRes = await fetch(CATALOG_ASSET_URL, { cache: 'default' });
      if (!networkRes.ok) {
        throw new Error(`HTTP ${networkRes.status}`);
      }
      if (!isLikelyJsonResponse(networkRes)) {
        throw new Error('Respuesta inesperada al descargar el catálogo (no es JSON).');
      }
      const resCloneForCache = networkRes.clone();
      const json = (await networkRes.json()) as unknown;
      const parsed = parseCatalogPayload(json);
      await writeToBrowserCache(resCloneForCache);
      memoryCache = parsed;
      return parsed;
    } catch (err) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offline) {
        throw new Error(
          'El catálogo de Mercadona aún no se ha descargado en este dispositivo. Conéctate a internet para usarlo offline más adelante.'
        );
      }
      throw err;
    } finally {
      inFlightLoad = null;
    }
  })();

  return inFlightLoad;
}

export function getCachedMercadonaCatalogSync(): LoadedMercadonaCatalog | null {
  return memoryCache;
}
