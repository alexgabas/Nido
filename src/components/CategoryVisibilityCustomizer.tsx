import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, X } from 'lucide-react';
import { useNido } from '../context/NidoContext';
import {
  MAX_VISIBLE_SELECTOR_CATEGORIES,
  resolveInitialVisibleCategoriesPlan,
  resolveSelectorCategories,
} from '../domain/categories';
import { toUserFriendlyErrorMessage } from '../services/firebase';
import { CategoryIcon } from './CategoryIcon';

interface CategoryVisibilityCustomizerProps {
  open: boolean;
  onClose: () => void;
}

export const CategoryVisibilityCustomizer: React.FC<CategoryVisibilityCustomizerProps> = ({
  open,
  onClose,
}) => {
  const {
    categoryRegistry,
    memberCategoryPreferences,
    saveMemberCategoryPreferences,
    showToast,
  } = useNido();

  const [draftVisibleIds, setDraftVisibleIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const resolved = resolveSelectorCategories(categoryRegistry, memberCategoryPreferences);
    setDraftVisibleIds(resolved.visibleCategories.map((c) => c.id));
  }, [open, categoryRegistry, memberCategoryPreferences]);

  const activeById = useMemo(
    () => new Map(categoryRegistry.activeCategories.map((c) => [c.id, c])),
    [categoryRegistry.activeCategories]
  );

  const visibleItems = useMemo(
    () =>
      draftVisibleIds
        .map((id) => activeById.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [draftVisibleIds, activeById]
  );

  const hiddenItems = useMemo(() => {
    const visibleSet = new Set(draftVisibleIds);
    return categoryRegistry.activeCategories.filter((c) => !visibleSet.has(c.id));
  }, [categoryRegistry.activeCategories, draftVisibleIds]);

  if (!open) return null;

  const moveItem = (index: number, delta: -1 | 1) => {
    const nextIdx = index + delta;
    if (nextIdx < 0 || nextIdx >= draftVisibleIds.length) return;
    setDraftVisibleIds((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(nextIdx, 0, moved);
      return next;
    });
  };

  const hideItem = (id: string) => {
    if (draftVisibleIds.length <= 1) {
      setError('Deja al menos una categoría visible en el selector.');
      return;
    }
    setError(null);
    setDraftVisibleIds((prev) => prev.filter((item) => item !== id));
  };

  const showItem = (id: string) => {
    if (draftVisibleIds.includes(id)) return;
    if (draftVisibleIds.length >= MAX_VISIBLE_SELECTOR_CATEGORIES) {
      setError(`Puedes tener hasta ${MAX_VISIBLE_SELECTOR_CATEGORIES} categorías visibles.`);
      return;
    }
    setError(null);
    setDraftVisibleIds((prev) => [...prev, id]);
  };

  const handleRestoreDefaults = () => {
    setError(null);
    const plan = resolveInitialVisibleCategoriesPlan(categoryRegistry.customCategories);
    const availableDefaults = plan.orderedVisibleIds.filter((id) => activeById.has(id));
    if (availableDefaults.length > 0) {
      setDraftVisibleIds(availableDefaults);
    } else {
      setDraftVisibleIds(
        categoryRegistry.activeCategories
          .slice(0, MAX_VISIBLE_SELECTOR_CATEGORIES)
          .map((c) => c.id)
      );
    }
  };

  const handleSave = async () => {
    if (draftVisibleIds.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveMemberCategoryPreferences(draftVisibleIds);
      showToast('Categorías visibles actualizadas');
      onClose();
    } catch (err) {
      setError(
        toUserFriendlyErrorMessage(err, 'No se pudieron guardar tus categorías visibles.')
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customize-categories-title"
    >
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 flex flex-col max-h-[92vh]">
        <header className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <h2
              id="customize-categories-title"
              className="font-display text-base sm:text-lg font-bold text-[#0F1F24] dark:text-[#F0F5F6]"
            >
              Personalizar categorías visibles
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Elige cuáles ves en «Añadir gasto» y en qué orden aparecen.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar personalización"
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <p className="text-xs rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-slate-600 dark:text-slate-300">
            Esta selección es personal para tu cuenta en este hogar y se sincroniza entre tus dispositivos. No cambia las categorías de tu pareja ni ningún gasto guardado.
          </p>

          {error && (
            <div
              role="alert"
              className="rounded-xl bg-[#DC4C3E]/10 text-[#B42318] dark:text-[#FCA5A5] px-3.5 py-2.5 text-xs font-medium"
            >
              {error}
            </div>
          )}

          {/* Visibles */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Visibles ({visibleItems.length})
              </h3>
              <button
                type="button"
                onClick={handleRestoreDefaults}
                className="min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/10 inline-flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Selección inicial</span>
              </button>
            </div>

            <div className="space-y-1.5">
              {visibleItems.map((cat, idx) => (
                <div
                  key={cat.id}
                  className="min-h-[48px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      aria-hidden="true"
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    <CategoryIcon
                      icon={cat.icon}
                      className="w-4 h-4 text-slate-700 dark:text-slate-200 shrink-0"
                    />
                    <span className="text-sm font-semibold text-[#0F1F24] dark:text-[#F0F5F6] truncate">
                      {cat.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveItem(idx, -1)}
                      aria-label={`Subir ${cat.label}`}
                      className="min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === visibleItems.length - 1}
                      onClick={() => moveItem(idx, 1)}
                      aria-label={`Bajar ${cat.label}`}
                      className="min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => hideItem(cat.id)}
                      aria-label={`Ocultar ${cat.label}`}
                      title="Ocultar del selector principal"
                      className="min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center text-slate-500 hover:text-[#B42318] hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <EyeOff className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Ocultas */}
          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Ocultas en «Más categorías» ({hiddenItems.length})
            </h3>
            {hiddenItems.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                Todas tus categorías activas están visibles en el selector principal.
              </p>
            ) : (
              <div className="space-y-1.5">
                {hiddenItems.map((cat) => (
                  <div
                    key={cat.id}
                    className="min-h-[48px] px-3 py-1.5 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/30 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        aria-hidden="true"
                        className="w-2.5 h-2.5 rounded-full shrink-0 opacity-75"
                        style={{ backgroundColor: cat.color }}
                      />
                      <CategoryIcon
                        icon={cat.icon}
                        className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0"
                      />
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-300 truncate">
                        {cat.label}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => showItem(cat.id)}
                      aria-label={`Mostrar ${cat.label}`}
                      className="min-h-[44px] px-3 rounded-lg text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/10 inline-flex items-center gap-1.5 shrink-0"
                    >
                      <Eye className="w-4 h-4" />
                      <span>Mostrar</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 shrink-0 bg-white dark:bg-[#132025] rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || draftVisibleIds.length === 0}
            onClick={() => void handleSave()}
            className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-50 text-white text-sm font-bold"
          >
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </footer>
      </div>
    </div>
  );
};
