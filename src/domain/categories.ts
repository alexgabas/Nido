import {
  SYSTEM_EXPENSE_CATEGORIES,
  type CategoryBudgetLimit,
  type CategoryColorMap,
  type CustomCategory,
  type MemberCategoryPreferences,
  type MonthlyBudget,
  type SystemExpenseCategory,
  type Transaction,
  type TransactionCategory,
} from '../types/nido';
import {
  DEFAULT_CATEGORY_COLORS,
  DEFAULT_SETTLEMENT_COLOR,
  isValidHexColor,
} from './categoryPalette';
import { EXPENSE_CATEGORY_LABELS } from './presets';

export const CATEGORY_ICON_KEYS = [
  'tag',
  'home',
  'dumbbell',
  'heart-pulse',
  'paw-print',
  'utensils',
  'shirt',
  'gift',
  'plane',
  'graduation-cap',
  'sparkles',
  'car',
  'alert-circle',
  'shopping-bag',
  'coffee',
  'music',
  'wrench',
  'book',
  'zap',
  'droplets',
  'flame',
  'wifi',
  'smartphone',
  'tv',
  'shield',
  'building-2',
  'shopping-cart',
  'ticket',
  'layers',
] as const;

export type CategoryIconKey = (typeof CATEGORY_ICON_KEYS)[number];

export const CATEGORY_ICON_OPTIONS: ReadonlyArray<{ key: CategoryIconKey; label: string }> = [
  { key: 'tag', label: 'Etiqueta' },
  { key: 'home', label: 'Hogar' },
  { key: 'dumbbell', label: 'Deporte' },
  { key: 'heart-pulse', label: 'Salud' },
  { key: 'paw-print', label: 'Mascotas' },
  { key: 'utensils', label: 'Restauración' },
  { key: 'shirt', label: 'Ropa' },
  { key: 'gift', label: 'Regalos' },
  { key: 'plane', label: 'Viajes' },
  { key: 'graduation-cap', label: 'Formación' },
  { key: 'sparkles', label: 'Cuidado' },
  { key: 'car', label: 'Vehículo' },
  { key: 'alert-circle', label: 'Imprevistos' },
  { key: 'shopping-bag', label: 'Compras' },
  { key: 'coffee', label: 'Café' },
  { key: 'music', label: 'Música' },
  { key: 'wrench', label: 'Mantenimiento' },
  { key: 'book', label: 'Lectura' },
  { key: 'shopping-cart', label: 'Supermercado' },
  { key: 'ticket', label: 'Ocio' },
  { key: 'zap', label: 'Electricidad' },
  { key: 'droplets', label: 'Agua' },
  { key: 'flame', label: 'Gas' },
  { key: 'wifi', label: 'Internet' },
  { key: 'smartphone', label: 'Móvil' },
  { key: 'tv', label: 'Suscripciones' },
  { key: 'shield', label: 'Seguros' },
  { key: 'building-2', label: 'Comunidad' },
  { key: 'layers', label: 'Otros' },
];

export const SYSTEM_CATEGORY_ICONS: Record<SystemExpenseCategory, CategoryIconKey> = {
  alquiler: 'home',
  luz: 'zap',
  agua: 'droplets',
  gas: 'flame',
  internet: 'wifi',
  movil: 'smartphone',
  suscripciones: 'tv',
  seguros: 'shield',
  comunidad: 'building-2',
  supermercado: 'shopping-cart',
  transporte: 'car',
  ocio: 'ticket',
  otros: 'layers',
};

export interface CustomCategorySuggestion {
  key: string;
  name: string;
  icon: CategoryIconKey;
  color: string;
  csvKeywords: string;
}

export const CUSTOM_CATEGORY_SUGGESTIONS: readonly CustomCategorySuggestion[] = [
  {
    key: 'hogar_decoracion',
    name: 'Hogar y decoración',
    icon: 'home',
    color: '#0F766E',
    csvKeywords: 'ikea, leroy merlin, zara home, maison, ferreteria',
  },
  {
    key: 'gimnasio_deporte',
    name: 'Gimnasio y deporte',
    icon: 'dumbbell',
    color: '#0284C7',
    csvKeywords: 'gimnasio, gym, dir, basic fit, vivagym, decathlon, padel',
  },
  {
    key: 'salud_farmacia',
    name: 'Salud y farmacia',
    icon: 'heart-pulse',
    color: '#DC4C3E',
    csvKeywords: 'farmacia, parafama, dentista, clinica, fisio, optica',
  },
  {
    key: 'mascotas',
    name: 'Mascotas',
    icon: 'paw-print',
    color: '#B45309',
    csvKeywords: 'veterinario, kiwoko, tiendanimal, pienso',
  },
  {
    key: 'restaurantes_pedidos',
    name: 'Restaurantes y pedidos',
    icon: 'utensils',
    color: '#EA580C',
    csvKeywords: 'restaurante, glovo, uber eats, just eat, bar, tapas',
  },
  {
    key: 'ropa_calzado',
    name: 'Ropa y calzado',
    icon: 'shirt',
    color: '#9333EA',
    csvKeywords: 'zara, mango, h&m, uniqlo, pull, bershka, zapateria',
  },
  {
    key: 'regalos_celebraciones',
    name: 'Regalos y celebraciones',
    icon: 'gift',
    color: '#DB2777',
    csvKeywords: 'regalo, floristeria, fnac, cumpleanos',
  },
  {
    key: 'viajes_escapadas',
    name: 'Viajes y escapadas',
    icon: 'plane',
    color: '#2563EB',
    csvKeywords: 'booking, airbnb, hotel, ryanair, vueling, renfe ave',
  },
  {
    key: 'formacion',
    name: 'Formación',
    icon: 'graduation-cap',
    color: '#4F46E5',
    csvKeywords: 'academia, curso, libros, libreria, universidad',
  },
  {
    key: 'cuidado_personal',
    name: 'Cuidado personal',
    icon: 'sparkles',
    color: '#7C3AED',
    csvKeywords: 'peluqueria, barberia, estetica, primor, druni',
  },
  {
    key: 'vehiculo',
    name: 'Vehículo',
    icon: 'car',
    color: '#475569',
    csvKeywords: 'taller, itv, seguro coche, neumaticos, lavadero',
  },
  {
    key: 'imprevistos',
    name: 'Imprevistos',
    icon: 'alert-circle',
    color: '#D97706',
    csvKeywords: 'reparacion, cerrajero, urgencia',
  },
];

export interface ResolvedCategoryMeta {
  id: TransactionCategory;
  label: string;
  color: string;
  icon: CategoryIconKey | 'arrow-left-right';
  isSystem: boolean;
  archived: boolean;
  isUnknown: boolean;
  isSettlement: boolean;
  order: number;
  csvKeywords: string;
}

const SYSTEM_SET = new Set<string>(SYSTEM_EXPENSE_CATEGORIES);
const ICON_SET = new Set<string>(CATEGORY_ICON_KEYS);

export function isSystemExpenseCategory(id: string): id is SystemExpenseCategory {
  return SYSTEM_SET.has(id);
}

export function isCustomCategoryId(id: string): boolean {
  return /^cat_[a-zA-Z0-9_]{2,44}$/.test(id);
}

export function isValidCategoryIcon(icon: unknown): icon is CategoryIconKey {
  return typeof icon === 'string' && ICON_SET.has(icon);
}

export function normalizeCategoryName(name: string): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function generateCustomCategoryId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(existingIds);
  let baseSlug =
    normalizeCategoryName(name)
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 22) || 'custom';
  if (baseSlug.length < 2) {
    baseSlug = `${baseSlug}_cat`;
  }
  const candidate = `cat_${baseSlug}`;
  if (!taken.has(candidate)) return candidate;
  let counter = 2;
  while (counter < 1000) {
    const suffixed = `${candidate.slice(0, 38)}_${counter}`;
    if (!taken.has(suffixed)) return suffixed;
    counter += 1;
  }
  return `cat_${Date.now().toString(36)}`.slice(0, 40);
}

export function isValidSelectorCategoryId(id: string): boolean {
  return isSystemExpenseCategory(id) || isCustomCategoryId(id);
}

export const CATEGORY_SELECTOR_PREFS_VERSION = 1;
export const MAX_VISIBLE_SELECTOR_CATEGORIES = 60;

export interface InitialVisibleCategoryEntry {
  type: 'system' | 'suggestion';
  id: string;
}

export const INITIAL_VISIBLE_CATEGORY_SPEC: readonly InitialVisibleCategoryEntry[] = [
  { type: 'system', id: 'supermercado' },
  { type: 'system', id: 'ocio' },
  { type: 'suggestion', id: 'restaurantes_pedidos' },
  { type: 'suggestion', id: 'hogar_decoracion' },
  { type: 'suggestion', id: 'cuidado_personal' },
  { type: 'suggestion', id: 'gimnasio_deporte' },
  { type: 'suggestion', id: 'salud_farmacia' },
  { type: 'suggestion', id: 'mascotas' },
  { type: 'suggestion', id: 'ropa_calzado' },
  { type: 'suggestion', id: 'regalos_celebraciones' },
  { type: 'suggestion', id: 'viajes_escapadas' },
  { type: 'suggestion', id: 'vehiculo' },
  { type: 'suggestion', id: 'imprevistos' },
  { type: 'system', id: 'otros' },
] as const;

const SUGGESTION_BY_KEY = new Map<string, CustomCategorySuggestion>(
  CUSTOM_CATEGORY_SUGGESTIONS.map((s) => [s.key, s])
);

export function findExistingCustomCategoryForSuggestion(
  suggestion: CustomCategorySuggestion,
  customCategories: CustomCategory[]
): CustomCategory | undefined {
  const deterministicId = `cat_${suggestion.key}`;
  const byId = customCategories.find((c) => c.id === deterministicId);
  if (byId) return byId;
  const targetNorm = normalizeCategoryName(suggestion.name);
  return customCategories.find((c) => normalizeCategoryName(c.name) === targetNorm);
}

export interface InitialVisibleCategoriesPlan {
  missingSuggestionsToCreate: Array<{
    id: string;
    suggestion: CustomCategorySuggestion;
    order: number;
  }>;
  orderedVisibleIds: string[];
}

export function resolveInitialVisibleCategoriesPlan(
  customCategories: CustomCategory[]
): InitialVisibleCategoriesPlan {
  const existingIds = new Set(customCategories.map((c) => c.id));
  let nextOrder =
    customCategories.reduce((max, c) => Math.max(max, Number.isFinite(c.order) ? c.order : 0), 0) +
    1;

  const missingSuggestionsToCreate: InitialVisibleCategoriesPlan['missingSuggestionsToCreate'] = [];
  const orderedVisibleIds: string[] = [];

  for (const entry of INITIAL_VISIBLE_CATEGORY_SPEC) {
    if (entry.type === 'system') {
      orderedVisibleIds.push(entry.id);
      continue;
    }
    const suggestion = SUGGESTION_BY_KEY.get(entry.id);
    if (!suggestion) continue;

    const existing = findExistingCustomCategoryForSuggestion(suggestion, customCategories);
    if (existing) {
      orderedVisibleIds.push(existing.id);
      continue;
    }

    const preferredId = `cat_${suggestion.key}`;
    const id =
      isCustomCategoryId(preferredId) && !existingIds.has(preferredId)
        ? preferredId
        : generateCustomCategoryId(suggestion.name, existingIds);
    existingIds.add(id);

    missingSuggestionsToCreate.push({
      id,
      suggestion,
      order: nextOrder,
    });
    nextOrder += 1;
    orderedVisibleIds.push(id);
  }

  return {
    missingSuggestionsToCreate,
    orderedVisibleIds,
  };
}

export interface ResolvedSelectorCategories {
  visibleCategories: ResolvedCategoryMeta[];
  hiddenCategories: ResolvedCategoryMeta[];
  selectedOutsideVisible: ResolvedCategoryMeta | null;
}

export function resolveSelectorCategories(
  registry: CategoryRegistry,
  prefs: MemberCategoryPreferences | null | undefined,
  selectedCategoryId?: string
): ResolvedSelectorCategories {
  const activeById = new Map<string, ResolvedCategoryMeta>(
    registry.activeCategories.map((c) => [c.id, c])
  );

  const rawPreferredIds =
    prefs && Array.isArray(prefs.visibleCategoryIds) && prefs.visibleCategoryIds.length > 0
      ? prefs.visibleCategoryIds
      : resolveInitialVisibleCategoriesPlan(registry.customCategories).orderedVisibleIds;

  const visibleCategories: ResolvedCategoryMeta[] = [];
  const visibleIdSet = new Set<string>();

  for (const id of rawPreferredIds) {
    if (visibleIdSet.has(id)) continue;
    const meta = activeById.get(id);
    if (!meta) continue;
    visibleIdSet.add(id);
    visibleCategories.push(meta);
  }

  // Safe fallback if all preferred categories were deleted or archived
  if (visibleCategories.length === 0) {
    for (const cat of registry.activeCategories) {
      visibleIdSet.add(cat.id);
      visibleCategories.push(cat);
    }
  }

  const hiddenCategories = registry.activeCategories.filter((c) => !visibleIdSet.has(c.id));

  let selectedOutsideVisible: ResolvedCategoryMeta | null = null;
  if (
    selectedCategoryId &&
    selectedCategoryId !== 'liquidacion' &&
    !visibleIdSet.has(selectedCategoryId)
  ) {
    selectedOutsideVisible = registry.getMeta(selectedCategoryId);
  }

  return {
    visibleCategories,
    hiddenCategories,
    selectedOutsideVisible,
  };
}

export function isCategoryDuplicateName(
  name: string,
  customCategories: CustomCategory[],
  excludeCategoryId?: string
): boolean {
  const target = normalizeCategoryName(name);
  if (!target) return false;
  for (const sysId of SYSTEM_EXPENSE_CATEGORIES) {
    if (normalizeCategoryName(EXPENSE_CATEGORY_LABELS[sysId]) === target) {
      return true;
    }
  }
  if (target === 'liquidacion') return true;
  return customCategories.some(
    (c) => c.id !== excludeCategoryId && normalizeCategoryName(c.name) === target
  );
}

export function getAvailableCategorySuggestions(
  customCategories: CustomCategory[]
): CustomCategorySuggestion[] {
  return CUSTOM_CATEGORY_SUGGESTIONS.filter(
    (s) => !isCategoryDuplicateName(s.name, customCategories)
  );
}

export interface CategoryRegistry {
  activeCategories: ResolvedCategoryMeta[];
  allKnownCategories: ResolvedCategoryMeta[];
  customCategories: CustomCategory[];
  labelsMap: Record<string, string>;
  colorsMap: Record<string, string>;
  getMeta: (id: string) => ResolvedCategoryMeta;
  getLabel: (id: string) => string;
  getColor: (id: string) => string;
  getIcon: (id: string) => CategoryIconKey | 'arrow-left-right';
  isArchived: (id: string) => boolean;
}

export function buildCategoryRegistry(
  customCategories: CustomCategory[] = [],
  householdColors?: CategoryColorMap
): CategoryRegistry {
  const sortedCustom = [...customCategories].sort(
    (a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, 'es')
  );

  const metaMap = new Map<string, ResolvedCategoryMeta>();
  const labelsMap: Record<string, string> = {
    liquidacion: 'Liquidación',
  };
  const colorsMap: Record<string, string> = {};

  SYSTEM_EXPENSE_CATEGORIES.forEach((id, index) => {
    const customColor = householdColors?.[id];
    const color = isValidHexColor(customColor)
      ? customColor.toUpperCase()
      : DEFAULT_CATEGORY_COLORS[id] ?? '#64748B';
    const label = EXPENSE_CATEGORY_LABELS[id] || id;
    const meta: ResolvedCategoryMeta = {
      id,
      label,
      color,
      icon: SYSTEM_CATEGORY_ICONS[id] ?? 'tag',
      isSystem: true,
      archived: false,
      isUnknown: false,
      isSettlement: false,
      order: index,
      csvKeywords: '',
    };
    metaMap.set(id, meta);
    labelsMap[id] = label;
    colorsMap[id] = color;
  });

  sortedCustom.forEach((cat, idx) => {
    const color = isValidHexColor(cat.color) ? cat.color.toUpperCase() : '#0F766E';
    const icon: CategoryIconKey = isValidCategoryIcon(cat.icon) ? cat.icon : 'tag';
    const meta: ResolvedCategoryMeta = {
      id: cat.id,
      label: cat.name,
      color,
      icon,
      isSystem: false,
      archived: Boolean(cat.archived),
      isUnknown: false,
      isSettlement: false,
      order: 100 + (Number.isFinite(cat.order) ? cat.order : idx),
      csvKeywords: cat.csvKeywords || '',
    };
    metaMap.set(cat.id, meta);
    labelsMap[cat.id] = cat.name;
    colorsMap[cat.id] = color;
  });

  const settlementMeta: ResolvedCategoryMeta = {
    id: 'liquidacion',
    label: 'Liquidación',
    color: DEFAULT_SETTLEMENT_COLOR,
    icon: 'arrow-left-right',
    isSystem: true,
    archived: false,
    isUnknown: false,
    isSettlement: true,
    order: 9999,
    csvKeywords: '',
  };
  metaMap.set('liquidacion', settlementMeta);

  const getMeta = (id: string): ResolvedCategoryMeta => {
    const found = metaMap.get(id);
    if (found) return found;
    const fallbackLabel = id
      ? `Categoría (${id.replace(/^cat_/, '').replace(/_/g, ' ')})`
      : 'Otros';
    return {
      id: id || 'otros',
      label: fallbackLabel,
      color: '#64748B',
      icon: 'tag',
      isSystem: false,
      archived: false,
      isUnknown: true,
      isSettlement: false,
      order: 9998,
      csvKeywords: '',
    };
  };

  const allKnownCategories = Array.from(metaMap.values())
    .filter((m) => !m.isSettlement)
    .sort((a, b) => a.order - b.order);

  const activeCategories = allKnownCategories.filter((m) => !m.archived);

  return {
    activeCategories,
    allKnownCategories,
    customCategories: sortedCustom,
    labelsMap,
    colorsMap,
    getMeta,
    getLabel: (id: string) => getMeta(id).label,
    getColor: (id: string) => getMeta(id).color,
    getIcon: (id: string) => getMeta(id).icon,
    isArchived: (id: string) => getMeta(id).archived,
  };
}

export function pickSimpleWizardCategories(
  activeCategories: ResolvedCategoryMeta[],
  recentTransactions: Transaction[],
  primaryLimit = 8
): {
  primaryCategories: ResolvedCategoryMeta[];
  overflowCategories: ResolvedCategoryMeta[];
} {
  if (activeCategories.length <= primaryLimit) {
    return {
      primaryCategories: activeCategories,
      overflowCategories: [],
    };
  }

  const freq = new Map<string, number>();
  for (const tx of recentTransactions) {
    if (tx.isSettlement || tx.category === 'liquidacion') continue;
    freq.set(tx.category, (freq.get(tx.category) ?? 0) + 1);
  }

  // Always keep supermercado & ocio handy when there is little history
  const ranked = [...activeCategories].sort((a, b) => {
    const fa = freq.get(a.id) ?? 0;
    const fb = freq.get(b.id) ?? 0;
    if (fb !== fa) return fb - fa;
    // Active custom categories with usage rank up naturally; otherwise prefer everyday defaults before utilities
    const priorityIds = ['supermercado', 'ocio', 'transporte', 'alquiler', 'luz', 'internet', 'otros'];
    const pa = priorityIds.indexOf(a.id);
    const pb = priorityIds.indexOf(b.id);
    if (pa !== -1 && pb !== -1) return pa - pb;
    if (pa !== -1) return -1;
    if (pb !== -1) return 1;
    return a.order - b.order;
  });

  const primarySet = new Set(ranked.slice(0, primaryLimit).map((c) => c.id));
  return {
    primaryCategories: activeCategories.filter((c) => primarySet.has(c.id)),
    overflowCategories: activeCategories.filter((c) => !primarySet.has(c.id)),
  };
}

export function mergeMonthlyAndCustomBudgetLimits(
  monthlyBudget: MonthlyBudget | null,
  categoryBudgets: CategoryBudgetLimit[],
  monthKey?: string
): MonthlyBudget | null {
  const filteredCustom = monthKey
    ? categoryBudgets.filter((b) => b.monthKey === monthKey)
    : categoryBudgets;

  if (!monthlyBudget && filteredCustom.length === 0) {
    return null;
  }

  const mergedLimits: Record<string, number> = {};
  if (monthlyBudget?.limits) {
    for (const [k, v] of Object.entries(monthlyBudget.limits)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        mergedLimits[k] = v;
      }
    }
  }
  for (const item of filteredCustom) {
    if (Number.isFinite(item.limit) && item.limit >= 0) {
      mergedLimits[item.categoryId] = item.limit;
    }
  }

  return {
    monthKey: monthlyBudget?.monthKey || monthKey || filteredCustom[0]?.monthKey || '',
    limits: mergedLimits,
    updatedAt: monthlyBudget?.updatedAt || filteredCustom[0]?.updatedAt || '',
  };
}

export function buildCategoryBudgetDocId(monthKey: string, categoryId: string): string {
  return `${monthKey}__${categoryId}`;
}

export function isCategoryUsedInHouseholdData(
  categoryId: string,
  params: {
    transactions?: Array<{ category: string }>;
    recurring?: Array<{ category: string }>;
    initialCosts?: Array<{ category: string }>;
    categoryBudgets?: Array<{ categoryId: string; limit: number }>;
  }
): boolean {
  if (params.transactions?.some((t) => t.category === categoryId)) return true;
  if (params.recurring?.some((r) => r.category === categoryId)) return true;
  if (params.initialCosts?.some((c) => c.category === categoryId)) return true;
  if (params.categoryBudgets?.some((b) => b.categoryId === categoryId)) return true;
  return false;
}

export interface CategoryDeleteSafetyCheck {
  canDelete: boolean;
  reason: 'in_use' | 'multi_member_privacy' | null;
}

export function canSafelyDeleteCustomCategory(
  categoryId: string,
  params: {
    memberCount: number;
    transactions?: Array<{ category: string }>;
    recurring?: Array<{ category: string }>;
    initialCosts?: Array<{ category: string }>;
    categoryBudgets?: Array<{ categoryId: string; limit: number }>;
  }
): CategoryDeleteSafetyCheck {
  if (params.memberCount > 1) {
    return { canDelete: false, reason: 'multi_member_privacy' };
  }
  if (isCategoryUsedInHouseholdData(categoryId, params)) {
    return { canDelete: false, reason: 'in_use' };
  }
  return { canDelete: true, reason: null };
}

export interface BudgetCopyEntry {
  categoryId: string;
  limit: number;
  previousCurrentLimit?: number;
}

export interface SkippedArchivedBudgetEntry {
  categoryId: string;
  name: string;
  prevLimit: number;
}

export interface CopyPreviousBudgetsPlan {
  hasPreviousBudgets: boolean;
  toFill: BudgetCopyEntry[];
  toOverwrite: BudgetCopyEntry[];
  unchanged: BudgetCopyEntry[];
  skippedArchived: SkippedArchivedBudgetEntry[];
  mergedLimits: Record<string, number>;
}

function hasExplicitBudgetLimit(limits: Record<string, number>, key: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(limits, key)) return false;
  const val = limits[key];
  return typeof val === 'number' && Number.isFinite(val) && val >= 0;
}

function roundBudgetCents(val: number): number {
  return Math.round(val * 100) / 100;
}

export function planCopyPreviousMonthBudgets(params: {
  prevLimits: Record<string, number>;
  currentLimits: Record<string, number>;
  customCategories: CustomCategory[];
  overwriteExisting: boolean;
}): CopyPreviousBudgetsPlan {
  const { prevLimits, currentLimits, customCategories, overwriteExisting } = params;
  const customById = new Map(customCategories.map((c) => [c.id, c]));

  const mergedLimits: Record<string, number> = {};
  for (const [k, v] of Object.entries(currentLimits)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      mergedLimits[k] = roundBudgetCents(v);
    }
  }

  const toFill: BudgetCopyEntry[] = [];
  const toOverwrite: BudgetCopyEntry[] = [];
  const unchanged: BudgetCopyEntry[] = [];
  const skippedArchived: SkippedArchivedBudgetEntry[] = [];

  for (const [catId, rawVal] of Object.entries(prevLimits)) {
    if (typeof rawVal !== 'number' || !Number.isFinite(rawVal) || rawVal < 0) continue;
    const prevLimit = roundBudgetCents(rawVal);

    if (!isSystemExpenseCategory(catId)) {
      if (!isCustomCategoryId(catId)) continue;
      const customCat = customById.get(catId);
      if (!customCat) continue;
      if (customCat.archived) {
        skippedArchived.push({
          categoryId: catId,
          name: customCat.name,
          prevLimit,
        });
        continue;
      }
    }

    if (!hasExplicitBudgetLimit(currentLimits, catId)) {
      toFill.push({ categoryId: catId, limit: prevLimit });
      mergedLimits[catId] = prevLimit;
    } else {
      const existingVal = roundBudgetCents(currentLimits[catId]);
      if (Math.abs(existingVal - prevLimit) < 0.005) {
        unchanged.push({
          categoryId: catId,
          limit: prevLimit,
          previousCurrentLimit: existingVal,
        });
      } else {
        toOverwrite.push({
          categoryId: catId,
          limit: prevLimit,
          previousCurrentLimit: existingVal,
        });
        if (overwriteExisting) {
          mergedLimits[catId] = prevLimit;
        }
      }
    }
  }

  return {
    hasPreviousBudgets:
      toFill.length > 0 ||
      toOverwrite.length > 0 ||
      unchanged.length > 0 ||
      skippedArchived.length > 0,
    toFill,
    toOverwrite,
    unchanged,
    skippedArchived,
    mergedLimits,
  };
}


