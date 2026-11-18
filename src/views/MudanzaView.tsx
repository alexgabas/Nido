import React, { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Check,
  CheckSquare,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  Square,
  Trash2,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useNido } from '../context/NidoContext';
import { downloadTextFile, generateSpanishCSV } from '../domain/backup';
import {
  buildIkeaSearchUrl,
  computeFurnitureSummary,
  computeInitialCostsSummary,
  formatDateES,
  formatEUR,
  getTodayLocalISO,
} from '../domain/finance';
import {
  FURNITURE_STATUS_LABELS,
  INITIAL_COST_CATEGORY_LABELS,
  PRIORITY_LABELS,
  ROOM_LABELS,
} from '../domain/presets';
import { exportNidoPDF } from '../services/pdfExport';
import { toUserFriendlyErrorMessage } from '../services/firebase';
import {
  COMMON_ACCOUNT_ID,
  type FurnitureItem,
  type FurniturePriority,
  type FurnitureRoom,
  type FurnitureStatus,
  type InitialCost,
  type InitialCostCategory,
} from '../types/nido';

type MudanzaSubTab = 'gastos' | 'checklist' | 'mobiliario';
type FurnitureSortField = 'name' | 'room' | 'price' | 'status';

export const MudanzaView: React.FC = () => {
  const {
    household,
    householdId,
    members,
    memberA,
    memberB,
    currentUserProfile,
    effectiveSplitPctA,
    uiMode,
    initialCosts,
    checklist,
    furnitureItems,
    monthTransactions,
    goals,
    goalMovements,
    repo,
    showToast,
    scheduleUndo,
    seedingDefaults,
    retryDefaultSeed,
  } = useNido();

  const [subTab, setSubTab] = useState<MudanzaSubTab>(() =>
    uiMode === 'sencillo' ? 'mobiliario' : 'gastos'
  );

  // Initial costs modal state (Avanzado)
  const [costModalOpen, setCostModalOpen] = useState(false);
  const [editingCost, setEditingCost] = useState<InitialCost | null>(null);
  const [costConcept, setCostConcept] = useState('');
  const [costCategory, setCostCategory] = useState<InitialCostCategory>('alquiler');
  const [costAmount, setCostAmount] = useState('');
  const [costPaidBy, setCostPaidBy] = useState<string>(COMMON_ACCOUNT_ID);
  const [costStatus, setCostStatus] = useState<'pendiente' | 'pagado'>('pendiente');
  const [costDueDate, setCostDueDate] = useState('');
  const [costNotes, setCostNotes] = useState('');

  // Checklist add state
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskGroup, setNewTaskGroup] = useState('Suministros y trámites');

  // Furniture search, filters, sorting, inline edit, bulk selection (Avanzado)
  const [furnitureSearch, setFurnitureSearch] = useState('');
  const [roomFilter, setRoomFilter] = useState<FurnitureRoom | 'todas'>('todas');
  const [priorityFilter, setPriorityFilter] = useState<FurniturePriority | 'todas'>('todas');
  const [statusFilter, setStatusFilter] = useState<FurnitureStatus | 'todos'>('todos');
  const [sortField, setSortField] = useState<FurnitureSortField>('room');
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedFurnitureIds, setSelectedFurnitureIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [inlineFurId, setInlineFurId] = useState<string | null>(null);
  const [inlineFurPrice, setInlineFurPrice] = useState('0');
  const [inlineFurQty, setInlineFurQty] = useState('1');

  // Furniture modal state
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<FurnitureItem | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemRoom, setItemRoom] = useState<FurnitureRoom>('salon');
  const [itemPriority, setItemPriority] = useState<FurniturePriority>('imprescindible');
  const [itemStatus, setItemStatus] = useState<FurnitureStatus>('pendiente');
  const [itemStore, setItemStore] = useState('IKEA');
  const [itemUrl, setItemUrl] = useState('');
  const [itemArticle, setItemArticle] = useState('');
  const [itemPrice, setItemPrice] = useState('0');
  const [itemQty, setItemQty] = useState('1');
  const [itemNotes, setItemNotes] = useState('');

  // Confirm delete state
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'cost'; item: InitialCost }
    | { kind: 'furniture'; item: FurnitureItem }
    | { kind: 'checklist'; id: string; text: string }
    | null
  >(null);

  const effectiveSubTab: MudanzaSubTab =
    uiMode === 'sencillo' && subTab === 'gastos' ? 'mobiliario' : subTab;

  const uidA = memberA?.uid || 'member_a';
  const uidB = memberB?.uid || 'member_b';
  const nameA = memberA?.displayName?.split(' ')[0] || 'Persona A';
  const nameB = memberB?.displayName?.split(' ')[0] || 'Pareja';

  const costSummary = useMemo(
    () => computeInitialCostsSummary(initialCosts, effectiveSplitPctA, uidA, uidB),
    [initialCosts, effectiveSplitPctA, uidA, uidB]
  );

  const furnitureSummary = useMemo(
    () => computeFurnitureSummary(furnitureItems),
    [furnitureItems]
  );

  const filteredFurniture = useMemo(() => {
    if (uiMode === 'sencillo') return furnitureItems;
    const q = furnitureSearch.trim().toLowerCase();
    const list = furnitureItems.filter((it) => {
      if (roomFilter !== 'todas' && it.room !== roomFilter) return false;
      if (priorityFilter !== 'todas' && it.priority !== priorityFilter) return false;
      if (statusFilter !== 'todos' && it.status !== statusFilter) return false;
      if (q) {
        const hay = `${it.name} ${it.store} ${it.articleNumber} ${ROOM_LABELS[it.room]}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name, 'es');
      else if (sortField === 'room') cmp = ROOM_LABELS[a.room].localeCompare(ROOM_LABELS[b.room], 'es');
      else if (sortField === 'price') cmp = a.unitPrice * a.qty - b.unitPrice * b.qty;
      else cmp = FURNITURE_STATUS_LABELS[a.status].localeCompare(FURNITURE_STATUS_LABELS[b.status], 'es');
      return sortAsc ? cmp : -cmp;
    });
  }, [uiMode, furnitureItems, furnitureSearch, roomFilter, priorityFilter, statusFilter, sortField, sortAsc]);

  const checklistDoneCount = checklist.filter((c) => c.done).length;
  const checklistPct = checklist.length > 0 ? Math.round((checklistDoneCount / checklist.length) * 100) : 0;

  const groupedChecklist = useMemo(() => {
    const groups = new Map<string, typeof checklist>();
    for (const item of checklist) {
      const list = groups.get(item.group) ?? [];
      list.push(item);
      groups.set(item.group, list);
    }
    return Array.from(groups.entries());
  }, [checklist]);

  const openCostModal = (cost: InitialCost | null) => {
    setEditingCost(cost);
    setCostConcept(cost?.concept ?? '');
    setCostCategory(cost?.category ?? 'otros');
    setCostAmount(cost ? String(cost.amount) : '');
    const normalizedPaidBy =
      !cost?.paidBy || cost.paidBy === 'comun' ? COMMON_ACCOUNT_ID : cost.paidBy;
    setCostPaidBy(normalizedPaidBy);
    setCostStatus(cost?.status ?? 'pendiente');
    setCostDueDate(cost?.dueDate ?? '');
    setCostNotes(cost?.notes ?? '');
    setCostModalOpen(true);
  };

  const handleSaveCost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId || !currentUserProfile) return;
    const numeric = Number(costAmount.replace(',', '.'));
    if (!Number.isFinite(numeric) || numeric < 0) return;
    try {
      await repo.upsertInitialCost(
        householdId,
        {
          id: editingCost?.id,
          concept: costConcept.trim(),
          category: costCategory,
          amount: Math.round(numeric * 100) / 100,
          paidBy: costPaidBy,
          status: costStatus,
          dueDate: costDueDate,
          notes: costNotes,
        },
        currentUserProfile
      );
      setCostModalOpen(false);
      showToast('Gasto inicial guardado');
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudo guardar el gasto inicial.'));
    }
  };

  const openFurnitureModal = (item: FurnitureItem | null) => {
    setEditingItem(item);
    setItemName(item?.name ?? '');
    setItemRoom(item?.room ?? 'salon');
    setItemPriority(item?.priority ?? 'imprescindible');
    setItemStatus(item?.status ?? 'pendiente');
    setItemStore(item?.store ?? 'IKEA');
    setItemUrl(item?.productUrl ?? '');
    setItemArticle(item?.articleNumber ?? '');
    setItemPrice(item ? String(item.unitPrice) : '0');
    setItemQty(item ? String(item.qty) : '1');
    setItemNotes(item?.notes ?? '');
    setItemModalOpen(true);
  };

  const handleSaveFurniture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId || !currentUserProfile || !itemName.trim()) return;
    const price = uiMode === 'sencillo' ? (editingItem?.unitPrice ?? 0) : Math.max(0, Number(itemPrice.replace(',', '.')) || 0);
    const qty = uiMode === 'sencillo' ? (editingItem?.qty ?? 1) : Math.max(1, Math.min(999, Math.round(Number(itemQty) || 1)));
    await repo.upsertFurnitureItem(
      householdId,
      {
        id: editingItem?.id,
        name: itemName.trim(),
        room: itemRoom,
        priority: uiMode === 'sencillo' ? (editingItem?.priority ?? 'imprescindible') : itemPriority,
        status: uiMode === 'sencillo' ? (editingItem?.status ?? 'pendiente') : itemStatus,
        store: uiMode === 'sencillo' ? (editingItem?.store ?? 'IKEA') : itemStore.trim() || 'IKEA',
        productUrl: uiMode === 'sencillo' ? (editingItem?.productUrl ?? '') : itemUrl.trim(),
        articleNumber: uiMode === 'sencillo' ? (editingItem?.articleNumber ?? '') : itemArticle.trim(),
        unitPrice: Math.round(price * 100) / 100,
        qty,
        notes: uiMode === 'sencillo' ? (editingItem?.notes ?? '') : itemNotes.trim(),
      },
      currentUserProfile
    );
    setItemModalOpen(false);
    showToast('Mueble guardado');
  };

  const handleSaveInlineFurniture = async (item: FurnitureItem) => {
    if (!householdId || !currentUserProfile) return;
    const price = Math.max(0, Number(inlineFurPrice.replace(',', '.')) || 0);
    const qty = Math.max(1, Math.min(999, Math.round(Number(inlineFurQty) || 1)));
    await repo.upsertFurnitureItem(
      householdId,
      {
        ...item,
        unitPrice: Math.round(price * 100) / 100,
        qty,
      },
      currentUserProfile
    );
    setInlineFurId(null);
    showToast('Artículo actualizado');
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !householdId || !currentUserProfile) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    if (target.kind === 'cost') {
      const backupItem = { ...target.item };
      await repo.deleteInitialCost(householdId, backupItem.id, backupItem.concept, currentUserProfile);
      scheduleUndo(`Eliminado "${backupItem.concept}"`, () =>
        repo.restoreInitialCost(householdId, backupItem, currentUserProfile)
      );
    } else if (target.kind === 'furniture') {
      const backupItem = { ...target.item };
      await repo.deleteFurnitureItem(householdId, backupItem.id, backupItem.name, currentUserProfile);
      scheduleUndo(`Eliminado "${backupItem.name}"`, () =>
        repo.restoreFurnitureItem(householdId, backupItem, currentUserProfile)
      );
    } else {
      await repo.deleteChecklistItem(householdId, target.id, target.text, currentUserProfile);
      showToast('Tarea eliminada');
    }
  };

  const handleConfirmBulkDeleteFurniture = async () => {
    if (!householdId || !currentUserProfile) return;
    const toDelete = furnitureItems
      .filter((it) => selectedFurnitureIds.has(it.id))
      .map((it) => ({ id: it.id, name: it.name }));
    setBulkDeleteConfirmOpen(false);
    if (toDelete.length === 0) return;
    try {
      await repo.deleteFurnitureItemsBulk(householdId, toDelete, currentUserProfile);
      setSelectedFurnitureIds(new Set());
      showToast(`Eliminados ${toDelete.length} artículos`);
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudieron eliminar los artículos.'));
    }
  };

  const handleExportMudanzaCSV = () => {
    const csv = generateSpanishCSV(
      ['Tipo', 'Concepto / Artículo', 'Categoría / Estancia', 'Estado', 'Importe Total (€)'],
      [
        ...initialCosts.map((c) => [
          'Gasto inicial',
          c.concept,
          INITIAL_COST_CATEGORY_LABELS[c.category],
          c.status === 'pagado' ? 'Pagado' : 'Pendiente',
          c.amount,
        ]),
        ...furnitureItems.map((it) => [
          'Mobiliario',
          `${it.name} (x${it.qty})`,
          ROOM_LABELS[it.room],
          FURNITURE_STATUS_LABELS[it.status],
          it.unitPrice * it.qty,
        ]),
      ]
    );
    downloadTextFile(`nido-mudanza-${getTodayLocalISO()}.csv`, csv, 'text/csv;charset=utf-8;');
    showToast('CSV de mudanza descargado');
  };

  const handleExportMudanzaPDF = () => {
    if (!household) return;
    const today = getTodayLocalISO();
    exportNidoPDF({
      scope: 'mudanza',
      household,
      members,
      fromDate: today.slice(0, 7) + '-01',
      toDate: today,
      transactions: monthTransactions,
      initialCosts,
      items: furnitureItems,
      goals,
      goalMovements,
    });
    showToast('PDF de mudanza descargado');
  };

  const memberLabel = (uid: string) => {
    if (uid === COMMON_ACCOUNT_ID || uid === 'comun') return 'Cuenta común';
    return members.find((m) => m.uid === uid)?.displayName || 'Pareja';
  };

  const allVisibleSelected =
    filteredFurniture.length > 0 && filteredFurniture.every((it) => selectedFurnitureIds.has(it.id));

  // ─── MODO SENCILLO: SOLO MOBILIARIO (SIN FILTROS/URL/REF) + CHECKLIST ──────
  if (uiMode === 'sencillo') {
    return (
      <div className="space-y-5 max-w-2xl mx-auto">
        <header className="space-y-1">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">Mudanza</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Muebles del piso y lista de tareas.
          </p>
        </header>

        {/* Only 2 clean sub-tabs */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-200/70 dark:bg-slate-900 rounded-2xl">
          {[
            { id: 'mobiliario' as const, label: `Muebles (${furnitureItems.length})` },
            { id: 'checklist' as const, label: `Checklist (${checklistDoneCount}/${checklist.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`min-h-[46px] px-3 rounded-xl text-sm font-bold transition-colors truncate ${
                effectiveSubTab === tab.id
                  ? 'bg-white dark:bg-[#132025] text-[#0F1F24] dark:text-[#F0F5F6] shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Sencillo: Mobiliario (no filters, no URL/articleNumber/store/price clutter) */}
        {effectiveSubTab === 'mobiliario' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {furnitureSummary.boughtCount} de {furnitureSummary.totalCount} resueltos
              </p>
              <button
                type="button"
                onClick={() => openFurnitureModal(null)}
                className="min-h-[46px] px-4 rounded-2xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-bold flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Añadir mueble</span>
              </button>
            </div>

            {furnitureItems.length === 0 ? (
              <div className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
                <p className="text-base font-bold">Sin muebles todavía</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Añade lo que necesitéis para el piso y ve marcando su estado.
                </p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {furnitureItems.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-3.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="text-base font-bold truncate">
                          {item.name} {item.qty > 1 ? `×${item.qty}` : ''}
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {ROOM_LABELS[item.room]}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Eliminar ${item.name}`}
                        onClick={() => setDeleteTarget({ kind: 'furniture', item })}
                        className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-400 hover:text-[#DC4C3E]"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Large 1-tap status chips */}
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.keys(FURNITURE_STATUS_LABELS) as FurnitureStatus[]).map((st) => {
                        const active = item.status === st;
                        return (
                          <button
                            key={st}
                            type="button"
                            onClick={() =>
                              householdId &&
                              currentUserProfile &&
                              void repo.updateFurnitureStatus(householdId, item, st, currentUserProfile)
                            }
                            className={`min-h-[44px] px-3 rounded-2xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
                              active
                                ? st === 'comprado' || st === 'ya_lo_tenemos'
                                  ? 'bg-[#15803D] text-white'
                                  : st === 'en_carrito'
                                    ? 'bg-[#0E5A64] text-white'
                                    : 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                                : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                            <span>{FURNITURE_STATUS_LABELS[st]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Sencillo: Checklist */}
        {effectiveSubTab === 'checklist' && (
          <div className="space-y-4">
            <div className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-bold">Progreso de entrada</h2>
                <span className="font-mono-num text-sm font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
                  {checklistDoneCount} de {checklist.length}
                </span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-[#0E5A64] dark:bg-[#2AA1AE] rounded-full transition-all duration-500"
                  style={{ width: `${checklistPct}%` }}
                />
              </div>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newTaskText.trim() || !householdId || !currentUserProfile) return;
                await repo.addChecklistItem(
                  householdId,
                  newTaskText.trim(),
                  'Suministros y trámites',
                  checklist.length + 1,
                  currentUserProfile
                );
                setNewTaskText('');
                showToast('Tarea añadida');
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                maxLength={240}
                value={newTaskText}
                onChange={(e) => setNewTaskText(e.target.value)}
                placeholder="Añadir una tarea..."
                className="flex-1 min-h-[48px] px-4 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] text-sm"
              />
              <button
                type="submit"
                className="min-h-[48px] px-4 rounded-2xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-bold whitespace-nowrap"
              >
                Añadir
              </button>
            </form>

            {groupedChecklist.map(([groupName, groupItems]) => (
              <div
                key={groupName}
                className="rounded-3xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3"
              >
                <h3 className="font-display text-sm font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
                  {groupName}
                </h3>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {groupItems.map((task) => (
                    <li key={task.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          householdId &&
                          currentUserProfile &&
                          void repo.toggleChecklistItem(householdId, task, !task.done, currentUserProfile)
                        }
                        className="flex items-start gap-3 text-left flex-1 min-h-[46px] py-1"
                      >
                        {task.done ? (
                          <CheckSquare className="w-5 h-5 text-[#15803D] dark:text-[#4ADE80] shrink-0 mt-0.5" />
                        ) : (
                          <Square className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                        )}
                        <span
                          className={`text-sm leading-snug block ${
                            task.done ? 'line-through text-slate-400' : ''
                          }`}
                        >
                          {task.text}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Eliminar tarea ${task.text}`}
                        onClick={() => setDeleteTarget({ kind: 'checklist', id: task.id, text: task.text })}
                        className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-400 hover:text-[#DC4C3E]"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* Sencillo Add Furniture Modal (Name + Room only) */}
        {itemModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="simple-furniture-modal-title"
          >
            <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 space-y-4">
              <h2 id="simple-furniture-modal-title" className="font-display text-lg font-bold">
                Nuevo mueble
              </h2>
              <form onSubmit={handleSaveFurniture} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Nombre</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    maxLength={120}
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    placeholder="Ej. Mesita de noche"
                    className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Estancia</label>
                  <select
                    value={itemRoom}
                    onChange={(e) => setItemRoom(e.target.value as FurnitureRoom)}
                    className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    {(Object.keys(ROOM_LABELS) as FurnitureRoom[]).map((r) => (
                      <option key={r} value={r}>
                        {ROOM_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setItemModalOpen(false)}
                    className="min-h-[46px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="min-h-[46px] px-5 rounded-xl bg-[#0E5A64] text-white text-sm font-bold"
                  >
                    Guardar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title="Confirmar eliminación"
          description={
            deleteTarget?.kind === 'furniture'
              ? `Vas a eliminar "${deleteTarget.item.name}". Podrás deshacerlo durante 5 segundos.`
              : `Vas a eliminar la tarea "${deleteTarget?.kind === 'checklist' ? deleteTarget.text : ''}".`
          }
          confirmLabel="Eliminar"
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    );
  }

  // ─── MODO AVANZADO ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header + Export */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">Mudanza</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Gastos iniciales, checklist legal Catalunya y equipamiento del piso.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportMudanzaCSV}
            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={handleExportMudanzaPDF}
            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#132025] text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>PDF</span>
          </button>
        </div>
      </div>

      {/* 3 Sub-tabs */}
      <div className="grid grid-cols-3 gap-1 p-1 bg-slate-200/70 dark:bg-slate-900 rounded-xl">
        {[
          { id: 'gastos' as const, label: 'Gastos iniciales' },
          { id: 'checklist' as const, label: `Checklist (${checklistDoneCount}/${checklist.length})` },
          { id: 'mobiliario' as const, label: 'Mobiliario e IKEA' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`min-h-[44px] px-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors truncate ${
              effectiveSubTab === tab.id
                ? 'bg-white dark:bg-[#132025] text-[#0F1F24] dark:text-[#F0F5F6] shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-[#0F1F24]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* SECTION A: GASTOS INICIALES */}
      {effectiveSubTab === 'gastos' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Total previsto</p>
              <p className="font-display text-xl font-bold tabular-nums mt-1">
                {formatEUR(costSummary.totalPlanned)}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Pagado</p>
              <p className="font-display text-xl font-bold tabular-nums mt-1 text-[#15803D] dark:text-[#4ADE80]">
                {formatEUR(costSummary.totalPaid)}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Pendiente</p>
              <p className="font-display text-xl font-bold tabular-nums mt-1 text-[#DC4C3E]">
                {formatEUR(costSummary.totalPending)}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Reparto previsto</p>
              <p className="text-xs font-semibold tabular-nums mt-1.5">
                {nameA}: {formatEUR(costSummary.shareA)}
              </p>
              <p className="text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">
                {nameB}: {formatEUR(costSummary.shareB)}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold">Conceptos de entrada</h2>
            <button
              type="button"
              onClick={() => openCostModal(null)}
              className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo gasto inicial</span>
            </button>
          </div>

          {initialCosts.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-8 text-center space-y-3">
              <p className="text-sm font-semibold">No hay gastos iniciales registrados</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Añade la fianza, el primer mes o los cambios de titular para calcular cuánto os corresponde.
              </p>
              <div className="pt-1">
                <button
                  type="button"
                  disabled={seedingDefaults}
                  onClick={() => void retryDefaultSeed()}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                >
                  {seedingDefaults ? 'Cargando listas...' : 'Cargar listas por defecto'}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
              {initialCosts.map((c) => (
                <div
                  key={c.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold truncate">{c.concept}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {INITIAL_COST_CATEGORY_LABELS[c.category]} · Pagó: {memberLabel(c.paidBy)}
                      {c.dueDate ? ` · Fecha: ${formatDateES(c.dueDate)}` : ''}
                    </p>
                    {c.notes && <p className="text-xs text-slate-500 dark:text-slate-400">{c.notes}</p>}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                    <span className="font-mono-num text-base font-bold mr-1">
                      {formatEUR(c.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        householdId &&
                        currentUserProfile &&
                        void repo.upsertInitialCost(
                          householdId,
                          {
                            ...c,
                            status: c.status === 'pagado' ? 'pendiente' : 'pagado',
                          },
                          currentUserProfile
                        )
                      }
                      className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold transition-colors ${
                        c.status === 'pagado'
                          ? 'bg-[#15803D]/12 text-[#15803D] dark:text-[#4ADE80]'
                          : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      {c.status === 'pagado' ? 'Pagado' : 'Pendiente'}
                    </button>
                    <button
                      type="button"
                      aria-label={`Editar ${c.concept}`}
                      onClick={() => openCostModal(c)}
                      className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Eliminar ${c.concept}`}
                      onClick={() => setDeleteTarget({ kind: 'cost', item: c })}
                      className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-400 hover:text-[#DC4C3E] hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SECTION B: CHECKLIST CATALUNYA */}
      {effectiveSubTab === 'checklist' && (
        <div className="space-y-5">
          <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold">Progreso legal y entrada al piso</h2>
              <span className="font-mono-num text-sm font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
                {checklistDoneCount}/{checklist.length} ({checklistPct}%)
              </span>
            </div>
            <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-[#0E5A64] dark:bg-[#2AA1AE] rounded-full transition-all duration-500"
                style={{ width: `${checklistPct}%` }}
              />
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Recordatorio Catalunya: la fianza legal es 1 mensualidad (máx. 2 de garantía adicional, sin seguro de impago obligatorio). El propietario debe depositarla en el INCASÒL en 2 meses y entregaros copia. Comprobad si Sant Sadurní d’Anoia aplica tope de zona tensionada.
            </p>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newTaskText.trim() || !householdId || !currentUserProfile) return;
              await repo.addChecklistItem(
                householdId,
                newTaskText.trim(),
                newTaskGroup,
                checklist.length + 1,
                currentUserProfile
              );
              setNewTaskText('');
              showToast('Tarea añadida');
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <input
              type="text"
              maxLength={240}
              value={newTaskText}
              onChange={(e) => setNewTaskText(e.target.value)}
              placeholder="Añadir otra tarea de mudanza..."
              className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] text-sm"
            />
            <select
              aria-label="Grupo de tarea"
              value={newTaskGroup}
              onChange={(e) => setNewTaskGroup(e.target.value)}
              className="min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] text-sm"
            >
              <option value="Contrato y normativa Catalunya">Contrato y normativa</option>
              <option value="Entrega de llaves">Entrega de llaves</option>
              <option value="Suministros y trámites">Suministros y trámites</option>
            </select>
            <button
              type="submit"
              className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-sm font-semibold whitespace-nowrap"
            >
              Añadir tarea
            </button>
          </form>

          {groupedChecklist.map(([groupName, groupItems]) => (
            <div
              key={groupName}
              className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 space-y-3"
            >
              <h3 className="font-display text-sm font-bold text-[#0E5A64] dark:text-[#5EEAD4]">
                {groupName}
              </h3>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {groupItems.map((task) => (
                  <li key={task.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        householdId &&
                        currentUserProfile &&
                        void repo.toggleChecklistItem(householdId, task, !task.done, currentUserProfile)
                      }
                      className="flex items-start gap-3 text-left flex-1 min-h-[44px] py-1"
                    >
                      {task.done ? (
                        <CheckSquare className="w-5 h-5 text-[#15803D] dark:text-[#4ADE80] shrink-0 mt-0.5" />
                      ) : (
                        <Square className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-0.5">
                        <span
                          className={`text-sm leading-snug block ${
                            task.done ? 'line-through text-slate-400' : ''
                          }`}
                        >
                          {task.text}
                        </span>
                        {task.done && (
                          <span className="text-xs text-slate-500 dark:text-slate-400 block">
                            Hecho por {memberLabel(task.doneBy)} · {formatDateES(task.doneAt)}
                          </span>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={`Eliminar tarea ${task.text}`}
                      onClick={() => setDeleteTarget({ kind: 'checklist', id: task.id, text: task.text })}
                      className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-400 hover:text-[#DC4C3E]"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* SECTION C: MOBILIARIO E IKEA (AVANZADO CON FILTROS, BÚSQUEDA, ORDENACIÓN, EDICIÓN EN LÍNEA Y BORRADO MASIVO) */}
      {effectiveSubTab === 'mobiliario' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Presupuesto pendiente</p>
              <p className="font-display text-xl font-bold tabular-nums mt-1 text-[#DC4C3E]">
                {formatEUR(furnitureSummary.totalPending)}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Ya gastado</p>
              <p className="font-display text-xl font-bold tabular-nums mt-1 text-[#15803D] dark:text-[#4ADE80]">
                {formatEUR(furnitureSummary.totalSpent)}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Carrito IKEA ({furnitureSummary.cartCount} artículos)
                </p>
                <p className="font-display text-xl font-bold tabular-nums mt-1 text-[#0E5A64] dark:text-[#5EEAD4]">
                  {formatEUR(furnitureSummary.totalCart)}
                </p>
              </div>
              <ShoppingCart className="w-6 h-6 text-[#0E5A64] dark:text-[#5EEAD4]" />
            </div>
          </div>

          {/* Search, Filters, Sorting, Bulk Actions */}
          <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <div className="flex flex-col md:flex-row gap-2.5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  aria-label="Buscar muebles"
                  value={furnitureSearch}
                  onChange={(e) => setFurnitureSearch(e.target.value)}
                  placeholder="Buscar por nombre, tienda o referencia..."
                  className="w-full min-h-[44px] pl-10 pr-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-[#F6F8F8] dark:bg-slate-900 text-sm"
                />
              </div>

              <button
                type="button"
                onClick={() => openFurnitureModal(null)}
                className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>Añadir mueble</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filtrar por estancia"
                value={roomFilter}
                onChange={(e) => setRoomFilter(e.target.value as FurnitureRoom | 'todas')}
                className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
              >
                <option value="todas">Todas las estancias</option>
                {(Object.keys(ROOM_LABELS) as FurnitureRoom[]).map((r) => (
                  <option key={r} value={r}>
                    {ROOM_LABELS[r]}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filtrar por prioridad"
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value as FurniturePriority | 'todas')}
                className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
              >
                <option value="todas">Todas las prioridades</option>
                {(Object.keys(PRIORITY_LABELS) as FurniturePriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filtrar por estado"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as FurnitureStatus | 'todos')}
                className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
              >
                <option value="todos">Todos los estados</option>
                {(Object.keys(FURNITURE_STATUS_LABELS) as FurnitureStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {FURNITURE_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1 ml-auto">
                <select
                  aria-label="Ordenar mobiliario"
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as FurnitureSortField)}
                  className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
                >
                  <option value="room">Ordenar: Estancia</option>
                  <option value="name">Ordenar: Nombre</option>
                  <option value="price">Ordenar: Precio</option>
                  <option value="status">Ordenar: Estado</option>
                </select>
                <button
                  type="button"
                  aria-label="Invertir orden"
                  onClick={() => setSortAsc((prev) => !prev)}
                  className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300"
                >
                  <ArrowUpDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Bulk toolbar */}
            {filteredFurniture.length > 0 && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <label className="flex items-center gap-2 cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFurnitureIds(new Set(filteredFurniture.map((it) => it.id)));
                      } else {
                        setSelectedFurnitureIds(new Set());
                      }
                    }}
                    className="w-4 h-4 accent-[#0E5A64]"
                  />
                  <span>Seleccionar visibles ({filteredFurniture.length})</span>
                </label>

                {selectedFurnitureIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setBulkDeleteConfirmOpen(true)}
                    className="min-h-[36px] px-3 rounded-xl bg-[#DC4C3E] text-white font-semibold flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Eliminar seleccionados ({selectedFurnitureIds.size})</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {filteredFurniture.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
              <p className="text-sm font-semibold">No hay artículos con esos filtros</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Cambia los filtros o añade un artículo nuevo.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filteredFurniture.map((item) => {
                const lineTotal = item.unitPrice * item.qty;
                const isInlineEditing = inlineFurId === item.id;
                const isSelected = selectedFurnitureIds.has(item.id);
                return (
                  <article
                    key={item.id}
                    className={`rounded-2xl bg-white dark:bg-[#132025] border p-4 space-y-3 ${
                      isSelected
                        ? 'border-[#0E5A64] ring-1 ring-[#0E5A64]/30'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${item.name}`}
                          checked={isSelected}
                          onChange={(e) => {
                            setSelectedFurnitureIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(item.id);
                              else next.delete(item.id);
                              return next;
                            });
                          }}
                          className="w-4 h-4 mt-1 accent-[#0E5A64] shrink-0"
                        />
                        <div className="min-w-0">
                          <h3 className="text-base font-bold truncate">
                            {item.name} {item.qty > 1 ? `×${item.qty}` : ''}
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {ROOM_LABELS[item.room]} · {PRIORITY_LABELS[item.priority]}
                            {item.store ? ` · ${item.store}` : ''}
                            {item.articleNumber ? ` · Ref. ${item.articleNumber}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          title="Edición rápida de precio y cantidad"
                          onClick={() => {
                            if (isInlineEditing) {
                              setInlineFurId(null);
                            } else {
                              setInlineFurId(item.id);
                              setInlineFurPrice(String(item.unitPrice));
                              setInlineFurQty(String(item.qty));
                            }
                          }}
                          className="font-mono-num text-sm font-bold px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          {item.unitPrice > 0 ? formatEUR(lineTotal) : 'Sin precio'}
                        </button>
                        <button
                          type="button"
                          aria-label={`Editar ${item.name}`}
                          onClick={() => openFurnitureModal(item)}
                          className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Eliminar ${item.name}`}
                          onClick={() => setDeleteTarget({ kind: 'furniture', item })}
                          className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-slate-400 hover:text-[#DC4C3E]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {isInlineEditing && (
                      <div className="rounded-xl bg-[#F6F8F8] dark:bg-slate-900 p-3 flex flex-wrap items-end gap-2">
                        <div>
                          <label className="block text-[11px] font-medium mb-1">Precio (€)</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={inlineFurPrice}
                            onChange={(e) => setInlineFurPrice(e.target.value)}
                            className="w-24 min-h-[38px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] font-mono-num text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium mb-1">Uds.</label>
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={inlineFurQty}
                            onChange={(e) => setInlineFurQty(e.target.value)}
                            className="w-16 min-h-[38px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025] text-xs"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleSaveInlineFurniture(item)}
                          className="min-h-[38px] px-3 rounded-lg bg-[#0E5A64] text-white text-xs font-semibold"
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={() => setInlineFurId(null)}
                          className="min-h-[38px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}

                    {/* 1-tap status chips */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      {(Object.keys(FURNITURE_STATUS_LABELS) as FurnitureStatus[]).map((st) => {
                        const active = item.status === st;
                        return (
                          <button
                            key={st}
                            type="button"
                            onClick={() =>
                              householdId &&
                              currentUserProfile &&
                              void repo.updateFurnitureStatus(householdId, item, st, currentUserProfile)
                            }
                            className={`min-h-[40px] px-2 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1 whitespace-nowrap ${
                              active
                                ? st === 'comprado' || st === 'ya_lo_tenemos'
                                  ? 'bg-[#15803D] text-white'
                                  : st === 'en_carrito'
                                    ? 'bg-[#0E5A64] text-white'
                                    : 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                                : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                          >
                            {active && <Check className="w-3 h-3 shrink-0" />}
                            <span className="truncate">{FURNITURE_STATUS_LABELS[st]}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* IKEA Search + Product Link */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <a
                        href={buildIkeaSearchUrl(item.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Buscar en IKEA</span>
                      </a>
                      {item.productUrl && (
                        <a
                          href={item.productUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 inline-flex items-center gap-1.5"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Ver ficha guardada</span>
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal: Initial Cost */}
      {costModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cost-modal-title"
        >
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h2 id="cost-modal-title" className="font-display text-lg font-bold">
              {editingCost ? 'Editar gasto inicial' : 'Nuevo gasto inicial'}
            </h2>
            <form onSubmit={handleSaveCost} className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Concepto</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={costConcept}
                  onChange={(e) => setCostConcept(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Categoría</label>
                  <select
                    value={costCategory}
                    onChange={(e) => setCostCategory(e.target.value as InitialCostCategory)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    {(Object.keys(INITIAL_COST_CATEGORY_LABELS) as InitialCostCategory[]).map((cat) => (
                      <option key={cat} value={cat}>
                        {INITIAL_COST_CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Importe (€)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={costAmount}
                    onChange={(e) => setCostAmount(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Pagado por</label>
                  <select
                    value={costPaidBy}
                    onChange={(e) => setCostPaidBy(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    <option value={COMMON_ACCOUNT_ID}>Cuenta común</option>
                    {memberA && <option value={memberA.uid}>{nameA}</option>}
                    {memberB && <option value={memberB.uid}>{nameB}</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Estado</label>
                  <select
                    value={costStatus}
                    onChange={(e) => setCostStatus(e.target.value as 'pendiente' | 'pagado')}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    <option value="pendiente">Pendiente</option>
                    <option value="pagado">Pagado</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Fecha límite (opcional)</label>
                <input
                  type="date"
                  value={costDueDate}
                  onChange={(e) => setCostDueDate(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Notas</label>
                <input
                  type="text"
                  maxLength={500}
                  value={costNotes}
                  onChange={(e) => setCostNotes(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCostModalOpen(false)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] text-white text-sm font-semibold"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Furniture Item (Avanzado full form) */}
      {itemModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="furniture-modal-title"
        >
          <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 id="furniture-modal-title" className="font-display text-lg font-bold">
              {editingItem ? 'Editar artículo' : 'Nuevo mueble / electrodoméstico'}
            </h2>
            <form onSubmit={handleSaveFurniture} className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Nombre</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Estancia</label>
                  <select
                    value={itemRoom}
                    onChange={(e) => setItemRoom(e.target.value as FurnitureRoom)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    {(Object.keys(ROOM_LABELS) as FurnitureRoom[]).map((r) => (
                      <option key={r} value={r}>
                        {ROOM_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Prioridad</label>
                  <select
                    value={itemPriority}
                    onChange={(e) => setItemPriority(e.target.value as FurniturePriority)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    {(Object.keys(PRIORITY_LABELS) as FurniturePriority[]).map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Precio unit. (€)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={itemPrice}
                    onChange={(e) => setItemPrice(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-num text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Cantidad</label>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={itemQty}
                    onChange={(e) => setItemQty(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Tienda</label>
                  <input
                    type="text"
                    maxLength={60}
                    value={itemStore}
                    onChange={(e) => setItemStore(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Enlace producto (IKEA u otra)</label>
                  <input
                    type="url"
                    maxLength={500}
                    value={itemUrl}
                    onChange={(e) => setItemUrl(e.target.value)}
                    placeholder="https://www.ikea.com/es/es/..."
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Referencia / Artículo</label>
                  <input
                    type="text"
                    maxLength={40}
                    value={itemArticle}
                    onChange={(e) => setItemArticle(e.target.value)}
                    placeholder="Ej. 304.914.52"
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Notas (medidas, color...)</label>
                <input
                  type="text"
                  maxLength={500}
                  value={itemNotes}
                  onChange={(e) => setItemNotes(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setItemModalOpen(false)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] text-white text-sm font-semibold"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Confirmar eliminación"
        description={
          deleteTarget?.kind === 'cost'
            ? `Vas a eliminar el gasto inicial "${deleteTarget.item.concept}". Podrás deshacerlo durante 5 segundos.`
            : deleteTarget?.kind === 'furniture'
              ? `Vas a eliminar "${deleteTarget.item.name}" de la lista de mobiliario. Podrás deshacerlo durante 5 segundos.`
              : `Vas a eliminar la tarea "${deleteTarget?.text ?? ''}" del checklist.`
        }
        confirmLabel="Eliminar"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        title="Eliminar artículos seleccionados"
        description={`Se eliminarán ${selectedFurnitureIds.size} artículos de mobiliario de forma permanente.`}
        confirmLabel={`Eliminar ${selectedFurnitureIds.size}`}
        onConfirm={() => void handleConfirmBulkDeleteFurniture()}
        onCancel={() => setBulkDeleteConfirmOpen(false)}
      />
    </div>
  );
};
