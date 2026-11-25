import React from 'react';
import { useNido } from '../context/NidoContext';
import { hexToRgba } from '../domain/categoryPalette';
import type { CategoryColorMap, TransactionCategory } from '../types/nido';
import { CategoryIcon } from './CategoryIcon';

interface CategoryTagProps {
  category: TransactionCategory;
  customColors?: CategoryColorMap;
  size?: 'xs' | 'sm';
  labelOverride?: string;
  showIcon?: boolean;
  className?: string;
}

export const CategoryTag: React.FC<CategoryTagProps> = ({
  category,
  customColors,
  size = 'sm',
  labelOverride,
  showIcon = true,
  className = '',
}) => {
  const { categoryRegistry } = useNido();
  const meta = categoryRegistry.getMeta(category);
  const overrideColor = customColors?.[category];
  const hex =
    overrideColor && /^#[0-9A-Fa-f]{6}$/.test(overrideColor) ? overrideColor : meta.color;
  const label = labelOverride ?? meta.label;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border font-semibold whitespace-nowrap ${
        size === 'xs' ? 'px-1.5 py-0.5 text-[11px] leading-tight' : 'px-2.5 py-1 text-xs leading-tight'
      } text-[#0F1F24] dark:text-[#F0F5F6] ${className}`}
      style={{
        backgroundColor: hexToRgba(hex, 0.12),
        borderColor: hexToRgba(hex, 0.35),
      }}
    >
      <span
        aria-hidden="true"
        className={`rounded-full shrink-0 ${size === 'xs' ? 'w-2 h-2' : 'w-2.5 h-2.5'}`}
        style={{ backgroundColor: hex }}
      />
      {showIcon && <CategoryIcon icon={meta.icon} className={size === 'xs' ? 'w-3 h-3 shrink-0' : 'w-3.5 h-3.5 shrink-0'} />}
      <span className="truncate">{label}</span>
      {meta.archived && (
        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
          (Archivada)
        </span>
      )}
    </span>
  );
};
