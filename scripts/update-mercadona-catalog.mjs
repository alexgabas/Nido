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
 *   - --mode=dumps (por defecto): descarga con reanudación HTTP Range a .cache/off-dumps/ y filtra
 *     en streaming sin límites de peticiones ni costes.
 *   - --mode=api: consulta paginada y educada (1 req / 6.5 s) con checkpoint reanudable.
 *   - --mode=refine: depura el catálogo JSON ya descargado (sin tráfico de red), corrige secciones
 *     mal clasificadas con reglas por límites de palabra, marca ruido en `excludedFromSuggestions`
 *     conservando IDs, variantes, formatos y atribución ODbL.
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
    defaultSection: 'Sin clasificar',
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

const VALID_SHORT_WORDS = new Set([
  'te',
  'pan',
  'pao',
  'ajo',
  'sal',
  'col',
  'ron',
  'gin',
  'uva',
  'bbq',
  'wok',
  'aji',
  'oca',
  'pez',
  'soy',
  'oat',
  'rum',
  'ice',
  'oil',
  'pie',
  'ham',
  'egg',
  'jam',
  'pea',
  'nut',
  'fig',
  'tea',
]);

const NOISE_EXACT_NAMES = new Set([
  'no',
  'se',
  'si',
  'ya',
  'ok',
  'na',
  'ni',
  'lo',
  'la',
  'el',
  'en',
  'de',
  'un',
  'una',
  'ghn',
  'hace',
  'merc',
  'test',
  'prueba',
  'asdf',
  'qwer',
  'xxxx',
  'xxx',
  'producto',
  'sin nombre',
  'desconocido',
  'unknown',
  'n/a',
  'none',
  'null',
  'delete',
  'borrar',
  'nordos',
  'mierda',
  'caca',
  'polla',
  'cono',
]);

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
  if (/^\d{5,}$/.test(name)) return true;
  if (/^[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜãõÃÕ]+$/.test(name)) return true;
  if (/https?:\/\/|www\.|<[^>]+>|\{|\}/i.test(name)) return true;
  const norm = normalizeText(name);
  if (NOISE_EXACT_NAMES.has(norm)) return true;
  if (/\b(nordos|gilipollas|puta|fuck|shit)\b/i.test(norm)) return true;
  const latinLetters = (name.match(/[a-zA-ZáéíóúÁÉÍÓÚñÑüÜãõÃÕ]/g) || []).length;
  if (latinLetters < 2) return true;
  return false;
}

/**
 * Determina si una entrada existente debe excluirse de las sugerencias por ser ruido
 * (`No`, `Se`, `ghn`, `Hace`, etc.) sin eliminar palabras cortas válidas (`Té`, `Pan`, `Ajo`, `Sal`, `BBQ`, `WOK`).
 */
function isExcludedFromSuggestions(rawName) {
  const name = cleanWhitespace(rawName);
  if (isLikelyJunkProductName(name)) return true;
  const norm = normalizeText(name);
  if (!norm) return true;
  if (NOISE_EXACT_NAMES.has(norm)) return true;
  if (norm.length <= 3 && !VALID_SHORT_WORDS.has(norm)) return true;
  if (!/[aeiou]/.test(norm) && !VALID_SHORT_WORDS.has(norm)) return true;
  if (/(.)\1{3,}/.test(norm)) return true;
  if (/^\d+\s*[.,/-]*$/.test(norm)) return true;
  if (/^\d+\s*(kcal|kj|g|gr|kg|ml|cl|l|%)$/i.test(norm)) return true;
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
  if (/\b(huevo|huevos|ovos)\b/.test(normName)) return 'docena';
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

/**
 * Clasificación estricta por límites de palabra (\b) y orden de especificidad:
 * producto específico > sabor o ingrediente secundario.
 * Si no hay señales suficientes, devuelve 'Sin clasificar' en lugar de inventar una sección.
 */
function classifySection(sourceKey, name, brand = '', variant = '', extraContext = '') {
  const nameNorm = normalizeText(`${name} ${variant}`);
  const brandNorm = normalizeText(brand);
  const fullNorm = normalizeText(`${name} ${variant} ${brand} ${extraContext}`);

  // 1) Fuentes y marcas no alimentarias exclusivas
  if (
    sourceKey === 'obf' ||
    brandNorm === 'deliplus' ||
    brandNorm === 'solcare' ||
    brandNorm === 'stylius'
  ) {
    if (/\b(bebe|panal|panales|infantil|baby|diaper|potito)\b/.test(fullNorm)) {
      return 'Bebé y mascotas';
    }
    if (/\b(limpieza|detergente|lejia|fregasuelos|ambientador|papel higienico)\b/.test(nameNorm)) {
      return 'Limpieza y hogar';
    }
    return 'Cuidado personal e higiene';
  }
  if (sourceKey === 'opf' || brandNorm === 'bosque verde') {
    if (/\b(perro|gato|mascota|arena para gatos?)\b/.test(fullNorm)) {
      return 'Bebé y mascotas';
    }
    if (/\b(champu|gel de ducha|jabon de manos|pasta de dientes|desodorante|cosmet)\b/.test(nameNorm)) {
      return 'Cuidado personal e higiene';
    }
    return 'Limpieza y hogar';
  }
  if (brandNorm === 'compy') {
    return 'Bebé y mascotas';
  }

  // Marca especializada de quesos
  if (brandNorm === 'entrepinares') {
    return 'Lácteos, quesos y bebidas vegetales';
  }

  // 2) Bebé y mascotas
  if (/\b(pienso|mascota|mascotas|perro|perros|gato|gatos|arena para gatos?|panal|panales|potito|potitos|leche infantil|papilla|papillas|chupete|biberon|empapador|colonia bebe)\b/.test(fullNorm)) {
    return 'Bebé y mascotas';
  }

  // 3) Limpieza y hogar
  if (/\b(papel higienico|papel cocina|papel de cocina|servilleta|servilletas|bolsa basura|bolsa de basura|bolsas de basura|detergente|suavizante|lavavajillas|lejia|fregasuelos|limpiacristales|estropajo|bayeta|papel aluminio|papel de aluminio|film transparente|ambientador|quitagrasas|antical|desatascador|insecticida|limpiador|limpiahogar|fregona|escoba|cerillas|pila alcalina|pilas)\b/.test(fullNorm)) {
    return 'Limpieza y hogar';
  }

  // 4) Cuidado personal e higiene
  if (/\b(gel de ducha|gel bano|gel higienizante|champu|acondicionador|mascarilla capilar|desodorante|dentifrico|pasta de dientes|cepillo dental|cepillo de dientes|colutorio|compresa|compresas|tampon|tampones|salvaslip|protector solar|crema corporal|crema facial|crema hidratante|crema manos|maquinilla|afeitar|espuma de afeitar|after shave|toallita|toallitas|algodon|bastoncillos|hilo dental|colonia|perfume|agua micelar|desmaquillante|esmalte|pintalabios|laca|gomina|tinte|urea|arbol del te|aceite corporal|vaselina|tirita|tiritas|preservativo|lubricante)\b/.test(fullNorm)) {
    return 'Cuidado personal e higiene';
  }

  // 5) Congelados (antes de carnes, pescados, panes y postres)
  if (/\b(congelad[oa]s?|ultracongelad[oa]s?|helado|helados|polo|polos|sorbete|bombon helado|tarrina helado|edamame|gyoza|gyozas|hielo|cubitos de hielo|wok|patatas para freir|varitas de merluza|nuggets|churros)\b/.test(fullNorm)) {
    return 'Congelados';
  }

  // 6) Platos preparados y refrigerados
  if (/\b(plato preparado|gazpacho|salmorejo|hummus|guacamole|ensaladilla|tortilla de patata|tortilla espanola|tortilla con|pizza|pizzas|lasana|canelones|empanada|empanadilla|empanadillas|croqueta|croquetas|sushi|poke|wrap|wraps|sandwich|sandwiches|bocadillo|bocadillos|tabule|crema refrigerada|callos|fabada|paella|risotto|yakisoba|ramen|falafel)\b/.test(nameNorm) &&
      !/\b(masa de pizza|sopa instantanea|caldo)\b/.test(nameNorm)) {
    return 'Platos preparados y refrigerados';
  }

  // 7) Lácteos, quesos y bebidas vegetales (antes de fruta/pan/dulces)
  if (/\b(leche|milk|yogur|yogurt|kefir|queso|quesos|mozzarella|burrata|ricotta|mascarpone|parmesano|cheddar|gouda|emmental|brie|camembert|manchego|roquefort|feta|mato|cuajada|requeson|entrepinares|mantequilla|margarina|nata|flan|natillas|arroz con leche|petit|danonino|actimel|skyr|griego|4 quesos|bebida de avena|bebida de soja|bebida de almendra|bebida de arroz|bebida de coco|bebida vegetal|leche de avena|leche de soja|leche de almendras?)\b/.test(nameNorm) &&
      !/\b(chocolate con leche|galleta|galletas|helado|salsa de queso|patatas? fritas?|chips|snack|sabor queso)\b/.test(nameNorm)) {
    return 'Lácteos, quesos y bebidas vegetales';
  }

  // 8) Huevos, carne y charcutería (antes de pescado y conservas)
  if (/\b(huevo|huevos|ovos|eggs|clara de huevo|claras de huevo|yema)\b/.test(nameNorm) || /huevosuelo/.test(nameNorm)) {
    if (!/\b(chocolate|sorpresa|pascua|huevo kinder|galleta)\b/.test(nameNorm)) {
      return 'Carne, charcutería y huevos';
    }
  }
  if (/\b(pollo|pavo|cerdo|ternera|vacuno|cordero|conejo|jamon|lomo|lacon|beicon|bacon|panceta|hamburguesa|salchicha|salchichas|carne|chorizo|fuet|salchichon|mortadela|salami|chistorra|longaniza|morcilla|sobrasada|butifarra|pate|foie|albondigas|alitas|alas de pollo|pechuga|muslo|contramuslo|solomillo|chuleta|costilla|entrecot|secreto|abanico iberico|presa|alheira|anojo|cachopo|york)\b/.test(nameNorm) &&
      !/\b(caldo|patatas? fritas?|chips|sabor jamon|aroma|vegano|vegetal|arroz con|bocata queso)\b/.test(nameNorm)) {
    return 'Carne, charcutería y huevos';
  }

  // 9) Conservas de pescado -> Despensa (antes de Pescado fresco)
  const isCannedOrPreserve = /\b(lata|latas|conserva|conservas|en aceite|aceite de oliva|aceite de girasol|al natural|escabeche|en tomate|en salsa)\b/.test(nameNorm);

  // 10) Pescado y marisco fresco / refrigerado
  if (!isCannedOrPreserve &&
      /\b(salmon|merluza|bacalao|lubina|dorada|emperador|pez espada|rape|lenguado|rodaballo|trucha|boqueron|boquerones|sardina|sardinas|caballa|jurel|bonito|atun|anchoa|anchoas|anchois|langostino|langostinos|gamba|gambas|gambon|cigala|bogavante|mejillon|mejillones|almeja|almejas|berberecho|berberechos|pulpo|sepia|calamar|calamares|pota|chipiron|chipirones|navaja|navajas|ostra|vieira|pescado|marisco|surimi|gulas|cangrejo|panga|tilapia)\b/.test(nameNorm)) {
    return 'Pescado y marisco';
  }

  // 11) Panadería y bollería (antes de fruta/despensa para panes con aceite de oliva)
  if (/\b(pan|panes|panecillo|panecillos|panets|barra de pan|pan de molde|pan integral|pan rustico|baguette|baguettes|chapata|chapatas|mollete|molletes|piadina|piadinas|croissant|magdalena|magdalenas|brioche|hojaldre|masa de pizza|masa quebrada|picos|reganas|biscote|biscotes|tostada|tostadas|rosquilla|rosquillas|ensaimada|napolitana|napolitanas|sobao|sobaos|bizcocho|palmera|palmeritas|donut|berlina|muffin|tortita|tortitas|tortillas? de trigo|tortillas? integrales|tortillas? de avena|fajita|fajitas|xuxo|pao)\b/.test(nameNorm) &&
      !/\b(panal|panales|panceta|pantalon|pan rallado)\b/.test(nameNorm)) {
    return 'Panadería y bollería';
  }

  // 12) Bebidas (antes de fruta para zumos/néctares de fruta)
  if (/\b(agua|agua mineral|refresco|cola|coca cola|pepsi|fanta|sprite|tonica|gaseosa|casera|cerveza|clara|vino|cava|champan|champagne|vermut|sidra|sangria|tinto de verano|ginebra|gin|ron|vodka|whisky|licor|crema de orujo|kombucha|horchata|zumo|zumos|nectar|jus|batido|bebida energetica|isotonica|aquarius|nestea|fuze tea|te frio|mosto|fino|moscatel|anis|pacharan)\b/.test(nameNorm) &&
      !/\b(vinagre|zumo de limon.*cocina)\b/.test(nameNorm)) {
    return 'Bebidas';
  }

  // 13) Desayuno, café y dulces (antes de fruta/despensa para galletas/mermeladas con fruta)
  if (/\b(cafe|descafeinado|capsulas|espresso|ristretto|cappuccino|cacao|colacao|nesquik|infusion|infusiones|manzanilla|tila|poleo|te|te verde|te negro|te rojo|chai|matcha|cereales|copos de avena|muesli|granola|porridge|galleta|galletas|barquillo|mermelada|confitura|miel|crema de cacahuete|crema de cacao|nocilla|nutella|azucar|edulcorante|sacarina|stevia|chocolate|bombones|turron|polvoron|mantecado|mazapan|caramelo|caramelos|chicle|chicles|gominola|golosina|regaliz|barrita|barritas|cacao puro)\b/.test(nameNorm) &&
      !/\b(aceite|salsa)\b/.test(nameNorm)) {
    return 'Desayuno, café y dulces';
  }

  // 14) Despensa, arroz, pasta y conservas (antes de fruta para aceites, tomate frito, conservas, snacks)
  if (/\b(arroz|pasta|espagueti|espaguetis|macarron|macarrones|tallarin|tallarines|fideo|fideos|fusilli|penne|farfalle|tagliatelle|gnocchi|cuscus|quinoa|chia|lino|semilla|semillas|garbanzo|garbanzos|lenteja|lentejas|alubia|alubias|judias|lata|conserva|conservas|tomate frito|tomate triturado|tomate natural triturado|concentrado de tomate|maiz dulce|aceituna|aceitunas|pepinillo|pepinillos|encurtido|alcaparra|aceite|aceite de oliva|aceite de girasol|aceite de coco|vinagre|sal|pimienta|especia|especias|oregano|comino|pimenton|curry|curcuma|canela|harina|levadura|bicarbonato|pan rallado|pure|caldo|sopa|mayonesa|alioli|ketchup|mostaza|salsa|soja|bbq|aderezo|vinagreta|tahini|pesto|carbonara|bolonesa|nuez|nueces|almendra|almendras|avellana|avellanas|pistacho|pistachos|anacardo|anacardos|cacahuete|cacahuetes|pipas|frutos secos|patatas fritas|chips|nachos|palomitas|snack|maiz frito|almibar|compota|coco rallado)\b/.test(nameNorm) ||
      isCannedOrPreserve) {
    return 'Despensa, arroz, pasta y conservas';
  }

  // 15) Fruta y verdura fresca
  if (/\b(platano|platanos|banana|manzana|manzanas|maca|naranja|naranjas|mandarina|mandarinas|clementina|clementinas|limon|limones|lima|pera|peras|fresa|fresas|freson|frambuesa|frambuesas|arandano|arandanos|mora|moras|cereza|cerezas|uva|uvas|melon|sandia|pina|mango|papaya|kiwi|kiwis|aguacate|aguacates|melocoton|nectarina|paraguayo|albaricoque|ciruela|higo|higos|granada|caqui|persimon|chirimoya|maracuya|coco|tomate|tomates|patata|patatas|papa|boniato|batata|cebolla|cebollas|cebolleta|puerro|puerros|ajo|ajos|zanahoria|zanahorias|calabacin|calabaza|berenjena|pimiento|pimientos|pepino|lechuga|escarola|canonigos|rucula|espinaca|espinacas|acelga|acelgas|champinon|champinones|seta|setas|brocoli|coliflor|repollo|col|lombarda|judia verde|judias verdes|guisante|guisantes|haba|habas|esparrago|esparragos|alcachofa|alcachofas|apio|rabano|rabanito|remolacha|jengibre|fruta|frutas|verdura|verduras|ensalada|mezclum)\b/.test(nameNorm)) {
    return 'Fruta y verdura';
  }

  return 'Sin clasificar';
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
  const section = classifySection(source.key, rawName, brand, variant, categoriesText);
  const defaultUnit = inferDefaultUnit(format, rawName, section);
  const excluded = isExcludedFromSuggestions(rawName);

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
    ...(excluded ? { excludedFromSuggestions: true } : {}),
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
    { key: 'off_store', base: 'https://world.openfoodfacts.org/api/v2/search', params: 'stores_tags=mercadona&countries_tags=spain', sourceKey: 'off', defaultSection: 'Sin clasificar' },
    { key: 'off_hacendado', base: 'https://world.openfoodfacts.org/api/v2/search', params: 'brands_tags=hacendado&countries_tags=spain', sourceKey: 'off', defaultSection: 'Sin clasificar' },
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

function runRefineMode() {
  if (!fs.existsSync(OUTPUT_FILE)) {
    throw new Error(`No existe ${OUTPUT_FILE} para depurar.`);
  }
  const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  const prevItems = Array.isArray(existing.items) ? existing.items : [];

  let correctedSections = 0;
  let excludedFromSuggestionsCount = 0;
  let sinClasificarCount = 0;

  const refinedItems = prevItems.map((item) => {
    const sourceKey = String(item.sourceRef || '').split(':')[0] || 'off';
    const nextSection = classifySection(
      sourceKey,
      item.name || '',
      item.brand || '',
      item.variant || '',
      ''
    );
    if (nextSection !== item.section) {
      correctedSections += 1;
    }
    if (nextSection === 'Sin clasificar') {
      sinClasificarCount += 1;
    }
    const excluded = isExcludedFromSuggestions(item.name || '');
    if (excluded) {
      excludedFromSuggestionsCount += 1;
    }

    const updated = {
      id: item.id,
      name: item.name,
      ...(item.brand ? { brand: item.brand } : {}),
      ...(item.variant ? { variant: item.variant } : {}),
      ...(item.format ? { format: item.format } : {}),
      section: nextSection,
      ...(item.defaultUnit ? { defaultUnit: item.defaultUnit } : {}),
      ...(excluded ? { excludedFromSuggestions: true } : {}),
      sourceRef: item.sourceRef,
      source: item.source,
      addedAt: item.addedAt,
    };
    return updated;
  });

  return {
    items: refinedItems,
    stats: {
      total: refinedItems.length,
      correctedSections,
      excludedFromSuggestions: excludedFromSuggestionsCount,
      sinClasificar: sinClasificarCount,
    },
    existingMeta: existing,
  };
}

async function main() {
  const modeArg = process.argv.find((a) => a.startsWith('--mode=')) || '--mode=dumps';
  const mode = modeArg.split('=')[1];
  const addedAt = new Date().toISOString().slice(0, 10);

  let items = [];
  let refineStats = null;
  let existingMeta = null;

  if (mode === 'refine') {
    const refined = runRefineMode();
    items = refined.items;
    refineStats = refined.stats;
    existingMeta = refined.existingMeta;
  } else if (mode === 'api') {
    items = await runApiMode(addedAt);
  } else {
    items = await runDumpsMode(addedAt);
  }

  items.sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const sectionCounts = {};
  for (const item of items) {
    sectionCounts[item.section] = (sectionCounts[item.section] || 0) + 1;
  }

  const payload = {
    version: 1,
    source: existingMeta?.source || 'Open Food Facts, Open Beauty Facts & Open Products Facts',
    license:
      existingMeta?.license || 'ODbL 1.0 / DbCL 1.0 (https://world.openfoodfacts.org/terms-of-use)',
    disclaimer:
      existingMeta?.disclaimer ||
      'Catálogo de referencia no oficial. El surtido puede variar según tienda y fecha.',
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
  console.log(`Productos totales (IDs estables conservados): ${items.length.toLocaleString('es-ES')}`);
  if (refineStats) {
    console.log('Resumen depuración (--mode=refine):', {
      total: refineStats.total,
      correctedSections: refineStats.correctedSections,
      excludedFromSuggestions: refineStats.excludedFromSuggestions,
      sinClasificar: refineStats.sinClasificar,
    });
  }
  console.log(`Tamaño JSON: ${(rawBytes / (1024 * 1024)).toFixed(2)} MB | Gzip: ${(gzBytes / 1024).toFixed(1)} KB`);
  console.log('Distribución por sección (bySection):', sectionCounts);
}

main().catch((err) => {
  console.error('Error al actualizar el catálogo:', err);
  process.exit(1);
});
