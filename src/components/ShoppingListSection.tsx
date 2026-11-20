import React, { useMemo, useState } from 'react';
import { Check, Minus, Plus, ShoppingBasket, ShoppingCart, Trash2, X } from 'lucide-react';
import { useNido } from '../context/NidoContext';
import { toUserFriendlyErrorMessage } from '../services/firebase';
import { MAX_LENGTHS, type ShoppingItem } from '../types/nido';

interface ShoppingListSectionProps {
  open: boolean;
  onClose: () => void;
}

export const ShoppingListSection: React.FC<ShoppingListSectionProps> = ({ open, onClose }) => {
  const {
    householdId,
    shoppingItems,
    members,
    currentUserProfile,
    repo,
    showToast,
    openQuickExpenseWithPrefill,
  } = useNido();

  const [newText, setNewText] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingItems = useMemo(
    () => shoppingItems.filter((item) => !item.done),
    [shoppingItems]
  );
  const checkedItems = useMemo(
    () => shoppingItems.filter((item) => item.done),
    [shoppingItems]
  );

  if (!open) return null;

  const memberName = (uid: string) =>
    members.find((m) => m.uid === uid)?.displayName?.split(' ')[0] || '';

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId || !currentUserProfile) return;
    const clean = newText.trim().slice(0, MAX_LENGTHS.shoppingText);
    if (!clean) return;
    const qty = Math.max(1, Math.min(999, Math.round(Number(newQty) || 1)));
    setSubmitting(true);
    setError(null);
    try {
      await repo.upsertShoppingItem(
        householdId,
        { text: clean, qty, done: false },
        currentUserProfile
      );
      setNewText('');
      setNewQty('1');
    } catch (err) {
      setError(
        toUserFriendlyErrorMessage(err, 'No se pudo añadir el artículo a la lista de la compra.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleDone = async (item: ShoppingItem) => {
    if (!householdId || !currentUserProfile) return;
    setBusyId(item.id);
    setError(null);
    try {
      await repo.upsertShoppingItem(
        householdId,
        { id: item.id, text: item.text, qty: item.qty, done: !item.done },
        currentUserProfile
      );
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo actualizar el artículo.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleChangeQty = async (item: ShoppingItem, delta: number) => {
    if (!householdId || !currentUserProfile) return;
    const nextQty = Math.max(1, Math.min(999, item.qty + delta));
    if (nextQty === item.qty) return;
    setBusyId(item.id);
    setError(null);
    try {
      await repo.upsertShoppingItem(
        householdId,
        { id: item.id, text: item.text, qty: nextQty, done: item.done },
        currentUserProfile
      );
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo actualizar la cantidad.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteItem = async (item: ShoppingItem) => {
    if (!householdId) return;
    setBusyId(item.id);
    setError(null);
    try {
      await repo.deleteShoppingItem(householdId, item.id);
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo eliminar el artículo.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleConvertToExpense = () => {
    if (!householdId || checkedItems.length === 0) return;
    const checkedIds = checkedItems.map((i) => i.id);
    const itemsList = checkedItems
      .map((i) => (i.qty > 1 ? `${i.text} (x${i.qty})` : i.text))
      .join(', ');
    const notes = `Lista de la compra: ${itemsList}`.slice(0, MAX_LENGTHS.notes);

    onClose();
    openQuickExpenseWithPrefill(
      {
        category: 'supermercado',
        concept: 'Compra supermercado',
        notes,
      },
      async () => {
        await repo.deleteShoppingItemsBulk(householdId, checkedIds);
        showToast('Compra convertida en gasto y artículos limpiados');
      }
    );
  };

  const renderRow = (item: ShoppingItem) => {
    const busy = busyId === item.id;
    const addedName = memberName(item.addedBy);
    return (
      <li
        key={item.id}
        className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            type="button"
            disabled={busy}
            aria-label={
              item.done ? `Desmarcar ${item.text}` : `Marcar ${item.text} como comprado`
            }
            onClick={() => void handleToggleDone(item)}
            className={`min-h-[44px] min-w-[44px] rounded-xl border flex items-center justify-center shrink-0 transition-colors ${
              item.done
                ? 'border-[#15803D] bg-[#15803D] text-white'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-[#0E5A64]'
            }`}
          >
            {item.done && <Check className="w-5 h-5" />}
          </button>

          <div className="min-w-0 flex-1">
            <p
              className={`text-sm font-semibold truncate ${
                item.done
                  ? 'line-through text-slate-500 dark:text-slate-400'
                  : 'text-[#0F1F24] dark:text-[#F0F5F6]'
              }`}
            >
              {item.text}
            </p>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Cantidad: {item.qty}
              {addedName ? ` · Añadido por ${addedName}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!item.done && (
            <>
              <button
                type="button"
                disabled={busy || item.qty <= 1}
                aria-label={`Restar cantidad de ${item.text}`}
                onClick={() => void handleChangeQty(item, -1)}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 disabled:opacity-40"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-6 text-center text-xs font-bold tabular-nums">{item.qty}</span>
              <button
                type="button"
                disabled={busy}
                aria-label={`Sumar cantidad de ${item.text}`}
                onClick={() => void handleChangeQty(item, 1)}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200"
              >
                <Plus className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            type="button"
            disabled={busy}
            aria-label={`Eliminar ${item.text}`}
            onClick={() => void handleDeleteItem(item)}
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-[#B42318] dark:hover:text-[#FCA5A5]"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </li>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shopping-list-title"
    >
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center">
              <ShoppingCart className="w-5 h-5" />
            </span>
            <div>
              <h2 id="shopping-list-title" className="font-display text-lg font-bold">
                Lista de la compra
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {pendingItems.length} por comprar · {checkedItems.length} en el carro
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar lista de la compra"
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl bg-[#DC4C3E]/10 text-[#B42318] dark:text-[#FCA5A5] px-3.5 py-2.5 text-xs font-medium shrink-0"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleAdd} className="flex gap-2 shrink-0">
          <input
            type="text"
            aria-label="Artículo para comprar"
            maxLength={MAX_LENGTHS.shoppingText}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Añadir producto (ej. Leche, pan...)"
            className="flex-1 min-h-[46px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          />
          <input
            type="number"
            aria-label="Cantidad"
            min={1}
            max={999}
            value={newQty}
            onChange={(e) => setNewQty(e.target.value)}
            className="w-16 min-h-[46px] px-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-center font-semibold tabular-nums"
          />
          <button
            type="submit"
            disabled={submitting || !newText.trim()}
            className="min-h-[46px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-40 text-white text-sm font-semibold flex items-center gap-1 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Añadir</span>
          </button>
        </form>

        <div className="flex-1 overflow-y-auto space-y-4 pr-0.5">
          {shoppingItems.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <ShoppingBasket className="w-10 h-10 text-slate-400 dark:text-slate-500 mx-auto" />
              <p className="text-sm font-semibold">La lista está vacía</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Apunta lo que falte en casa; se sincroniza al momento con tu pareja y luego puedes convertirlo en un gasto de supermercado.
              </p>
            </div>
          ) : (
            <>
              {pendingItems.length > 0 && (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {pendingItems.map(renderRow)}
                </ul>
              )}
              {checkedItems.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Marcados en el carro ({checkedItems.length})
                  </p>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {checkedItems.map(renderRow)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-2 shrink-0">
          <button
            type="button"
            disabled={checkedItems.length === 0}
            onClick={handleConvertToExpense}
            className="w-full min-h-[48px] px-4 rounded-xl bg-[#15803D] hover:bg-[#166534] disabled:opacity-40 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>
              {checkedItems.length > 0
                ? `Convertir en gasto (${checkedItems.length})`
                : 'Marca artículos para convertir en gasto'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
