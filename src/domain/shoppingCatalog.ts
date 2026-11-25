import {
  MAX_LENGTHS,
  SHOPPING_SECTIONS,
  type ShoppingCatalogItem,
  type ShoppingItem,
  type ShoppingSection,
  type ShoppingSectionOverride,
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
  excludedFromSuggestions?: boolean;
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
  defaultSection?: ShoppingSection;
  productKey?: string;
  hasSectionOverride?: boolean;
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

export function resolveShoppingProductKey(item: {
  catalogId?: string;
  text: string;
  brand?: string;
  format?: string;
}): string {
  const rawCatalogId = String(item.catalogId ?? '').trim();
  if (rawCatalogId && /^[a-zA-Z0-9_-]{2,64}$/.test(rawCatalogId)) {
    return rawCatalogId;
  }
  return buildShoppingCatalogId(item.text, {
    brand: item.brand,
    format: item.format,
  });
}

export function buildSectionOverridesMap(
  overrides: readonly ShoppingSectionOverride[] = []
): Map<string, ShoppingSection> {
  const map = new Map<string, ShoppingSection>();
  for (const ov of overrides) {
    const key = String(ov.productKey || ov.id || '').trim();
    const sec = normalizeShoppingSection(ov.section);
    if (key && sec) {
      map.set(key, sec);
    }
  }
  return map;
}

export function resolveEffectiveShoppingSection(
  item: {
    text: string;
    catalogId?: string;
    brand?: string;
    format?: string;
    section?: ShoppingSection | string;
  },
  overridesMap?: ReadonlyMap<string, ShoppingSection>
): ShoppingSection {
  if (overridesMap && overridesMap.size > 0) {
    const key = resolveShoppingProductKey(item);
    const override = overridesMap.get(key);
    if (override) return override;
  }
  return normalizeShoppingSection(item.section) ?? inferShoppingSection(item.text);
}

export function inferShoppingSection(text: string): ShoppingSection {
  const norm = normalizeShoppingText(text);
  if (!norm) return 'Sin clasificar';

  if (/\b(pienso|mascota|mascotas|perro|perros|gato|gatos|arena para gato|panal|panales|bebe|potito|potitos|papilla|papillas|chupete|biberon)\b/.test(norm)) {
    return 'Bebé y mascotas';
  }
  if (/\b(papel higienico|papel cocina|papel de cocina|servilleta|servilletas|bolsa basura|bolsas de basura|detergente|suavizante|lavavajillas|lejia|fregasuelos|limpiacristales|estropajo|bayeta|papel aluminio|papel de aluminio|film transparente|ambientador|quitagrasas|antical|desatascador|insecticida|limpiador)\b/.test(norm)) {
    return 'Limpieza y hogar';
  }
  if (/\b(gel de ducha|gel bano|champu|acondicionador|mascarilla capilar|desodorante|pasta de dientes|dentifrico|cepillo dental|cepillo de dientes|colutorio|compresa|compresas|tampon|tampones|protector solar|crema hidratante|crema facial|crema corporal|toallita|toallitas|algodon|afeitar|hilo dental|colonia|perfume|maquillaje|jabon de manos|esponja)\b/.test(norm)) {
    return 'Cuidado personal e higiene';
  }
  if (/\b(congelad[oa]s?|ultracongelad[oa]s?|helado|helados|polo|polos|sorbete|tarrina helado|edamame|gyoza|gyozas|hielo|cubitos de hielo|croquetas congeladas)\b/.test(norm)) {
    return 'Congelados';
  }
  if (/\b(gazpacho|salmorejo|hummus|guacamole|ensaladilla|tortilla de patata|tortilla espanola|pizza fresca|lasana|canelones|plato preparado|empanadilla|empanada|sushi|poke|wrap|sandwich|bocadillo|tabule|crema refrigerada)\b/.test(norm)) {
    return 'Platos preparados y refrigerados';
  }
  if (/\b(leche|yogur|yogurt|kefir|queso|quesos|mozzarella|burrata|ricotta|mascarpone|parmesano|cheddar|gouda|emmental|brie|camembert|manchego|roquefort|entrepinares|mantequilla|margarina|nata|requeson|cuajada|flan|natillas|arroz con leche|petit suisse|bebida de avena|bebida de soja|bebida de almendra|bebida vegetal)\b/.test(norm)) {
    return 'Lácteos, quesos y bebidas vegetales';
  }
  if (/\b(huevo|huevos|clara de huevo|claras de huevo|yema|pollo|pavo|cerdo|ternera|vacuno|cordero|conejo|jamon|lomo|lacon|beicon|bacon|panceta|hamburguesa|salchicha|salchichas|carne|chorizo|fuet|salchichon|mortadela|salami|pate|foie|morcilla|butifarra|espinazo|carcasa|alitas|muslo|pechuga|solomillo|chuleta|costilla|entrecot|secreto|presa iberica)\b/.test(norm) &&
      !/\b(caldo|patatas? fritas?|chips|sabor jamon|aroma|vegano|vegetal)\b/.test(norm)) {
    return 'Carne, charcutería y huevos';
  }
  if (/\b(salmon|merluza|bacalao|lubina|dorada|emperador|pez espada|rape|lenguado|rodaballo|trucha|boqueron|boquerones|sardina|sardinas|caballa|jurel|bonito|atun fresco|langostino|langostinos|gamba|gambas|gambon|mejillon|mejillones|almeja|almejas|berberecho|pulpo|sepia|calamar|calamares|chipiron|chipirones|pescado|marisco|surimi|gulas|anguriñas|cangrejo)\b/.test(norm) &&
      !/\b(lata|conserva|en aceite|al natural|escabeche|tomate)\b/.test(norm)) {
    return 'Pescado y marisco';
  }
  if (/\b(pan|barra de pan|pan de molde|pan integral|pan rustico|baguette|chapata|croissant|magdalena|magdalenas|brioche|hojaldre|masa de pizza|picos|regañas|biscote|biscotes|tostada|tostadas|rosquilla|ensaimada|napolitana|sobao|sobaos|bizcocho|palmera|donut|berlina|muffin|tortita|tortitas|tortilla de trigo|fajita|fajitas)\b/.test(norm) &&
      !/\b(panal|panales|panceta|pantalon)\b/.test(norm)) {
    return 'Panadería y bollería';
  }
  if (/\b(platano|platanos|banana|manzana|manzanas|naranja|naranjas|mandarina|mandarinas|clementina|limon|limones|lima|pera|peras|fresa|fresas|freson|frambuesa|arandano|arandanos|mora|moras|cereza|cerezas|uva|uvas|melon|sandia|pina|mango|papaya|kiwi|aguacate|aguacates|melocoton|nectarina|albaricoque|ciruela|higo|granada|caqui|chirimoya|tomate|tomates|patata|patatas|boniato|cebolla|cebollas|cebolleta|puerro|ajo|ajos|zanahoria|zanahorias|calabacin|calabaza|berenjena|pimiento|pimientos|pepino|lechuga|escarola|canonigos|rucula|espinaca|espinacas|acelga|champinon|champinones|seta|setas|brocoli|coliflor|repollo|col|lombarda|judia verde|guisante fresco|esparrago|alcachofa|apio|rabano|remolacha|jengibre|fruta|verdura|ensalada bolsa)\b/.test(norm) &&
      !/\b(frito|triturado|zumo|nectar|mermelada|confitura|galleta|galletas|yogur|helado|caramelo|chicle|infusion|te|refresco|sabor|aroma|aderezo|salsa|vinagre|aceite|patatas fritas|chips|snack|compota|conserva|almibar|deshidratad[oa]|lata)\b/.test(norm)) {
    return 'Fruta y verdura';
  }
  if (/\b(agua|agua mineral|refresco|cola|coca cola|pepsi|fanta|sprite|tonica|gaseosa|casera|cerveza|clara|vino|cava|champan|vermut|sidra|sangria|tinto de verano|ginebra|ron|vodka|whisky|licor|kombucha|horchata|zumo|nectar|batido|bebida energetica|isotonica|aquarius|nestea|fuze tea|te frio)\b/.test(norm)) {
    return 'Bebidas';
  }
  if (/\b(cafe|descafeinado|capsulas cafe|cacao|colacao|nesquik|infusion|infusiones|manzanilla|tila|poleo|te|te verde|te negro|te rojo|chai|matcha|cereales|avena|copos de avena|muesli|granola|galleta|galletas|mermelada|confitura|miel|crema de cacahuete|crema de cacao|nocilla|nutella|azucar|edulcorante|sacarina|stevia|chocolate|bombones|turron|caramelo|caramelos|chicle|gominola|golosina|barrita)\b/.test(norm)) {
    return 'Desayuno, café y dulces';
  }
  if (/\b(arroz|pasta|espagueti|espaguetis|macarron|macarrones|tallarin|tallarines|fideo|fideos|fusilli|penne|cuscus|quinoa|garbanzo|garbanzos|lenteja|lentejas|alubia|alubias|judias|atun en lata|atun claro|sardinilla|sardinillas|caballa lata|mejillon escabeche|conserva|conservas|tomate frito|tomate triturado|maiz dulce|aceituna|aceitunas|pepinillo|encurtido|aceite|aceite de oliva|aceite girasol|vinagre|sal|pimienta|especia|especias|oregano|comino|pimenton|curry|harina|levadura|pan rallado|caldo|sopa|crema de verduras|mayonesa|ketchup|mostaza|salsa|soja|aderezo|nuez|nueces|almendra|almendras|avellana|pistacho|anacardo|cacahuete|pipas|frutos secos|patatas fritas|chips|nachos|palomitas|snack|maiz frito)\b/.test(norm)) {
    return 'Despensa, arroz, pasta y conservas';
  }
  return 'Sin clasificar';
}

export function groupShoppingItemsBySection(
  items: ShoppingItem[],
  sectionOverrides?: ReadonlyMap<string, ShoppingSection>
): Array<{ section: ShoppingSection; items: ShoppingItem[] }> {
  const buckets = new Map<ShoppingSection, ShoppingItem[]>();
  for (const sec of SHOPPING_SECTIONS) {
    buckets.set(sec, []);
  }
  for (const item of items) {
    const sec = resolveEffectiveShoppingSection(item, sectionOverrides);
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
  options?: {
    limit?: number;
    offset?: number;
    section?: ShoppingSection | 'todas';
    sectionOverrides?: ReadonlyMap<string, ShoppingSection>;
  }
): PaginatedShoppingSuggestions {
  const limit = Math.max(1, options?.limit ?? 12);
  const offset = Math.max(0, options?.offset ?? 0);
  const normQuery = normalizeShoppingText(query);
  const activeSection =
    options?.section && options.section !== 'todas'
      ? normalizeShoppingSection(options.section)
      : undefined;
  const overrides = options?.sectionOverrides;

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
      const productKey = resolveShoppingProductKey(item);
      const defaultSection = normalizeShoppingSection(item.section) ?? inferShoppingSection(item.text);
      const overrideSec = overrides?.get(productKey);
      return {
        key: `hogar:${item.id}`,
        text: item.text,
        defaultUnit: item.defaultUnit || '',
        source: 'hogar' as const,
        sourceType: srcType,
        ...(item.catalogId ? { catalogId: item.catalogId } : {}),
        ...(item.brand ? { brand: item.brand } : {}),
        ...(item.format ? { format: item.format } : {}),
        section: overrideSec ?? defaultSection,
        defaultSection,
        productKey,
        hasSectionOverride: Boolean(overrideSec),
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
    const productKey = resolveShoppingProductKey(item);
    const defaultSection = normalizeShoppingSection(item.section) ?? inferShoppingSection(item.text);
    const overrideSec = overrides?.get(productKey);
    const itemSection = overrideSec ?? defaultSection;
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
        defaultSection,
        productKey,
        hasSectionOverride: Boolean(overrideSec),
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
    if (raw.excludedFromSuggestions) continue;
    if (seenCatalogIds.has(raw.id)) continue;

    const defaultSection = normalizeShoppingSection(raw.section) ?? inferShoppingSection(raw.name);
    const overrideSec = overrides?.get(raw.id);
    const entrySection = overrideSec ?? defaultSection;
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
        defaultSection,
        productKey: entry.id,
        hasSectionOverride: Boolean(overrideSec),
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
    const overrideSec = overrides?.get(gen.id);
    const genSection = overrideSec ?? gen.section;
    if (activeSection && genSection !== activeSection) continue;

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
        catalogId: gen.id,
        section: genSection,
        defaultSection: gen.section,
        productKey: gen.id,
        hasSectionOverride: Boolean(overrideSec),
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
  section?: ShoppingSection | 'todas',
  sectionOverrides?: ReadonlyMap<string, ShoppingSection>
): ShoppingSuggestion[] {
  return searchShoppingSuggestionsPaginated(query, householdCatalog, mercadonaCatalog, {
    limit,
    offset: 0,
    section,
    sectionOverrides,
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
