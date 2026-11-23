import React, { useEffect, useMemo, useState } from 'react';
import { Check, Palette, RotateCcw, X } from 'lucide-react';
import { useNido } from '../../context/NidoContext';
import { isCustomCategoryId, isSystemExpenseCategory } from '../../domain/categories';
import {
  CATEGORY_COLOR_SWATCHES,
  DEFAULT_CATEGORY_COLORS,
  isValidHexColor,
} from '../../domain/categoryPalette';
import { toUserFriendlyErrorMessage } from '../../services/firebase';
import type { CategoryColorMap } from '../../types/nido';
import { CategoryTag } from '../CategoryTag';

interface CategoryColorModalProps {
  open: boolean;
  onClose: () => void;
}

export const CategoryColorModal: React.FC<CategoryColorModalProps> = ({ open, onClose }) => {
  const {
    household,
    householdId,
    currentUserProfile,
    customCategories,
    categoryRegistry,
    repo,
    showToast,
  } = useNido();
  const [draftSystemColors, setDraftSystemColors] = useState<CategoryColorMap>({});
  const [draftCustomColors, setDraftCustomColors] = useState<Record<string, string>>({});
  const [selectedCategory, setSelectedCategory] = useState<string>('alquiler');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleCategories = useMemo(
    () => categoryRegistry.allKnownCategories.filter((c) => !c.archived || c.id === selectedCategory),
    [categoryRegistry.allKnownCategories, selectedCategory]
  );

  useEffect(() => {
    if (!open) return;
    setDraftSystemColors({ ...(household?.categoryColors ?? {}) });
    const nextCustom: Record<string, string> = {};
    for (const c of customCategories) {
      nextCustom[c.id] = isValidHexColor(c.color) ? c.color.toUpperCase() : '#0F766E';
    }
    setDraftCustomColors(nextCustom);
    setSelectedCategory('alquiler');
    setError(null);
  }, [open, household?.categoryColors, customCategories]);

  const combinedDraftColors = useMemo<CategoryColorMap>(
    () => ({
      ...draftSystemColors,
      ...draftCustomColors,
    }),
    [draftSystemColors, draftCustomColors]
  );

  if (!open) return null;

  const isSelectedCustom = isCustomCategoryId(selectedCategory);
  const activeHex = (
    combinedDraftColors[selectedCategory] || categoryRegistry.getColor(selectedCategory)
  ).toUpperCase();
  const selectedLabel = categoryRegistry.getLabel(selectedCategory);

  const handleSelectColor = (hex: string) => {
    const upper = hex.toUpperCase();
    if (!isValidHexColor(upper)) return;
    if (isSelectedCustom) {
      setDraftCustomColors((prev) => ({
        ...prev,
        [selectedCategory]: upper,
      }));
    } else {
      setDraftSystemColors((prev) => ({
        ...prev,
        [selectedCategory]: upper,
      }));
    }
  };

  const handleResetDefaults = () => {
    setDraftSystemColors({});
  };

  const handleSave = async () => {
    if (!householdId) return;
    setSaving(true);
    setError(null);
    try {
      await repo.updateCategoryColors(householdId, draftSystemColors);
      if (currentUserProfile) {
        const changedCustom = customCategories.filter((c) => {
          const nextHex = draftCustomColors[c.id];
          return isValidHexColor(nextHex) && nextHex.toUpperCase() !== c.color.toUpperCase();
        });
        for (const cat of changedCustom) {
          await repo.upsertCustomCategory(
            householdId,
            {
              id: cat.id,
              name: cat.name,
              color: draftCustomColors[cat.id].toUpperCase(),
              icon: cat.icon,
              order: cat.order,
              archived: cat.archived,
              csvKeywords: cat.csvKeywords || '',
            },
            currentUserProfile
          );
        }
      }
      showToast('Colores de categorías guardados para todo el hogar');
      onClose();
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudieron guardar los colores. Inténtalo de nuevo.'));
    } finally {
      setSaving(false);
    }
  };

  const defaultHint = isSystemExpenseCategory(selectedCategory)
    ? `Por defecto: ${DEFAULT_CATEGORY_COLORS[selectedCategory]}`
    : 'Categoría personalizada';

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
            {visibleCategories.map((cat) => {
              const isSelected = cat.id === selectedCategory;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`min-h-[44px] px-2.5 py-1.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-[#0E5A64] ring-2 ring-[#0E5A64]/25 bg-[#0E5A64]/5 dark:bg-[#0E5A64]/15'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <CategoryTag category={cat.id} customColors={combinedDraftColors} size="xs" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2: Select swatch or free picker */}
        <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              2. Color para {selectedLabel}
            </span>
            <div className="flex items-center gap-2">
              <CategoryTag category={selectedCategory} customColors={combinedDraftColors} />
              <label htmlFor="cat-color-free-input" className="sr-only">
                Selector de color libre para {selectedLabel}
              </label>
              <input
                id="cat-color-free-input"
                type="color"
                value={isValidHexColor(activeHex) ? activeHex : '#0E5A64'}
                onChange={(e) => handleSelectColor(e.target.value)}
                className="w-9 h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer"
              />
            </div>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {CATEGORY_COLOR_SWATCHES.map((swatch) => {
              const isCurrent = activeHex === swatch.hex.toUpperCase();
              return (
                <button
                  key={swatch.hex}
                  type="button"
                  aria-label={`${swatch.name} (${swatch.hex})`}
                  aria-pressed={isCurrent}
                  title={swatch.name}
                  onClick={() => handleSelectColor(swatch.hex)}
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
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{defaultHint}</span>
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

