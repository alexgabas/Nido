import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useNido } from '../../context/NidoContext';
import {
  canSafelyDeleteCustomCategory,
  CATEGORY_ICON_OPTIONS,
  generateCustomCategoryId,
  getAvailableCategorySuggestions,
  isCategoryDuplicateName,
  type CategoryIconKey,
  type CustomCategorySuggestion,
} from '../../domain/categories';
import { CATEGORY_COLOR_SWATCHES, isValidHexColor } from '../../domain/categoryPalette';
import { toUserFriendlyErrorMessage } from '../../services/firebase';
import { MAX_LENGTHS, type CategoryBudgetLimit, type CustomCategory } from '../../types/nido';
import { CategoryIcon } from '../CategoryIcon';
import { CategoryTag } from '../CategoryTag';
import { ConfirmDialog } from '../ConfirmDialog';

export const CategoryManagerSection: React.FC = () => {
  const {
    householdId,
    members,
    currentUserProfile,
    customCategories,
    recentTransactions,
    recurring,
    initialCosts,
    categoryBudgets,
    repo,
    showToast,
  } = useNido();

  const [formOpen, setFormOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<CustomCategory | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#0F766E');
  const [icon, setIcon] = useState<CategoryIconKey>('tag');
  const [csvKeywords, setCsvKeywords] = useState('');
  const [saving, setSaving] = useState(false);
  const [addingSuggestionKey, setAddingSuggestionKey] = useState<string | null>(null);
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomCategory | null>(null);
  const [allCategoryBudgets, setAllCategoryBudgets] = useState<CategoryBudgetLimit[]>([]);

  useEffect(() => {
    if (!householdId) {
      setAllCategoryBudgets([]);
      return;
    }
    let cancelled = false;
    repo
      .fetchAllCategoryBudgets(householdId)
      .then((items) => {
        if (!cancelled) setAllCategoryBudgets(items);
      })
      .catch(() => {
        if (!cancelled) setAllCategoryBudgets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, repo, customCategories, categoryBudgets]);

  const sortedCustom = useMemo(
    () =>
      [...customCategories].sort(
        (a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, 'es')
      ),
    [customCategories]
  );

  const activeCustom = useMemo(() => sortedCustom.filter((c) => !c.archived), [sortedCustom]);
  const archivedCustom = useMemo(() => sortedCustom.filter((c) => c.archived), [sortedCustom]);
  const availableSuggestions = useMemo(
    () => getAvailableCategorySuggestions(customCategories),
    [customCategories]
  );

  const nextAvailableColor = useMemo(() => {
    const used = new Set(customCategories.map((c) => c.color.toUpperCase()));
    const free = CATEGORY_COLOR_SWATCHES.find((s) => !used.has(s.hex.toUpperCase()));
    return free?.hex || '#0F766E';
  }, [customCategories]);

  const openCreateForm = () => {
    setEditingCat(null);
    setName('');
    setColor(nextAvailableColor);
    setIcon('tag');
    setCsvKeywords('');
    setError(null);
    setFormOpen(true);
  };

  const openEditForm = (cat: CustomCategory) => {
    setEditingCat(cat);
    setName(cat.name);
    setColor(isValidHexColor(cat.color) ? cat.color.toUpperCase() : '#0F766E');
    const validIcon = CATEGORY_ICON_OPTIONS.some((o) => o.key === cat.icon)
      ? (cat.icon as CategoryIconKey)
      : 'tag';
    setIcon(validIcon);
    setCsvKeywords(cat.csvKeywords || '');
    setError(null);
    setFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId || !currentUserProfile) return;
    const cleanName = name.trim();
    if (!cleanName) {
      setError('Escribe un nombre para la categoría.');
      return;
    }
    if (cleanName.length > MAX_LENGTHS.categoryName) {
      setError(`El nombre no puede superar los ${MAX_LENGTHS.categoryName} caracteres.`);
      return;
    }
    if (isCategoryDuplicateName(cleanName, customCategories, editingCat?.id)) {
      setError('Ya existe una categoría con ese nombre en el hogar.');
      return;
    }
    const cleanColor = isValidHexColor(color) ? color.toUpperCase() : '#0F766E';
    const nextOrder = editingCat
      ? editingCat.order
      : sortedCustom.reduce((max, c) => Math.max(max, Number.isFinite(c.order) ? c.order : 0), 0) +
        1;
    const id =
      editingCat?.id ||
      generateCustomCategoryId(
        cleanName,
        customCategories.map((c) => c.id)
      );

    setSaving(true);
    setError(null);
    try {
      await repo.upsertCustomCategory(
        householdId,
        {
          id,
          name: cleanName,
          color: cleanColor,
          icon,
          order: nextOrder,
          archived: editingCat?.archived ?? false,
          csvKeywords: csvKeywords.trim().slice(0, MAX_LENGTHS.csvKeywordString),
        },
        currentUserProfile
      );
      showToast(editingCat ? 'Categoría actualizada' : `Categoría «${cleanName}» creada`);
      setFormOpen(false);
      setEditingCat(null);
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo guardar la categoría.'));
    } finally {
      setSaving(false);
    }
  };

  const handleAddSuggestion = async (suggestion: CustomCategorySuggestion) => {
    if (!householdId || !currentUserProfile || addingSuggestionKey) return;
    if (isCategoryDuplicateName(suggestion.name, customCategories)) {
      showToast('Esa categoría ya existe en vuestro hogar');
      return;
    }
    const id = generateCustomCategoryId(
      suggestion.name,
      customCategories.map((c) => c.id)
    );
    const nextOrder =
      sortedCustom.reduce((max, c) => Math.max(max, Number.isFinite(c.order) ? c.order : 0), 0) +
      1;
    setAddingSuggestionKey(suggestion.key);
    try {
      await repo.upsertCustomCategory(
        householdId,
        {
          id,
          name: suggestion.name,
          color: suggestion.color,
          icon: suggestion.icon,
          order: nextOrder,
          archived: false,
          csvKeywords: suggestion.csvKeywords,
        },
        currentUserProfile
      );
      showToast(`Categoría «${suggestion.name}» añadida`);
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudo añadir la sugerencia.'));
    } finally {
      setAddingSuggestionKey(null);
    }
  };

  const handleToggleArchived = async (cat: CustomCategory) => {
    if (!householdId || !currentUserProfile) return;
    try {
      await repo.upsertCustomCategory(
        householdId,
        {
          id: cat.id,
          name: cat.name,
          color: cat.color,
          icon: cat.icon,
          order: cat.order,
          archived: !cat.archived,
          csvKeywords: cat.csvKeywords || '',
        },
        currentUserProfile
      );
      showToast(
        cat.archived
          ? `Categoría «${cat.name}» reactivada`
          : `Categoría «${cat.name}» archivada`
      );
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudo actualizar la categoría.'));
    }
  };

  const handleMove = async (catId: string, direction: -1 | 1) => {
    if (!householdId || reorderingId) return;
    const index = activeCustom.findIndex((c) => c.id === catId);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= activeCustom.length) return;

    const reorderedActive = [...activeCustom];
    const [moved] = reorderedActive.splice(index, 1);
    reorderedActive.splice(targetIndex, 0, moved);

    const combined = [...reorderedActive, ...archivedCustom];
    const orderedPayload = combined.map((c, idx) => ({ id: c.id, order: idx + 1 }));

    setReorderingId(catId);
    try {
      await repo.reorderCustomCategories(householdId, orderedPayload);
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudo cambiar el orden.'));
    } finally {
      setReorderingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !householdId || !currentUserProfile) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      const [allTxs, freshCategoryBudgets] = await Promise.all([
        repo.fetchAllTransactions(householdId, currentUserProfile.uid),
        repo.fetchAllCategoryBudgets(householdId),
      ]);
      const check = canSafelyDeleteCustomCategory(target.id, {
        memberCount: members.length,
        transactions: allTxs,
        recurring,
        initialCosts,
        categoryBudgets: freshCategoryBudgets,
      });
      if (!check.canDelete) {
        showToast(
          check.reason === 'multi_member_privacy'
            ? 'En hogares compartidos las categorías se archivan para no afectar a gastos privados de tu pareja.'
            : 'Esta categoría tiene gastos, plantillas o presupuestos asociados: archívala en lugar de borrarla.'
        );
        return;
      }
      await repo.deleteUnusedCustomCategory(
        householdId,
        target.id,
        target.name,
        currentUserProfile
      );
      showToast(`Categoría «${target.name}» eliminada`);
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudo eliminar la categoría.'));
    }
  };

  const renderCategoryRow = (cat: CustomCategory, index: number, isActiveList: boolean) => {
    const mergedBudgets = allCategoryBudgets.length > 0 ? allCategoryBudgets : categoryBudgets;
    const deleteCheck = canSafelyDeleteCustomCategory(cat.id, {
      memberCount: members.length,
      transactions: recentTransactions,
      recurring,
      initialCosts,
      categoryBudgets: mergedBudgets,
    });
    return (
      <div
        key={cat.id}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#F6F8F8] dark:bg-slate-900/50 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
      >
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryTag
              category={cat.id}
              showIcon
              size="sm"
            />
            {cat.archived && (
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Oculta al añadir nuevos gastos
              </span>
            )}
          </div>
          {cat.csvKeywords && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              Palabras clave CSV: {cat.csvKeywords}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1 shrink-0">
          {isActiveList && (
            <>
              <button
                type="button"
                aria-label={`Subir ${cat.name}`}
                disabled={index === 0 || Boolean(reorderingId)}
                onClick={() => void handleMove(cat.id, -1)}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] flex items-center justify-center text-slate-600 dark:text-slate-300 disabled:opacity-35"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label={`Bajar ${cat.name}`}
                disabled={index === activeCustom.length - 1 || Boolean(reorderingId)}
                onClick={() => void handleMove(cat.id, 1)}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] flex items-center justify-center text-slate-600 dark:text-slate-300 disabled:opacity-35"
              >
                <ArrowDown className="w-4 h-4" />
              </button>
            </>
          )}

          <button
            type="button"
            aria-label={`Editar categoría ${cat.name}`}
            onClick={() => openEditForm(cat)}
            className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Pencil className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => void handleToggleArchived(cat)}
            className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-xs font-semibold inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {cat.archived ? (
              <>
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reactivar</span>
              </>
            ) : (
              <>
                <Archive className="w-3.5 h-3.5" />
                <span>Archivar</span>
              </>
            )}
          </button>

          {deleteCheck.canDelete && (
            <button
              type="button"
              aria-label={`Eliminar categoría ${cat.name}`}
              onClick={() => setDeleteTarget(cat)}
              className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] flex items-center justify-center text-slate-500 hover:text-[#B42318] dark:hover:text-[#FCA5A5]"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <section
      aria-label="Categorías personalizadas"
      className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-5"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-[#0E5A64] dark:text-[#5EEAD4]" />
            <h2 className="font-display text-lg font-bold">Categorías personalizadas</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Crea categorías propias con su color e icono. Aparecen en gastos, calendario, plantillas, presupuestos e importación CSV. Si archivas una categoría usada, tus gastos antiguos siguen intactos.
            {members.length > 1
              ? ' En hogares compartidos las categorías se archivan para no dejar sin categoría gastos privados de tu pareja.'
              : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={() => (formOpen && !editingCat ? setFormOpen(false) : openCreateForm())}
          className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Nueva categoría</span>
        </button>
      </div>

      {/* Create / Edit form */}
      {formOpen && (
        <form
          onSubmit={handleSave}
          data-pwa-unsaved="true"
          className="rounded-2xl border border-[#0E5A64]/35 bg-[#0E5A64]/4 dark:bg-[#0E5A64]/12 p-4 sm:p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-base font-bold">
              {editingCat ? `Editar «${editingCat.name}»` : 'Nueva categoría personalizada'}
            </h3>
            <button
              type="button"
              aria-label="Cerrar formulario de categoría"
              onClick={() => {
                setFormOpen(false);
                setEditingCat(null);
                setError(null);
              }}
              className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl bg-[#B42318]/10 text-[#B42318] dark:text-[#FCA5A5] p-3 text-xs font-medium"
            >
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="custom-cat-name" className="block text-xs font-semibold mb-1">
                Nombre visible
              </label>
              <input
                id="custom-cat-name"
                type="text"
                required
                maxLength={MAX_LENGTHS.categoryName}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. Gimnasio y deporte"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>

            <div>
              <label htmlFor="custom-cat-keywords" className="block text-xs font-semibold mb-1">
                Palabras clave CSV (opcional)
              </label>
              <input
                id="custom-cat-keywords"
                type="text"
                maxLength={MAX_LENGTHS.csvKeywordString}
                value={csvKeywords}
                onChange={(e) => setCsvKeywords(e.target.value)}
                placeholder="Ej. gimnasio, basic fit, decathlon"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold">Color compartido</span>
              <div className="flex items-center gap-2">
                <label htmlFor="custom-cat-color-picker" className="text-[11px] text-slate-500">
                  Selector libre:
                </label>
                <input
                  id="custom-cat-color-picker"
                  type="color"
                  value={isValidHexColor(color) ? color : '#0F766E'}
                  onChange={(e) => setColor(e.target.value.toUpperCase())}
                  className="w-10 h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer"
                />
              </div>
            </div>

            <div className="grid grid-cols-8 gap-2">
              {CATEGORY_COLOR_SWATCHES.map((sw) => {
                const selected = color.toUpperCase() === sw.hex.toUpperCase();
                return (
                  <button
                    key={sw.hex}
                    type="button"
                    aria-label={`${sw.name} (${sw.hex})`}
                    aria-pressed={selected}
                    title={sw.name}
                    onClick={() => setColor(sw.hex)}
                    className={`min-h-[44px] rounded-xl flex items-center justify-center border-2 transition-transform active:scale-95 ${
                      selected
                        ? 'border-[#0F1F24] dark:border-white scale-105'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: sw.hex }}
                  >
                    {selected && <Check className="w-4 h-4 text-white drop-shadow-xs" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-semibold">Icono</span>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {CATEGORY_ICON_OPTIONS.map((opt) => {
                const active = icon === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setIcon(opt.key)}
                    className={`min-h-[44px] px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                      active
                        ? 'border-[#0E5A64] bg-[#0E5A64] text-white'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <CategoryIcon icon={opt.key} className="w-4 h-4 shrink-0" />
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200/70 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Vista previa:</span>
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-semibold text-xs"
                style={{
                  backgroundColor: `${color}20`,
                  borderColor: `${color}55`,
                }}
              >
                <CategoryIcon icon={icon} className="w-3.5 h-3.5" />
                <span>{name.trim() || 'Tu categoría'}</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setFormOpen(false);
                  setEditingCat(null);
                  setError(null);
                }}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-xs sm:text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs sm:text-sm font-semibold disabled:opacity-50"
              >
                {saving ? 'Guardando...' : editingCat ? 'Guardar cambios' : 'Crear categoría'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Existing custom categories */}
      {sortedCustom.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-5 text-center space-y-1">
          <p className="text-sm font-semibold">Todavía no habéis creado categorías propias</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Añade una arriba o elige alguna de las sugerencias opcionales de abajo si la necesitáis.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {activeCustom.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Activas ({activeCustom.length})
              </h3>
              <div className="space-y-2">
                {activeCustom.map((cat, idx) => renderCategoryRow(cat, idx, true))}
              </div>
            </div>
          )}

          {archivedCustom.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Archivadas ({archivedCustom.length})
              </h3>
              <div className="space-y-2">
                {archivedCustom.map((cat, idx) => renderCategoryRow(cat, idx, false))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Optional suggestions (never auto-activated) */}
      {availableSuggestions.length > 0 && (
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <Sparkles className="w-3.5 h-3.5 text-[#0E5A64] dark:text-[#5EEAD4]" />
            <span>Sugerencias opcionales (solo se activan si las añades)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {availableSuggestions.map((s) => (
              <button
                key={s.key}
                type="button"
                disabled={Boolean(addingSuggestionKey)}
                onClick={() => void handleAddSuggestion(s)}
                className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-[#F6F8F8] dark:bg-slate-900/60 hover:border-[#0E5A64]/50 text-xs font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                <span
                  aria-hidden="true"
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <CategoryIcon icon={s.icon} className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300 shrink-0" />
                <span>{addingSuggestionKey === s.key ? 'Añadiendo...' : `+ ${s.name}`}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Eliminar categoría sin uso"
        description={`Vas a eliminar definitivamente la categoría «${deleteTarget?.name ?? ''}» porque no tiene gastos ni presupuestos asociados.`}
        confirmLabel="Eliminar"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
};
