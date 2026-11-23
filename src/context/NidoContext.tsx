import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  computeEffectiveSplitPctA,
  getCurrentMonthKeyLocal,
  getTodayLocalISO,
  getUpcomingChargesWithinDays,
  shiftMonthKey,
} from '../domain/finance';
import {
  buildCategoryRegistry,
  mergeMonthlyAndCustomBudgetLimits,
  type CategoryRegistry,
} from '../domain/categories';
import {
  buildLocalNoticeStorageKey,
  LOCAL_NOTICE_UPDATED_EVENT,
  loadLocalNoticeSettings,
  syncAppBadge,
  triggerForegroundNotificationCheck,
} from '../domain/localNotifications';
import {
  clearAllLocalPendingCheckouts,
  clearLocalPendingCheckout,
  executeDurableShoppingCheckout,
  loadLocalPendingCheckout,
  reconcileShoppingItemsForCleanup,
  saveLocalPendingCheckout,
  type LocalPendingShoppingCheckout,
  type ShoppingCheckoutItemSnapshot,
} from '../domain/shoppingCheckout';
import { usePwaUpdateBlock } from '../services/pwaUpdateGuard';
import { globalSearchSessionCache } from '../domain/globalSearch';
import { DemoHouseholdRepository } from '../repositories/DemoHouseholdRepository';
import { FirestoreHouseholdRepository } from '../repositories/FirestoreHouseholdRepository';
import type {
  HouseholdRepository,
  JoinHouseholdOptions,
  UserProfileInput,
} from '../repositories/HouseholdRepository';
import { auth, googleProvider, toUserFriendlyErrorMessage } from '../services/firebase';
import type {
  ActivityEntry,
  CategoryBudgetLimit,
  ChecklistItem,
  CustomCategory,
  ExpensePrefill,
  FurnitureItem,
  GoalMovement,
  Household,
  HouseholdMember,
  InitialCost,
  MonthClosure,
  MonthlyBudget,
  NavTab,
  PendingShoppingCheckout,
  RecurringExpense,
  SavingsGoal,
  ShoppingCatalogItem,
  ShoppingItem,
  ThemeMode,
  Transaction,
  UiMode,
} from '../types/nido';

interface UndoToastState {
  id: number;
  message: string;
  onUndo: () => Promise<void>;
}

interface NidoContextValue {
  // Auth & Mode
  authReady: boolean;
  authUser: User | null;
  isDemoMode: boolean;
  currentUserProfile: UserProfileInput | null;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  enterDemoMode: () => void;
  exitDemoMode: () => void;

  // Household & Members
  householdId: string | null;
  householdLoading: boolean;
  householdError: string | null;
  household: Household | null;
  members: HouseholdMember[];
  memberA: HouseholdMember | undefined;
  memberB: HouseholdMember | undefined;
  currentMember: HouseholdMember | undefined;
  effectiveSplitPctA: number;
  seedPending: boolean;
  seedingDefaults: boolean;
  retryDefaultSeed: () => Promise<void>;
  createHousehold: (name: string) => Promise<void>;
  joinHousehold: (code: string, options?: JoinHouseholdOptions) => Promise<void>;

  // Navigation & Preferences
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  selectedMonthKey: string;
  setSelectedMonthKey: (mk: string) => void;
  focusMensualSection: 'plantillas' | null;
  clearFocusMensualSection: () => void;
  openHabitualSetupInAvanzado: () => Promise<void>;
  uiMode: UiMode;
  toggleUiMode: () => Promise<void>;
  theme: ThemeMode;
  toggleTheme: () => void;

  // Quick add modal & prefill (e.g. from Shopping List)
  quickExpenseOpen: boolean;
  setQuickExpenseOpen: (open: boolean) => void;
  quickExpensePrefill: ExpensePrefill | null;
  quickExpenseOnSaved: (() => Promise<void> | void) | null;
  openQuickExpenseWithPrefill: (
    prefill: ExpensePrefill,
    onSaved?: () => Promise<void> | void
  ) => void;
  clearQuickExpensePrefill: () => void;
  shoppingOpen: boolean;
  setShoppingOpen: (open: boolean) => void;
  openShoppingList: () => void;
  pendingShoppingCleanupIds: string[];
  pendingShoppingCheckouts: PendingShoppingCheckout[];
  localPendingCheckout: LocalPendingShoppingCheckout | null;
  resumingShoppingCheckout: boolean;
  refreshLocalPendingCheckout: () => void;
  registerPendingShoppingCleanup: (snapshots: ShoppingCheckoutItemSnapshot[]) => void;
  openConvertShoppingToExpense: (itemIds: string[], prefill: ExpensePrefill) => void;
  retryShoppingCleanup: () => Promise<void>;
  dismissShoppingCleanup: () => void;
  resumePendingShoppingCheckout: (checkoutId?: string) => Promise<void>;
  dismissPendingCheckoutRecovery: (checkoutId?: string) => Promise<void>;
  pendingOpenShopping: boolean;
  consumePendingOpenShopping: () => void;

  // Categories Registry
  customCategories: CustomCategory[];
  categoryRegistry: CategoryRegistry;

  // Real-time Collections
  activity: ActivityEntry[];
  initialCosts: InitialCost[];
  checklist: ChecklistItem[];
  furnitureItems: FurnitureItem[];
  recurring: RecurringExpense[];
  currentMonthTransactions: Transaction[];
  monthTransactions: Transaction[];
  recentTransactions: Transaction[];
  budget: MonthlyBudget | null;
  currentMonthBudget: MonthlyBudget | null;
  categoryBudgets: CategoryBudgetLimit[];
  monthClosures: MonthClosure[];
  goals: SavingsGoal[];
  goalMovements: GoalMovement[];
  shoppingItems: ShoppingItem[];
  shoppingCatalog: ShoppingCatalogItem[];

  // Repository & Feedback
  repo: HouseholdRepository;
  toastMessage: string | null;
  showToast: (msg: string) => void;
  undoToast: UndoToastState | null;
  scheduleUndo: (message: string, onUndo: () => Promise<void>) => void;
  dismissUndo: () => void;
}

const NidoContext = createContext<NidoContextValue | null>(null);

const THEME_KEY = 'nido_theme_v1';

export const NidoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const firestoreRepoRef = useRef<FirestoreHouseholdRepository | null>(null);
  const demoRepoRef = useRef<DemoHouseholdRepository | null>(null);

  const getFirestoreRepo = () => {
    if (!firestoreRepoRef.current) firestoreRepoRef.current = new FirestoreHouseholdRepository();
    return firestoreRepoRef.current;
  };
  const getDemoRepo = () => {
    if (!demoRepoRef.current) demoRepoRef.current = new DemoHouseholdRepository();
    return demoRepoRef.current;
  };

  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('autostart') === '1';
  });

  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [householdLoading, setHouseholdLoading] = useState(false);
  const [householdError, setHouseholdError] = useState<string | null>(null);

  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [initialCosts, setInitialCosts] = useState<InitialCost[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [furnitureItems, setFurnitureItems] = useState<FurnitureItem[]>([]);
  const [recurring, setRecurring] = useState<RecurringExpense[]>([]);
  const [rawMonthTransactions, setRawMonthTransactions] = useState<Transaction[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [rawBudget, setRawBudget] = useState<MonthlyBudget | null>(null);
  const [rawCurrentMonthBudget, setRawCurrentMonthBudget] = useState<MonthlyBudget | null>(null);
  const [selectedCategoryBudgets, setSelectedCategoryBudgets] = useState<CategoryBudgetLimit[]>([]);
  const [currentCategoryBudgets, setCurrentCategoryBudgets] = useState<CategoryBudgetLimit[]>([]);
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>([]);
  const [monthClosures, setMonthClosures] = useState<MonthClosure[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [goalMovements, setGoalMovements] = useState<GoalMovement[]>([]);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  const [shoppingCatalog, setShoppingCatalog] = useState<ShoppingCatalogItem[]>([]);
  const [pendingShoppingCheckouts, setPendingShoppingCheckouts] = useState<
    PendingShoppingCheckout[]
  >([]);
  const [localPendingCheckout, setLocalPendingCheckout] =
    useState<LocalPendingShoppingCheckout | null>(null);
  const [resumingShoppingCheckout, setResumingShoppingCheckout] = useState(false);
  const [seedPending, setSeedPending] = useState(false);
  const [seedingDefaults, setSeedingDefaults] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>('inicio');
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(() => getCurrentMonthKeyLocal());
  const [focusMensualSection, setFocusMensualSection] = useState<'plantillas' | null>(null);
  const [quickExpenseOpen, setQuickExpenseOpen] = useState(false);
  const [quickExpensePrefill, setQuickExpensePrefill] = useState<ExpensePrefill | null>(null);
  const [shoppingOpen, setShoppingOpen] = useState(false);
  const [pendingShoppingCleanupSnapshots, setPendingShoppingCleanupSnapshots] = useState<
    ShoppingCheckoutItemSnapshot[]
  >([]);
  const shoppingItemsRef = useRef<ShoppingItem[]>(shoppingItems);
  const resumeCheckoutInFlightRef = useRef(false);
  useEffect(() => {
    shoppingItemsRef.current = shoppingItems;
  }, [shoppingItems]);
  useEffect(() => {
    setPendingShoppingCleanupSnapshots([]);
  }, [householdId]);
  const pendingShoppingCleanupIds = useMemo(
    () => pendingShoppingCleanupSnapshots.map((s) => s.id),
    [pendingShoppingCleanupSnapshots]
  );
  const [pendingOpenShopping, setPendingOpenShopping] = useState(false);
  const [noticeSettingsTick, setNoticeSettingsTick] = useState(0);
  const quickExpenseOnSavedRef = useRef<(() => Promise<void> | void) | null>(null);
  const pendingDeepLinkRef = useRef<{
    tab: NavTab | null;
    action: string | null;
    open: string | null;
  } | null>(
    (() => {
      if (typeof window === 'undefined') return null;
      const params = new URLSearchParams(window.location.search);
      const rawTab = params.get('tab');
      const allowedTabs: NavTab[] = ['inicio', 'mudanza', 'mensual', 'ahorros', 'ajustes', 'ayuda'];
      const validTab = rawTab && allowedTabs.includes(rawTab as NavTab) ? (rawTab as NavTab) : null;
      const action = params.get('action');
      const open = params.get('open');
      if (!validTab && !action && !open) return null;
      return { tab: validTab, action, open };
    })()
  );

  const consumePendingOpenShopping = useCallback(() => {
    setPendingOpenShopping(false);
  }, []);

  const openShoppingList = useCallback(() => {
    setShoppingOpen(true);
  }, []);

  const clearFocusMensualSection = useCallback(() => {
    setFocusMensualSection(null);
  }, []);

  const openQuickExpenseWithPrefill = useCallback(
    (prefill: ExpensePrefill, onSaved?: () => Promise<void> | void) => {
      setQuickExpensePrefill(prefill);
      quickExpenseOnSavedRef.current = onSaved ?? null;
      setQuickExpenseOpen(true);
    },
    []
  );

  const clearQuickExpensePrefill = useCallback(() => {
    setQuickExpensePrefill(null);
    quickExpenseOnSavedRef.current = null;
  }, []);

  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // ignore
    }
    return 'light';
  });

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [undoToast, setUndoToast] = useState<UndoToastState | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const showToast = useCallback((msg: string) => {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    setUndoToast(null);
    setToastMessage(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 3500);
  }, []);

  const scheduleUndo = useCallback((message: string, onUndo: () => Promise<void>) => {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    const id = Date.now();
    setUndoToast({ id, message, onUndo });
    undoTimerRef.current = window.setTimeout(() => {
      setUndoToast((cur) => (cur?.id === id ? null : cur));
    }, 5000);
  }, []);

  const dismissUndo = useCallback(() => {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    setUndoToast(null);
  }, []);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Resolve householdId for signed-in user or demo
  useEffect(() => {
    if (isDemoMode) {
      setHouseholdId('demo_hogar_santsadurni');
      setHouseholdLoading(false);
      setHouseholdError(null);
      return;
    }
    if (!authReady) return;
    if (!authUser) {
      setHouseholdId(null);
      setHousehold(null);
      setMembers([]);
      setHouseholdLoading(false);
      return;
    }

    let cancelled = false;
    setHouseholdLoading(true);
    setHouseholdError(null);
    getFirestoreRepo()
      .getUserHouseholdId(authUser.uid)
      .then((hid) => {
        if (!cancelled) {
          setHouseholdId(hid);
          setHouseholdLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setHouseholdError(
            toUserFriendlyErrorMessage(err, 'No se pudo cargar tu hogar. Inténtalo de nuevo.')
          );
          setHouseholdLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authReady, authUser, isDemoMode]);

  const repo: HouseholdRepository = useMemo(
    () => (isDemoMode ? getDemoRepo() : getFirestoreRepo()),
    [isDemoMode]
  );

  useEffect(() => {
    if (!householdId) {
      setSeedPending(false);
      return;
    }
    setSeedPending(repo.hasPendingDefaultSeed(householdId));
  }, [householdId, repo]);

  const viewerUid = isDemoMode ? 'demo_alex' : authUser?.uid || '';

  const currentUserProfile: UserProfileInput | null = useMemo(() => {
    if (isDemoMode) {
      return { uid: 'demo_alex', displayName: 'Alex', photoURL: '' };
    }
    if (!authUser) return null;
    return {
      uid: authUser.uid,
      displayName: authUser.displayName || authUser.email?.split('@')[0] || 'Usuario',
      photoURL: authUser.photoURL || '',
    };
  }, [isDemoMode, authUser]);

  const memberA = useMemo(
    () => members.find((m) => m.role === 'member_a') ?? members[0],
    [members]
  );
  const memberB = useMemo(
    () => members.find((m) => m.role === 'member_b') ?? (members.length > 1 ? members[1] : undefined),
    [members]
  );
  const currentMember = useMemo(() => {
    const uid = currentUserProfile?.uid;
    return members.find((m) => m.uid === uid);
  }, [members, currentUserProfile]);

  const uiMode: UiMode = currentMember?.uiMode ?? 'sencillo';
  const effectiveTab: NavTab = uiMode === 'sencillo' && activeTab === 'ajustes' ? 'inicio' : activeTab;

  // 1) Base subscriptions always active once inside a household
  useEffect(() => {
    if (!householdId || !viewerUid) {
      setCustomCategories([]);
      return;
    }
    const onErr = (e: Error) => {
      setHouseholdError(
        toUserFriendlyErrorMessage(e, 'No se pudieron sincronizar los datos del hogar.')
      );
    };
    const unsubH = repo.subscribeHousehold(householdId, setHousehold, onErr);
    const unsubM = repo.subscribeMembers(householdId, setMembers, onErr);
    const unsubCat = repo.subscribeCustomCategories(householdId, setCustomCategories, onErr);
    return () => {
      unsubH();
      unsubM();
      unsubCat();
    };
  }, [householdId, viewerUid, repo]);

  // 2) Activity (Avanzado · Inicio only)
  useEffect(() => {
    if (!householdId || !viewerUid || uiMode !== 'avanzado' || effectiveTab !== 'inicio') {
      setActivity([]);
      return;
    }
    const onErr = (e: Error) =>
      setHouseholdError(toUserFriendlyErrorMessage(e, 'No se pudo cargar la actividad reciente.'));
    return repo.subscribeActivity(householdId, 20, setActivity, onErr);
  }, [householdId, viewerUid, uiMode, effectiveTab, repo]);

  // 3) Initial costs (Avanzado · Mudanza only)
  useEffect(() => {
    if (!householdId || !viewerUid || uiMode !== 'avanzado' || effectiveTab !== 'mudanza') {
      setInitialCosts([]);
      return;
    }
    const onErr = (e: Error) =>
      setHouseholdError(toUserFriendlyErrorMessage(e, 'No se pudieron cargar los gastos iniciales.'));
    return repo.subscribeInitialCosts(householdId, setInitialCosts, onErr);
  }, [householdId, viewerUid, uiMode, effectiveTab, repo]);

  // 4) Checklist & Furniture (Inicio or Mudanza in both modes)
  useEffect(() => {
    if (!householdId || !viewerUid || (effectiveTab !== 'inicio' && effectiveTab !== 'mudanza')) {
      setChecklist([]);
      setFurnitureItems([]);
      return;
    }
    const onErr = (e: Error) =>
      setHouseholdError(toUserFriendlyErrorMessage(e, 'No se pudo cargar la lista de mudanza.'));
    const unsubCl = repo.subscribeChecklist(householdId, setChecklist, onErr);
    const unsubFur = repo.subscribeFurniture(householdId, setFurnitureItems, onErr);
    return () => {
      unsubCl();
      unsubFur();
    };
  }, [householdId, viewerUid, effectiveTab, repo]);

  // 5) Recurring templates (Inicio, Mensual in both modes, Ahorros, or Avanzado Ajustes)
  useEffect(() => {
    const needed =
      effectiveTab === 'inicio' ||
      effectiveTab === 'mensual' ||
      effectiveTab === 'ahorros' ||
      (uiMode === 'avanzado' && effectiveTab === 'ajustes');
    if (!householdId || !viewerUid || !needed) {
      setRecurring([]);
      return;
    }
    const onErr = (e: Error) =>
      setHouseholdError(toUserFriendlyErrorMessage(e, 'No se pudieron cargar los gastos fijos.'));
    return repo.subscribeRecurring(householdId, setRecurring, onErr);
  }, [householdId, viewerUid, uiMode, effectiveTab, repo]);

  // 6) Recent 12 months transactions (Inicio, Ahorros, or Avanzado Mensual/Ajustes)
  useEffect(() => {
    const needed =
      effectiveTab === 'inicio' ||
      effectiveTab === 'ahorros' ||
      (uiMode === 'avanzado' && (effectiveTab === 'mensual' || effectiveTab === 'ajustes'));
    if (!householdId || !viewerUid || !needed) {
      setRecentTransactions([]);
      return;
    }
    const minRecentMonth = shiftMonthKey(getCurrentMonthKeyLocal(), -11);
    const onErr = (e: Error) =>
      setHouseholdError(toUserFriendlyErrorMessage(e, 'No se pudo cargar el historial reciente.'));
    return repo.subscribeTransactionsRecentMonths(
      householdId,
      viewerUid,
      minRecentMonth,
      setRecentTransactions,
      onErr
    );
  }, [householdId, viewerUid, uiMode, effectiveTab, repo]);

  const currentMonthTransactions = useMemo(() => {
    const currentMonthKey = getCurrentMonthKeyLocal();
    return recentTransactions.filter((t) => t.monthKey === currentMonthKey);
  }, [recentTransactions]);

  // 7) Selected month transactions (Sencillo · Mensual, or Avanzado · Mensual when outside 12m window)
  const minRecentMonthKey = shiftMonthKey(getCurrentMonthKeyLocal(), -11);
  const selectedMonthInsideRecentWindow =
    uiMode === 'avanzado' && effectiveTab === 'mensual' && selectedMonthKey >= minRecentMonthKey;

  useEffect(() => {
    const needDirectMonthSub =
      effectiveTab === 'mensual' && !selectedMonthInsideRecentWindow;
    if (!householdId || !viewerUid || !needDirectMonthSub) {
      setRawMonthTransactions([]);
      return;
    }
    const onErr = (e: Error) =>
      setHouseholdError(toUserFriendlyErrorMessage(e, 'No se pudieron cargar los movimientos del mes.'));
    return repo.subscribeTransactionsByMonth(
      householdId,
      viewerUid,
      selectedMonthKey,
      setRawMonthTransactions,
      onErr
    );
  }, [householdId, viewerUid, effectiveTab, selectedMonthInsideRecentWindow, selectedMonthKey, repo]);

  const monthTransactions = useMemo(
    () =>
      selectedMonthInsideRecentWindow
        ? recentTransactions.filter((t) => t.monthKey === selectedMonthKey)
        : rawMonthTransactions,
    [selectedMonthInsideRecentWindow, recentTransactions, selectedMonthKey, rawMonthTransactions]
  );

  // 8) Current month budget (Inicio, Ahorros, or Avanzado Ajustes for savings capacity fallback)
  useEffect(() => {
    const needed =
      effectiveTab === 'inicio' ||
      effectiveTab === 'ahorros' ||
      (uiMode === 'avanzado' && effectiveTab === 'ajustes');
    if (!householdId || !viewerUid || !needed) {
      setRawCurrentMonthBudget(null);
      setCurrentCategoryBudgets([]);
      return;
    }
    const currentMonthKey = getCurrentMonthKeyLocal();
    const onErr = (e: Error) =>
      setHouseholdError(toUserFriendlyErrorMessage(e, 'No se pudo cargar el presupuesto del mes.'));
    const unsubB = repo.subscribeBudget(householdId, currentMonthKey, setRawCurrentMonthBudget, onErr);
    const unsubCb = repo.subscribeCategoryBudgets(
      householdId,
      currentMonthKey,
      setCurrentCategoryBudgets,
      onErr
    );
    return () => {
      unsubB();
      unsubCb();
    };
  }, [householdId, viewerUid, uiMode, effectiveTab, repo]);

  // 9) Selected month budget (Avanzado · Mensual only)
  useEffect(() => {
    if (!householdId || !viewerUid || uiMode !== 'avanzado' || effectiveTab !== 'mensual') {
      setRawBudget(null);
      setSelectedCategoryBudgets([]);
      return;
    }
    const onErr = (e: Error) =>
      setHouseholdError(toUserFriendlyErrorMessage(e, 'No se pudo cargar el presupuesto del mes.'));
    const unsubB = repo.subscribeBudget(householdId, selectedMonthKey, setRawBudget, onErr);
    const unsubCb = repo.subscribeCategoryBudgets(
      householdId,
      selectedMonthKey,
      setSelectedCategoryBudgets,
      onErr
    );
    return () => {
      unsubB();
      unsubCb();
    };
  }, [householdId, viewerUid, uiMode, effectiveTab, selectedMonthKey, repo]);

  const currentMonthBudget = useMemo(
    () =>
      mergeMonthlyAndCustomBudgetLimits(
        rawCurrentMonthBudget,
        currentCategoryBudgets,
        getCurrentMonthKeyLocal()
      ),
    [rawCurrentMonthBudget, currentCategoryBudgets]
  );

  const budget = useMemo(
    () =>
      mergeMonthlyAndCustomBudgetLimits(rawBudget, selectedCategoryBudgets, selectedMonthKey),
    [rawBudget, selectedCategoryBudgets, selectedMonthKey]
  );

  // 10) Month closures (always active inside a household so QuickExpenseModal and ShoppingCheckoutPanel enforce closed months from any tab)
  useEffect(() => {
    if (!householdId || !viewerUid) {
      setMonthClosures([]);
      return;
    }
    const onErr = (e: Error) =>
      setHouseholdError(toUserFriendlyErrorMessage(e, 'No se pudieron comprobar los meses cerrados.'));
    return repo.subscribeMonthClosures(householdId, setMonthClosures, onErr);
  }, [householdId, viewerUid, repo]);

  // 12) Goals & Goal movements (Inicio or Ahorros)
  useEffect(() => {
    if (!householdId || !viewerUid || (effectiveTab !== 'inicio' && effectiveTab !== 'ahorros')) {
      setGoals([]);
      setGoalMovements([]);
      return;
    }
    const onErr = (e: Error) =>
      setHouseholdError(toUserFriendlyErrorMessage(e, 'No se pudieron cargar las metas de ahorro.'));
    const unsubG = repo.subscribeGoals(householdId, setGoals, onErr);
    const unsubGm = repo.subscribeGoalMovements(householdId, setGoalMovements, onErr);
    return () => {
      unsubG();
      unsubGm();
    };
  }, [householdId, viewerUid, effectiveTab, repo]);

  // 13) Shopping list (Inicio or whenever Shopping drawer is open)
  useEffect(() => {
    if (!householdId || !viewerUid || (effectiveTab !== 'inicio' && !shoppingOpen)) {
      setShoppingItems([]);
      return;
    }
    const onErr = (e: Error) =>
      setHouseholdError(toUserFriendlyErrorMessage(e, 'No se pudo sincronizar la lista de la compra.'));
    return repo.subscribeShopping(householdId, setShoppingItems, onErr);
  }, [householdId, viewerUid, effectiveTab, shoppingOpen, repo]);

  // 14) Shopping household catalog (only when Shopping drawer is open)
  useEffect(() => {
    if (!householdId || !viewerUid || !shoppingOpen) {
      setShoppingCatalog([]);
      return;
    }
    const onErr = (e: Error) =>
      setHouseholdError(
        toUserFriendlyErrorMessage(e, 'No se pudo cargar el catálogo de la compra.')
      );
    return repo.subscribeShoppingCatalog(householdId, setShoppingCatalog, onErr);
  }, [householdId, viewerUid, shoppingOpen, repo]);

  // 15) Pending durable shopping checkouts (0 docs in steady state; enables cross-device & reload recovery)
  useEffect(() => {
    if (!householdId || !viewerUid) {
      setPendingShoppingCheckouts([]);
      setLocalPendingCheckout(null);
      return;
    }
    setLocalPendingCheckout(loadLocalPendingCheckout(householdId, viewerUid));
    const onErr = (e: Error) =>
      setHouseholdError(
        toUserFriendlyErrorMessage(e, 'No se pudo comprobar las compras pendientes de limpieza.')
      );
    return repo.subscribePendingShoppingCheckouts(
      householdId,
      viewerUid,
      setPendingShoppingCheckouts,
      onErr
    );
  }, [householdId, viewerUid, repo]);

  const refreshLocalPendingCheckout = useCallback(() => {
    if (!householdId || !viewerUid) {
      setLocalPendingCheckout(null);
      return;
    }
    setLocalPendingCheckout(loadLocalPendingCheckout(householdId, viewerUid));
  }, [householdId, viewerUid]);

  usePwaUpdateBlock(
    resumingShoppingCheckout || localPendingCheckout?.state === 'committing',
    'write'
  );

  const categoryRegistry = useMemo(
    () => buildCategoryRegistry(customCategories, household?.categoryColors),
    [customCategories, household?.categoryColors]
  );

  const effectiveSplitPctA = useMemo(() => {
    if (!household) return 50;
    return computeEffectiveSplitPctA(household.settings);
  }, [household]);

  const signInWithGoogle = useCallback(async () => {
    setIsDemoMode(false);
    await signInWithPopup(auth, googleProvider);
  }, []);

  const logout = useCallback(async () => {
    globalSearchSessionCache.clearAll();
    clearAllLocalPendingCheckouts();
    setLocalPendingCheckout(null);
    setPendingShoppingCheckouts([]);
    if (isDemoMode) {
      setIsDemoMode(false);
      setHouseholdId(null);
      setHousehold(null);
      return;
    }
    await signOut(auth);
  }, [isDemoMode]);

  const enterDemoMode = useCallback(() => {
    globalSearchSessionCache.clearAll();
    clearAllLocalPendingCheckouts();
    setLocalPendingCheckout(null);
    setIsDemoMode(true);
  }, []);

  const exitDemoMode = useCallback(() => {
    globalSearchSessionCache.clearAll();
    clearAllLocalPendingCheckouts();
    setLocalPendingCheckout(null);
    setPendingShoppingCheckouts([]);
    setIsDemoMode(false);
    setHouseholdId(null);
    setHousehold(null);
  }, []);

  const createHousehold = useCallback(
    async (name: string) => {
      if (!currentUserProfile) return;
      setHouseholdError(null);
      const hid = await repo.createHousehold(currentUserProfile, name);
      setHouseholdId(hid);
      setSeedPending(repo.hasPendingDefaultSeed(hid));
    },
    [currentUserProfile, repo]
  );

  const joinHousehold = useCallback(
    async (code: string, options?: JoinHouseholdOptions) => {
      if (!currentUserProfile) return;
      setHouseholdError(null);
      const hid = await repo.joinHouseholdByCode(currentUserProfile, code, options);
      setHouseholdId(hid);
      setSeedPending(repo.hasPendingDefaultSeed(hid));
    },
    [currentUserProfile, repo]
  );

  const retryDefaultSeed = useCallback(async () => {
    if (!householdId || !currentUserProfile) return;
    setSeedingDefaults(true);
    try {
      const created = await repo.seedDefaultLists(householdId, currentUserProfile);
      setSeedPending(repo.hasPendingDefaultSeed(householdId));
      showToast(
        created > 0
          ? `Listas por defecto cargadas (${created} elementos)`
          : 'Las listas por defecto ya estaban cargadas'
      );
    } catch (err) {
      showToast(
        toUserFriendlyErrorMessage(
          err,
          'No se pudieron cargar las listas por defecto. Inténtalo de nuevo.'
        )
      );
    } finally {
      setSeedingDefaults(false);
    }
  }, [householdId, currentUserProfile, repo, showToast]);

  const toggleUiMode = useCallback(async () => {
    if (!householdId || !currentUserProfile) return;
    const next: UiMode = uiMode === 'sencillo' ? 'avanzado' : 'sencillo';
    try {
      await repo.updateMemberUiMode(householdId, currentUserProfile.uid, next);
      if (next === 'sencillo' && activeTab === 'ajustes') {
        setActiveTab('inicio');
      }
      showToast(next === 'avanzado' ? 'Modo Avanzado activado' : 'Modo Sencillo activado');
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudo cambiar el modo de interfaz.'));
    }
  }, [householdId, currentUserProfile, uiMode, activeTab, repo, showToast]);

  const openHabitualSetupInAvanzado = useCallback(async () => {
    try {
      if (uiMode !== 'avanzado' && householdId && currentUserProfile) {
        await repo.updateMemberUiMode(householdId, currentUserProfile.uid, 'avanzado');
      }
      setSelectedMonthKey(getCurrentMonthKeyLocal());
      setFocusMensualSection('plantillas');
      setActiveTab('mensual');
    } catch (err) {
      showToast(toUserFriendlyErrorMessage(err, 'No se pudo abrir la configuración de habituales.'));
    }
  }, [uiMode, householdId, currentUserProfile, repo, showToast]);

  const registerPendingShoppingCleanup = useCallback(
    (snapshots: ShoppingCheckoutItemSnapshot[]) => {
      setPendingShoppingCleanupSnapshots(snapshots);
    },
    []
  );

  const openConvertShoppingToExpense = useCallback(
    (itemIds: string[], prefill: ExpensePrefill) => {
      const targetIdSet = new Set(itemIds);
      const capturedSnapshots: ShoppingCheckoutItemSnapshot[] = shoppingItemsRef.current
        .filter((item) => targetIdSet.has(item.id) && item.done)
        .map((item) => ({
          id: item.id,
          text: item.text,
          qty: item.qty,
          unit: item.unit || '',
          done: Boolean(item.done),
          updatedAt: item.updatedAt || '',
        }));
      openQuickExpenseWithPrefill(prefill, async () => {
        if (!householdId || capturedSnapshots.length === 0) return;
        const reconciled = reconcileShoppingItemsForCleanup(
          capturedSnapshots,
          shoppingItemsRef.current
        );
        const skipped = reconciled.skippedModified.length + reconciled.skippedUnchecked.length;
        if (reconciled.safeToDeleteIds.length === 0) {
          setPendingShoppingCleanupSnapshots([]);
          if (skipped > 0) {
            showToast(
              `Gasto guardado. Se conservaron ${skipped} productos modificados o desmarcados mientras tanto.`
            );
          }
          return;
        }
        try {
          await repo.deleteShoppingItemsBulk(householdId, reconciled.safeToDeleteIds);
          setPendingShoppingCleanupSnapshots([]);
          showToast(
            skipped > 0
              ? `Gasto guardado, ${reconciled.safeToDeleteIds.length} limpiados y ${skipped} conservados por cambios recientes`
              : 'Gasto de compra guardado y marcados limpiados'
          );
        } catch {
          const safeSet = new Set(reconciled.safeToDeleteIds);
          setPendingShoppingCleanupSnapshots(
            capturedSnapshots.filter((snap) => safeSet.has(snap.id))
          );
          showToast(
            'El gasto se ha guardado, pero no se pudieron limpiar los marcados. Puedes reintentar sin duplicar el gasto.'
          );
        }
      });
    },
    [householdId, openQuickExpenseWithPrefill, repo, showToast]
  );

  const retryShoppingCleanup = useCallback(async () => {
    if (!householdId || pendingShoppingCleanupSnapshots.length === 0) return;
    const reconciled = reconcileShoppingItemsForCleanup(
      pendingShoppingCleanupSnapshots,
      shoppingItemsRef.current
    );
    const skipped = reconciled.skippedModified.length + reconciled.skippedUnchecked.length;
    if (reconciled.safeToDeleteIds.length === 0) {
      setPendingShoppingCleanupSnapshots([]);
      showToast(
        skipped > 0
          ? `No se borró ningún producto: ${skipped} fueron modificados o desmarcados recientemente.`
          : 'Los productos ya no estaban en la lista.'
      );
      return;
    }
    try {
      await repo.deleteShoppingItemsBulk(householdId, reconciled.safeToDeleteIds);
      setPendingShoppingCleanupSnapshots([]);
      showToast(
        skipped > 0
          ? `Retirados ${reconciled.safeToDeleteIds.length} productos y conservados ${skipped} modificados recientemente`
          : 'Productos marcados eliminados de la lista'
      );
    } catch (err) {
      showToast(
        toUserFriendlyErrorMessage(
          err,
          'No se pudieron limpiar los marcados. Vuelve a intentarlo.'
        )
      );
    }
  }, [householdId, pendingShoppingCleanupSnapshots, repo, showToast]);

  const dismissShoppingCleanup = useCallback(() => {
    setPendingShoppingCleanupSnapshots([]);
  }, []);

  const resumePendingShoppingCheckout = useCallback(
    async (checkoutId?: string) => {
      if (!householdId || !currentUserProfile || !viewerUid) return;
      if (!isDemoMode && typeof navigator !== 'undefined' && navigator.onLine === false) {
        showToast('Necesitas conexión a internet para comprobar y completar esta compra en el servidor.');
        return;
      }

      const local = loadLocalPendingCheckout(householdId, viewerUid);
      const targetLocal =
        local && (!checkoutId || local.checkoutId === checkoutId) ? local : null;
      const targetServer = pendingShoppingCheckouts.find((c) =>
        checkoutId ? c.id === checkoutId : true
      );

      if (!targetLocal && !targetServer) return;

      setResumingShoppingCheckout(true);
      try {
        if (targetLocal) {
          const result = await executeDurableShoppingCheckout({
            input: {
              checkoutId: targetLocal.checkoutId,
              monthKey: targetLocal.monthKey,
              concept: targetLocal.concept,
              amount: targetLocal.amount,
              date: targetLocal.date,
              paidBy: targetLocal.paidBy,
              splitPctA: targetLocal.splitPctA,
              isPrivate: targetLocal.isPrivate,
              notes: targetLocal.notes,
              snapshots: targetLocal.snapshots,
            },
            inFlightRef: resumeCheckoutInFlightRef,
            commitPhase1: (phase1Input) =>
              repo.commitShoppingCheckoutPhase1(householdId, phase1Input, currentUserProfile),
            cleanupBatch: (id, snapsById) =>
              repo.cleanupShoppingCheckoutBatch(householdId, id, snapsById),
            onPhase1Confirmed: (_expenseId, pendingIds) => {
              globalSearchSessionCache.invalidateHousehold(householdId);
              if (pendingIds.length > 0) {
                const updated: LocalPendingShoppingCheckout = {
                  ...targetLocal,
                  state: 'cleanup_pending',
                  updatedAt: new Date().toISOString(),
                };
                saveLocalPendingCheckout(updated);
                setLocalPendingCheckout(updated);
              }
            },
            onCleared: () => {
              clearLocalPendingCheckout(householdId, viewerUid);
              setLocalPendingCheckout(null);
            },
          });

          if (result.status === 'ignored_in_flight') return;
          if (result.status === 'overlap_conflict') {
            showToast(
              'Esa compra ya fue procesada o modificada desde otro dispositivo. No se ha duplicado ningún gasto.'
            );
            return;
          }
          if (result.status === 'all_modified_or_gone') {
            showToast('Los productos seleccionados cambiaron o ya no estaban marcados. No se creó gasto.');
            return;
          }
          if (result.status === 'phase1_failed') {
            showToast(
              toUserFriendlyErrorMessage(
                result.error,
                'No se pudo comprobar la compra en el servidor. Inténtalo de nuevo con conexión.'
              )
            );
            return;
          }
          if (result.status === 'cleanup_partial') {
            showToast(
              `Gasto confirmado sin duplicar, pero quedan ${result.remainingItemIds.length} productos por retirar. Puedes reintentar.`
            );
            return;
          }
          const concurrentSuffix =
            result.skippedConcurrentCount > 0
              ? ` · ${result.skippedConcurrentCount} conservados por cambios recientes`
              : '';
          const alreadyGoneSuffix =
            result.alreadyGoneCount > 0
              ? ` · Aviso: ${result.alreadyGoneCount} ya habían sido retirados en otro cierre (revisa los gastos recientes)`
              : '';
          showToast(
            result.reusedExistingExpense
              ? `Compra ya confirmada en el servidor (sin duplicar gasto)${
                  result.deletedCount > 0 ? ` · ${result.deletedCount} retirados` : ''
                }${concurrentSuffix}${alreadyGoneSuffix}`
              : `Compra completada y ${result.deletedCount} productos retirados${concurrentSuffix}${alreadyGoneSuffix}`
          );
          return;
        }

        if (targetServer) {
          if (resumeCheckoutInFlightRef.current) return;
          resumeCheckoutInFlightRef.current = true;
          try {
            let remaining = [...targetServer.pendingItemIds];
            let deletedCount = 0;
            let skippedCount = 0;
            let alreadyGoneCount = 0;
            let guard = 0;
            while (remaining.length > 0 && guard < 15) {
              guard += 1;
              const batch = await repo.cleanupShoppingCheckoutBatch(householdId, targetServer.id);
              deletedCount += batch.deletedIds.length;
              skippedCount += batch.skippedConcurrentIds.length;
              alreadyGoneCount += batch.alreadyGoneIds.length;
              remaining = batch.remainingItemIds;
              if (batch.completed) break;
            }
            const skippedSuffix =
              skippedCount > 0 ? ` · ${skippedCount} conservados por cambios recientes` : '';
            const alreadyGoneSuffix =
              alreadyGoneCount > 0
                ? ` · Aviso: ${alreadyGoneCount} ya habían sido retirados en otro cierre (revisa los gastos recientes)`
                : '';
            showToast(
              `Limpieza completada (${deletedCount} ${
                deletedCount === 1 ? 'producto retirado' : 'productos retirados'
              })${skippedSuffix}${alreadyGoneSuffix}`
            );
          } finally {
            resumeCheckoutInFlightRef.current = false;
          }
        }
      } catch (err) {
        showToast(
          toUserFriendlyErrorMessage(
            err,
            'No se pudo completar la limpieza pendiente. Inténtalo de nuevo.'
          )
        );
      } finally {
        setResumingShoppingCheckout(false);
      }
    },
    [householdId, currentUserProfile, viewerUid, isDemoMode, pendingShoppingCheckouts, repo, showToast]
  );

  const dismissPendingCheckoutRecovery = useCallback(
    async (checkoutId?: string) => {
      if (!householdId || !viewerUid) return;
      const local = loadLocalPendingCheckout(householdId, viewerUid);
      if (local && (!checkoutId || local.checkoutId === checkoutId)) {
        clearLocalPendingCheckout(householdId, viewerUid);
        setLocalPendingCheckout(null);
      }
      const serverTarget = pendingShoppingCheckouts.find((c) =>
        checkoutId ? c.id === checkoutId : true
      );
      if (serverTarget) {
        try {
          await repo.dismissPendingShoppingCheckout(householdId, serverTarget.id);
        } catch (err) {
          showToast(
            toUserFriendlyErrorMessage(err, 'No se pudo descartar el aviso de limpieza.')
          );
        }
      }
    },
    [householdId, viewerUid, pendingShoppingCheckouts, repo, showToast]
  );

  // Apply PWA deep link ONLY once auth + household + members are ready, then clean URL params
  useEffect(() => {
    const dl = pendingDeepLinkRef.current;
    if (!dl) return;
    if (!isDemoMode && !authReady) return;
    if (!householdId || !household || members.length === 0) return;

    pendingDeepLinkRef.current = null;
    if (dl.action === 'add-expense') {
      setQuickExpenseOpen(true);
    }
    if (dl.open === 'shopping') {
      setShoppingOpen(true);
    } else if (dl.tab) {
      setActiveTab(uiMode === 'sencillo' && dl.tab === 'ajustes' ? 'inicio' : dl.tab);
    }

    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('tab');
      url.searchParams.delete('action');
      url.searchParams.delete('open');
      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, '', nextUrl);
    } catch {
      // Ignore history errors
    }
  }, [isDemoMode, authReady, householdId, household, members.length, uiMode]);

  // Keep local foreground notification settings reactive across AjustesView <-> NidoContext
  useEffect(() => {
    const onUpdated = () => setNoticeSettingsTick((n) => n + 1);
    window.addEventListener(LOCAL_NOTICE_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(LOCAL_NOTICE_UPDATED_EVENT, onUpdated);
  }, []);

  // Opt-in foreground reminder + App Badge sync (zero server push, zero automatic permission prompt)
  useEffect(() => {
    if (!householdId || !viewerUid) {
      void syncAppBadge(0);
      return;
    }
    const canEvaluateCurrentMonth =
      effectiveTab === 'inicio' ||
      effectiveTab === 'ahorros' ||
      (uiMode === 'avanzado' && (effectiveTab === 'mensual' || effectiveTab === 'ajustes')) ||
      (effectiveTab === 'mensual' && selectedMonthKey === getCurrentMonthKeyLocal());

    if (!canEvaluateCurrentMonth) return;

    const storageKey = buildLocalNoticeStorageKey(householdId, viewerUid);
    const settings = loadLocalNoticeSettings(storageKey);
    const todayISO = getTodayLocalISO();
    const currentMonthKey = getCurrentMonthKeyLocal();
    const txSource =
      effectiveTab === 'mensual' && selectedMonthKey === currentMonthKey
        ? monthTransactions
        : currentMonthTransactions;

    const due = getUpcomingChargesWithinDays(recurring, todayISO, settings.daysAhead, txSource);
    void syncAppBadge(settings.enabled ? due.length : 0);

    if (settings.enabled && recurring.length > 0) {
      triggerForegroundNotificationCheck({
        storageKey,
        recurring,
        transactions: txSource,
        todayISO,
      });
    }
  }, [
    householdId,
    viewerUid,
    effectiveTab,
    uiMode,
    selectedMonthKey,
    recurring,
    monthTransactions,
    currentMonthTransactions,
    noticeSettingsTick,
  ]);

  const effectiveSeedPending = Boolean(household?.seedPending) || seedPending;

  const value: NidoContextValue = {
    authReady,
    authUser,
    isDemoMode,
    currentUserProfile,
    signInWithGoogle,
    logout,
    enterDemoMode,
    exitDemoMode,
    householdId,
    householdLoading,
    householdError,
    household,
    members,
    memberA,
    memberB,
    currentMember,
    effectiveSplitPctA,
    seedPending: effectiveSeedPending,
    seedingDefaults,
    retryDefaultSeed,
    createHousehold,
    joinHousehold,
    activeTab,
    setActiveTab,
    selectedMonthKey,
    setSelectedMonthKey,
    focusMensualSection,
    clearFocusMensualSection,
    openHabitualSetupInAvanzado,
    uiMode,
    toggleUiMode,
    theme,
    toggleTheme,
    quickExpenseOpen,
    setQuickExpenseOpen,
    quickExpensePrefill,
    quickExpenseOnSaved: quickExpenseOnSavedRef.current,
    openQuickExpenseWithPrefill,
    clearQuickExpensePrefill,
    shoppingOpen,
    setShoppingOpen,
    openShoppingList,
    pendingShoppingCleanupIds,
    pendingShoppingCheckouts,
    localPendingCheckout,
    resumingShoppingCheckout,
    refreshLocalPendingCheckout,
    registerPendingShoppingCleanup,
    openConvertShoppingToExpense,
    retryShoppingCleanup,
    dismissShoppingCleanup,
    resumePendingShoppingCheckout,
    dismissPendingCheckoutRecovery,
    pendingOpenShopping,
    consumePendingOpenShopping,
    customCategories,
    categoryRegistry,
    activity,
    initialCosts,
    checklist,
    furnitureItems,
    recurring,
    monthTransactions,
    currentMonthTransactions,
    recentTransactions,
    budget,
    currentMonthBudget,
    categoryBudgets: currentCategoryBudgets,
    monthClosures,
    goals,
    goalMovements,
    shoppingItems,
    shoppingCatalog,
    repo,
    toastMessage,
    showToast,
    undoToast,
    scheduleUndo,
    dismissUndo,
  };

  return <NidoContext.Provider value={value}>{children}</NidoContext.Provider>;
};

export function useNido(): NidoContextValue {
  const ctx = useContext(NidoContext);
  if (!ctx) throw new Error('useNido debe usarse dentro de NidoProvider');
  return ctx;
}
