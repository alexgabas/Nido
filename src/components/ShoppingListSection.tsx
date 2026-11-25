import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Layers,
  List,
  ListChecks,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
  ShoppingBasket,
  ShoppingCart,
  Star,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useNido } from '../context/NidoContext';
import { formatEUR, roundCents } from '../domain/finance';
import {
  findPendingDuplicateMatch,
  formatShoppingQtyUnit,
  GENERIC_STAPLES_CATALOG,
  groupShoppingItemsBySection,
  inferShoppingSection,
  normalizeShoppingSection,
  normalizeShoppingSourceType,
  normalizeShoppingText,
  normalizeShoppingUnit,
  resolveEffectiveShoppingSection,
  resolveShoppingProductKey,
  searchShoppingSuggestionsPaginated,
  SHOPPING_SECTIONS,
  SHOPPING_UNITS,
  type ShoppingSuggestion,
} from '../domain/shoppingCatalog';
import { useScreenWakeLock } from '../hooks/useScreenWakeLock';
import { toUserFriendlyErrorMessage } from '../services/firebase';
import {
  getCachedMercadonaCatalogSync,
  loadMercadonaCatalogOnDemand,
  type LoadedMercadonaCatalog,
} from '../services/mercadonaCatalogLoader';
import {
  captureShoppingCheckoutSnapshots,
  type ShoppingCheckoutItemSnapshot,
} from '../domain/shoppingCheckout';
import {
  MAX_LENGTHS,
  type ShoppingCatalogItem,
  type ShoppingItem,
  type ShoppingSection,
  type ShoppingSourceType,
} from '../types/nido';
import { ConfirmDialog } from './ConfirmDialog';
import { ShoppingCheckoutPanel } from './ShoppingCheckoutPanel';
import { ShoppingTemplatesPanel } from './ShoppingTemplatesPanel';

interface ShoppingListSectionProps {
  open: boolean;
  onClose: () => void;
  variant?: 'modal' | 'page';
}

interface SelectedProductMeta {
  baseNormText: string;
  catalogId?: string;
  brand?: string;
  format?: string;
  section: ShoppingSection;
  sourceType: ShoppingSourceType;
}

interface DuplicatePromptState {
  text: string;
  qty: number;
  unit: string;
  meta: SelectedProductMeta;
  existing: ShoppingItem;
}

export const ShoppingListSection: React.FC<ShoppingListSectionProps> = ({
  open,
  onClose,
  variant = 'modal',
}) => {
  const {
    householdId,
    shoppingItems,
    shoppingCatalog,
    shoppingTemplates,
    shoppingSectionOverridesMap,
    members,
    currentUserProfile,
    uiMode,
    repo,
    showToast,
    scheduleUndo,
    pendingShoppingCheckouts,
    localPendingCheckout,
    resumingShoppingCheckout,
    resumePendingShoppingCheckout,
    dismissPendingCheckoutRecovery,
  } = useNido();

  const [newText, setNewText] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [newUnit, setNewUnit] = useState('');
  const [catalogSection, setCatalogSection] = useState<ShoppingSection | 'todas'>('todas');
  const [selectedMeta, setSelectedMeta] = useState<SelectedProductMeta | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionLimit, setSuggestionLimit] = useState(12);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(-1);
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicatePromptState | null>(null);
  const [checkoutSnapshots, setCheckoutSnapshots] = useState<ShoppingCheckoutItemSnapshot[] | null>(
    null
  );
  const [templatesViewOpen, setTemplatesViewOpen] = useState(false);

  const [mercadonaCatalog, setMercadonaCatalog] = useState<LoadedMercadonaCatalog | null>(() =>
    getCachedMercadonaCatalogSync()
  );
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [groupBySection, setGroupBySection] = useState(true);
  const [shoppingMode, setShoppingMode] = useState(false);
  const [keepScreenAwake, setKeepScreenAwake] = useState(false);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editQty, setEditQty] = useState('1');
  const [editUnit, setEditUnit] = useState('');
  const [editSection, setEditSection] = useState<ShoppingSection>('Sin clasificar');
  const [rememberSectionOverride, setRememberSectionOverride] = useState(false);

  const [clearCheckedConfirmOpen, setClearCheckedConfirmOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [favBusyId, setFavBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productInputRef = useRef<HTMLInputElement | null>(null);
  const comboContainerRef = useRef<HTMLFormElement | null>(null);
  const suppressNextFocusOpenRef = useRef(false);

  const fetchMercadonaCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const loaded = await loadMercadonaCatalogOnDemand();
      setMercadonaCatalog(loaded);
    } catch (err) {
      const detail =
        err instanceof Error && err.message && err.message.includes('aún no se ha descargado')
          ? `${err.message} Puedes seguir usando tus productos del hogar y básicos.`
          : 'No se pudo cargar el catálogo de referencia de Mercadona. Puedes seguir usando tus productos del hogar y básicos.';
      setCatalogError(detail);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (mercadonaCatalog) return;
    void fetchMercadonaCatalog();
  }, [open, mercadonaCatalog, fetchMercadonaCatalog]);

  const pendingItems = useMemo(
    () => shoppingItems.filter((item) => !item.done),
    [shoppingItems]
  );
  const checkedItems = useMemo(
    () => shoppingItems.filter((item) => item.done),
    [shoppingItems]
  );

  const groupedPending = useMemo(
    () => groupShoppingItemsBySection(pendingItems, shoppingSectionOverridesMap),
    [pendingItems, shoppingSectionOverridesMap]
  );

  const quickCatalogItems = useMemo(
    () =>
      [...shoppingCatalog]
        .sort(
          (a, b) =>
            Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
            b.usageCount - a.usageCount ||
            b.lastUsedAt.localeCompare(a.lastUsedAt)
        )
        .slice(0, 10),
    [shoppingCatalog]
  );

  const mercadonaEntries = mercadonaCatalog?.items ?? [];

  const paginatedSuggestions = useMemo(
    () =>
      searchShoppingSuggestionsPaginated(newText, shoppingCatalog, mercadonaEntries, {
        limit: suggestionLimit,
        offset: 0,
        section: catalogSection,
        sectionOverrides: shoppingSectionOverridesMap,
      }),
    [newText, shoppingCatalog, mercadonaEntries, suggestionLimit, catalogSection, shoppingSectionOverridesMap]
  );
  const suggestions = paginatedSuggestions.items;

  const wakeLockEnabled =
    open && shoppingMode && keepScreenAwake && !checkoutSnapshots && !templatesViewOpen;
  const wakeLock = useScreenWakeLock(wakeLockEnabled);

  useEffect(() => {
    setActiveSuggestionIdx(-1);
  }, [newText, catalogSection, suggestions.length]);

  useEffect(() => {
    setSuggestionLimit(12);
  }, [newText, catalogSection]);

  useEffect(() => {
    if (!shoppingMode) {
      setKeepScreenAwake(false);
    }
  }, [shoppingMode]);

  useEffect(() => {
    if (!open) {
      setSuggestionsOpen(false);
      setSuggestionLimit(12);
      setCatalogSection('todas');
      setDuplicatePrompt(null);
      setCheckoutSnapshots(null);
      setTemplatesViewOpen(false);
      setKeepScreenAwake(false);
      setEditingItemId(null);
      setRememberSectionOverride(false);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!suggestionsOpen) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (comboContainerRef.current && !comboContainerRef.current.contains(e.target as Node)) {
        setSuggestionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [suggestionsOpen]);

  if (!open) return null;

  const memberName = (uid: string) =>
    members.find((m) => m.uid === uid)?.displayName?.split(' ')[0] || '';

  const parsePositiveQty = (raw: string): number | null => {
    const clean = raw.trim().replace(',', '.');
    if (!clean) return 1;
    const parsed = Number(clean);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 999) return null;
    return roundCents(parsed);
  };

  const resolveCatalogDefaultSection = (item: {
    text: string;
    catalogId?: string;
  }): ShoppingSection => {
    if (item.catalogId) {
      const mercEntry = mercadonaEntries.find((e) => e.id === item.catalogId);
      if (mercEntry) return mercEntry.section;
      const genEntry = GENERIC_STAPLES_CATALOG.find((g) => g.id === item.catalogId);
      if (genEntry) return genEntry.section;
    }
    return inferShoppingSection(item.text);
  };

  const resolveMetaForText = (cleanText: string): SelectedProductMeta => {
    const norm = normalizeShoppingText(cleanText);
    if (selectedMeta && selectedMeta.baseNormText === norm) {
      return selectedMeta;
    }
    const productKey = resolveShoppingProductKey({ text: cleanText });
    const overrideSec = shoppingSectionOverridesMap.get(productKey);
    return {
      baseNormText: norm,
      section:
        overrideSec ??
        (catalogSection !== 'todas' ? catalogSection : inferShoppingSection(cleanText)),
      sourceType: 'custom',
    };
  };

  const commitAddNewItem = async (
    text: string,
    qty: number,
    unit: string,
    meta: SelectedProductMeta
  ) => {
    if (!householdId || !currentUserProfile) return;
    setSubmitting(true);
    setError(null);
    try {
      await repo.upsertShoppingItem(
        householdId,
        {
          text,
          qty,
          unit,
          done: false,
          ...(meta.catalogId ? { catalogId: meta.catalogId } : {}),
          ...(meta.brand ? { brand: meta.brand } : {}),
          ...(meta.format ? { format: meta.format } : {}),
          section: meta.section,
          sourceType: meta.sourceType,
        },
        currentUserProfile
      );
      await repo.upsertShoppingCatalogItem(
        householdId,
        {
          text,
          defaultUnit: unit,
          ...(meta.catalogId ? { catalogId: meta.catalogId } : {}),
          ...(meta.brand ? { brand: meta.brand } : {}),
          ...(meta.format ? { format: meta.format } : {}),
          section: meta.section,
          sourceType: meta.sourceType,
        },
        currentUserProfile
      );
      setNewText('');
      setNewQty('1');
      setNewUnit('');
      setSelectedMeta(null);
      setDuplicatePrompt(null);
      setSuggestionsOpen(false);
      suppressNextFocusOpenRef.current = true;
      window.requestAnimationFrame(() => productInputRef.current?.focus());
    } catch (err) {
      setError(
        toUserFriendlyErrorMessage(err, 'No se pudo añadir el producto a la lista de la compra.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleMergeDuplicate = async () => {
    if (!duplicatePrompt || !householdId || !currentUserProfile) return;
    const { existing, qty, unit, text, meta } = duplicatePrompt;
    const mergedQty = Math.min(999, roundCents((Number(existing.qty) || 1) + qty));
    setSubmitting(true);
    setError(null);
    try {
      const nextSection = resolveEffectiveShoppingSection(
        {
          ...existing,
          section: normalizeShoppingSection(existing.section) ?? meta.section,
        },
        shoppingSectionOverridesMap
      );
      const nextSourceType =
        normalizeShoppingSourceType(existing.sourceType) ?? meta.sourceType;
      await repo.upsertShoppingItem(
        householdId,
        {
          id: existing.id,
          text: existing.text,
          qty: mergedQty,
          unit: existing.unit || unit,
          done: false,
          ...(existing.catalogId || meta.catalogId
            ? { catalogId: existing.catalogId || meta.catalogId }
            : {}),
          ...(existing.brand || meta.brand ? { brand: existing.brand || meta.brand } : {}),
          ...(existing.format || meta.format ? { format: existing.format || meta.format } : {}),
          section: nextSection,
          ...(nextSourceType ? { sourceType: nextSourceType } : {}),
        },
        currentUserProfile
      );
      await repo.upsertShoppingCatalogItem(
        householdId,
        {
          text,
          defaultUnit: unit || existing.unit,
          ...(existing.catalogId || meta.catalogId
            ? { catalogId: existing.catalogId || meta.catalogId }
            : {}),
          ...(existing.brand || meta.brand ? { brand: existing.brand || meta.brand } : {}),
          ...(existing.format || meta.format ? { format: existing.format || meta.format } : {}),
          section: nextSection,
          ...(nextSourceType ? { sourceType: nextSourceType } : {}),
        },
        currentUserProfile
      );
      setNewText('');
      setNewQty('1');
      setNewUnit('');
      setSelectedMeta(null);
      setDuplicatePrompt(null);
      setSuggestionsOpen(false);
      showToast(`Cantidad sumada a «${existing.text}»`);
      suppressNextFocusOpenRef.current = true;
      window.requestAnimationFrame(() => productInputRef.current?.focus());
    } catch (err) {
      setError(
        toUserFriendlyErrorMessage(err, 'No se pudo actualizar el producto existente.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId || !currentUserProfile || submitting) return;
    const clean = newText.trim().slice(0, MAX_LENGTHS.shoppingText);
    if (!clean) return;

    const qty = parsePositiveQty(newQty);
    if (qty === null) {
      setError('Introduce una cantidad positiva hasta 999 (puedes usar decimales como 0,5).');
      return;
    }

    const cleanUnit = normalizeShoppingUnit(newUnit);
    const meta = resolveMetaForText(clean);
    const dupCheck = findPendingDuplicateMatch(clean, cleanUnit, pendingItems, {
      format: meta.format,
    });
    if (dupCheck.exactSameUnitMatch) {
      setSuggestionsOpen(false);
      setDuplicatePrompt({
        text: clean,
        qty,
        unit: cleanUnit,
        meta,
        existing: dupCheck.exactSameUnitMatch,
      });
      return;
    }

    await commitAddNewItem(clean, qty, cleanUnit, meta);
  };

  const applySuggestion = (s: ShoppingSuggestion) => {
    const cleanText = s.text.slice(0, MAX_LENGTHS.shoppingText);
    setNewText(cleanText);
    setNewUnit(s.defaultUnit ? normalizeShoppingUnit(s.defaultUnit) : '');
    setSelectedMeta({
      baseNormText: normalizeShoppingText(cleanText),
      ...(s.catalogId ? { catalogId: s.catalogId } : {}),
      ...(s.brand ? { brand: s.brand } : {}),
      ...(s.format ? { format: s.format } : {}),
      section: s.section,
      sourceType: s.sourceType,
    });
    setSuggestionsOpen(false);
    setActiveSuggestionIdx(-1);
    setDuplicatePrompt(null);
    suppressNextFocusOpenRef.current = true;
    window.requestAnimationFrame(() => productInputRef.current?.focus());
  };

  const handleQuickAddCatalogItem = async (catItem: ShoppingCatalogItem) => {
    if (!householdId || !currentUserProfile || submitting) return;
    const cleanUnit = normalizeShoppingUnit(catItem.defaultUnit);
    const meta: SelectedProductMeta = {
      baseNormText: normalizeShoppingText(catItem.text),
      ...(catItem.catalogId ? { catalogId: catItem.catalogId } : {}),
      ...(catItem.brand ? { brand: catItem.brand } : {}),
      ...(catItem.format ? { format: catItem.format } : {}),
      section: resolveEffectiveShoppingSection(catItem, shoppingSectionOverridesMap),
      sourceType:
        normalizeShoppingSourceType(catItem.sourceType) ??
        (catItem.catalogId ? 'mercadona' : 'custom'),
    };
    const dupCheck = findPendingDuplicateMatch(catItem.text, cleanUnit, pendingItems, {
      format: catItem.format,
    });
    if (dupCheck.exactSameUnitMatch) {
      setDuplicatePrompt({
        text: catItem.text,
        qty: 1,
        unit: cleanUnit,
        meta,
        existing: dupCheck.exactSameUnitMatch,
      });
      return;
    }
    await commitAddNewItem(catItem.text, 1, cleanUnit, meta);
  };

  const handleToggleFavorite = async (catItem: ShoppingCatalogItem) => {
    if (!householdId || favBusyId) return;
    setFavBusyId(catItem.id);
    setError(null);
    try {
      await repo.toggleShoppingCatalogFavorite(householdId, catItem.id, !catItem.favorite);
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo actualizar el favorito.'));
    } finally {
      setFavBusyId(null);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestionsOpen || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestionIdx((prev) => (prev + 1 >= suggestions.length ? 0 : prev + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestionIdx((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSuggestionsOpen(false);
      setActiveSuggestionIdx(-1);
    } else if (e.key === 'Enter' && activeSuggestionIdx >= 0 && suggestions[activeSuggestionIdx]) {
      e.preventDefault();
      applySuggestion(suggestions[activeSuggestionIdx]);
    }
  };

  const handleToggleDone = async (item: ShoppingItem) => {
    if (!householdId || !currentUserProfile) return;
    setBusyId(item.id);
    setError(null);
    const nextDone = !item.done;
    try {
      await repo.upsertShoppingItem(
        householdId,
        {
          id: item.id,
          text: item.text,
          qty: item.qty,
          unit: item.unit || '',
          done: nextDone,
          ...(item.catalogId ? { catalogId: item.catalogId } : {}),
          ...(item.brand ? { brand: item.brand } : {}),
          ...(item.format ? { format: item.format } : {}),
          ...(item.section ? { section: item.section } : {}),
          ...(item.sourceType ? { sourceType: item.sourceType } : {}),
        },
        currentUserProfile
      );
      scheduleUndo(
        nextDone
          ? `En el carro: "${item.text}"`
          : `Devuelto "${item.text}" a pendientes`,
        async () => {
          await repo.upsertShoppingItem(
            householdId,
            {
              id: item.id,
              text: item.text,
              qty: item.qty,
              unit: item.unit || '',
              done: item.done,
              ...(item.catalogId ? { catalogId: item.catalogId } : {}),
              ...(item.brand ? { brand: item.brand } : {}),
              ...(item.format ? { format: item.format } : {}),
              ...(item.section ? { section: item.section } : {}),
              ...(item.sourceType ? { sourceType: item.sourceType } : {}),
            },
            currentUserProfile
          );
        }
      );
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo actualizar el producto.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleChangeQty = async (item: ShoppingItem, direction: 1 | -1) => {
    if (!householdId || !currentUserProfile) return;
    const step = Number.isInteger(item.qty) && item.qty >= 1 ? 1 : 0.5;
    const minQty = step === 0.5 ? 0.5 : 1;
    const nextQty = Math.max(minQty, Math.min(999, roundCents(item.qty + direction * step)));
    if (nextQty === item.qty) return;
    setBusyId(item.id);
    setError(null);
    try {
      await repo.upsertShoppingItem(
        householdId,
        {
          id: item.id,
          text: item.text,
          qty: nextQty,
          unit: item.unit || '',
          done: item.done,
          ...(item.catalogId ? { catalogId: item.catalogId } : {}),
          ...(item.brand ? { brand: item.brand } : {}),
          ...(item.format ? { format: item.format } : {}),
          ...(item.section ? { section: item.section } : {}),
          ...(item.sourceType ? { sourceType: item.sourceType } : {}),
        },
        currentUserProfile
      );
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo actualizar la cantidad.'));
    } finally {
      setBusyId(null);
    }
  };

  const startEditItem = (item: ShoppingItem) => {
    const productKey = resolveShoppingProductKey(item);
    setEditingItemId(item.id);
    setEditText(item.text);
    setEditQty(String(item.qty).replace('.', ','));
    setEditUnit(item.unit || '');
    setEditSection(resolveEffectiveShoppingSection(item, shoppingSectionOverridesMap));
    setRememberSectionOverride(shoppingSectionOverridesMap.has(productKey));
    setError(null);
  };

  const handleRestoreCatalogSection = async (item: ShoppingItem) => {
    if (!householdId || !currentUserProfile) return;
    const productKey = resolveShoppingProductKey({
      catalogId: item.catalogId,
      text: editText.trim() || item.text,
      brand: item.brand,
      format: item.format,
    });
    const defaultSection = resolveCatalogDefaultSection({
      catalogId: item.catalogId,
      text: editText.trim() || item.text,
    });
    setBusyId(item.id);
    setError(null);
    try {
      await repo.clearShoppingSectionOverride(householdId, productKey);
      await repo.upsertShoppingItem(
        householdId,
        {
          id: item.id,
          text: item.text,
          qty: item.qty,
          unit: item.unit || '',
          done: item.done,
          ...(item.catalogId ? { catalogId: item.catalogId } : {}),
          ...(item.brand ? { brand: item.brand } : {}),
          ...(item.format ? { format: item.format } : {}),
          section: defaultSection,
          ...(item.sourceType ? { sourceType: item.sourceType } : {}),
        },
        currentUserProfile
      );
      setEditSection(defaultSection);
      setRememberSectionOverride(false);
      showToast(`Sección restaurada a «${defaultSection}»`);
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo restaurar la sección del catálogo.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent, item: ShoppingItem) => {
    e.preventDefault();
    if (!householdId || !currentUserProfile) return;
    const cleanText = editText.trim().slice(0, MAX_LENGTHS.shoppingText);
    if (!cleanText) {
      setError('El nombre del producto no puede quedar vacío.');
      return;
    }
    const parsedQty = parsePositiveQty(editQty);
    if (parsedQty === null) {
      setError('La cantidad debe ser positiva y no superar 999.');
      return;
    }
    const cleanUnit = normalizeShoppingUnit(editUnit);
    const productKey = resolveShoppingProductKey({
      catalogId: item.catalogId,
      text: cleanText,
      brand: item.brand,
      format: item.format,
    });
    const hadOverride = shoppingSectionOverridesMap.has(productKey);
    const catalogDefaultSection = resolveCatalogDefaultSection({
      catalogId: item.catalogId,
      text: cleanText,
    });
    setBusyId(item.id);
    setError(null);
    try {
      if (rememberSectionOverride) {
        await repo.setShoppingSectionOverride(
          householdId,
          productKey,
          editSection,
          currentUserProfile
        );
      } else if (hadOverride) {
        await repo.clearShoppingSectionOverride(householdId, productKey);
      }
      await repo.upsertShoppingItem(
        householdId,
        {
          id: item.id,
          text: cleanText,
          qty: parsedQty,
          unit: cleanUnit,
          done: item.done,
          ...(item.catalogId ? { catalogId: item.catalogId } : {}),
          ...(item.brand ? { brand: item.brand } : {}),
          ...(item.format ? { format: item.format } : {}),
          section: editSection,
          ...(item.sourceType ? { sourceType: item.sourceType } : {}),
        },
        currentUserProfile
      );
      await repo.upsertShoppingCatalogItem(
        householdId,
        {
          text: cleanText,
          defaultUnit: cleanUnit,
          ...(item.catalogId ? { catalogId: item.catalogId } : {}),
          ...(item.brand ? { brand: item.brand } : {}),
          ...(item.format ? { format: item.format } : {}),
          section: rememberSectionOverride ? editSection : catalogDefaultSection,
          ...(item.sourceType ? { sourceType: item.sourceType } : {}),
        },
        currentUserProfile
      );
      setEditingItemId(null);
      setRememberSectionOverride(false);
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo guardar el cambio del producto.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteItem = async (item: ShoppingItem) => {
    if (!householdId || !currentUserProfile) return;
    setBusyId(item.id);
    setError(null);
    const snapshot = { ...item };
    try {
      await repo.deleteShoppingItem(householdId, item.id);
      if (editingItemId === item.id) setEditingItemId(null);
      scheduleUndo(`Eliminado "${snapshot.text}"`, async () => {
        await repo.upsertShoppingItem(
          householdId,
          {
            text: snapshot.text,
            qty: snapshot.qty,
            unit: snapshot.unit || '',
            done: snapshot.done,
            ...(snapshot.catalogId ? { catalogId: snapshot.catalogId } : {}),
            ...(snapshot.brand ? { brand: snapshot.brand } : {}),
            ...(snapshot.format ? { format: snapshot.format } : {}),
            ...(snapshot.section ? { section: snapshot.section } : {}),
            ...(snapshot.sourceType ? { sourceType: snapshot.sourceType } : {}),
          },
          currentUserProfile
        );
      });
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo eliminar el producto.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleClearCheckedConfirm = async () => {
    if (!householdId || checkedItems.length === 0) return;
    const ids = checkedItems.map((i) => i.id);
    setClearCheckedConfirmOpen(false);
    setError(null);
    try {
      await repo.deleteShoppingItemsBulk(householdId, ids);
      showToast('Productos comprados limpiados');
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudieron limpiar los productos comprados.'));
    }
  };

  const handleStartCheckout = () => {
    if (!householdId || checkedItems.length === 0) return;
    const snapshots = captureShoppingCheckoutSnapshots(checkedItems);
    if (snapshots.length === 0) return;
    setSuggestionsOpen(false);
    setDuplicatePrompt(null);
    setEditingItemId(null);
    setCheckoutSnapshots(snapshots);
  };

  const renderRow = (item: ShoppingItem) => {
    const busy = busyId === item.id;
    const isEditing = editingItemId === item.id;
    const addedName = memberName(item.addedBy);
    const qtyLabel = formatShoppingQtyUnit(item.qty, item.unit);
    const minForStep = Number.isInteger(item.qty) && item.qty >= 1 ? 1 : 0.5;
    const isMercadona = item.sourceType === 'mercadona';
    const metaSub = [item.brand, item.format].filter(Boolean).join(' · ');

    if (isEditing) {
      const editProductKey = resolveShoppingProductKey({
        catalogId: item.catalogId,
        text: editText.trim() || item.text,
        brand: item.brand,
        format: item.format,
      });
      const catalogDefaultSection = resolveCatalogDefaultSection({
        catalogId: item.catalogId,
        text: editText.trim() || item.text,
      });
      const hasSavedOverride = shoppingSectionOverridesMap.has(editProductKey);
      return (
        <li key={item.id} className="py-2.5 first:pt-0 last:pb-0">
          <form
            onSubmit={(e) => void handleSaveEdit(e, item)}
            className="rounded-xl bg-[#F6F8F8] dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2.5 space-y-2"
          >
            <input
              type="text"
              aria-label="Editar nombre del producto"
              maxLength={MAX_LENGTHS.shoppingText}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] text-sm"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                aria-label="Editar cantidad"
                value={editQty}
                onChange={(e) => setEditQty(e.target.value)}
                className="w-20 min-h-[44px] px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] text-sm text-center font-semibold tabular-nums"
              />
              <select
                aria-label="Editar unidad"
                value={editUnit}
                onChange={(e) => setEditUnit(e.target.value)}
                className="flex-1 min-w-[110px] min-h-[44px] px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] text-sm"
              >
                {SHOPPING_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Sección de compra"
                value={editSection}
                onChange={(e) => {
                  const nextSec = e.target.value as ShoppingSection;
                  setEditSection(nextSec);
                  if (nextSec !== catalogDefaultSection) {
                    setRememberSectionOverride(true);
                  }
                }}
                className="w-full sm:w-auto sm:flex-1 min-h-[44px] px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] text-sm"
              >
                {SHOPPING_SECTIONS.map((sec) => (
                  <option key={sec} value={sec}>
                    {sec}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              <label className="inline-flex items-center gap-2 min-h-[36px] text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberSectionOverride}
                  onChange={(e) => setRememberSectionOverride(e.target.checked)}
                  className="w-4 h-4 accent-[#0E5A64] rounded"
                />
                <span>Recordar sección en futuras compras del hogar</span>
              </label>
              {hasSavedOverride && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRestoreCatalogSection(item)}
                  className="min-h-[40px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] text-[11px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 hover:border-[#0E5A64]"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restaurar sección del catálogo</span>
                </button>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingItemId(null);
                  setRememberSectionOverride(false);
                }}
                className="min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] px-3.5 rounded-xl bg-[#0E5A64] text-white text-xs font-bold"
              >
                Guardar
              </button>
            </div>
          </form>
        </li>
      );
    }

    return (
      <li
        key={item.id}
        className={`${shoppingMode ? 'py-3' : 'py-2.5'} first:pt-0 last:pb-0 flex items-center justify-between gap-2`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            type="button"
            disabled={busy}
            aria-label={
              item.done ? `Desmarcar ${item.text}` : `Marcar ${item.text} como comprado`
            }
            onClick={() => void handleToggleDone(item)}
            className={`${
              shoppingMode ? 'min-h-[48px] min-w-[48px]' : 'min-h-[44px] min-w-[44px]'
            } rounded-xl border flex items-center justify-center shrink-0 transition-colors ${
              item.done
                ? 'border-[#15803D] bg-[#15803D] text-white'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-[#0E5A64]'
            }`}
          >
            {item.done && <Check className="w-5 h-5" />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p
                className={`${shoppingMode ? 'text-base' : 'text-sm'} font-semibold truncate ${
                  item.done
                    ? 'line-through text-slate-500 dark:text-slate-400'
                    : 'text-[#0F1F24] dark:text-[#F0F5F6]'
                }`}
              >
                {item.text}
              </p>
              {isMercadona && (
                <span className="px-1.5 py-0.5 rounded bg-[#15803D] text-white text-[10px] font-bold shrink-0">
                  Mercadona
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
              <span className="font-semibold tabular-nums">{qtyLabel}</span>
              {metaSub ? ` · ${metaSub}` : ''}
              {addedName ? ` · ${addedName}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!item.done && !shoppingMode && (
            <>
              <button
                type="button"
                disabled={busy || item.qty <= minForStep}
                aria-label={`Restar cantidad de ${item.text}`}
                onClick={() => void handleChangeQty(item, -1)}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 disabled:opacity-40"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`Sumar cantidad de ${item.text}`}
                onClick={() => void handleChangeQty(item, 1)}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`Editar ${item.text}`}
                onClick={() => startEditItem(item)}
                className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-[#0E5A64]"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </>
          )}
          {shoppingMode && !item.done && (
            <button
              type="button"
              disabled={busy}
              aria-label={`Sumar cantidad de ${item.text}`}
              onClick={() => void handleChangeQty(item, 1)}
              className="min-h-[48px] min-w-[48px] rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
          {!shoppingMode && (
            <button
              type="button"
              disabled={busy}
              aria-label={`Eliminar ${item.text}`}
              onClick={() => void handleDeleteItem(item)}
              className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-[#B42318] dark:hover:text-[#FCA5A5]"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </li>
    );
  };

  const isPage = variant === 'page';

  return (
    <>
      <div
        className={
          isPage
            ? 'max-w-2xl mx-auto'
            : 'fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4'
        }
        role={isPage ? undefined : 'dialog'}
        aria-modal={isPage ? undefined : 'true'}
        aria-labelledby="shopping-list-title"
      >
        <div
          className={
            isPage
              ? 'w-full rounded-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-4 sm:p-6 space-y-3.5 flex flex-col'
              : 'w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-4 sm:p-6 space-y-3.5 max-h-[92vh] flex flex-col'
          }
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-10 h-10 rounded-xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center shrink-0">
                <ShoppingCart className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                {isPage ? (
                  <h1 id="shopping-list-title" className="font-display text-xl sm:text-2xl font-bold truncate">
                    {checkoutSnapshots
                      ? 'Finalizar compra'
                      : templatesViewOpen
                        ? 'Mis listas'
                        : 'Lista de la compra'}
                  </h1>
                ) : (
                  <h2 id="shopping-list-title" className="font-display text-lg font-bold truncate">
                    {checkoutSnapshots
                      ? 'Finalizar compra'
                      : templatesViewOpen
                        ? 'Mis listas'
                        : 'Lista de la compra'}
                  </h2>
                )}
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {checkoutSnapshots
                    ? `${checkoutSnapshots.length} ${
                        checkoutSnapshots.length === 1 ? 'producto listo' : 'productos listos'
                      } para pasar a gasto`
                    : templatesViewOpen
                      ? 'Listas reutilizables compartidas del hogar'
                      : `${pendingItems.length} por comprar · ${checkedItems.length} en el carro`}
                </p>
              </div>
            </div>
            {!isPage ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar lista de la compra"
                className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            ) : (
              uiMode === 'sencillo' && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Volver a Inicio"
                  className="md:hidden min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 shrink-0 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Inicio</span>
                </button>
              )
            )}
          </div>

          {checkoutSnapshots ? (
            <ShoppingCheckoutPanel
              snapshots={checkoutSnapshots}
              liveShoppingItems={shoppingItems}
              onCancel={() => setCheckoutSnapshots(null)}
              onCompleted={() => {
                setCheckoutSnapshots(null);
                if (!isPage) onClose();
              }}
            />
          ) : templatesViewOpen ? (
            <ShoppingTemplatesPanel
              onClose={() => setTemplatesViewOpen(false)}
              mercadonaEntries={mercadonaEntries}
            />
          ) : (
            <>

          {/* View controls: Por secciones / Lista simple + Mis listas + Modo compra */}
          <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 bg-[#F6F8F8] dark:bg-slate-900">
              <button
                type="button"
                aria-pressed={groupBySection}
                onClick={() => setGroupBySection(true)}
                className={`min-h-[44px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                  groupBySection
                    ? 'bg-white dark:bg-[#132025] text-[#0E5A64] dark:text-[#5EEAD4] shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Por secciones</span>
              </button>
              <button
                type="button"
                aria-pressed={!groupBySection}
                onClick={() => setGroupBySection(false)}
                className={`min-h-[44px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                  !groupBySection
                    ? 'bg-white dark:bg-[#132025] text-[#0E5A64] dark:text-[#5EEAD4] shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span>Lista simple</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              {!shoppingMode && (
                <button
                  type="button"
                  onClick={() => {
                    setSuggestionsOpen(false);
                    setEditingItemId(null);
                    setTemplatesViewOpen(true);
                  }}
                  className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-xs font-bold text-slate-700 dark:text-slate-200 hover:border-[#0E5A64]/50 inline-flex items-center gap-1.5 transition-colors"
                >
                  <ListChecks className="w-3.5 h-3.5 text-[#0E5A64] dark:text-[#5EEAD4]" />
                  <span>Mis listas{shoppingTemplates.length > 0 ? ` (${shoppingTemplates.length})` : ''}</span>
                </button>
              )}

              <button
                type="button"
                aria-pressed={shoppingMode}
                onClick={() => setShoppingMode((v) => !v)}
                className={`min-h-[44px] px-3.5 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 transition-colors ${
                  shoppingMode
                    ? 'border-[#15803D] bg-[#15803D] text-white'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] text-slate-700 dark:text-slate-200 hover:border-[#0E5A64]/50'
                }`}
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>Modo compra</span>
              </button>
            </div>
          </div>

          {shoppingMode && (
            <div
              role="status"
              className="rounded-xl bg-[#0E5A64]/10 dark:bg-[#0E5A64]/25 border border-[#0E5A64]/25 px-3.5 py-2.5 space-y-2 shrink-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
                  {pendingItems.length > 0
                    ? `Faltan ${pendingItems.length} ${pendingItems.length === 1 ? 'producto' : 'productos'} por echar al carro`
                    : '¡Todo en el carro! Ya puedes convertir la compra en gasto'}
                </span>
                <span className="font-mono-num text-xs font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
                  {checkedItems.length}/{shoppingItems.length}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  aria-pressed={keepScreenAwake}
                  onClick={() => setKeepScreenAwake((v) => !v)}
                  className={`min-h-[44px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                    keepScreenAwake
                      ? 'border-[#0E5A64] bg-[#0E5A64] text-white'
                      : 'border-[#0E5A64]/30 bg-white/80 dark:bg-[#132025] text-[#0E5A64] dark:text-[#5EEAD4]'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" />
                  <span>
                    {keepScreenAwake && wakeLock.active
                      ? 'Pantalla encendida (activa)'
                      : 'Mantener pantalla encendida'}
                  </span>
                </button>
                {keepScreenAwake && wakeLock.statusMessage && (
                  <p className="text-[11px] text-amber-800 dark:text-amber-200">
                    {wakeLock.statusMessage}
                  </p>
                )}
              </div>
            </div>
          )}

          {(localPendingCheckout || pendingShoppingCheckouts.length > 0) && (
            <div
              role="region"
              aria-label="Recuperación de compra pendiente"
              className="rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-300 dark:border-amber-700/60 p-3 space-y-2 shrink-0"
            >
              {localPendingCheckout ? (
                <>
                  <p className="text-xs font-bold text-amber-950 dark:text-amber-100">
                    {localPendingCheckout.state === 'committing'
                      ? `Compra pendiente de confirmar (${formatEUR(localPendingCheckout.amount)})`
                      : `Compra confirmada con limpieza pendiente (${formatEUR(localPendingCheckout.amount)})`}
                  </p>
                  <p className="text-[11px] text-amber-900 dark:text-amber-200">
                    {localPendingCheckout.state === 'committing'
                      ? 'Se interrumpió antes de recibir confirmación. Comprobaremos si ya está en el servidor para no duplicar el gasto.'
                      : 'El gasto ya se registró; al reanudar solo se retirarán los productos pendientes que no hayan cambiado.'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={resumingShoppingCheckout}
                      onClick={() =>
                        void resumePendingShoppingCheckout(localPendingCheckout.checkoutId)
                      }
                      className="min-h-[44px] px-3 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-50 text-white text-xs font-bold"
                    >
                      {resumingShoppingCheckout
                        ? 'Comprobando...'
                        : localPendingCheckout.state === 'committing'
                          ? 'Comprobar y completar'
                          : 'Reanudar limpieza'}
                    </button>
                    <button
                      type="button"
                      disabled={resumingShoppingCheckout}
                      onClick={() =>
                        void dismissPendingCheckoutRecovery(localPendingCheckout.checkoutId)
                      }
                      className="min-h-[44px] px-3 rounded-xl border border-amber-300 dark:border-amber-700 text-xs font-semibold text-amber-950 dark:text-amber-100"
                    >
                      Descartar aviso
                    </button>
                  </div>
                </>
              ) : (
                pendingShoppingCheckouts.map((pending) => (
                  <div key={pending.id} className="space-y-1.5">
                    <p className="text-xs font-bold text-amber-950 dark:text-amber-100">
                      Gasto guardado, quedan {pending.pendingItemIds.length}{' '}
                      {pending.pendingItemIds.length === 1 ? 'producto' : 'productos'} por retirar
                      {pending.amount > 0 ? ` (${formatEUR(pending.amount)})` : ''}
                    </p>
                    <p className="text-[11px] text-amber-900 dark:text-amber-200">
                      Puedes completar la limpieza desde este dispositivo sin duplicar el gasto.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={resumingShoppingCheckout}
                        onClick={() => void resumePendingShoppingCheckout(pending.id)}
                        className="min-h-[44px] px-3 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-50 text-white text-xs font-bold"
                      >
                        {resumingShoppingCheckout
                          ? 'Limpiando...'
                          : 'Reanudar limpieza (sin duplicar gasto)'}
                      </button>
                      <button
                        type="button"
                        disabled={resumingShoppingCheckout}
                        onClick={() => void dismissPendingCheckoutRecovery(pending.id)}
                        className="min-h-[44px] px-3 rounded-xl border border-amber-300 dark:border-amber-700 text-xs font-semibold text-amber-950 dark:text-amber-100"
                      >
                        Descartar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl bg-[#DC4C3E]/10 text-[#B42318] dark:text-[#FCA5A5] px-3.5 py-2.5 text-xs font-medium shrink-0"
            >
              {error}
            </div>
          )}

          {/* Catalog loading/error status */}
          {!shoppingMode && (catalogLoading || catalogError) && (
            <div className="rounded-xl bg-[#F6F8F8] dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 px-3 py-2 flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300 shrink-0">
              <span>
                {catalogLoading
                  ? 'Cargando catálogo de Mercadona...'
                  : catalogError}
              </span>
              {catalogError && (
                <button
                  type="button"
                  onClick={() => void fetchMercadonaCatalog()}
                  className="min-h-[44px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold inline-flex items-center gap-1 shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reintentar</span>
                </button>
              )}
            </div>
          )}

          {/* Formulario rápido + Autocompletado Mercadona + Hogar */}
          {!shoppingMode && (
            <form
              onSubmit={handleAdd}
              className="relative space-y-2 shrink-0"
              ref={comboContainerRef}
            >
              {/* Filtro por sección de supermercado (combinable con texto) */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Explorar catálogo por sección de supermercado"
                  value={catalogSection}
                  onChange={(e) => {
                    const nextSec = e.target.value as ShoppingSection | 'todas';
                    setCatalogSection(nextSec);
                    if (nextSec !== 'todas') {
                      setSuggestionsOpen(true);
                    }
                  }}
                  className="flex-1 min-w-[180px] min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
                >
                  <option value="todas">Sección de supermercado: Todas</option>
                  {SHOPPING_SECTIONS.map((sec) => (
                    <option key={sec} value={sec}>
                      {sec}
                    </option>
                  ))}
                </select>
                {catalogSection !== 'todas' && (
                  <button
                    type="button"
                    onClick={() => {
                      setCatalogSection('todas');
                      if (!newText.trim()) setSuggestionsOpen(false);
                    }}
                    className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                  >
                    Ver todas
                  </button>
                )}
              </div>

              {uiMode === 'avanzado' && (
                <div
                  className="flex items-center gap-1.5 overflow-x-auto pb-0.5"
                  role="group"
                  aria-label="Accesos rápidos de secciones de supermercado"
                >
                  <button
                    type="button"
                    aria-pressed={catalogSection === 'todas'}
                    onClick={() => {
                      setCatalogSection('todas');
                      if (!newText.trim()) setSuggestionsOpen(false);
                    }}
                    className={`min-h-[36px] px-2.5 rounded-lg border text-[11px] font-semibold shrink-0 transition-colors ${
                      catalogSection === 'todas'
                        ? 'border-[#0E5A64] bg-[#0E5A64] text-white'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Todas
                  </button>
                  {SHOPPING_SECTIONS.map((sec) => {
                    const active = catalogSection === sec;
                    return (
                      <button
                        key={sec}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setCatalogSection(sec);
                          setSuggestionsOpen(true);
                        }}
                        className={`min-h-[36px] px-2.5 rounded-lg border text-[11px] font-semibold shrink-0 transition-colors ${
                          active
                            ? 'border-[#0E5A64] bg-[#0E5A64] text-white'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {sec}
                      </button>
                    );
                  })}
                </div>
              )}

              <div>
                <input
                  ref={productInputRef}
                  type="text"
                  role="combobox"
                  aria-label="Producto para comprar"
                  aria-expanded={suggestionsOpen && suggestions.length > 0}
                  aria-controls="shopping-suggestions-list"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    activeSuggestionIdx >= 0 && suggestions[activeSuggestionIdx]
                      ? `shopping-sug-${suggestions[activeSuggestionIdx].key}`
                      : undefined
                  }
                  maxLength={MAX_LENGTHS.shoppingText}
                  value={newText}
                  onFocus={() => {
                    if (suppressNextFocusOpenRef.current) {
                      suppressNextFocusOpenRef.current = false;
                      return;
                    }
                    setSuggestionsOpen(true);
                  }}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setNewText(nextVal);
                    if (
                      selectedMeta &&
                      normalizeShoppingText(nextVal) !== selectedMeta.baseNormText
                    ) {
                      setSelectedMeta(null);
                    }
                    setSuggestionsOpen(true);
                    setDuplicatePrompt(null);
                  }}
                  onKeyDown={handleInputKeyDown}
                  placeholder={
                    catalogSection === 'todas'
                      ? 'Añadir producto (ej. leche hacendado, plátanos, gel...)'
                      : `Buscar en «${catalogSection}» o escribir producto...`
                  }
                  className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-2 focus:outline-[#0E5A64]"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  aria-label="Cantidad"
                  min={0.01}
                  max={999}
                  step="any"
                  value={newQty}
                  onFocus={() => setSuggestionsOpen(false)}
                  onChange={(e) => {
                    setNewQty(e.target.value);
                    setDuplicatePrompt(null);
                  }}
                  className="w-20 min-h-[44px] px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-center font-semibold tabular-nums"
                />
                <select
                  aria-label="Unidad"
                  value={newUnit}
                  onFocus={() => setSuggestionsOpen(false)}
                  onChange={(e) => {
                    setNewUnit(e.target.value);
                    setDuplicatePrompt(null);
                  }}
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
                  disabled={submitting || !newText.trim()}
                  className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-40 text-white text-sm font-semibold flex items-center gap-1 shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Añadir</span>
                </button>
              </div>

              {/* Dropdown positioned below entire form (no overlap with Qty / Unit / Añadir) */}
              {suggestionsOpen &&
                (suggestions.length > 0 ||
                  newText.trim().length > 0 ||
                  catalogSection !== 'todas') && (
                <div className="absolute left-0 right-0 top-full mt-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#132025] shadow-xl z-20 overflow-hidden">
                  <div className="px-3.5 py-2 border-b border-slate-100 dark:border-slate-800 bg-[#F6F8F8] dark:bg-slate-900/70 flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="font-semibold truncate">
                      {paginatedSuggestions.totalCount.toLocaleString('es-ES')}{' '}
                      {paginatedSuggestions.totalCount === 1 ? 'resultado' : 'resultados'}
                      {catalogSection !== 'todas' ? ` en «${catalogSection}»` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSuggestionsOpen(false)}
                      className="min-h-[32px] px-2 rounded-lg font-semibold text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800 shrink-0"
                    >
                      Ocultar
                    </button>
                  </div>
                  {suggestions.length === 0 ? (
                    <div className="px-3.5 py-3 text-xs text-slate-500 dark:text-slate-400">
                      Sin coincidencias en {catalogSection !== 'todas' ? `«${catalogSection}»` : 'el catálogo'}. Pulsa «Añadir» para guardarlo como producto personalizado.
                    </div>
                  ) : (
                    <>
                      <ul
                        id="shopping-suggestions-list"
                        role="listbox"
                        aria-label="Sugerencias de productos"
                        className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800"
                      >
                        {suggestions.map((s, idx) => {
                          const isActive = idx === activeSuggestionIdx;
                          const isMercadona = s.sourceType === 'mercadona';
                          const metaLine = [s.brand, s.format].filter(Boolean).join(' · ');
                          return (
                            <li
                              key={s.key}
                              id={`shopping-sug-${s.key}`}
                              role="option"
                              aria-selected={isActive}
                            >
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  applySuggestion(s);
                                }}
                                className={`w-full min-h-[46px] px-3.5 py-2 text-left flex items-center justify-between gap-2 text-xs transition-colors ${
                                  isActive
                                    ? 'bg-[#0E5A64]/12 text-[#0E5A64] dark:text-[#5EEAD4]'
                                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/80'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    {s.favorite && (
                                      <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />
                                    )}
                                    <span className="font-semibold truncate text-sm text-[#0F1F24] dark:text-[#F0F5F6]">
                                      {s.text}
                                    </span>
                                  </div>
                                  {metaLine && (
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                      {metaLine}
                                    </p>
                                  )}
                                </div>
                                <span className="flex items-center gap-1.5 shrink-0">
                                  {s.hasSectionOverride && (
                                    <span
                                      title={`Sección personalizada: ${s.section}`}
                                      className="px-1.5 py-0.5 rounded bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] text-[10px] font-semibold"
                                    >
                                      {s.section}
                                    </span>
                                  )}
                                  {s.defaultUnit && (
                                    <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                      {s.defaultUnit}
                                    </span>
                                  )}
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      isMercadona
                                        ? 'bg-[#15803D] text-white'
                                        : s.source === 'hogar'
                                          ? 'bg-[#0E5A64]/12 text-[#0E5A64] dark:text-[#5EEAD4]'
                                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                    }`}
                                  >
                                    {isMercadona
                                      ? 'Mercadona'
                                      : s.source === 'hogar'
                                        ? 'Hogar'
                                        : 'Básico'}
                                  </span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      {paginatedSuggestions.hasMore && (
                        <div className="border-t border-slate-100 dark:border-slate-800 bg-[#F6F8F8] dark:bg-slate-900/60 px-3 py-1.5 flex items-center justify-between">
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            Mostrando {suggestions.length} de {paginatedSuggestions.totalCount}
                          </span>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setSuggestionLimit((n) => n + 12);
                            }}
                            className="min-h-[44px] px-3 rounded-lg text-xs font-bold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-[#0E5A64]/10"
                          >
                            Ver más resultados
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </form>
          )}

          {/* Favoritos y recientes del hogar (añadir en 1 toque + estrella favorita) */}
          {!shoppingMode && quickCatalogItems.length > 0 && (
            <div className="space-y-1.5 shrink-0">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Favoritos y recientes
              </p>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {quickCatalogItems.map((catItem) => {
                  const busyFav = favBusyId === catItem.id;
                  return (
                    <div
                      key={catItem.id}
                      className="inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-[#F6F8F8] dark:bg-slate-900/60 shrink-0 overflow-hidden"
                    >
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleQuickAddCatalogItem(catItem)}
                        className="min-h-[44px] pl-3 pr-2 text-xs font-semibold text-[#0F1F24] dark:text-[#F0F5F6] hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 max-w-[170px]"
                        title={`Añadir ${catItem.text}`}
                      >
                        <Plus className="w-3.5 h-3.5 text-[#0E5A64] dark:text-[#5EEAD4] shrink-0" />
                        <span className="truncate">{catItem.text}</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyFav}
                        aria-label={
                          catItem.favorite
                            ? `Quitar ${catItem.text} de favoritos`
                            : `Marcar ${catItem.text} como favorito`
                        }
                        aria-pressed={Boolean(catItem.favorite)}
                        onClick={() => void handleToggleFavorite(catItem)}
                        className="min-h-[44px] min-w-[44px] px-1.5 flex items-center justify-center text-slate-400 hover:text-amber-500"
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${
                            catItem.favorite
                              ? 'text-amber-500 fill-amber-500'
                              : ''
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Aviso de duplicado pendiente exacto */}
          {duplicatePrompt && (
            <div
              role="region"
              aria-label="Producto ya pendiente en la lista"
              className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-3.5 space-y-2.5 shrink-0"
            >
              <p className="text-xs font-semibold text-amber-950 dark:text-amber-100">
                Ya tienes «{duplicatePrompt.existing.text}» (
                {formatShoppingQtyUnit(duplicatePrompt.existing.qty, duplicatePrompt.existing.unit)}
                ) en pendientes.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleMergeDuplicate()}
                  className="min-h-[44px] px-3 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs font-bold"
                >
                  Sumar a existente
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    void commitAddNewItem(
                      duplicatePrompt.text,
                      duplicatePrompt.qty,
                      duplicatePrompt.unit,
                      duplicatePrompt.meta
                    )
                  }
                  className="min-h-[44px] px-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-[#132025] text-xs font-semibold"
                >
                  Añadir aparte
                </button>
                <button
                  type="button"
                  onClick={() => setDuplicatePrompt(null)}
                  className="min-h-[44px] px-3 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Lista de productos */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-0.5">
            {shoppingItems.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <ShoppingBasket className="w-10 h-10 text-slate-400 dark:text-slate-500 mx-auto" />
                <p className="text-sm font-semibold">La lista está vacía</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Apunta lo que falte en casa o busca productos en el catálogo; se sincroniza al momento con tu pareja.
                </p>
              </div>
            ) : (
              <>
                {pendingItems.length > 0 &&
                  (groupBySection ? (
                    <div className="space-y-3">
                      {groupedPending.map((group) => (
                        <section key={group.section} className="space-y-1">
                          <h3 className="text-[11px] font-bold uppercase tracking-wide text-[#0E5A64] dark:text-[#5EEAD4]">
                            {group.section} ({group.items.length})
                          </h3>
                          <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-100 dark:border-slate-800/80 px-2.5 py-1">
                            {group.items.map(renderRow)}
                          </ul>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        Pendientes ({pendingItems.length})
                      </p>
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        {pendingItems.map(renderRow)}
                      </ul>
                    </div>
                  ))}

                {checkedItems.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        Comprados ({checkedItems.length})
                      </p>
                      <button
                        type="button"
                        onClick={() => setClearCheckedConfirmOpen(true)}
                        className="min-h-[44px] px-2.5 rounded-lg text-xs font-semibold text-[#B42318] dark:text-[#FCA5A5] hover:bg-[#B42318]/10"
                      >
                        Limpiar comprados
                      </button>
                    </div>
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {checkedItems.map(renderRow)}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Discreet catalog attribution & disclaimer + Convert button */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2 shrink-0">
            {mercadonaCatalog && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center leading-tight">
                {mercadonaCatalog.meta.disclaimer} ({mercadonaCatalog.meta.count.toLocaleString('es-ES')} productos · {mercadonaCatalog.meta.license})
              </p>
            )}
            <button
              type="button"
              disabled={checkedItems.length === 0}
              onClick={handleStartCheckout}
              className="w-full min-h-[48px] px-4 rounded-xl bg-[#15803D] hover:bg-[#166534] disabled:opacity-40 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>
                {checkedItems.length > 0
                  ? shoppingMode
                    ? `Finalizar compra (${checkedItems.length})`
                    : `Convertir en gasto (${checkedItems.length})`
                  : shoppingMode
                    ? 'Marca artículos para finalizar la compra'
                    : 'Marca artículos para convertir en gasto'}
              </span>
            </button>
          </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={clearCheckedConfirmOpen}
        title="Limpiar productos comprados"
        description={`Se eliminarán de la lista los ${checkedItems.length} artículos marcados como comprados. Los gastos ya registrados no se verán afectados.`}
        confirmLabel="Sí, limpiar comprados"
        destructive
        onConfirm={() => void handleClearCheckedConfirm()}
        onCancel={() => setClearCheckedConfirmOpen(false)}
      />
    </>
  );
};
