import type { ChecklistItem, FurnitureItem, Household, NavTab, UiMode } from '../types/nido';

export const VALID_NAV_TABS: readonly NavTab[] = [
  'inicio',
  'mensual',
  'compra',
  'ahorros',
  'mudanza',
  'ajustes',
  'ayuda',
] as const;

export function isValidNavTab(value: unknown): value is NavTab {
  return typeof value === 'string' && (VALID_NAV_TABS as readonly string[]).includes(value);
}

/**
 * Los hogares existentes sin el campo `mudanzaCompleted` conservan la etapa de mudanza activa (`false`)
 * hasta que uno de los miembros la marque expresamente como terminada.
 */
export function isMudanzaCompleted(household: Pick<Household, 'mudanzaCompleted'> | null | undefined): boolean {
  return Boolean(household?.mudanzaCompleted);
}

export interface MudanzaPendingCounts {
  pendingFurnitureCount: number;
  pendingChecklistCount: number;
  hasPending: boolean;
}

export function countPendingMudanzaItems(
  furnitureItems: readonly Pick<FurnitureItem, 'status'>[],
  checklist: readonly Pick<ChecklistItem, 'done'>[]
): MudanzaPendingCounts {
  const pendingFurnitureCount = furnitureItems.filter(
    (item) => item.status === 'pendiente' || item.status === 'en_carrito'
  ).length;
  const pendingChecklistCount = checklist.filter((task) => !task.done).length;
  return {
    pendingFurnitureCount,
    pendingChecklistCount,
    hasPending: pendingFurnitureCount > 0 || pendingChecklistCount > 0,
  };
}

/**
 * Genera el aviso informativo (no bloqueante) cuando quedan muebles o tareas pendientes
 * al dar por terminada la etapa de mudanza. Nunca modifica ni marca como hechos los elementos.
 */
export function buildMudanzaCompletionDescription(counts: MudanzaPendingCounts): string {
  const baseKeepNote =
    'No se borrará ningún gasto, mueble ni tarea ni se marcarán como hechos. Podrás consultar todo en Hogar → Histórico de mudanza y reabrir la etapa cuando quieras.';

  if (!counts.hasPending) {
    return `La etapa de mudanza pasará al histórico compartido del hogar y dejará de ocupar espacio en Inicio. ${baseKeepNote}`;
  }

  const parts: string[] = [];
  if (counts.pendingFurnitureCount > 0) {
    parts.push(
      `${counts.pendingFurnitureCount} ${
        counts.pendingFurnitureCount === 1 ? 'mueble pendiente' : 'muebles pendientes'
      }`
    );
  }
  if (counts.pendingChecklistCount > 0) {
    parts.push(
      `${counts.pendingChecklistCount} ${
        counts.pendingChecklistCount === 1 ? 'tarea sin completar' : 'tareas sin completar'
      }`
    );
  }

  return `Aviso: todavía quedan ${parts.join(' y ')}. Puedes dar por terminada la mudanza igualmente. ${baseKeepNote}`;
}

/**
 * Conserva la sección equivalente al cambiar entre modo Sencillo y Avanzado.
 * Nunca cambia el modo silenciosamente; solo redirige `ajustes` a `inicio` al pasar a Sencillo
 * porque Ajustes técnicos solo existe en Avanzado.
 */
export function resolveTabForUiMode(tab: NavTab, uiMode: UiMode): NavTab {
  if (uiMode === 'sencillo' && tab === 'ajustes') {
    return 'inicio';
  }
  return tab;
}

export interface DeepLinkInput {
  tab?: string | null;
  action?: string | null;
  open?: string | null;
}

export interface ResolvedDeepLink {
  targetTab: NavTab | null;
  openQuickExpense: boolean;
}

/**
 * Mantiene compatibilidad con los atajos PWA y enlaces antiguos:
 * - `/?action=add-expense` -> abre Añadir gasto
 * - `/?tab=inicio&open=shopping` o `/?open=shopping` o `/?tab=compra` -> abre Compra
 * - `/?tab=mensual` / `/?tab=mudanza` / `/?tab=ahorros` / `/?tab=ajustes` / `/?tab=ayuda`
 */
export function resolveDeepLinkNavigation(
  input: DeepLinkInput,
  uiMode: UiMode
): ResolvedDeepLink {
  const openQuickExpense = input.action === 'add-expense';
  if (input.open === 'shopping') {
    return { targetTab: 'compra', openQuickExpense };
  }
  if (isValidNavTab(input.tab)) {
    return { targetTab: resolveTabForUiMode(input.tab, uiMode), openQuickExpense };
  }
  return { targetTab: null, openQuickExpense };
}
