import React from 'react';
import { useNido } from '../context/NidoContext';
import { hexToRgba, resolveCategoryColor } from '../domain/categoryPalette';
import { TRANSACTION_CATEGORY_LABELS } from '../domain/presets';
import type { CategoryColorMap, TransactionCategory } from '../types/nido';

interface CategoryTagProps {
  category: TransactionCategory;
  customColors?: CategoryColorMap;
  size?: 'xs' | 'sm';
  labelOverride?: string;
  className?: string;
}

export const CategoryTag: React.FC<CategoryTagProps> = ({
  category,
  customColors,
  size = 'sm',
  labelOverride,
  className = '',
}) => {
  const { household } = useNido();
  const hex = resolveCategoryColor(category, customColors ?? household?.categoryColors);
  const label = labelOverride ?? TRANSACTION_CATEGORY_LABELS[category];

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
      <span className="truncate">{label}</span>
    </span>
  );
};
