import { roundCents } from './finance';
import {
  findPendingDuplicateMatch,
  normalizeShoppingSection,
  normalizeShoppingSourceType,
  normalizeShoppingUnit,
  resolveEffectiveShoppingSection,
} from './shoppingCatalog';
import {
  MAX_LENGTHS,
  type ShoppingItem,
  type ShoppingSection,
  type ShoppingTemplateItem,
} from '../types/nido';

export const MAX_SHOPPING_TEMPLATE_ITEMS = 100;

export type ShoppingTemplateApplyMode = 'missing_only' | 'sum_quantities';

export interface ShoppingTemplateCreateOp {
  text: string;
  qty: number;
  unit?: string;
  catalogId?: string;
  brand?: string;
  format?: string;
  section?: ShoppingSection;
  sourceType?: ShoppingTemplateItem['sourceType'];
}

export interface ShoppingTemplateUpdateOp {
  id: string;
  text: string;
  qty: number;
  unit?: string;
  done: false;
  catalogId?: string;
  brand?: string;
  format?: string;
  section?: ShoppingSection;
  sourceType?: ShoppingTemplateItem['sourceType'];
}

export interface ApplyShoppingTemplatePlan {
  toCreate: ShoppingTemplateCreateOp[];
  toUpdate: ShoppingTemplateUpdateOp[];
  skippedAlreadyPendingCount: number;
  skippedIncompatibleUnitCount: number;
  addedSeparateIncompatibleUnitCount: number;
}

export function sanitizeShoppingTemplateItems(
  items: readonly ShoppingTemplateItem[]
): ShoppingTemplateItem[] {
  const clean: ShoppingTemplateItem[] = [];
  for (const item of items) {
    if (clean.length >= MAX_SHOPPING_TEMPLATE_ITEMS) break;
    const text = String(item.text ?? '').trim().slice(0, MAX_LENGTHS.shoppingText);
    if (!text) continue;
    const rawQty = Number(item.qty);
    const qty = roundCents(Math.max(0.01, Math.min(999, Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1)));
    const unit = normalizeShoppingUnit(item.unit);
    const catalogId = String(item.catalogId ?? '').trim().slice(0, MAX_LENGTHS.shoppingCatalogId);
    const brand = String(item.brand ?? '').trim().slice(0, MAX_LENGTHS.shoppingBrand);
    const format = String(item.format ?? '').trim().slice(0, MAX_LENGTHS.shoppingFormat);
    const section = normalizeShoppingSection(item.section);
    const sourceType = normalizeShoppingSourceType(item.sourceType);
    clean.push({
      text,
      qty,
      ...(unit ? { unit } : {}),
      ...(catalogId ? { catalogId } : {}),
      ...(brand ? { brand } : {}),
      ...(format ? { format } : {}),
      ...(section ? { section } : {}),
      ...(sourceType ? { sourceType } : {}),
    });
  }
  return clean;
}

export function generateShoppingTemplateId(): string {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Planifica de forma pura y determinista la aplicación de una lista reutilizable
 * sobre la lista de la compra activa:
 * - Modo por defecto ('missing_only'): añade solo productos que no están pendientes.
 *   Si ya existe un pendiente del mismo producto/variante (misma o distinta unidad), lo omite
 *   para no duplicar ni mezclar unidades incompatibles.
 * - Modo explícito ('sum_quantities'): suma cantidades únicamente cuando coinciden texto,
 *   formato/variante y unidad; si las unidades son incompatibles nunca las suma y lo añade
 *   como línea separada con su propia unidad.
 * - Nunca marca productos como comprados ni genera gastos.
 */
export function planApplyShoppingTemplate(params: {
  templateItems: readonly ShoppingTemplateItem[];
  selectedIndexes?: readonly number[];
  livePendingItems: readonly ShoppingItem[];
  mode?: ShoppingTemplateApplyMode;
  sectionOverrides?: ReadonlyMap<string, ShoppingSection>;
}): ApplyShoppingTemplatePlan {
  const mode: ShoppingTemplateApplyMode = params.mode ?? 'missing_only';
  const chosenItems =
    params.selectedIndexes && params.selectedIndexes.length > 0
      ? params.selectedIndexes
          .map((idx) => params.templateItems[idx])
          .filter((it): it is ShoppingTemplateItem => Boolean(it))
      : [...params.templateItems];

  const cleanChosen = sanitizeShoppingTemplateItems(chosenItems);
  const workingPending: ShoppingItem[] = params.livePendingItems
    .filter((i) => !i.done)
    .map((i) => ({ ...i }));

  const toCreate: ShoppingTemplateCreateOp[] = [];
  const updatesById = new Map<string, ShoppingTemplateUpdateOp>();
  let skippedAlreadyPendingCount = 0;
  let skippedIncompatibleUnitCount = 0;
  let addedSeparateIncompatibleUnitCount = 0;

  let virtualIdx = 0;

  for (const item of cleanChosen) {
    const effectiveSection = resolveEffectiveShoppingSection(item, params.sectionOverrides);
    const match = findPendingDuplicateMatch(item.text, item.unit, workingPending, {
      format: item.format,
    });

    if (mode === 'missing_only') {
      if (match.exactSameUnitMatch) {
        skippedAlreadyPendingCount += 1;
        continue;
      }
      if (match.differentUnitMatch) {
        skippedAlreadyPendingCount += 1;
        skippedIncompatibleUnitCount += 1;
        continue;
      }
      const createOp: ShoppingTemplateCreateOp = {
        text: item.text,
        qty: item.qty,
        ...(item.unit ? { unit: item.unit } : {}),
        ...(item.catalogId ? { catalogId: item.catalogId } : {}),
        ...(item.brand ? { brand: item.brand } : {}),
        ...(item.format ? { format: item.format } : {}),
        section: effectiveSection,
        ...(item.sourceType ? { sourceType: item.sourceType } : {}),
      };
      toCreate.push(createOp);
      virtualIdx += 1;
      workingPending.push({
        id: `__virtual_${virtualIdx}`,
        ...createOp,
        done: false,
        addedBy: '',
        createdAt: '',
        updatedAt: '',
      });
      continue;
    }

    // mode === 'sum_quantities'
    if (match.exactSameUnitMatch) {
      const existing = match.exactSameUnitMatch;
      const nextQty = roundCents(Math.min(999, existing.qty + item.qty));
      existing.qty = nextQty;
      if (existing.id.startsWith('__virtual_')) {
        const createdTarget = toCreate.find(
          (c) =>
            c.text === existing.text &&
            (c.unit || '') === (existing.unit || '') &&
            (c.format || '') === (existing.format || '')
        );
        if (createdTarget) {
          createdTarget.qty = nextQty;
        }
      } else {
        updatesById.set(existing.id, {
          id: existing.id,
          text: existing.text,
          qty: nextQty,
          ...(existing.unit ? { unit: existing.unit } : {}),
          done: false,
          ...(existing.catalogId ? { catalogId: existing.catalogId } : {}),
          ...(existing.brand ? { brand: existing.brand } : {}),
          ...(existing.format ? { format: existing.format } : {}),
          section: resolveEffectiveShoppingSection(existing, params.sectionOverrides),
          ...(existing.sourceType ? { sourceType: existing.sourceType } : {}),
        });
      }
      continue;
    }

    if (match.differentUnitMatch) {
      // Nunca sumar unidades incompatibles: se añade aparte conservando su unidad original.
      addedSeparateIncompatibleUnitCount += 1;
    }

    const createOp: ShoppingTemplateCreateOp = {
      text: item.text,
      qty: item.qty,
      ...(item.unit ? { unit: item.unit } : {}),
      ...(item.catalogId ? { catalogId: item.catalogId } : {}),
      ...(item.brand ? { brand: item.brand } : {}),
      ...(item.format ? { format: item.format } : {}),
      section: effectiveSection,
      ...(item.sourceType ? { sourceType: item.sourceType } : {}),
    };
    toCreate.push(createOp);
    virtualIdx += 1;
    workingPending.push({
      id: `__virtual_${virtualIdx}`,
      ...createOp,
      done: false,
      addedBy: '',
      createdAt: '',
      updatedAt: '',
    });
  }

  return {
    toCreate,
    toUpdate: Array.from(updatesById.values()),
    skippedAlreadyPendingCount,
    skippedIncompatibleUnitCount,
    addedSeparateIncompatibleUnitCount,
  };
}
