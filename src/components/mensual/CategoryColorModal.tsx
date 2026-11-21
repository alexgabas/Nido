import React, { useEffect, useState } from 'react';
import { Check, Palette, RotateCcw, X } from 'lucide-react';
import { useNido } from '../../context/NidoContext';
import {
  CATEGORY_COLOR_SWATCHES,
  DEFAULT_CATEGORY_COLORS,
  resolveCategoryColor,
} from '../../domain/categoryPalette';
import { EXPENSE_CATEGORY_LABELS } from '../../domain/presets';
import { toUserFriendlyErrorMessage } from '../../services/firebase';
import type { CategoryColorMap, ExpenseCategory } from '../../types/nido';
import { CategoryTag } from '../CategoryTag';

interface CategoryColorModalProps {
  open: boolean;
  onClose: () => void;
}

const ORDERED_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[];

export const CategoryColorModal: React.FC<CategoryColorModalProps> = ({ open, onClose }) => {
  const { household, householdId, repo, showToast } = useNido();
  const [draftColors, setDraftColors] = useState<CategoryColorMap>({});
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory>('alquiler');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraftColors({ ...(household?.categoryColors ?? {}) });
    setSelectedCategory('alquiler');
    setError(null);
  }, [open, household?.categoryColors]);

  if (!open) return null;

  const activeHex = resolveCategoryColor(selectedCategory, draftColors);

  const handleSelectSwatch = (hex: string) => {
    setDraftColors((prev) => ({
      ...prev,
      [selectedCategory]: hex.toUpperCase(),
    }));
  };

  const handleResetDefaults = () => {
    setDraftColors({});
  };

  const handleSave = async () => {
    if (!householdId) return;
    setSaving(true);
    setError(null);
    try {
      await repo.updateCategoryColors(householdId, draftColors);
      showToast('Colores de categorías guardados para todo el hogar');
      onClose();
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudieron guardar los colores. Inténtalo de nuevo.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-colors-title"
    >
      <div className="w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center shrink-0 mt-0.5">
              <Palette className="w-5 h-5" />
            </span>
            <div>
              <h2 id="category-colors-title" className="font-display text-lg font-bold">
                Colores de categorías
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Se comparten entre los dos en todo Nido (calendario, etiquetas y gráficos).
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar selector de colores"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div role="alert" className="rounded-xl bg-[#B42318]/10 text-[#B42318] dark:text-[#FCA5A5] p-3 text-xs font-medium">
            {error}
          </div>
        )}

        {/* Step 1: Select category */}
        <div className="space-y-2">
          <span className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            1. Elige una categoría
          </span>
          <div className="flex flex-wrap gap-2">
            {ORDERED_CATEGORIES.map((cat) => {
              const isSelected = cat === selectedCategory;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`min-h-[44px] px-2.5 py-1.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-[#0E5A64] ring-2 ring-[#0E5A64]/25 bg-[#0E5A64]/5 dark:bg-[#0E5A64]/15'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <CategoryTag category={cat} customColors={draftColors} size="xs" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2: Select swatch */}
        <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              2. Color para {EXPENSE_CATEGORY_LABELS[selectedCategory]}
            </span>
            <CategoryTag category={selectedCategory} customColors={draftColors} />
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {CATEGORY_COLOR_SWATCHES.map((swatch) => {
              const isCurrent = activeHex.toUpperCase() === swatch.hex.toUpperCase();
              return (
                <button
                  key={swatch.hex}
                  type="button"
                  aria-label={`${swatch.name} (${swatch.hex})`}
                  aria-pressed={isCurrent}
                  title={swatch.name}
                  onClick={() => handleSelectSwatch(swatch.hex)}
                  className={`min-h-[44px] rounded-xl flex items-center justify-center border-2 transition-transform active:scale-95 ${
                    isCurrent
                      ? 'border-[#0F1F24] dark:border-white scale-105'
                      : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: swatch.hex }}
                >
                  {isCurrent && <Check className="w-5 h-5 text-white drop-shadow-xs" />}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Por defecto: {DEFAULT_CATEGORY_COLORS[selectedCategory]}
            </span>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restaurar colores por defecto</span>
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar colores'}
          </button>
        </div>
      </div>
    </div>
  );
};
