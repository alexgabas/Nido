import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookmarkPlus,
  Check,
  ListChecks,
  Pencil,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import { useNido } from '../context/NidoContext';
import { roundCents } from '../domain/finance';
import {
  formatShoppingQtyUnit,
  normalizeShoppingSection,
  normalizeShoppingSourceType,
  normalizeShoppingText,
  normalizeShoppingUnit,
  resolveEffectiveShoppingSection,
  searchShoppingSuggestionsPaginated,
  SHOPPING_UNITS,
  type PreindexedMercadonaEntry,
  type ShoppingSuggestion,
  type StaticMercadonaCatalogEntry,
} from '../domain/shoppingCatalog';
import {
  MAX_SHOPPING_TEMPLATE_ITEMS,
  planApplyShoppingTemplate,
  sanitizeShoppingTemplateItems,
  type ShoppingTemplateApplyMode,
} from '../domain/shoppingTemplates';
import { toUserFriendlyErrorMessage } from '../services/firebase';
import {
  MAX_LENGTHS,
  type ShoppingListTemplate,
  type ShoppingSection,
  type ShoppingSourceType,
  type ShoppingTemplateItem,
} from '../types/nido';
import { ConfirmDialog } from './ConfirmDialog';

interface ShoppingTemplatesPanelProps {
  onClose: () => void;
  mercadonaEntries: readonly (StaticMercadonaCatalogEntry | PreindexedMercadonaEntry)[];
}

export const ShoppingTemplatesPanel: React.FC<ShoppingTemplatesPanelProps> = ({
  onClose,
  mercadonaEntries,
}) => {
  const {
    householdId,
    currentUserProfile,
    shoppingTemplates,
    shoppingItems,
    shoppingCatalog,
    shoppingSectionOverridesMap,
    repo,
    showToast,
  } = useNido();

  const [mode, setMode] = useState<'list' | 'editor' | 'apply' | 'pick_from_current'>('list');
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [draftName, setDraftName] = useState('');
  const [draftItems, setDraftItems] = useState<ShoppingTemplateItem[]>([]);

  // Editor item add inputs
  const [itemText, setItemText] = useState('');
  const [itemQty, setItemQty] = useState('1');
  const [itemUnit, setItemUnit] = useState('');
  const [itemMeta, setItemMeta] = useState<{
    baseNorm: string;
    catalogId?: string;
    brand?: string;
    format?: string;
    section?: ShoppingSection;
    sourceType?: ShoppingSourceType;
  } | null>(null);
  const [itemSugOpen, setItemSugOpen] = useState(false);

  // Pick from current active list state
  const [pickedActiveIds, setPickedActiveIds] = useState<Set<string>>(new Set());

  // Apply template state
  const [applyingTemplate, setApplyingTemplate] = useState<ShoppingListTemplate | null>(null);
  const [selectedApplyIndexes, setSelectedApplyIndexes] = useState<Set<number>>(new Set());
  const [applyMode, setApplyMode] = useState<ShoppingTemplateApplyMode>('missing_only');

  const [deleteTarget, setDeleteTarget] = useState<ShoppingListTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingItems = useMemo(
    () => shoppingItems.filter((item) => !item.done),
    [shoppingItems]
  );

  const editorSuggestions = useMemo(() => {
    if (!itemText.trim()) return [];
    return searchShoppingSuggestionsPaginated(itemText, shoppingCatalog, mercadonaEntries, {
      limit: 8,
      offset: 0,
      sectionOverrides: shoppingSectionOverridesMap,
    }).items;
  }, [itemText, shoppingCatalog, mercadonaEntries, shoppingSectionOverridesMap]);

  const applyPlan = useMemo(() => {
    if (!applyingTemplate) return null;
    const selectedIndexes = Array.from(selectedApplyIndexes).sort((a, b) => a - b);
    if (selectedIndexes.length === 0) {
      return {
        toCreate: [],
        toUpdate: [],
        skippedAlreadyPendingCount: 0,
        skippedIncompatibleUnitCount: 0,
        addedSeparateIncompatibleUnitCount: 0,
      };
    }
    return planApplyShoppingTemplate({
      templateItems: applyingTemplate.items,
      selectedIndexes,
      livePendingItems: pendingItems,
      mode: applyMode,
      sectionOverrides: shoppingSectionOverridesMap,
    });
  }, [applyingTemplate, selectedApplyIndexes, pendingItems, applyMode, shoppingSectionOverridesMap]);

  const resetEditor = () => {
    setEditingId(undefined);
    setDraftName('');
    setDraftItems([]);
    setItemText('');
    setItemQty('1');
    setItemUnit('');
    setItemMeta(null);
    setItemSugOpen(false);
    setError(null);
  };

  const openNewFromScratch = () => {
    resetEditor();
    setMode('editor');
  };

  const openSaveFromCurrent = () => {
    resetEditor();
    setPickedActiveIds(new Set(shoppingItems.map((i) => i.id)));
    setMode('pick_from_current');
  };

  const proceedFromCurrentSelection = () => {
    const selected = shoppingItems.filter((i) => pickedActiveIds.has(i.id));
    if (selected.length === 0) {
      setError('Selecciona al menos un producto de la lista actual.');
      return;
    }
    setError(null);
    setDraftItems(
      sanitizeShoppingTemplateItems(
        selected.map((i) => ({
          text: i.text,
          qty: i.qty,
          ...(i.unit ? { unit: i.unit } : {}),
          ...(i.catalogId ? { catalogId: i.catalogId } : {}),
          ...(i.brand ? { brand: i.brand } : {}),
          ...(i.format ? { format: i.format } : {}),
          ...(normalizeShoppingSection(i.section)
            ? { section: normalizeShoppingSection(i.section) }
            : {}),
          ...(normalizeShoppingSourceType(i.sourceType)
            ? { sourceType: normalizeShoppingSourceType(i.sourceType) }
            : {}),
        }))
      )
    );
    setMode('editor');
  };

  const openEditTemplate = (tpl: ShoppingListTemplate) => {
    resetEditor();
    setEditingId(tpl.id);
    setDraftName(tpl.name);
    setDraftItems(sanitizeShoppingTemplateItems(tpl.items));
    setMode('editor');
  };

  const openApplyTemplate = (tpl: ShoppingListTemplate) => {
    setError(null);
    setApplyingTemplate(tpl);
    setApplyMode('missing_only');
    setSelectedApplyIndexes(new Set(tpl.items.map((_, idx) => idx)));
    setMode('apply');
  };

  const handleSelectSuggestionInEditor = (s: ShoppingSuggestion) => {
    setItemText(s.text.slice(0, MAX_LENGTHS.shoppingText));
    setItemUnit(s.defaultUnit ? normalizeShoppingUnit(s.defaultUnit) : '');
    setItemMeta({
      baseNorm: normalizeShoppingText(s.text),
      ...(s.catalogId ? { catalogId: s.catalogId } : {}),
      ...(s.brand ? { brand: s.brand } : {}),
      ...(s.format ? { format: s.format } : {}),
      section: s.section,
      sourceType: s.sourceType,
    });
    setItemSugOpen(false);
  };

  const handleAddDraftItem = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanText = itemText.trim().slice(0, MAX_LENGTHS.shoppingText);
    if (!cleanText) return;
    if (draftItems.length >= MAX_SHOPPING_TEMPLATE_ITEMS) {
      setError(`Una lista reutilizable puede tener hasta ${MAX_SHOPPING_TEMPLATE_ITEMS} productos.`);
      return;
    }
    const parsedQty = Number(itemQty.trim().replace(',', '.'));
    const safeQty =
      Number.isFinite(parsedQty) && parsedQty > 0 && parsedQty <= 999 ? roundCents(parsedQty) : 1;
    const cleanUnit = normalizeShoppingUnit(itemUnit);
    const meta =
      itemMeta && itemMeta.baseNorm === normalizeShoppingText(cleanText) ? itemMeta : null;
    const effectiveSection = resolveEffectiveShoppingSection(
      {
        text: cleanText,
        catalogId: meta?.catalogId,
        brand: meta?.brand,
        format: meta?.format,
        section: meta?.section,
      },
      shoppingSectionOverridesMap
    );

    const nextItem: ShoppingTemplateItem = {
      text: cleanText,
      qty: safeQty,
      ...(cleanUnit ? { unit: cleanUnit } : {}),
      ...(meta?.catalogId ? { catalogId: meta.catalogId } : {}),
      ...(meta?.brand ? { brand: meta.brand } : {}),
      ...(meta?.format ? { format: meta.format } : {}),
      section: effectiveSection,
      sourceType: meta?.sourceType ?? 'custom',
    };

    setDraftItems((prev) => [...prev, nextItem]);
    setItemText('');
    setItemQty('1');
    setItemUnit('');
    setItemMeta(null);
    setItemSugOpen(false);
    setError(null);
  };

  const handleSaveTemplate = async () => {
    if (!householdId || !currentUserProfile || busy) return;
    const cleanName = draftName.trim().slice(0, MAX_LENGTHS.shoppingTemplateName);
    if (!cleanName) {
      setError('Ponle un nombre a la lista (ej. Compra semanal).');
      return;
    }
    const cleanItems = sanitizeShoppingTemplateItems(draftItems);
    if (cleanItems.length === 0) {
      setError('Añade al menos un producto antes de guardar la lista.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await repo.upsertShoppingTemplate(
        householdId,
        {
          ...(editingId ? { id: editingId } : {}),
          name: cleanName,
          items: cleanItems,
        },
        currentUserProfile
      );
      showToast(editingId ? `Lista «${cleanName}» actualizada` : `Lista «${cleanName}» guardada`);
      resetEditor();
      setMode('list');
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo guardar la lista reutilizable.'));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!householdId || !deleteTarget || busy) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setBusy(true);
    setError(null);
    try {
      await repo.deleteShoppingTemplate(householdId, target.id);
      showToast(`Lista «${target.name}» eliminada`);
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo eliminar la lista.'));
    } finally {
      setBusy(false);
    }
  };

  const handleApplyConfirm = async () => {
    if (!householdId || !currentUserProfile || !applyingTemplate || !applyPlan || busy) return;
    if (applyPlan.toCreate.length === 0 && applyPlan.toUpdate.length === 0) {
      showToast('Todos los productos seleccionados ya estaban pendientes en la lista.');
      setMode('list');
      setApplyingTemplate(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await repo.applyShoppingTemplate(householdId, applyPlan, currentUserProfile);
      const parts: string[] = [];
      if (applyPlan.toCreate.length > 0) {
        parts.push(
          `${applyPlan.toCreate.length} ${applyPlan.toCreate.length === 1 ? 'añadido' : 'añadidos'}`
        );
      }
      if (applyPlan.toUpdate.length > 0) {
        parts.push(
          `${applyPlan.toUpdate.length} ${
            applyPlan.toUpdate.length === 1 ? 'actualizado' : 'actualizados'
          }`
        );
      }
      if (applyPlan.skippedAlreadyPendingCount > 0) {
        parts.push(
          `${applyPlan.skippedAlreadyPendingCount} ${
            applyPlan.skippedAlreadyPendingCount === 1 ? 'ya pendiente' : 'ya pendientes'
          }`
        );
      }
      if (applyPlan.addedSeparateIncompatibleUnitCount > 0) {
        parts.push(
          `${applyPlan.addedSeparateIncompatibleUnitCount} aparte por distinta unidad`
        );
      }
      showToast(`Lista «${applyingTemplate.name}» aplicada: ${parts.join(' · ')}`);
      setApplyingTemplate(null);
      onClose();
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo aplicar la lista a la compra.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-3">
      {/* Sub-header */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={() => {
            if (mode === 'list') {
              onClose();
            } else {
              setError(null);
              setApplyingTemplate(null);
              setMode('list');
            }
          }}
          className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{mode === 'list' ? 'Volver a la lista' : 'Mis listas'}</span>
        </button>

        {mode === 'list' && (
          <div className="flex items-center gap-2">
            {shoppingItems.length > 0 && (
              <button
                type="button"
                onClick={openSaveFromCurrent}
                className="min-h-[44px] px-3 rounded-xl border border-[#0E5A64]/40 bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] text-xs font-bold inline-flex items-center gap-1.5"
              >
                <BookmarkPlus className="w-4 h-4" />
                <span>Guardar actual</span>
              </button>
            )}
            <button
              type="button"
              onClick={openNewFromScratch}
              className="min-h-[44px] px-3.5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Nueva lista</span>
            </button>
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-[#DC4C3E]/10 text-[#B42318] dark:text-[#FCA5A5] px-3.5 py-2.5 text-xs font-medium shrink-0"
        >
          {error}
        </div>
      )}

      {/* LIST VIEW */}
      {mode === 'list' && (
        <div className="flex-1 overflow-y-auto space-y-3 pr-0.5">
          {shoppingTemplates.length === 0 ? (
            <div className="py-10 px-4 text-center space-y-3 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
              <ListChecks className="w-10 h-10 text-slate-400 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
                  Aún no tenéis listas reutilizables
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
                  Guardad aquí vuestras listas habituales (por ejemplo, básicos semanales o escapadas) para añadirlas de golpe cuando haga falta. Se comparten en el hogar y no tocan la lista actual hasta que las apliquéis.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={openNewFromScratch}
                  className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Crear lista desde cero</span>
                </button>
                {shoppingItems.length > 0 && (
                  <button
                    type="button"
                    onClick={openSaveFromCurrent}
                    className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-[#0E5A64] dark:text-[#5EEAD4] inline-flex items-center gap-1.5"
                  >
                    <BookmarkPlus className="w-4 h-4" />
                    <span>Guardar de la lista actual</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {shoppingTemplates.map((tpl) => (
                <li
                  key={tpl.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#F6F8F8] dark:bg-slate-900/50 p-3.5 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-[#0F1F24] dark:text-[#F0F5F6] truncate">
                        {tpl.name}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {tpl.items.length} {tpl.items.length === 1 ? 'producto' : 'productos'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openApplyTemplate(tpl)}
                        className="min-h-[44px] px-3 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs font-bold inline-flex items-center gap-1.5"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Aplicar</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Editar lista ${tpl.name}`}
                        onClick={() => openEditTemplate(tpl)}
                        className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:text-[#0E5A64] hover:bg-white dark:hover:bg-slate-800"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Eliminar lista ${tpl.name}`}
                        onClick={() => setDeleteTarget(tpl)}
                        className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:text-[#B42318] hover:bg-white dark:hover:bg-slate-800"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2">
                    {tpl.items
                      .slice(0, 6)
                      .map((it) => `${it.text} (${formatShoppingQtyUnit(it.qty, it.unit)})`)
                      .join(' · ')}
                    {tpl.items.length > 6 ? ` · +${tpl.items.length - 6} más` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* PICK FROM CURRENT ACTIVE LIST */}
      {mode === 'pick_from_current' && (
        <div className="flex-1 min-h-0 flex flex-col space-y-3">
          <div className="flex items-center justify-between gap-2 shrink-0">
            <div>
              <h3 className="text-sm font-bold">Elegir productos de la lista actual</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Se copiarán a una lista nueva; tu lista actual no cambiará.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (pickedActiveIds.size === shoppingItems.length) {
                  setPickedActiveIds(new Set());
                } else {
                  setPickedActiveIds(new Set(shoppingItems.map((i) => i.id)));
                }
              }}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold shrink-0"
            >
              {pickedActiveIds.size === shoppingItems.length ? 'Ninguno' : 'Todos'}
            </button>
          </div>

          <ul className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl px-3">
            {shoppingItems.map((item) => {
              const checked = pickedActiveIds.has(item.id);
              return (
                <li key={item.id} className="py-2">
                  <label className="min-h-[44px] flex items-center justify-between gap-3 cursor-pointer">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setPickedActiveIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          });
                        }}
                        className="w-5 h-5 accent-[#0E5A64] shrink-0"
                      />
                      <span className="text-sm font-semibold truncate">{item.text}</span>
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                      {formatShoppingQtyUnit(item.qty, item.unit)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={proceedFromCurrentSelection}
            disabled={pickedActiveIds.size === 0}
            className="w-full min-h-[48px] rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-40 text-white text-sm font-bold shrink-0"
          >
            Continuar ({pickedActiveIds.size})
          </button>
        </div>
      )}

      {/* EDITOR VIEW */}
      {mode === 'editor' && (
        <div className="flex-1 min-h-0 flex flex-col space-y-3">
          <div className="shrink-0">
            <label
              htmlFor="tpl-name-input"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
            >
              Nombre de la lista
            </label>
            <input
              id="tpl-name-input"
              type="text"
              maxLength={MAX_LENGTHS.shoppingTemplateName}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Ej. Compra semanal, Desayunos..."
              className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium"
            />
          </div>

          <form onSubmit={handleAddDraftItem} className="relative space-y-2 shrink-0">
            <input
              type="text"
              aria-label="Añadir producto a la lista reutilizable"
              maxLength={MAX_LENGTHS.shoppingText}
              value={itemText}
              onChange={(e) => {
                const v = e.target.value;
                setItemText(v);
                if (itemMeta && normalizeShoppingText(v) !== itemMeta.baseNorm) {
                  setItemMeta(null);
                }
                setItemSugOpen(true);
              }}
              onFocus={() => {
                if (itemText.trim()) setItemSugOpen(true);
              }}
              placeholder="Buscar o escribir producto para añadir..."
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />

            {itemSugOpen && editorSuggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-[48px] z-20 max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] shadow-lg divide-y divide-slate-100 dark:divide-slate-800">
                {editorSuggestions.map((s) => (
                  <li key={s.key}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectSuggestionInEditor(s);
                      }}
                      className="w-full min-h-[44px] px-3 py-2 text-left text-xs flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span className="font-semibold truncate">{s.text}</span>
                      <span className="text-[11px] text-slate-500 shrink-0">
                        {[s.brand, s.format, s.defaultUnit].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-2">
              <input
                type="number"
                aria-label="Cantidad"
                min={0.01}
                max={999}
                step="any"
                value={itemQty}
                onChange={(e) => setItemQty(e.target.value)}
                className="w-20 min-h-[44px] px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-center font-semibold tabular-nums"
              />
              <select
                aria-label="Unidad"
                value={itemUnit}
                onChange={(e) => setItemUnit(e.target.value)}
                className="flex-1 min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                {SHOPPING_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!itemText.trim()}
                className="min-h-[44px] px-3.5 rounded-xl bg-[#0E5A64]/12 text-[#0E5A64] dark:text-[#5EEAD4] font-bold text-xs inline-flex items-center gap-1 shrink-0 disabled:opacity-40"
              >
                <Plus className="w-4 h-4" />
                <span>Añadir</span>
              </button>
            </div>
          </form>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
            {draftItems.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
                Todavía no hay productos en esta lista.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 px-3">
                {draftItems.map((it, idx) => (
                  <li key={`${it.text}-${idx}`} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{it.text}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {formatShoppingQtyUnit(it.qty, it.unit)}
                        {it.format ? ` · ${it.format}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Quitar ${it.text}`}
                      onClick={() =>
                        setDraftItems((prev) => prev.filter((_, itemIdx) => itemIdx !== idx))
                      }
                      className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:text-[#B42318]"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            disabled={busy || !draftName.trim() || draftItems.length === 0}
            onClick={() => void handleSaveTemplate()}
            className="w-full min-h-[48px] rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-40 text-white text-sm font-bold shrink-0"
          >
            {busy ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Guardar lista'}
          </button>
        </div>
      )}

      {/* APPLY VIEW */}
      {mode === 'apply' && applyingTemplate && applyPlan && (
        <div className="flex-1 min-h-0 flex flex-col space-y-3">
          <div className="flex items-center justify-between gap-2 shrink-0">
            <div className="min-w-0">
              <h3 className="text-sm font-bold truncate">Aplicar «{applyingTemplate.name}»</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Solo añade o actualiza pendientes; no marca productos comprados ni crea gastos.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (selectedApplyIndexes.size === applyingTemplate.items.length) {
                  setSelectedApplyIndexes(new Set());
                } else {
                  setSelectedApplyIndexes(new Set(applyingTemplate.items.map((_, i) => i)));
                }
              }}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold shrink-0"
            >
              {selectedApplyIndexes.size === applyingTemplate.items.length ? 'Ninguno' : 'Todos'}
            </button>
          </div>

          {/* Mode radio buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setApplyMode('missing_only')}
              className={`min-h-[54px] p-3 rounded-xl border text-left transition-colors ${
                applyMode === 'missing_only'
                  ? 'border-[#0E5A64] bg-[#0E5A64]/10'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <p className="text-xs font-bold text-[#0F1F24] dark:text-[#F0F5F6] flex items-center gap-1.5">
                {applyMode === 'missing_only' && (
                  <Check className="w-3.5 h-3.5 text-[#0E5A64] dark:text-[#5EEAD4]" />
                )}
                <span>Añadir solo los que faltan</span>
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Omite productos que ya estén pendientes para evitar duplicados.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setApplyMode('sum_quantities')}
              className={`min-h-[54px] p-3 rounded-xl border text-left transition-colors ${
                applyMode === 'sum_quantities'
                  ? 'border-[#0E5A64] bg-[#0E5A64]/10'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <p className="text-xs font-bold text-[#0F1F24] dark:text-[#F0F5F6] flex items-center gap-1.5">
                {applyMode === 'sum_quantities' && (
                  <Check className="w-3.5 h-3.5 text-[#0E5A64] dark:text-[#5EEAD4]" />
                )}
                <span>Sumar cantidades</span>
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Suma solo si coinciden variante y unidad; si la unidad difiere, lo añade aparte.
              </p>
            </button>
          </div>

          <ul className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl px-3">
            {applyingTemplate.items.map((item, idx) => {
              const checked = selectedApplyIndexes.has(idx);
              return (
                <li key={`${item.text}-${idx}`} className="py-2">
                  <label className="min-h-[44px] flex items-center justify-between gap-3 cursor-pointer">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedApplyIndexes((prev) => {
                            const next = new Set(prev);
                            if (next.has(idx)) next.delete(idx);
                            else next.add(idx);
                            return next;
                          });
                        }}
                        className="w-5 h-5 accent-[#0E5A64] shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold truncate">{item.text}</span>
                        {item.format && (
                          <span className="block text-[11px] text-slate-500 truncate">
                            {item.format}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                      {formatShoppingQtyUnit(item.qty, item.unit)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="rounded-xl bg-[#F6F8F8] dark:bg-slate-900/70 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 shrink-0">
            Se añadirán <strong>{applyPlan.toCreate.length}</strong>
            {applyPlan.toUpdate.length > 0 && (
              <>
                {' '}
                · se actualizarán <strong>{applyPlan.toUpdate.length}</strong>
              </>
            )}
            {applyPlan.skippedAlreadyPendingCount > 0 && (
              <>
                {' '}
                · se omitirán <strong>{applyPlan.skippedAlreadyPendingCount}</strong> por estar ya pendientes
              </>
            )}
            {applyPlan.addedSeparateIncompatibleUnitCount > 0 && (
              <>
                {' '}
                · {applyPlan.addedSeparateIncompatibleUnitCount} irán aparte por unidad distinta
              </>
            )}
            .
          </div>

          <button
            type="button"
            disabled={busy || selectedApplyIndexes.size === 0}
            onClick={() => void handleApplyConfirm()}
            className="w-full min-h-[48px] rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-40 text-white text-sm font-bold shrink-0"
          >
            {busy ? 'Aplicando...' : 'Aplicar a la lista'}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Eliminar lista reutilizable"
        description={
          deleteTarget
            ? `Se eliminará la lista «${deleteTarget.name}». Los productos que ya tengas en la lista de la compra actual no se verán afectados.`
            : ''
        }
        confirmLabel="Sí, eliminar"
        destructive
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
