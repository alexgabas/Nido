#!/usr/bin/env node
/**
 * Actualizador reanudable y gratuito del catálogo de referencia de Mercadona para Nido.
 *
 * Fuente primaria utilizada:
 *   - Open Food Facts (https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz)
 *   - Open Beauty Facts (https://static.openbeautyfacts.org/data/en.openbeautyfacts.org.products.csv.gz)
 *   - Open Products Facts (https://static.openproductsfacts.org/data/en.openproductsfacts.org.products.csv.gz)
 *
 * Licencia de la fuente:
 *   Open Database License (ODbL 1.0) / Database Contents License (DbCL 1.0).
 *   Atribución: "Data from Open Food Facts, Open Beauty Facts and Open Products Facts (ODbL 1.0)".
 *
 * Nota sobre preciocesta.com:
 *   Se verificó preciocesta.com/mercadona/ y su aviso legal no incluye licencia abierta de reutilización
 *   de base de datos, por lo que NO se extrae ni se consulta automáticamente.
 *
 * Modos:
 *   - Por defecto (--mode=dumps): descarga con reanudación HTTP Range a .cache/off-dumps/ y filtra
 *     en streaming sin límites de peticiones ni costes.
 *   - Alternativa (--mode=api): consulta paginada y educada (1 req / 6.5 s) con checkpoint reanudable.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const CACHE_DIR = path.join(ROOT_DIR, '.cache', 'off-dumps');
const API_CHECKPOINT_FILE = path.join(ROOT_DIR, '.cache', 'off-api-checkpoint.json');
const OUTPUT_FILE = path.join(ROOT_DIR, 'public', 'data', 'mercadona-catalog.v1.json');

const USER_AGENT = 'NidoCatalogBuilder/1.0 (https://github.com/nido-app; zero-cost-odbl-sync)';

const DUMP_SOURCES = [
  {
    key: 'off',
    label: 'Open Food Facts',
    url: 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz',
    file: path.join(CACHE_DIR, 'en.openfoodfacts.org.products.csv.gz'),
    defaultSection: 'Despensa, arroz, pasta y conservas',
  },
  {
    key: 'obf',
    label: 'Open Beauty Facts',
    url: 'https://static.openbeautyfacts.org/data/en.openbeautyfacts.org.products.csv.gz',
    file: path.join(CACHE_DIR, 'en.openbeautyfacts.org.products.csv.gz'),
    defaultSection: 'Cuidado personal e higiene',
  },
  {
    key: 'opf',
    label: 'Open Products Facts',
    url: 'https://static.openproductsfacts.org/data/en.openproductsfacts.org.products.csv.gz',
    file: path.join(CACHE_DIR, 'en.openproductsfacts.org.products.csv.gz'),
    defaultSection: 'Limpieza y hogar',
  },
];

const MERCADONA_PRIVATE_BRANDS = new Map([
  ['hacendado', 'Hacendado'],
  ['deliplus', 'Deliplus'],
  ['bosque verde', 'Bosque Verde'],
  ['bosque-verde', 'Bosque Verde'],
  ['compy', 'Compy'],
  ['solcare', 'Solcare'],
  ['stylius', 'Stylius'],
]);

const VARIANT_PATTERNS = [
  ['sin lactosa', 'Sin lactosa'],
  ['desnatada', 'Desnatada'],
  ['desnatado', 'Desnatado'],
  ['semidesnatada', 'Semidesnatada'],
  ['semidesnatado', 'Semidesnatado'],
  ['entera', 'Entera'],
  ['integral', 'Integral'],
  ['sin azucar', 'Sin azúcar'],
  ['sin azucares anadidos', 'Sin azúcares añadidos'],
  ['0% azucares', '0% azúcares'],
  ['0% m.g.', '0% M.G.'],
  ['0%', '0%'],
  ['sin gluten', 'Sin gluten'],
  ['descafeinado', 'Descafeinado'],
  ['bajo en sal', 'Bajo en sal'],
  ['light', 'Light'],
  ['extra virgen', 'Virgen extra'],
  ['virgen extra', 'Virgen extra'],
  ['al natural', 'Al natural'],
  ['en aceite de oliva', 'En aceite de oliva'],
  ['en aceite de girasol', 'En aceite de girasol'],
  ['en escabeche', 'En escabeche'],
  ['ecologico', 'Ecológico'],
  ['ecologica', 'Ecológica'],
  ['bio', 'Bio'],
  ['proteinas', 'Proteínas'],
  ['+proteinas', '+Proteínas'],
  ['suave', 'Suave'],
  ['intenso', 'Intenso'],
  ['fresco', 'Fresco'],
  ['fresca', 'Fresca'],
  ['congelado', 'Congelado'],
  ['congelada', 'Congelada'],
  ['en grano', 'En grano'],
  ['molido', 'Molido'],
  ['capsulas', 'Cápsulas'],
  ['soluble', 'Soluble'],
  ['a la sal', 'A la sal'],
  ['tostado', 'Tostado'],
  ['natural', 'Natural'],
  ['zero', 'Zero'],
  ['con gas', 'Con gas'],
  ['sin alcohol', 'Sin alcohol'],
  ['0,0', '0,0'],
  ['0.0', '0,0'],
  ['para perro', 'Perro'],
  ['para gato', 'Gato'],
];

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanWhitespace(value) {
  return String(value ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyJunkProductName(rawName) {
  const name = cleanWhitespace(rawName);
  if (!name || name.length < 2 || name.length > 110) return true;
  if (/^\d{5,}$/.test(name)) return true; // solo código de barras o números
  if (/^[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]+$/.test(name)) return true;
  if (/https?:\/\/|www\.|<[^>]+>|\{|\}/i.test(name)) return true;
  const norm = normalizeText(name);
  if (
    /^(test|prueba|asdf|qwer|xxxx|producto|sin nombre|desconocido|unknown|n\/a|none|null|delete|borrar|ñordos|mierda|caca|polla|coño)$/i.test(
      norm
    )
  ) {
    return true;
  }
  if (/\b(nordos|ñordos|gilipollas|puta|fuck|shit)\b/i.test(norm)) return true;
  // Descartar nombres puramente en otro alfabeto no latino
  const latinLetters = (name.match(/[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]/g) || []).length;
  if (latinLetters < 2) return true;
  return false;
}

function normalizeFormat(rawQuantity) {
  let q = cleanWhitespace(rawQuantity)
    .replace(/([0-9])\s*(gr|grs|gramos?)\b/gi, '$1 g')
    .replace(/([0-9])\s*(kg|kgs|kilogramos?)\b/gi, '$1 kg')
    .replace(/([0-9])\s*(ml|mls)\b/gi, '$1 ml')
    .replace(/([0-9])\s*(cl)\b/gi, '$1 cl')
    .replace(/([0-9])\s*(l|lt|lts|litros?)\b/gi, '$1 L')
    .replace(/([0-9])\s*(uds?|unidades?|pcs?)\b/gi, '$1 ud')
    .replace(/\*+/g, ' x ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!q || q.length > 36) return '';
  if (!/\d/.test(q)) return '';
  return q;
}

function inferDefaultUnit(format, name, section) {
  const normFmt = normalizeText(format);
  if (/\d\s*kg\b/.test(normFmt)) return 'kg';
  if (/\d\s*g\b/.test(normFmt)) return 'paq';
  if (/\d\s*l\b/.test(normFmt)) return 'L';
  if (/\d\s*(ml|cl)\b/.test(normFmt)) {
    const normName = normalizeText(name);
    if (/(cerveza|refresco|cola|tonica|zumo|atun|sardina|mejillon|oliva|conserva)/.test(normName)) {
      return /(lata|conserva|atun|mejillon|sardina)/.test(normName) ? 'lata' : 'botella';
    }
    return section === 'Cuidado personal e higiene' || section === 'Limpieza y hogar'
      ? 'botella'
      : 'ud';
  }
  if (/\b(docena|12 ud|12 huevos|6 huevos)\b/.test(normFmt)) return 'docena';
  const normName = normalizeText(name);
  if (/(huevo)/.test(normName)) return 'docena';
  if (/(agua|vino|aceite|vinagre|colutorio|suavizante|detergente liquido|lejia|fregasuelos|gel de ducha|champu)/.test(normName)) {
    return 'botella';
  }
  if (/(papel higienico|papel cocina|servilleta|bolsa|pan de molde|galleta|pasta|espagueti|macarron|copos|compresa|toallita)/.test(normName)) {
    return 'paq';
  }
  if (/(fruta|platano|manzana|naranja|mandarina|patata|cebolla|tomate|zanahoria)/.test(normName) && section === 'Fruta y verdura') {
    return 'kg';
  }
  return 'ud';
}

function normalizeBrand(rawBrand, fallbackBrandsTags) {
  const candidates = `${rawBrand || ''},${fallbackBrandsTags || ''}`
    .split(',')
    .map((s) => cleanWhitespace(s.replace(/^en:/, '').replace(/-/g, ' ')))
    .filter(Boolean);

  for (const cand of candidates) {
    const norm = normalizeText(cand);
    if (MERCADONA_PRIVATE_BRANDS.has(norm)) {
      return MERCADONA_PRIVATE_BRANDS.get(norm);
    }
  }
  for (const cand of candidates) {
    const norm = normalizeText(cand);
    if (norm === 'mercadona' || norm === 'hacendado mercadona' || norm === 'mercadona hacendado') {
      return 'Hacendado';
    }
    if (norm && norm !== 'unknown' && norm !== 'sin marca' && cand.length <= 40) {
      return cand;
    }
  }
  return '';
}

function extractVariant(name, genericName) {
  const combined = `${normalizeText(name)} ${normalizeText(genericName)}`;
  const found = [];
  for (const [needle, label] of VARIANT_PATTERNS) {
    if (combined.includes(needle) && !found.includes(label)) {
      found.push(label);
    }
    if (found.length >= 2) break;
  }
  return found.join(' · ');
}

function mapToSection(sourceKey, name, categoriesText, defaultSection) {
  const norm = normalizeText(`${name} ${categoriesText}`);

  if (sourceKey === 'obf') {
    if (/(bebe|panal|infantil|baby|diaper)/.test(norm)) return 'Bebé y mascotas';
    if (/(limpieza|detergente|hogar|papel)/.test(norm)) return 'Limpieza y hogar';
    return 'Cuidado personal e higiene';
  }
  if (sourceKey === 'opf') {
    if (/(perro|gato|mascota|pet|dog|cat|arena para gatos)/.test(norm)) return 'Bebé y mascotas';
    if (/(champu|gel|jabon manos|pasta de dientes|desodorante|cosmet)/.test(norm)) {
      return 'Cuidado personal e higiene';
    }
    return 'Limpieza y hogar';
  }

  if (/(pienso|mascota|perro|gato|dog|cat food|arena gato|panal|potito|leche infantil|papilla|bebe)/.test(norm)) {
    return 'Bebé y mascotas';
  }
  if (/(papel higienico|rollo cocina|servilleta|bolsa basura|detergente|suavizante|lavavajillas|lejia|fregasuelos|limpiacristales|estropajo|bayeta|insecticida|ambientador|aluminio|film)/.test(norm)) {
    return 'Limpieza y hogar';
  }
  if (/(gel de ducha|champu|acondicionador|desodorante|dentifrico|pasta de dientes|cepillo dientes|colutorio|compresa|tampon|crema corporal|protector solar|maquinilla|toallita|algodon)/.test(norm)) {
    return 'Cuidado personal e higiene';
  }
  if (/(congelad|ultracongelad|helado|ice cream|frozen|edamame|gyoza|patatas para freir)/.test(norm)) {
    return 'Congelados';
  }
  if (/(fruta|verdura|hortaliza|ensalada|brocoli|espinaca|tomate|patata|cebolla|platano|manzana|naranja|aguacate|champinon|fresa|fruit|vegetable)/.test(norm) &&
      !/(zumo|mermelada|frito|triturado|en conserva|galleta|yogur|helado)/.test(norm)) {
    return 'Fruta y verdura';
  }
  if (/(pescado|marisco|salmon|merluza|bacalao|atun fresco|langostino|gamba|mejillon fresco|calamar|fish|seafood)/.test(norm) &&
      !/(conserva|lata|en aceite|al natural|en escabeche)/.test(norm)) {
    return 'Pescado y marisco';
  }
  if (/(carne|pollo|pavo|cerdo|ternera|vacuno|jamon|lomo|chorizo|salchichon|fuet|beicon|bacon|hamburguesa|huevo|meat|poultry|charcut|egg)/.test(norm) &&
      !/(caldo|patata|snack|pizza|sabor jamon)/.test(norm)) {
    return 'Carne, charcutería y huevos';
  }
  if (/(plato preparado|gazpacho|salmorejo|hummus|guacamole|ensaladilla|lasaña|lasagna|tortilla de patata|pizza fresca|refrigerad)/.test(norm)) {
    return 'Platos preparados y refrigerados';
  }
  if (/(leche|yogur|kefir|queso|mozzarella|mantequilla|nata|requeson|cuajada|bebida de avena|bebida de soja|bebida de almendra|lacteo|dairy|cheese|milk|yogurt)/.test(norm) &&
      !/(chocolate con leche|galleta|helado)/.test(norm)) {
    return 'Lácteos, quesos y bebidas vegetales';
  }
  if (/(pan |panaderia|barra de pan|pan de molde|pan tostado|pico|tortita|brioche|croissant|magdalena|hojaldre|masa de pizza|bread|bakery)/.test(norm)) {
    return 'Panadería y bollería';
  }
  if (/(agua |mineral|refresco|cola|tonica|cerveza|vino|kombucha|horchata|zumo|nectar|bebida|tea|isotonica|soda|juice|beer|wine)/.test(norm) &&
      !/(bebida de avena|bebida de soja|bebida de almendra|aceite)/.test(norm)) {
    return 'Bebidas';
  }
  if (/(cafe|cacao|te |infusion|manzanilla|tilo|cereales|avena|muesli|galleta|mermelada|miel|chocolate|turron|dulce|crema de cacahuete|crema de cacao|azucar|breakfast|coffee|biscuit)/.test(norm)) {
    return 'Desayuno, café y dulces';
  }
  if (/(arroz|pasta|espagueti|macarron|fideo|garbanzo|lenteja|alubia|atun|sardinilla|mejillon|conserva|tomate frito|tomate triturado|aceituna|aceite|vinagre|sal |harina|caldo|mayonesa|salsa|especia|fruto seco|nuez|almendra|patatas fritas|snack)/.test(norm)) {
    return 'Despensa, arroz, pasta y conservas';
  }

  return defaultSection;
}

function stableCatalogId(normName, normBrand, normVariant, normFormat, code) {
  const key = `${normName}|${normBrand}|${normVariant}|${normFormat}` || String(code);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const slug = normName
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 22);
  return `mc_${slug || 'prod'}_${(hash >>> 0).toString(36)}`;
}

function isSpanishOrCompatible(countriesText, storesText, brandNorm) {
  const c = normalizeText(countriesText);
  const s = normalizeText(storesText);
  const hasMercadonaStore = /\bmercadona\b/.test(s);
  const isPrivateLabel = MERCADONA_PRIVATE_BRANDS.has(brandNorm);
  if (!hasMercadonaStore && !isPrivateLabel) return false;

  if (!c) return true;
  if (/(spain|espana|en:spain|portugal|en:portugal)/.test(c)) return true;
  // Si el producto es marca exclusiva de Mercadona y tiene países mezclados, aceptar si está etiquetado con Mercadona
  if (isPrivateLabel && hasMercadonaStore) return true;
  return false;
}

async function downloadWithResume(source) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tempPath = `${source.file}.part`;

  if (fs.existsSync(source.file)) {
    const stat = fs.statSync(source.file);
    if (stat.size > 100_000) {
      console.log(`[dumps] Reutilizando archivo en caché: ${path.basename(source.file)} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)`);
      return;
    }
  }

  let existingBytes = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0;
  const headers = { 'User-Agent': USER_AGENT };
  if (existingBytes > 0) {
    headers.Range = `bytes=${existingBytes}-`;
    console.log(`[dumps] Reanudando ${source.label} desde ${(existingBytes / (1024 * 1024)).toFixed(1)} MB...`);
  } else {
    console.log(`[dumps] Descargando ${source.label}...`);
  }

  const res = await fetch(source.url, { headers, redirect: 'follow' });
  if (res.status === 416) {
    fs.renameSync(tempPath, source.file);
    return;
  }
  if (!res.ok) {
    throw new Error(`Error HTTP ${res.status} al descargar ${source.label}`);
  }

  const append = res.status === 206 && existingBytes > 0;
  if (!append) existingBytes = 0;

  const totalBytes = Number(res.headers.get('content-length') || 0) + existingBytes;
  const writeStream = fs.createWriteStream(tempPath, { flags: append ? 'a' : 'w' });

  let downloaded = existingBytes;
  let lastLog = Date.now();
  const body = Readable.fromWeb(res.body);

  await new Promise((resolve, reject) => {
    body.on('data', (chunk) => {
      downloaded += chunk.length;
      const now = Date.now();
      if (now - lastLog > 4000) {
        lastLog = now;
        const pct = totalBytes > 0 ? ` (${((downloaded / totalBytes) * 100).toFixed(1)}%)` : '';
        console.log(`  · ${source.label}: ${(downloaded / (1024 * 1024)).toFixed(1)} MB${pct}`);
      }
    });
    body.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);
    body.pipe(writeStream);
  });

  fs.renameSync(tempPath, source.file);
  console.log(`[dumps] Descarga completa: ${source.label} (${(downloaded / (1024 * 1024)).toFixed(1)} MB)`);
}

function processProductRecord(raw, source, seenKeys, seenCodes, results, addedAt) {
  const code = cleanWhitespace(raw.code || '');
  if (code && seenCodes.has(code)) return 0;

  const rawName = cleanWhitespace(raw.product_name_es || raw.product_name || '');
  if (isLikelyJunkProductName(rawName)) return 0;

  const brandsRaw = cleanWhitespace(raw.brands || raw.brands_en || raw.brands_tags || '');
  const brand = normalizeBrand(brandsRaw, raw.brands_tags || '');
  const brandNorm = normalizeText(brand);

  const storesText = cleanWhitespace(raw.stores || '');
  const countriesText = cleanWhitespace(raw.countries_tags || raw.countries_en || '');
  if (!isSpanishOrCompatible(countriesText, storesText, brandNorm)) return 0;

  // Evitar falsos positivos: si la marca no es propia de Mercadona, exigir que stores contenga "mercadona"
  if (!MERCADONA_PRIVATE_BRANDS.has(brandNorm) && !/\bmercadona\b/.test(normalizeText(storesText))) {
    return 0;
  }

  const format = normalizeFormat(raw.quantity || '');
  const variant = extractVariant(rawName, raw.generic_name || '');
  const categoriesText = cleanWhitespace(
    [raw.categories, raw.categories_en, raw.categories_tags, raw.pnns_groups_1, raw.pnns_groups_2]
      .filter(Boolean)
      .join(' ')
  );
  const section = mapToSection(source.key, rawName, categoriesText, source.defaultSection);
  const defaultUnit = inferDefaultUnit(format, rawName, section);

  const normName = normalizeText(rawName);
  const normVariant = normalizeText(variant);
  const normFormat = normalizeText(format);
  const dedupKey = `${normName}|${brandNorm}|${normVariant}|${normFormat}`;
  if (seenKeys.has(dedupKey)) return 0;

  seenKeys.add(dedupKey);
  if (code) seenCodes.add(code);

  const id = stableCatalogId(normName, brandNorm, normVariant, normFormat, code);
  const entry = {
    id,
    name: rawName,
    ...(brand ? { brand } : {}),
    ...(variant ? { variant } : {}),
    ...(format ? { format } : {}),
    section,
    ...(defaultUnit && defaultUnit !== 'ud' ? { defaultUnit } : {}),
    sourceRef: `${source.key}:${code || id}`,
    source: 'openfoodfacts_odbl',
    addedAt,
  };
  results.push(entry);
  return 1;
}

async function parseCsvDump(source, seenKeys, seenCodes, results, addedAt) {
  console.log(`[dumps] Filtrando ${source.label}...`);
  const gunzip = zlib.createGunzip();
  const fileStream = fs.createReadStream(source.file);
  const rl = readline.createInterface({
    input: fileStream.pipe(gunzip),
    crlfDelay: Infinity,
  });

  let idx = null;
  let scanned = 0;
  let added = 0;

  for await (const line of rl) {
    if (!idx) {
      const headers = line.split('\t');
      const col = (name) => headers.indexOf(name);
      idx = {
        code: col('code'),
        product_name: col('product_name'),
        product_name_es: col('product_name_es'),
        generic_name: col('generic_name'),
        quantity: col('quantity'),
        brands: col('brands'),
        brands_en: col('brands_en'),
        brands_tags: col('brands_tags'),
        categories: col('categories'),
        categories_en: col('categories_en'),
        categories_tags: col('categories_tags'),
        stores: col('stores'),
        countries_tags: col('countries_tags'),
        countries_en: col('countries_en'),
        pnns_groups_1: col('pnns_groups_1'),
        pnns_groups_2: col('pnns_groups_2'),
      };
      continue;
    }

    scanned++;
    // Fast pre-filter before splitting all columns for speed
    const lower = line.toLowerCase();
    if (
      !lower.includes('mercadona') &&
      !lower.includes('hacendado') &&
      !lower.includes('deliplus') &&
      !lower.includes('bosque') &&
      !lower.includes('compy')
    ) {
      continue;
    }

    const cols = line.split('\t');
    const pick = (i) => (i >= 0 && i < cols.length ? cols[i] : '');
    added += processProductRecord(
      {
        code: pick(idx.code),
        product_name: pick(idx.product_name),
        product_name_es: pick(idx.product_name_es),
        generic_name: pick(idx.generic_name),
        quantity: pick(idx.quantity),
        brands: pick(idx.brands),
        brands_en: pick(idx.brands_en),
        brands_tags: pick(idx.brands_tags),
        categories: pick(idx.categories),
        categories_en: pick(idx.categories_en),
        categories_tags: pick(idx.categories_tags),
        stores: pick(idx.stores),
        countries_tags: pick(idx.countries_tags),
        countries_en: pick(idx.countries_en),
        pnns_groups_1: pick(idx.pnns_groups_1),
        pnns_groups_2: pick(idx.pnns_groups_2),
      },
      source,
      seenKeys,
      seenCodes,
      results,
      addedAt
    );
  }

  console.log(`  · ${source.label}: ${scanned.toLocaleString('es-ES')} filas revisadas → ${added.toLocaleString('es-ES')} productos añadidos`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runApiMode(addedAt) {
  fs.mkdirSync(path.dirname(API_CHECKPOINT_FILE), { recursive: true });
  let checkpoint = { queriesDone: {}, items: [] };
  if (fs.existsSync(API_CHECKPOINT_FILE)) {
    try {
      checkpoint = JSON.parse(fs.readFileSync(API_CHECKPOINT_FILE, 'utf8'));
    } catch {
      checkpoint = { queriesDone: {}, items: [] };
    }
  }

  const seenKeys = new Set();
  const seenCodes = new Set();
  const results = [];
  for (const prev of checkpoint.items || []) {
    const code = String(prev.sourceRef || '').split(':')[1] || '';
    const key = `${normalizeText(prev.name)}|${normalizeText(prev.brand)}|${normalizeText(prev.variant)}|${normalizeText(prev.format)}`;
    seenKeys.add(key);
    if (code) seenCodes.add(code);
    results.push(prev);
  }

  const apiPlans = [
    { key: 'off_store', base: 'https://world.openfoodfacts.org/api/v2/search', params: 'stores_tags=mercadona&countries_tags=spain', sourceKey: 'off', defaultSection: 'Despensa, arroz, pasta y conservas' },
    { key: 'off_hacendado', base: 'https://world.openfoodfacts.org/api/v2/search', params: 'brands_tags=hacendado&countries_tags=spain', sourceKey: 'off', defaultSection: 'Despensa, arroz, pasta y conservas' },
    { key: 'obf_deliplus', base: 'https://world.openbeautyfacts.org/api/v2/search', params: 'brands_tags=deliplus', sourceKey: 'obf', defaultSection: 'Cuidado personal e higiene' },
    { key: 'opf_bosque', base: 'https://world.openproductsfacts.org/api/v2/search', params: 'brands_tags=bosque-verde', sourceKey: 'opf', defaultSection: 'Limpieza y hogar' },
  ];

  const fields = 'code,product_name,product_name_es,generic_name,quantity,brands,brands_tags,categories,categories_tags,stores,countries_tags';
  for (const plan of apiPlans) {
    let page = Number(checkpoint.queriesDone[plan.key] || 1);
    while (true) {
      const url = `${plan.base}?${plan.params}&fields=${fields}&page_size=100&page=${page}`;
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.status === 429) {
        console.warn(`[api] Rate limit 429 en página ${page}; esperando 20 s antes de continuar...`);
        await sleep(20_000);
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} en ${plan.key} página ${page}`);
      }
      const json = await res.json();
      const prods = Array.isArray(json.products) ? json.products : [];
      if (prods.length === 0) break;
      for (const p of prods) {
        processProductRecord(
          p,
          { key: plan.sourceKey, defaultSection: plan.defaultSection },
          seenKeys,
          seenCodes,
          results,
          addedAt
        );
      }
      checkpoint.queriesDone[plan.key] = page + 1;
      checkpoint.items = results;
      fs.writeFileSync(API_CHECKPOINT_FILE, JSON.stringify(checkpoint));
      console.log(`[api] ${plan.key} página ${page} (${results.length} únicos acumulados)`);
      if (prods.length < 100) break;
      page++;
      await sleep(6500);
    }
  }
  return results;
}

async function runDumpsMode(addedAt) {
  for (const src of DUMP_SOURCES) {
    await downloadWithResume(src);
  }
  const seenKeys = new Set();
  const seenCodes = new Set();
  const results = [];
  for (const src of DUMP_SOURCES) {
    await parseCsvDump(src, seenKeys, seenCodes, results, addedAt);
  }
  return results;
}

async function main() {
  const modeArg = process.argv.find((a) => a.startsWith('--mode=')) || '--mode=dumps';
  const mode = modeArg.split('=')[1];
  const addedAt = new Date().toISOString().slice(0, 10);

  let items = mode === 'api' ? await runApiMode(addedAt) : await runDumpsMode(addedAt);

  items.sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const sectionCounts = {};
  for (const item of items) {
    sectionCounts[item.section] = (sectionCounts[item.section] || 0) + 1;
  }

  const payload = {
    version: 1,
    source: 'Open Food Facts, Open Beauty Facts & Open Products Facts',
    license: 'ODbL 1.0 / DbCL 1.0 (https://world.openfoodfacts.org/terms-of-use)',
    disclaimer: 'Catálogo de referencia no oficial. El surtido puede variar según tienda y fecha.',
    generatedAt: new Date().toISOString(),
    count: items.length,
    sectionCounts,
    items,
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload));
  const rawBytes = fs.statSync(OUTPUT_FILE).size;
  const gzBytes = zlib.gzipSync(fs.readFileSync(OUTPUT_FILE)).length;

  console.log(`\nCatálogo guardado en ${path.relative(ROOT_DIR, OUTPUT_FILE)}`);
  console.log(`Productos únicos reales: ${items.length.toLocaleString('es-ES')}`);
  console.log(`Tamaño JSON: ${(rawBytes / (1024 * 1024)).toFixed(2)} MB | Gzip: ${(gzBytes / 1024).toFixed(1)} KB`);
  console.log('Distribución por sección:', sectionCounts);
}

main().catch((err) => {
  console.error('Error al actualizar el catálogo:', err);
  process.exit(1);
});
