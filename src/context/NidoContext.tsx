import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  computeEffectiveSplitPctA,
  getCurrentMonthKeyLocal,
  shiftMonthKey,
} from '../domain/finance';
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
  ChecklistItem,
  ExpensePrefill,
  FurnitureItem,
  GoalMovement,
  Household,
  HouseholdMember,
  InitialCost,
  MonthClosure,
  MonthlyBudget,
  NavTab,
  RecurringExpense,
  SavingsGoal,
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
  monthClosures: MonthClosure[];
  goals: SavingsGoal[];
  goalMovements: GoalMovement[];
  shoppingItems: ShoppingItem[];

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
  const [budget, setBudget] = useState<MonthlyBudget | null>(null);
  const [currentMonthBudget, setCurrentMonthBudget] = useState<MonthlyBudget | null>(null);
  const [monthClosures, setMonthClosures] = useState<MonthClosure[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [goalMovements, setGoalMovements] = useState<GoalMovement[]>([]);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  const [seedPending, setSeedPending] = useState(false);
  const [seedingDefaults, setSeedingDefaults] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>('inicio');
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(() => getCurrentMonthKeyLocal());
  const [quickExpenseOpen, setQuickExpenseOpen] = useState(false);
  const [quickExpensePrefill, setQuickExpensePrefill] = useState<ExpensePrefill | null>(null);
  const quickExpenseOnSavedRef = useRef<(() => Promise<void> | void) | null>(null);

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
    if (!householdId || !viewerUid) return;
    const onErr = (e: Error) => {
      setHouseholdError(
        toUserFriendlyErrorMessage(e, 'No se pudieron sincronizar los datos del hogar.')
      );
    };
    const unsubH = repo.subscribeHousehold(householdId, setHousehold, onErr);
    const unsubM = repo.subscribeMembers(householdId, setMembers, onErr);
    return () => {
      unsubH();
      unsubM();
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

  // 5) Recurring templates (Inicio, Ahorros, or Avanzado Mensual/Ajustes)
  useEffect(() => {
    const needed =
      effectiveTab === 'inicio' ||
      effectiveTab === 'ahorros' ||
      (uiMode === 'avanzado' && (effectiveTab === 'mensual' || effectiveTab === 'ajustes'));
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
      setCurrentMonthBudget(null);
      return;
    }
    const currentMonthKey = getCurrentMonthKeyLocal();
    const onErr = (e: Error) =>
      setHouseholdError(toUserFriendlyErrorMessage(e, 'No se pudo cargar el presupuesto del mes.'));
    return repo.subscribeBudget(householdId, currentMonthKey, setCurrentMonthBudget, onErr);
  }, [householdId, viewerUid, uiMode, effectiveTab, repo]);

  // 9) Selected month budget (Avanzado · Mensual only)
  useEffect(() => {
    if (!householdId || !viewerUid || uiMode !== 'avanzado' || effectiveTab !== 'mensual') {
      setBudget(null);
      return;
    }
    const onErr = (e: Error) =>
      setHouseholdError(toUserFriendlyErrorMessage(e, 'No se pudo cargar el presupuesto del mes.'));
    return repo.subscribeBudget(householdId, selectedMonthKey, setBudget, onErr);
  }, [householdId, viewerUid, uiMode, effectiveTab, selectedMonthKey, repo]);

  // 10) Month closures (Inicio, Mensual, Ahorros, Avanzado Ajustes, or while quick-add expense modal is open)
  useEffect(() => {
    const needed =
      effectiveTab === 'inicio' ||
      effectiveTab === 'mensual' ||
      effectiveTab === 'ahorros' ||
      (uiMode === 'avanzado' && effectiveTab === 'ajustes') ||
      quickExpenseOpen;
    if (!householdId || !viewerUid || !needed) {
      setMonthClosures([]);
      return;
    }
    const onErr = (e: Error) =>
      setHouseholdError(toUserFriendlyErrorMessage(e, 'No se pudieron comprobar los meses cerrados.'));
    return repo.subscribeMonthClosures(householdId, setMonthClosures, onErr);
  }, [householdId, viewerUid, uiMode, effectiveTab, quickExpenseOpen, repo]);

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

  // 13) Shopping list (Inicio only)
  useEffect(() => {
    if (!householdId || !viewerUid || effectiveTab !== 'inicio') {
      setShoppingItems([]);
      return;
    }
    const onErr = (e: Error) =>
      setHouseholdError(toUserFriendlyErrorMessage(e, 'No se pudo sincronizar la lista de la compra.'));
    return repo.subscribeShopping(householdId, setShoppingItems, onErr);
  }, [householdId, viewerUid, effectiveTab, repo]);

  const effectiveSplitPctA = useMemo(() => {
    if (!household) return 50;
    return computeEffectiveSplitPctA(household.settings);
  }, [household]);

  const signInWithGoogle = useCallback(async () => {
    setIsDemoMode(false);
    await signInWithPopup(auth, googleProvider);
  }, []);

  const logout = useCallback(async () => {
    if (isDemoMode) {
      setIsDemoMode(false);
      setHouseholdId(null);
      setHousehold(null);
      return;
    }
    await signOut(auth);
  }, [isDemoMode]);

  const enterDemoMode = useCallback(() => {
    setIsDemoMode(true);
  }, []);

  const exitDemoMode = useCallback(() => {
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
    await repo.updateMemberUiMode(householdId, currentUserProfile.uid, next);
    if (next === 'sencillo' && activeTab === 'ajustes') {
      setActiveTab('inicio');
    }
    showToast(next === 'avanzado' ? 'Modo Avanzado activado' : 'Modo Sencillo activado');
  }, [householdId, currentUserProfile, uiMode, activeTab, repo, showToast]);

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
    seedPending,
    seedingDefaults,
    retryDefaultSeed,
    createHousehold,
    joinHousehold,
    activeTab,
    setActiveTab,
    selectedMonthKey,
    setSelectedMonthKey,
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
    monthClosures,
    goals,
    goalMovements,
    shoppingItems,
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
