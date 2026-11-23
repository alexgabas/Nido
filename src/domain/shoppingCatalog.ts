import {
  MAX_LENGTHS,
  SHOPPING_SECTIONS,
  type ShoppingCatalogItem,
  type ShoppingItem,
  type ShoppingSection,
  type ShoppingSourceType,
} from '../types/nido';

export { SHOPPING_SECTIONS };

export const SHOPPING_UNITS = [
  { value: '', label: 'Sin unidad' },
  { value: 'ud', label: 'ud' },
  { value: 'kg', label: 'kg' },
  { value: 'g', label: 'g' },
  { value: 'L', label: 'L' },
  { value: 'ml', label: 'ml' },
  { value: 'paq', label: 'paq' },
  { value: 'caja', label: 'caja' },
  { value: 'botella', label: 'botella' },
  { value: 'lata', label: 'lata' },
  { value: 'docena', label: 'docena' },
] as const;

export interface StaticMercadonaCatalogEntry {
  id: string;
  name: string;
  brand?: string;
  variant?: string;
  format?: string;
  section: ShoppingSection;
  defaultUnit?: string;
  sourceRef: string;
  source: string;
  addedAt: string;
}

export interface PreindexedMercadonaEntry extends StaticMercadonaCatalogEntry {
  normName: string;
  normBrand: string;
  normVariant: string;
  normFormat: string;
  searchText: string;
  searchWords: string[];
  nameWords: string[];
}

export interface GenericStapleEntry {
  id: string;
  name: string;
  defaultUnit: string;
  section: ShoppingSection;
}

export interface ShoppingSuggestion {
  key: string;
  text: string;
  defaultUnit: string;
  source: 'hogar' | 'mercadona' | 'generico';
  sourceType: ShoppingSourceType;
  catalogId?: string;
  brand?: string;
  variant?: string;
  format?: string;
  section: ShoppingSection;
  favorite?: boolean;
  usageCount?: number;
  lastUsedAt?: string;
}

export interface PaginatedShoppingSuggestions {
  items: ShoppingSuggestion[];
  totalCount: number;
  hasMore: boolean;
}

const SECTION_SET = new Set<string>(SHOPPING_SECTIONS);
const SOURCE_TYPE_SET = new Set<string>(['mercadona', 'custom', 'generic']);

export function normalizeShoppingText(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeShoppingUnit(unit?: string | null): string {
  return String(unit ?? '')
    .trim()
    .slice(0, MAX_LENGTHS.shoppingUnit);
}

export function normalizeShoppingSection(section?: string | null): ShoppingSection | undefined {
  const clean = String(section ?? '').trim();
  return SECTION_SET.has(clean) ? (clean as ShoppingSection) : undefined;
}

export function normalizeShoppingSourceType(
  sourceType?: string | null
): ShoppingSourceType | undefined {
  const clean = String(sourceType ?? '').trim();
  return SOURCE_TYPE_SET.has(clean) ? (clean as ShoppingSourceType) : undefined;
}

export function formatShoppingQtyUnit(qty: number, unit?: string): string {
  const num = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const formattedQty = Number.isInteger(num)
    ? String(num)
    : num.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const cleanUnit = normalizeShoppingUnit(unit);
  return cleanUnit ? `${formattedQty} ${cleanUnit}` : formattedQty;
}

export function buildShoppingCatalogId(
  text: string,
  options?: { catalogId?: string; brand?: string; format?: string }
): string {
  const normText = normalizeShoppingText(text);
  const normCatalogId = normalizeShoppingText(options?.catalogId || '');
  const normBrand = normalizeShoppingText(options?.brand || '');
  const normFormat = normalizeShoppingText(options?.format || '');
  const key = normCatalogId
    ? `${normText}|${normCatalogId}`
    : normBrand || normFormat
      ? `${normText}|${normBrand}|${normFormat}`
      : normText;

  const slug = normText
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(36);
  return `prod_${slug || 'item'}_${suffix}`.slice(0, 48);
}

export function inferShoppingSection(text: string): ShoppingSection {
  const norm = normalizeShoppingText(text);
  if (/(pienso|mascota|perro|gato|arena.*gato|panal|bebe|potito|papilla)/.test(norm)) {
    return 'Bebé y mascotas';
  }
  if (/(papel higienico|papel cocina|servilleta|bolsa basura|detergente|suavizante|lavavajillas|lejia|fregasuelos|limpiacristales|estropajo|bayeta|aluminio|film|ambientador)/.test(norm)) {
    return 'Limpieza y hogar';
  }
  if (/(gel de ducha|champu|acondicionador|desodorante|pasta de dientes|cepillo|colutorio|compresa|tampon|crema|protector solar|toallita|algodon|afeitar|hilo dental)/.test(norm)) {
    return 'Cuidado personal e higiene';
  }
  if (/(congelad|ultracongelad|helado|edamame|gyoza|hielo)/.test(norm)) {
    return 'Congelados';
  }
  if (/(platano|manzana|naranja|mandarina|limon|pera|fresa|aguacate|tomate|patata|cebolla|ajo|zanahoria|calabacin|berenjena|pimiento|pepino|lechuga|espinaca|champinon|brocoli|fruta|verdura)/.test(norm) &&
      !/(frito|triturado|zumo|mermelada|galleta)/.test(norm)) {
    return 'Fruta y verdura';
  }
  if (/(salmon|merluza|bacalao|langostino|gamba|pescado|marisco|calamar)/.test(norm) &&
      !/(lata|conserva|aceite|escabeche)/.test(norm)) {
    return 'Pescado y marisco';
  }
  if (/(pollo|pavo|cerdo|ternera|vacuno|jamon|lomo|beicon|bacon|hamburguesa|huevo|carne|chorizo|fuet)/.test(norm) &&
      !/(caldo|patata)/.test(norm)) {
    return 'Carne, charcutería y huevos';
  }
  if (/(gazpacho|salmorejo|hummus|guacamole|ensaladilla|tortilla|pizza fresca)/.test(norm)) {
    return 'Platos preparados y refrigerados';
  }
  if (/(leche|yogur|kefir|queso|mozzarella|mantequilla|nata|requeson|cuajada|bebida de avena|bebida de soja|bebida de almendra)/.test(norm)) {
    return 'Lácteos, quesos y bebidas vegetales';
  }
  if (/(pan|croissant|magdalena|brioche|hojaldre|masa de pizza|picos|tortita)/.test(norm)) {
    return 'Panadería y bollería';
  }
  if (/(agua|refresco|cola|tonica|cerveza|vino|kombucha|horchata|zumo|te frio)/.test(norm)) {
    return 'Bebidas';
  }
  if (/(cafe|cacao|infusion|manzanilla|te |avena|muesli|galleta|mermelada|miel|crema de cacahuete|azucar|chocolate)/.test(norm)) {
    return 'Desayuno, café y dulces';
  }
  if (/(arroz|espagueti|macarron|tallarin|fideo|garbanzo|lenteja|alubia|atun|sardinilla|mejillon|tomate frito|tomate triturado|maiz|aceituna|aceite|vinagre|sal |harina|caldo|mayonesa|nuez|nueces|almendra)/.test(norm)) {
    return 'Despensa, arroz, pasta y conservas';
  }
  return 'Otros de supermercado';
}

export function groupShoppingItemsBySection(
  items: ShoppingItem[]
): Array<{ section: ShoppingSection; items: ShoppingItem[] }> {
  const buckets = new Map<ShoppingSection, ShoppingItem[]>();
  for (const sec of SHOPPING_SECTIONS) {
    buckets.set(sec, []);
  }
  for (const item of items) {
    const sec = normalizeShoppingSection(item.section) ?? inferShoppingSection(item.text);
    buckets.get(sec)!.push(item);
  }
  return SHOPPING_SECTIONS.map((section) => ({
    section,
    items: buckets.get(section) ?? [],
  })).filter((g) => g.items.length > 0);
}

/**
 * Básicos genéricos a granel o sin marca (nunca se etiquetan como "Mercadona").
 * Sirven tanto de apoyo cuando el usuario busca genéricos ("Plátanos", "Barra de pan")
 * como de respaldo si todavía no se ha descargado el catálogo de Mercadona offline.
 */
export const GENERIC_STAPLES_CATALOG: readonly GenericStapleEntry[] = [
  { id: 'gen_platanos', name: 'Plátanos', defaultUnit: 'kg', section: 'Fruta y verdura' },
  { id: 'gen_manzanas', name: 'Manzanas', defaultUnit: 'kg', section: 'Fruta y verdura' },
  { id: 'gen_naranjas', name: 'Naranjas', defaultUnit: 'kg', section: 'Fruta y verdura' },
  { id: 'gen_mandarinas', name: 'Mandarinas', defaultUnit: 'kg', section: 'Fruta y verdura' },
  { id: 'gen_limones', name: 'Limones', defaultUnit: 'kg', section: 'Fruta y verdura' },
  { id: 'gen_peras', name: 'Peras', defaultUnit: 'kg', section: 'Fruta y verdura' },
  { id: 'gen_fresas', name: 'Fresas', defaultUnit: 'caja', section: 'Fruta y verdura' },
  { id: 'gen_aguacates', name: 'Aguacates', defaultUnit: 'ud', section: 'Fruta y verdura' },
  { id: 'gen_tomates', name: 'Tomates', defaultUnit: 'kg', section: 'Fruta y verdura' },
  { id: 'gen_tomates_cherry', name: 'Tomates cherry', defaultUnit: 'caja', section: 'Fruta y verdura' },
  { id: 'gen_patatas', name: 'Patatas', defaultUnit: 'kg', section: 'Fruta y verdura' },
  { id: 'gen_cebollas', name: 'Cebollas', defaultUnit: 'kg', section: 'Fruta y verdura' },
  { id: 'gen_ajos', name: 'Ajos', defaultUnit: 'paq', section: 'Fruta y verdura' },
  { id: 'gen_zanahorias', name: 'Zanahorias', defaultUnit: 'kg', section: 'Fruta y verdura' },
  { id: 'gen_calabacin', name: 'Calabacín', defaultUnit: 'kg', section: 'Fruta y verdura' },
  { id: 'gen_berenjena', name: 'Berenjena', defaultUnit: 'ud', section: 'Fruta y verdura' },
  { id: 'gen_pimiento_rojo', name: 'Pimiento rojo', defaultUnit: 'ud', section: 'Fruta y verdura' },
  { id: 'gen_pimiento_verde', name: 'Pimiento verde', defaultUnit: 'ud', section: 'Fruta y verdura' },
  { id: 'gen_pepino', name: 'Pepino', defaultUnit: 'ud', section: 'Fruta y verdura' },
  { id: 'gen_lechuga', name: 'Lechuga iceberg', defaultUnit: 'ud', section: 'Fruta y verdura' },
  { id: 'gen_espinacas', name: 'Espinacas frescas', defaultUnit: 'paq', section: 'Fruta y verdura' },
  { id: 'gen_champinones', name: 'Champiñones', defaultUnit: 'caja', section: 'Fruta y verdura' },
  { id: 'gen_pechuga_pollo', name: 'Pechuga de pollo', defaultUnit: 'kg', section: 'Carne, charcutería y huevos' },
  { id: 'gen_contramuslos_pollo', name: 'Contramuslos de pollo', defaultUnit: 'kg', section: 'Carne, charcutería y huevos' },
  { id: 'gen_carne_picada', name: 'Carne picada mixta', defaultUnit: 'paq', section: 'Carne, charcutería y huevos' },
  { id: 'gen_filetes_ternera', name: 'Filetes de ternera', defaultUnit: 'kg', section: 'Carne, charcutería y huevos' },
  { id: 'gen_salmon_fresco', name: 'Salmón fresco', defaultUnit: 'paq', section: 'Pescado y marisco' },
  { id: 'gen_merluza_fresca', name: 'Filetes de merluza', defaultUnit: 'paq', section: 'Pescado y marisco' },
  { id: 'gen_huevos_l', name: 'Huevos L', defaultUnit: 'docena', section: 'Carne, charcutería y huevos' },
  { id: 'gen_barra_pan', name: 'Barra de pan', defaultUnit: 'ud', section: 'Panadería y bollería' },
  { id: 'gen_pan_rustico', name: 'Pan rústico', defaultUnit: 'ud', section: 'Panadería y bollería' },
  { id: 'gen_hielo', name: 'Hielo en cubitos', defaultUnit: 'paq', section: 'Congelados' },
];

export function preindexMercadonaCatalog(
  entries: readonly StaticMercadonaCatalogEntry[]
): PreindexedMercadonaEntry[] {
  return entries.map((entry) => {
    const normName = normalizeShoppingText(entry.name);
    const normBrand = normalizeShoppingText(entry.brand || '');
    const normVariant = normalizeShoppingText(entry.variant || '');
    const normFormat = normalizeShoppingText(entry.format || '');
    const searchText = [normName, normBrand, normVariant, normFormat].filter(Boolean).join(' ');
    const nameWords = normName.split(' ').filter(Boolean);
    const searchWords = searchText.split(' ').filter(Boolean);
    return {
      ...entry,
      normName,
      normBrand,
      normVariant,
      normFormat,
      searchText,
      searchWords,
      nameWords,
    };
  });
}

function isPreindexed(
  entry: StaticMercadonaCatalogEntry | PreindexedMercadonaEntry
): entry is PreindexedMercadonaEntry {
  return 'searchText' in entry && Array.isArray(entry.searchWords);
}

function computeMatchTier(
  normQuery: string,
  tokens: string[],
  normName: string,
  nameWords: string[],
  searchText: string,
  searchWords: string[],
  normBrand = ''
): number | null {
  for (const tok of tokens) {
    if (!searchText.includes(tok)) return null;
  }

  // Tier 0: Coincidencia exacta en nombre (o nombre + marca)
  if (
    normName === normQuery ||
    (normBrand && `${normName} ${normBrand}` === normQuery)
  ) {
    return 0;
  }
  // Tier 1: Prefijo exacto del nombre
  if (normName.startsWith(normQuery)) {
    return 1;
  }
  // Tier 2: Todas las palabras de búsqueda empiezan palabras dentro del nombre
  if (tokens.every((tok) => nameWords.some((w) => w.startsWith(tok)))) {
    return 2;
  }
  // Tier 3: Todas las palabras de búsqueda son prefijos dentro de nombre + marca + variante + formato
  if (tokens.every((tok) => searchWords.some((w) => w.startsWith(tok)))) {
    return 3;
  }
  // Tier 4: Coincidencia parcial en cualquier orden
  return 4;
}

export function searchShoppingSuggestionsPaginated(
  query: string,
  householdCatalog: ShoppingCatalogItem[],
  mercadonaCatalog: readonly (StaticMercadonaCatalogEntry | PreindexedMercadonaEntry)[] = [],
  options?: { limit?: number; offset?: number; section?: ShoppingSection | 'todas' }
): PaginatedShoppingSuggestions {
  const limit = Math.max(1, options?.limit ?? 12);
  const offset = Math.max(0, options?.offset ?? 0);
  const normQuery = normalizeShoppingText(query);
  const activeSection =
    options?.section && options.section !== 'todas'
      ? normalizeShoppingSection(options.section)
      : undefined;

  if (!normQuery && !activeSection) {
    const sortedQuick = [...householdCatalog].sort(
      (a, b) =>
        Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
        b.usageCount - a.usageCount ||
        b.lastUsedAt.localeCompare(a.lastUsedAt)
    );
    const sliced = sortedQuick.slice(offset, offset + limit).map((item) => {
      const srcType: ShoppingSourceType =
        normalizeShoppingSourceType(item.sourceType) ??
        (item.catalogId ? 'mercadona' : 'custom');
      return {
        key: `hogar:${item.id}`,
        text: item.text,
        defaultUnit: item.defaultUnit || '',
        source: 'hogar' as const,
        sourceType: srcType,
        ...(item.catalogId ? { catalogId: item.catalogId } : {}),
        ...(item.brand ? { brand: item.brand } : {}),
        ...(item.format ? { format: item.format } : {}),
        section: normalizeShoppingSection(item.section) ?? inferShoppingSection(item.text),
        favorite: Boolean(item.favorite),
        usageCount: item.usageCount,
        lastUsedAt: item.lastUsedAt,
      };
    });
    return {
      items: sliced,
      totalCount: sortedQuick.length,
      hasMore: offset + sliced.length < sortedQuick.length,
    };
  }

  const tokens = normQuery ? normQuery.split(' ').filter(Boolean) : [];
  const seenCatalogIds = new Set<string>();
  const seenSignatures = new Set<string>();
  const scored: Array<{ suggestion: ShoppingSuggestion; tier: number; boost: number }> = [];

  // 1) Productos del hogar (favoritos y recientes)
  for (const item of householdCatalog) {
    const itemSection = normalizeShoppingSection(item.section) ?? inferShoppingSection(item.text);
    if (activeSection && itemSection !== activeSection) continue;

    const normName = normalizeShoppingText(item.text);
    const normBrand = normalizeShoppingText(item.brand || '');
    const normFormat = normalizeShoppingText(item.format || '');

    let tier = 0;
    if (normQuery) {
      const searchText = [normName, normBrand, normFormat].filter(Boolean).join(' ');
      const nameWords = normName.split(' ').filter(Boolean);
      const searchWords = searchText.split(' ').filter(Boolean);
      const computed = computeMatchTier(
        normQuery,
        tokens,
        normName,
        nameWords,
        searchText,
        searchWords,
        normBrand
      );
      if (computed === null) continue;
      tier = computed;
    }

    if (item.catalogId) seenCatalogIds.add(item.catalogId);
    const sig = `${normName}|${normBrand}|${normFormat}`;
    if (seenSignatures.has(sig)) continue;
    seenSignatures.add(sig);

    const sourceType: ShoppingSourceType =
      normalizeShoppingSourceType(item.sourceType) ??
      (item.catalogId ? 'mercadona' : 'custom');
    const boost =
      (item.favorite ? 220 : 0) +
      Math.min(120, (Number(item.usageCount) || 1) * 6) +
      30;

    scored.push({
      suggestion: {
        key: `hogar:${item.id}`,
        text: item.text,
        defaultUnit: item.defaultUnit || '',
        source: 'hogar',
        sourceType,
        ...(item.catalogId ? { catalogId: item.catalogId } : {}),
        ...(item.brand ? { brand: item.brand } : {}),
        ...(item.format ? { format: item.format } : {}),
        section: itemSection,
        favorite: Boolean(item.favorite),
        usageCount: item.usageCount,
        lastUsedAt: item.lastUsedAt,
      },
      tier,
      boost,
    });
  }

  // 2) Catálogo externo de Mercadona (ODbL)
  for (let i = 0; i < mercadonaCatalog.length; i++) {
    const raw = mercadonaCatalog[i];
    if (seenCatalogIds.has(raw.id)) continue;

    const entrySection = normalizeShoppingSection(raw.section) ?? inferShoppingSection(raw.name);
    if (activeSection && entrySection !== activeSection) continue;

    const entry = isPreindexed(raw) ? raw : preindexMercadonaCatalog([raw])[0];

    let tier = 1;
    if (normQuery) {
      const computed = computeMatchTier(
        normQuery,
        tokens,
        entry.normName,
        entry.nameWords,
        entry.searchText,
        entry.searchWords,
        entry.normBrand
      );
      if (computed === null) continue;
      tier = computed;
    }

    const sig = `${entry.normName}|${entry.normBrand}|${entry.normFormat}`;
    if (seenSignatures.has(sig)) continue;
    seenSignatures.add(sig);

    scored.push({
      suggestion: {
        key: `mc:${entry.id}`,
        text: entry.name,
        defaultUnit: entry.defaultUnit || '',
        source: 'mercadona',
        sourceType: 'mercadona',
        catalogId: entry.id,
        ...(entry.brand ? { brand: entry.brand } : {}),
        ...(entry.variant ? { variant: entry.variant } : {}),
        ...(entry.format ? { format: entry.format } : {}),
        section: entrySection,
      },
      tier,
      boost:
        entry.brand === 'Hacendado' || entry.brand === 'Deliplus' || entry.brand === 'Bosque Verde'
          ? 12
          : 8,
    });
  }

  // 3) Básicos genéricos (sin etiqueta Mercadona)
  for (const gen of GENERIC_STAPLES_CATALOG) {
    if (activeSection && gen.section !== activeSection) continue;

    const normName = normalizeShoppingText(gen.name);
    let tier = 1;
    if (normQuery) {
      const nameWords = normName.split(' ').filter(Boolean);
      const computed = computeMatchTier(
        normQuery,
        tokens,
        normName,
        nameWords,
        normName,
        nameWords,
        ''
      );
      if (computed === null) continue;
      tier = computed;
    }

    const sig = `${normName}||`;
    if (seenSignatures.has(sig)) continue;
    seenSignatures.add(sig);

    scored.push({
      suggestion: {
        key: `gen:${gen.id}`,
        text: gen.name,
        defaultUnit: gen.defaultUnit,
        source: 'generico',
        sourceType: 'generic',
        section: gen.section,
      },
      tier,
      boost: 4,
    });
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (b.boost !== a.boost) return b.boost - a.boost;
    return a.suggestion.text.localeCompare(b.suggestion.text, 'es');
  });

  const end = offset + limit;
  const items = scored.slice(offset, end).map((s) => s.suggestion);
  return {
    items,
    totalCount: scored.length,
    hasMore: end < scored.length,
  };
}

export function searchShoppingSuggestions(
  query: string,
  householdCatalog: ShoppingCatalogItem[],
  mercadonaCatalog: readonly (StaticMercadonaCatalogEntry | PreindexedMercadonaEntry)[] = [],
  limit = 12,
  section?: ShoppingSection | 'todas'
): ShoppingSuggestion[] {
  return searchShoppingSuggestionsPaginated(query, householdCatalog, mercadonaCatalog, {
    limit,
    offset: 0,
    section,
  }).items;
}

export interface PendingDuplicateCheck {
  exactSameUnitMatch: ShoppingItem | null;
  differentUnitMatch: ShoppingItem | null;
}

/**
 * Detecta duplicados pendientes respetando variantes, formato y unidades:
 * - "Leche" vs "Leche desnatada" NO coinciden (son variantes distintas).
 * - "Tomates (kg)" vs "Tomates (ud)" -> differentUnitMatch (no fusionar automáticamente).
 * - "Leche entera (L)" vs "Leche entera (L)" -> exactSameUnitMatch (ofrecer sumar o añadir aparte).
 */
export function findPendingDuplicateMatch(
  text: string,
  unit: string | undefined,
  pendingItems: ShoppingItem[],
  options?: { format?: string }
): PendingDuplicateCheck {
  const normTarget = normalizeShoppingText(text);
  const normUnit = normalizeShoppingText(normalizeShoppingUnit(unit));
  const normFormat = normalizeShoppingText(options?.format || '');
  if (!normTarget) {
    return { exactSameUnitMatch: null, differentUnitMatch: null };
  }

  const sameTextPending = pendingItems.filter((item) => {
    if (item.done) return false;
    if (normalizeShoppingText(item.text) !== normTarget) return false;
    if (normFormat && item.format && normalizeShoppingText(item.format) !== normFormat) {
      return false;
    }
    return true;
  });

  if (sameTextPending.length === 0) {
    return { exactSameUnitMatch: null, differentUnitMatch: null };
  }

  const exactSameUnitMatch =
    sameTextPending.find(
      (item) => normalizeShoppingText(normalizeShoppingUnit(item.unit)) === normUnit
    ) ?? null;

  const differentUnitMatch = exactSameUnitMatch ? null : sameTextPending[0] ?? null;

  return { exactSameUnitMatch, differentUnitMatch };
}
