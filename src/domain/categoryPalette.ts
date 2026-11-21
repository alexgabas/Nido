import type { CategoryColorMap, ExpenseCategory, TransactionCategory } from '../types/nido';
import { EXPENSE_CATEGORY_LABELS } from './presets';

export interface CategoryColorSwatch {
  hex: string;
  name: string;
}

export const CATEGORY_COLOR_SWATCHES: readonly CategoryColorSwatch[] = [
  { hex: '#0E5A64', name: 'Teal Nido' },
  { hex: '#0F766E', name: 'Esmeralda' },
  { hex: '#15803D', name: 'Bosque' },
  { hex: '#059669', name: 'Menta' },
  { hex: '#0284C7', name: 'Cielo' },
  { hex: '#2563EB', name: 'Azul' },
  { hex: '#4F46E5', name: 'Índigo' },
  { hex: '#7C3AED', name: 'Violeta' },
  { hex: '#9333EA', name: 'Púrpura' },
  { hex: '#DB2777', name: 'Fucsia' },
  { hex: '#DC4C3E', name: 'Coral' },
  { hex: '#EA580C', name: 'Naranja' },
  { hex: '#D97706', name: 'Ámbar' },
  { hex: '#B45309', name: 'Ocre' },
  { hex: '#475569', name: 'Pizarra' },
  { hex: '#64748B', name: 'Gris' },
] as const;

export const DEFAULT_CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  alquiler: '#0E5A64',
  supermercado: '#15803D',
  luz: '#D97706',
  agua: '#0284C7',
  gas: '#EA580C',
  internet: '#4F46E5',
  movil: '#7C3AED',
  suscripciones: '#DB2777',
  seguros: '#0F766E',
  comunidad: '#475569',
  transporte: '#2563EB',
  ocio: '#DC4C3E',
  otros: '#64748B',
};

export const DEFAULT_SETTLEMENT_COLOR = '#15803D';

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
}

export function sanitizeCategoryColors(raw: unknown): CategoryColorMap | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const clean: CategoryColorMap = {};
  let hasAny = false;
  for (const cat of Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]) {
    const val = (raw as Record<string, unknown>)[cat];
    if (isValidHexColor(val)) {
      clean[cat] = val.toUpperCase();
      hasAny = true;
    }
  }
  return hasAny ? clean : undefined;
}

export function resolveCategoryColor(
  category: TransactionCategory,
  customColors?: CategoryColorMap
): string {
  if (category === 'liquidacion') return DEFAULT_SETTLEMENT_COLOR;
  const custom = customColors?.[category];
  if (isValidHexColor(custom)) return custom.toUpperCase();
  return DEFAULT_CATEGORY_COLORS[category] ?? DEFAULT_CATEGORY_COLORS.otros;
}

export function hexToRgba(hex: string, alpha: number): string {
  const safe = isValidHexColor(hex) ? hex.slice(1) : '64748B';
  const r = parseInt(safe.slice(0, 2), 16);
  const g = parseInt(safe.slice(2, 4), 16);
  const b = parseInt(safe.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
