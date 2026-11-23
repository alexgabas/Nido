import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Lock,
  Settings2,
  Upload,
  X,
} from 'lucide-react';
import { useNido } from '../context/NidoContext';
import {
  isCustomCategoryId,
  isSystemExpenseCategory,
} from '../domain/categories';
import {
  buildParsedBankRows,
  detectCsvDelimiter,
  guessCsvColumns,
  parseCsvMatrix,
  resolveKeywordsMap,
  suggestKeywordTokenFromDescription,
  type CsvColumnMapping,
  type CsvDelimiter,
} from '../domain/csvImport';
import { formatDateES, formatEUR } from '../domain/finance';
import { DEFAULT_CSV_KEYWORDS, EXPENSE_CATEGORY_LABELS } from '../domain/presets';
import type { BankCsvImportItem } from '../repositories/HouseholdRepository';
import { toUserFriendlyErrorMessage } from '../services/firebase';
import {
  COMMON_ACCOUNT_ID,
  type CsvCategoryKeywords,
  type ExpenseCategory,
  type Transaction,
} from '../types/nido';

interface BankCsvImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported?: (count: number) => void;
}

interface RowOverride {
  selected?: boolean;
  category?: ExpenseCategory;
  isPrivate?: boolean;
}

export const BankCsvImportModal: React.FC<BankCsvImportModalProps> = ({
  open,
  onClose,
  onImported,
}) => {
  const {
    household,
    householdId,
    memberA,
    memberB,
    currentUserProfile,
    effectiveSplitPctA,
    monthClosures,
    recentTransactions,
    customCategories,
    categoryRegistry,
    repo,
    showToast,
  } = useNido();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [rawText, setRawText] = useState('');
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(';');
  const [hasHeader, setHasHeader] = useState(true);
  const [ignoreIncome, setIgnoreIncome] = useState(true);
  const [defaultPaidBy, setDefaultPaidBy] = useState<string>(COMMON_ACCOUNT_ID);
  const [mapping, setMapping] = useState<CsvColumnMapping>({
    dateIndex: 0,
    conceptIndex: 1,
    amountIndex: 2,
  });
  const [rowOverrides, setRowOverrides] = useState<Record<number, RowOverride>>({});

  // Editable keyword rules
  const [keywordsOpen, setKeywordsOpen] = useState(false);
  const [draftKeywords, setDraftKeywords] = useState<Record<ExpenseCategory, string>>(() =>
    resolveKeywordsMap(household?.csvKeywords, customCategories)
  );
  const [savingKeywords, setSavingKeywords] = useState(false);
  const [keywordPrompt, setKeywordPrompt] = useState<{
    rowIndex: number;
    keyword: string;
    targetCategory: ExpenseCategory;
  } | null>(null);
  const [savingQuickKeyword, setSavingQuickKeyword] = useState(false);

  // Full history for accurate duplicate detection
  const [historyTx, setHistoryTx] = useState<Transaction[]>(recentTransactions);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDraftKeywords(resolveKeywordsMap(household?.csvKeywords, customCategories));
    setRowOverrides({});
    setKeywordPrompt(null);
    setDefaultPaidBy(COMMON_ACCOUNT_ID);
  }, [open, household?.csvKeywords, customCategories]);

  useEffect(() => {
    if (!open || !householdId || !currentUserProfile) return;
    let cancelled = false;
    setLoadingHistory(true);
    repo
      .fetchAllTransactions(householdId, currentUserProfile.uid)
      .then((txs) => {
        if (!cancelled) setHistoryTx(txs);
      })
      .catch(() => {
        if (!cancelled) setHistoryTx(recentTransactions);
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, householdId, currentUserProfile, repo, recentTransactions]);

  const closedMonthKeys = useMemo(
    () => new Set(monthClosures.map((c) => c.monthKey)),
    [monthClosures]
  );

  const matrix = useMemo(() => {
    if (!rawText.trim()) return [];
    return parseCsvMatrix(rawText, delimiter);
  }, [rawText, delimiter]);

  const headers = useMemo(() => {
    if (matrix.length === 0) return [];
    const first = matrix[0];
    if (hasHeader) return first.map((h, i) => h || `Columna ${i + 1}`);
    return first.map((_, i) => `Columna ${i + 1}`);
  }, [matrix, hasHeader]);

  const dataRows = useMemo(() => {
    if (matrix.length === 0) return [];
    return hasHeader ? matrix.slice(1) : matrix;
  }, [matrix, hasHeader]);

  const parsedRows = useMemo(() => {
    if (dataRows.length === 0) return [];
    return buildParsedBankRows(dataRows, mapping, historyTx, draftKeywords, customCategories);
  }, [dataRows, mapping, historyTx, draftKeywords, customCategories]);

  const isRowDisabled = (rowIndex: number): { disabled: boolean; reason: string | null } => {
    const row = parsedRows[rowIndex];
    if (!row) return { disabled: true, reason: 'Fila no válida' };
    if (row.error) return { disabled: true, reason: row.error };
    if (row.monthKey && closedMonthKeys.has(row.monthKey)) {
      return { disabled: true, reason: 'Mes cerrado' };
    }
    if (ignoreIncome && row.isIncome) {
      return { disabled: true, reason: 'Ingreso ignorado' };
    }
    return { disabled: false, reason: null };
  };

  const getRowSelected = (rowIndex: number): boolean => {
    const row = parsedRows[rowIndex];
    if (!row) return false;
    const status = isRowDisabled(rowIndex);
    if (status.disabled) return false;
    const override = rowOverrides[rowIndex];
    if (override?.selected !== undefined) return override.selected;
    return !row.isDuplicate;
  };

  const getRowCategory = (rowIndex: number): ExpenseCategory => {
    const override = rowOverrides[rowIndex];
    if (override?.category) return override.category;
    return parsedRows[rowIndex]?.suggestedCategory ?? 'otros';
  };

  const getRowPrivate = (rowIndex: number): boolean => {
    return Boolean(rowOverrides[rowIndex]?.isPrivate);
  };

  const selectedCount = useMemo(
    () => parsedRows.filter((_, idx) => getRowSelected(idx)).length,
    [parsedRows, rowOverrides, ignoreIncome, closedMonthKeys]
  );

  if (!open) return null;

  const loadCsvContent = (text: string) => {
    setError(null);
    const detected = detectCsvDelimiter(text);
    setDelimiter(detected);
    setRawText(text);
    setRowOverrides({});
    const parsed = parseCsvMatrix(text, detected);
    if (parsed.length > 0) {
      setMapping(guessCsvColumns(parsed[0]));
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const content = await file.text();
      loadCsvContent(content);
    } catch {
      setError('No se pudo leer el archivo CSV.');
    }
  };

  const handleSaveKeywords = async () => {
    if (!householdId || !currentUserProfile) return;
    setSavingKeywords(true);
    setError(null);
    try {
      const systemPayload: CsvCategoryKeywords = {};
      for (const sysCat of Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]) {
        if (isSystemExpenseCategory(sysCat) && typeof draftKeywords[sysCat] === 'string') {
          systemPayload[sysCat] = draftKeywords[sysCat];
        }
      }
      await repo.updateCsvKeywords(householdId, systemPayload);

      for (const customCat of customCategories) {
        if (customCat.archived) continue;
        const nextKw = (draftKeywords[customCat.id] ?? '').trim();
        if (nextKw !== (customCat.csvKeywords ?? '').trim()) {
          await repo.upsertCustomCategory(
            householdId,
            {
              id: customCat.id,
              name: customCat.name,
              color: customCat.color,
              icon: customCat.icon,
              archived: customCat.archived,
              order: customCat.order,
              csvKeywords: nextKw,
            },
            currentUserProfile
          );
        }
      }
      showToast('Reglas de palabras clave guardadas');
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudieron guardar las reglas.'));
    } finally {
      setSavingKeywords(false);
    }
  };

  const handleConfirmQuickKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId || !keywordPrompt || !currentUserProfile) return;
    const cleanKw = keywordPrompt.keyword.trim().toLowerCase();
    if (cleanKw.length < 2) {
      setError('Escribe una palabra clave de al menos 2 caracteres.');
      return;
    }
    const cat = keywordPrompt.targetCategory;
    const existingList = (draftKeywords[cat] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const alreadyExists = existingList.some((item) => item.toLowerCase() === cleanKw);
    const nextList = alreadyExists ? existingList : [...existingList, cleanKw];
    const nextKwString = nextList.join(', ');
    const nextKeywords: Record<ExpenseCategory, string> = {
      ...draftKeywords,
      [cat]: nextKwString,
    };

    setSavingQuickKeyword(true);
    setError(null);
    try {
      if (isCustomCategoryId(cat)) {
        const targetCustom = customCategories.find((c) => c.id === cat);
        if (!targetCustom) {
          throw new Error('No se encontró la categoría personalizada.');
        }
        await repo.upsertCustomCategory(
          householdId,
          {
            id: targetCustom.id,
            name: targetCustom.name,
            color: targetCustom.color,
            icon: targetCustom.icon,
            archived: targetCustom.archived,
            order: targetCustom.order,
            csvKeywords: nextKwString,
          },
          currentUserProfile
        );
      } else {
        const systemPayload: CsvCategoryKeywords = {};
        for (const sysCat of Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]) {
          if (isSystemExpenseCategory(sysCat) && typeof nextKeywords[sysCat] === 'string') {
            systemPayload[sysCat] = nextKeywords[sysCat];
          }
        }
        await repo.updateCsvKeywords(householdId, systemPayload);
      }
      setDraftKeywords(nextKeywords);
      setKeywordPrompt(null);
      showToast(
        `Palabra clave «${cleanKw}» guardada para ${categoryRegistry.getLabel(cat)}`
      );
    } catch (err) {
      setError(toUserFriendlyErrorMessage(err, 'No se pudo guardar la palabra clave.'));
    } finally {
      setSavingQuickKeyword(false);
    }
  };

  const handleImport = async () => {
    if (!householdId || !currentUserProfile) return;
    const items: BankCsvImportItem[] = [];
    for (let i = 0; i < parsedRows.length; i++) {
      if (!getRowSelected(i)) continue;
      const row = parsedRows[i];
      if (!row.dateISO || !row.monthKey) continue;
      const isPriv = getRowPrivate(i);
      items.push({
        monthKey: row.monthKey,
        concept: row.concept,
        category: getRowCategory(i),
        amount: row.absAmount,
        date: row.dateISO,
        paidBy: isPriv ? currentUserProfile.uid : defaultPaidBy,
        splitPctA: effectiveSplitPctA,
        isPrivate: isPriv,
        notes: 'Importado desde CSV bancario',
      });
    }
    if (items.length === 0) return;

    setImporting(true);
    setError(null);
    try {
      const count = await repo.importBankTransactions(householdId, items, currentUserProfile);
      showToast(`Importados ${count} gastos del extracto`);
      onImported?.(count);
      onClose();
    } catch (err) {
      setError(
        toUserFriendlyErrorMessage(err, 'No se pudo completar la importación del CSV.')
      );
    } finally {
      setImporting(false);
    }
  };

  const nameA = memberA?.displayName?.trim() || 'Persona A';
  const nameB = memberB?.displayName?.trim() || 'Pareja';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-import-title"
    >
      <div className="w-full sm:max-w-4xl rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#132025] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl bg-[#0E5A64]/10 text-[#0E5A64] dark:text-[#5EEAD4] flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </span>
            <div>
              <h2 id="csv-import-title" className="font-display text-lg font-bold">
                Importar extracto bancario (CSV)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Detecta ; o , y decimales con coma, evita duplicados y sugiere categorías.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar importador CSV"
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

        <div className="flex-1 overflow-y-auto space-y-4 pr-0.5">
          {/* Upload / Paste CSV */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#F6F8F8] dark:bg-slate-900/60 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={(e) => void handleFileChange(e)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                <span>Subir archivo CSV</span>
              </button>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-600 dark:text-slate-400">Separador:</span>
                {([';', ','] as const).map((del) => (
                  <button
                    key={del}
                    type="button"
                    onClick={() => setDelimiter(del)}
                    className={`min-h-[44px] px-3 rounded-lg border font-mono font-bold ${
                      delimiter === del
                        ? 'border-[#0E5A64] bg-[#0E5A64] text-white'
                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-[#132025]'
                    }`}
                  >
                    {del === ';' ? 'Punto y coma (;)' : 'Coma (,)'}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              aria-label="O pega aquí el contenido del CSV"
              rows={3}
              value={rawText}
              onChange={(e) => loadCsvContent(e.target.value)}
              placeholder="O pega aquí las líneas de tu extracto (Fecha;Concepto;Importe)..."
              className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs"
            />
          </div>

          {/* Column mapping & import options */}
          {headers.length > 0 && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label htmlFor="csv-col-date" className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                    Columna Fecha
                  </label>
                  <select
                    id="csv-col-date"
                    value={mapping.dateIndex}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, dateIndex: Number(e.target.value) }))
                    }
                    className="w-full min-h-[44px] px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  >
                    {headers.map((h, idx) => (
                      <option key={idx} value={idx}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="csv-col-concept" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Columna Concepto
                  </label>
                  <select
                    id="csv-col-concept"
                    value={mapping.conceptIndex}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, conceptIndex: Number(e.target.value) }))
                    }
                    className="w-full min-h-[44px] px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  >
                    {headers.map((h, idx) => (
                      <option key={idx} value={idx}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="csv-col-amount" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Columna Importe
                  </label>
                  <select
                    id="csv-col-amount"
                    value={mapping.amountIndex}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, amountIndex: Number(e.target.value) }))
                    }
                    className="w-full min-h-[44px] px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  >
                    {headers.map((h, idx) => (
                      <option key={idx} value={idx}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="csv-default-payer" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Pagador por defecto
                  </label>
                  <select
                    id="csv-default-payer"
                    value={defaultPaidBy}
                    onChange={(e) => setDefaultPaidBy(e.target.value)}
                    className="w-full min-h-[44px] px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  >
                    <option value={COMMON_ACCOUNT_ID}>Cuenta común</option>
                    {memberA && <option value={memberA.uid}>{nameA}</option>}
                    {memberB && <option value={memberB.uid}>{nameB}</option>}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1 text-xs">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasHeader}
                    onChange={(e) => setHasHeader(e.target.checked)}
                    className="w-4 h-4 accent-[#0E5A64]"
                  />
                  <span>La primera fila son cabeceras</span>
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ignoreIncome}
                    onChange={(e) => setIgnoreIncome(e.target.checked)}
                    className="w-4 h-4 accent-[#0E5A64]"
                  />
                  <span>Ignorar ingresos / importes positivos</span>
                </label>
              </div>
            </div>
          )}

          {/* Editable Keyword Rules */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <button
              type="button"
              onClick={() => setKeywordsOpen((o) => !o)}
              className="w-full min-h-[44px] flex items-center justify-between text-xs font-bold text-[#0F1F24] dark:text-[#F0F5F6]"
            >
              <span className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-[#0E5A64] dark:text-[#5EEAD4]" />
                <span>Reglas de categoría por palabras clave (editables)</span>
              </span>
              {keywordsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {keywordsOpen && (
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Separa las palabras clave con comas (ej. «MERCADONA, BONPREU, CONSUM»). Se aplican al instante sobre la vista previa.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {categoryRegistry.activeCategories
                    .filter((cat) => cat.id !== 'otros')
                    .map((cat) => (
                      <div key={cat.id}>
                        <label
                          htmlFor={`kw-${cat.id}`}
                          className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1"
                        >
                          {cat.label}
                        </label>
                        <input
                          id={`kw-${cat.id}`}
                          type="text"
                          maxLength={300}
                          value={draftKeywords[cat.id] ?? ''}
                          onChange={(e) =>
                            setDraftKeywords((prev) => ({ ...prev, [cat.id]: e.target.value }))
                          }
                          className="w-full min-h-[44px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        />
                      </div>
                    ))}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setDraftKeywords(resolveKeywordsMap(DEFAULT_CSV_KEYWORDS, customCategories))
                    }
                    className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                  >
                    Restaurar por defecto
                  </button>
                  <button
                    type="button"
                    disabled={savingKeywords}
                    onClick={() => void handleSaveKeywords()}
                    className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {savingKeywords ? 'Guardando...' : 'Guardar reglas en el hogar'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Preview Rows */}
          {parsedRows.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold">
                  Vista previa ({parsedRows.length} filas · {selectedCount} seleccionadas para importar)
                </p>
                {loadingHistory && (
                  <span className="text-[11px] text-slate-500">Comprobando duplicados...</span>
                )}
              </div>

              {keywordPrompt && (
                <form
                  onSubmit={handleConfirmQuickKeyword}
                  className="rounded-2xl border border-[#0E5A64]/35 bg-[#0E5A64]/6 dark:bg-[#2AA1AE]/10 p-3.5 space-y-2.5"
                >
                  <p className="text-xs font-bold text-[#0F1F24] dark:text-[#F0F5F6]">
                    Recordar palabra clave para «{categoryRegistry.getLabel(keywordPrompt.targetCategory)}»
                  </p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                    Revisa o acorta el término antes de guardarlo en las reglas del hogar (evita fechas o referencias variables):
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      aria-label="Palabra clave a recordar"
                      maxLength={40}
                      value={keywordPrompt.keyword}
                      onChange={(e) =>
                        setKeywordPrompt((prev) =>
                          prev ? { ...prev, keyword: e.target.value } : null
                        )
                      }
                      placeholder="Ej. mercadona, endesa..."
                      className="flex-1 min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={savingQuickKeyword}
                        className="min-h-[44px] px-4 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] text-white text-xs font-semibold disabled:opacity-50"
                      >
                        {savingQuickKeyword ? 'Guardando...' : 'Guardar regla'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setKeywordPrompt(null)}
                        className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                </form>
              )}

              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-2xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 px-3">Importar</th>
                      <th className="py-2.5 px-2">Fecha</th>
                      <th className="py-2.5 px-2">Concepto</th>
                      <th className="py-2.5 px-2 text-right">Importe</th>
                      <th className="py-2.5 px-2">Categoría</th>
                      <th className="py-2.5 px-3 text-center">Privado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {parsedRows.map((row, idx) => {
                      const status = isRowDisabled(idx);
                      const checked = getRowSelected(idx);
                      const cat = getRowCategory(idx);
                      const priv = getRowPrivate(idx);
                      return (
                        <tr
                          key={row.rowIndex}
                          className={status.disabled ? 'opacity-50 bg-slate-50/50 dark:bg-slate-900/30' : undefined}
                        >
                          <td className="py-2 px-3">
                            <input
                              type="checkbox"
                              aria-label={`Importar fila ${idx + 1}`}
                              disabled={status.disabled}
                              checked={checked}
                              onChange={(e) =>
                                setRowOverrides((prev) => ({
                                  ...prev,
                                  [idx]: { ...prev[idx], selected: e.target.checked },
                                }))
                              }
                              className="w-4 h-4 accent-[#0E5A64]"
                            />
                          </td>
                          <td className="py-2 px-2 whitespace-nowrap">
                            {row.dateISO ? formatDateES(row.dateISO) : row.rawDate || '—'}
                          </td>
                          <td className="py-2 px-2 min-w-[170px]">
                            <p className="font-semibold truncate max-w-[230px]">
                              {row.concept || row.rawConcept || '—'}
                            </p>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {status.reason && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-semibold">
                                  {status.reason}
                                </span>
                              )}
                              {row.isDuplicate && !status.disabled && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-800 dark:text-amber-300 text-[10px] font-semibold">
                                  <AlertTriangle className="w-2.5 h-2.5" />
                                  <span>Posible duplicado</span>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-2 text-right font-mono-num font-bold whitespace-nowrap">
                            {row.signedAmount !== null
                              ? `${row.isIncome ? '+' : '-'}${formatEUR(row.absAmount)}`
                              : row.rawAmount || '—'}
                          </td>
                          <td className="py-2 px-2">
                            <div className="flex flex-col gap-1 items-start">
                              <select
                                aria-label={`Categoría fila ${idx + 1}`}
                                disabled={status.disabled}
                                value={cat}
                                onChange={(e) => {
                                  const nextCat = e.target.value as ExpenseCategory;
                                  setRowOverrides((prev) => ({
                                    ...prev,
                                    [idx]: {
                                      ...prev[idx],
                                      category: nextCat,
                                    },
                                  }));
                                  if (nextCat === row.suggestedCategory || nextCat === 'otros') {
                                    if (keywordPrompt?.rowIndex === idx) setKeywordPrompt(null);
                                  }
                                }}
                                className="min-h-[44px] px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                              >
                                {(categoryRegistry.activeCategories.some((c) => c.id === cat)
                                  ? categoryRegistry.activeCategories
                                  : [...categoryRegistry.activeCategories, categoryRegistry.getMeta(cat)]
                                ).map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.archived ? `${c.label} (Archivada)` : c.label}
                                  </option>
                                ))}
                              </select>
                              {!status.disabled &&
                                cat !== 'otros' &&
                                cat !== row.suggestedCategory && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setKeywordPrompt({
                                        rowIndex: idx,
                                        keyword:
                                          suggestKeywordTokenFromDescription(row.concept) ||
                                          row.concept.toLowerCase().slice(0, 30).trim(),
                                        targetCategory: cat,
                                      })
                                    }
                                    className="min-h-[44px] px-2 text-[11px] font-semibold text-[#0E5A64] dark:text-[#5EEAD4] hover:underline text-left"
                                  >
                                    Recordar palabra clave
                                  </button>
                                )}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <label className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                aria-label={`Marcar fila ${idx + 1} como privada`}
                                disabled={status.disabled}
                                checked={priv}
                                onChange={(e) =>
                                  setRowOverrides((prev) => ({
                                    ...prev,
                                    [idx]: { ...prev[idx], isPrivate: e.target.checked },
                                  }))
                                }
                                className="w-4 h-4 accent-[#0E5A64]"
                              />
                              <Lock className="w-3 h-3 text-slate-600 dark:text-slate-400" />
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={importing || selectedCount === 0}
            onClick={() => void handleImport()}
            className="min-h-[44px] px-5 rounded-xl bg-[#0E5A64] hover:bg-[#0A464E] disabled:opacity-40 text-white text-sm font-semibold"
          >
            {importing ? 'Importando...' : `Importar ${selectedCount} gastos`}
          </button>
        </div>
      </div>
    </div>
  );
};
