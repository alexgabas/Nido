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

  // Quick add modal
  quickExpenseOpen: boolean;
  setQuickExpenseOpen: (open: boolean) => void;

  // Real-time Collections
  activity: ActivityEntry[];
  initialCosts: InitialCost[];
  checklist: ChecklistItem[];
  furnitureItems: FurnitureItem[];
  recurring: RecurringExpense[];
  monthTransactions: Transaction[];
  recentTransactions: Transaction[];
  budget: MonthlyBudget | null;
  monthClosures: MonthClosure[];
  goals: SavingsGoal[];
  goalMovements: GoalMovement[];

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
  const [monthTransactions, setMonthTransactions] = useState<Transaction[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [budget, setBudget] = useState<MonthlyBudget | null>(null);
  const [monthClosures, setMonthClosures] = useState<MonthClosure[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [goalMovements, setGoalMovements] = useState<GoalMovement[]>([]);
  const [seedPending, setSeedPending] = useState(false);
  const [seedingDefaults, setSeedingDefaults] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>('inicio');
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(() => getCurrentMonthKeyLocal());
  const [quickExpenseOpen, setQuickExpenseOpen] = useState(false);

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

  // Real-time household & collections subscriptions
  useEffect(() => {
    if (!householdId) return;
    if (!isDemoMode && !authUser) return;

    const minRecentMonth = shiftMonthKey(getCurrentMonthKeyLocal(), -11);
    const onErr = (e: Error) => {
      setHouseholdError(
        toUserFriendlyErrorMessage(e, 'No se pudieron sincronizar los datos del hogar.')
      );
    };

    const unsubs = [
      repo.subscribeHousehold(householdId, setHousehold, onErr),
      repo.subscribeMembers(householdId, setMembers, onErr),
      repo.subscribeActivity(householdId, 20, setActivity, onErr),
      repo.subscribeInitialCosts(householdId, setInitialCosts, onErr),
      repo.subscribeChecklist(householdId, setChecklist, onErr),
      repo.subscribeFurniture(householdId, setFurnitureItems, onErr),
      repo.subscribeRecurring(householdId, setRecurring, onErr),
      repo.subscribeTransactionsRecentMonths(householdId, minRecentMonth, setRecentTransactions, onErr),
      repo.subscribeMonthClosures(householdId, setMonthClosures, onErr),
      repo.subscribeGoals(householdId, setGoals, onErr),
      repo.subscribeGoalMovements(householdId, setGoalMovements, onErr),
    ];

    return () => {
      for (const u of unsubs) u();
    };
  }, [householdId, isDemoMode, authUser, repo]);

  // Month-scoped subscriptions (optimized reads by monthKey)
  useEffect(() => {
    if (!householdId) return;
    if (!isDemoMode && !authUser) return;

    const onErr = (e: Error) =>
      setHouseholdError(
        toUserFriendlyErrorMessage(e, 'No se pudieron cargar los movimientos del mes.')
      );
    const unsubTx = repo.subscribeTransactionsByMonth(
      householdId,
      selectedMonthKey,
      setMonthTransactions,
      onErr
    );
    const unsubBudget = repo.subscribeBudget(householdId, selectedMonthKey, setBudget, onErr);
    return () => {
      unsubTx();
      unsubBudget();
    };
  }, [householdId, selectedMonthKey, isDemoMode, authUser, repo]);

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
    activity,
    initialCosts,
    checklist,
    furnitureItems,
    recurring,
    monthTransactions,
    recentTransactions,
    budget,
    monthClosures,
    goals,
    goalMovements,
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
