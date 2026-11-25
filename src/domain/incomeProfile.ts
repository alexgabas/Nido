import { fromCents, roundCents, toCents } from './finance';
import type {
  ExtraPaycheckItem,
  HouseholdIncomeConfig,
  HouseholdSettings,
  MemberIncomeMode,
  MemberIncomeProfile,
  OtherIncomeFrequency,
  OtherIncomeItem,
  OtherIncomeKind,
} from '../types/nido';

export const MAX_EXTRA_PAYCHECKS = 12;
export const MAX_OTHER_INCOMES = 20;
export const MAX_ORDINARY_PAY_COUNT = 24;

export const OTHER_INCOME_FREQUENCY_LABELS: Record<OtherIncomeFrequency, string> = {
  mensual: 'Mensual (×12)',
  trimestral: 'Trimestral (×4)',
  semestral: 'Semestral (×2)',
  anual: 'Anual (×1)',
  puntual: 'Puntual (×1)',
};

export const OTHER_INCOME_KIND_LABELS: Record<OtherIncomeKind, string> = {
  recurrente: 'Recurrente',
  puntual_o_incierto: 'Puntual o incierto',
};

export const SPANISH_MONTH_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'Enero' },
  { value: 2, label: 'Febrero' },
  { value: 3, label: 'Marzo' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Mayo' },
  { value: 6, label: 'Junio' },
  { value: 7, label: 'Julio' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Septiembre' },
  { value: 10, label: 'Octubre' },
  { value: 11, label: 'Noviembre' },
  { value: 12, label: 'Diciembre' },
];

export function getOtherIncomeAnnualMultiplier(frequency: OtherIncomeFrequency): number {
  switch (frequency) {
    case 'mensual':
      return 12;
    case 'trimestral':
      return 4;
    case 'semestral':
      return 2;
    case 'anual':
    case 'puntual':
    default:
      return 1;
  }
}

export function createDefaultMemberIncomeProfile(
  fallbackMonthlyNet = 0
): MemberIncomeProfile {
  const cleanMonthly = roundCents(Math.max(0, Number(fallbackMonthlyNet) || 0));
  return {
    mode: 'rapida',
    quickMonthlyNet: cleanMonthly,
    ordinaryPayAmount: cleanMonthly,
    ordinaryPayCount: 12,
    extraPaychecks: [],
    otherIncomes: [],
  };
}

export function createDefaultHouseholdIncomeConfig(
  settings: Pick<HouseholdSettings, 'incomeA' | 'incomeB'>,
  updatedBy = '',
  updatedAt = ''
): HouseholdIncomeConfig {
  return {
    memberA: createDefaultMemberIncomeProfile(settings.incomeA),
    memberB: createDefaultMemberIncomeProfile(settings.incomeB),
    updatedBy,
    updatedAt,
  };
}

export function sanitizeExtraPaycheckItem(
  raw: unknown,
  idx: number
): ExtraPaycheckItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const idRaw = typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 48) : `extra_${idx + 1}`;
  const labelRaw = typeof r.label === 'string' ? r.label.trim().slice(0, 60) : '';
  const amountNum = Number(r.amount);
  const cleanAmount = Number.isFinite(amountNum) && amountNum >= 0 ? roundCents(amountNum) : 0;
  const amount = cleanAmount === 0 ? 0 : cleanAmount;
  let expectedMonth: number | null = null;
  if (r.expectedMonth !== undefined && r.expectedMonth !== null && r.expectedMonth !== '') {
    const m = Math.round(Number(r.expectedMonth));
    if (Number.isInteger(m) && m >= 1 && m <= 12) {
      expectedMonth = m;
    }
  }
  return {
    id: idRaw,
    label: labelRaw || `Paga extra ${idx + 1}`,
    amount,
    expectedMonth,
  };
}

const VALID_FREQS = new Set<OtherIncomeFrequency>([
  'mensual',
  'trimestral',
  'semestral',
  'anual',
  'puntual',
]);
const VALID_KINDS = new Set<OtherIncomeKind>(['recurrente', 'puntual_o_incierto']);

export function sanitizeOtherIncomeItem(
  raw: unknown,
  idx: number
): OtherIncomeItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const idRaw = typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 48) : `other_${idx + 1}`;
  const conceptRaw = typeof r.concept === 'string' ? r.concept.trim().slice(0, 80) : '';
  const amountNum = Number(r.amount);
  const cleanAmount = Number.isFinite(amountNum) && amountNum >= 0 ? roundCents(amountNum) : 0;
  const amount = cleanAmount === 0 ? 0 : cleanAmount;
  const freqRaw = String(r.frequency ?? 'mensual') as OtherIncomeFrequency;
  const frequency: OtherIncomeFrequency = VALID_FREQS.has(freqRaw) ? freqRaw : 'mensual';
  const kindRaw = String(r.kind ?? 'recurrente') as OtherIncomeKind;
  const kind: OtherIncomeKind = VALID_KINDS.has(kindRaw) ? kindRaw : 'recurrente';
  const defaultInclude = kind === 'recurrente';
  const includeInAnnualEstimate =
    typeof r.includeInAnnualEstimate === 'boolean' ? r.includeInAnnualEstimate : defaultInclude;

  return {
    id: idRaw,
    concept: conceptRaw || `Otro ingreso ${idx + 1}`,
    amount,
    frequency,
    kind,
    includeInAnnualEstimate,
  };
}

export function sanitizeMemberIncomeProfile(
  raw: unknown,
  fallbackMonthlyNet = 0
): MemberIncomeProfile {
  const base = createDefaultMemberIncomeProfile(fallbackMonthlyNet);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const mode: MemberIncomeMode = r.mode === 'detallada' ? 'detallada' : 'rapida';
  const rawQuick =
    typeof r.quickMonthlyNet === 'number' && Number.isFinite(r.quickMonthlyNet) && r.quickMonthlyNet >= 0
      ? roundCents(r.quickMonthlyNet)
      : base.quickMonthlyNet;
  const quickMonthlyNet = rawQuick === 0 ? 0 : rawQuick;
  const rawOrdinary =
    typeof r.ordinaryPayAmount === 'number' && Number.isFinite(r.ordinaryPayAmount) && r.ordinaryPayAmount >= 0
      ? roundCents(r.ordinaryPayAmount)
      : quickMonthlyNet;
  const ordinaryPayAmount = rawOrdinary === 0 ? 0 : rawOrdinary;
  const rawCount = Number(r.ordinaryPayCount);
  const clampedCount = Number.isFinite(rawCount)
    ? Math.max(0, Math.min(MAX_ORDINARY_PAY_COUNT, Math.round(rawCount)))
    : 12;
  const ordinaryPayCount = clampedCount === 0 ? 0 : clampedCount;

  const extraPaychecks: ExtraPaycheckItem[] = Array.isArray(r.extraPaychecks)
    ? r.extraPaychecks
        .slice(0, MAX_EXTRA_PAYCHECKS)
        .map((item, idx) => sanitizeExtraPaycheckItem(item, idx))
        .filter((x): x is ExtraPaycheckItem => x !== null)
    : [];

  const otherIncomes: OtherIncomeItem[] = Array.isArray(r.otherIncomes)
    ? r.otherIncomes
        .slice(0, MAX_OTHER_INCOMES)
        .map((item, idx) => sanitizeOtherIncomeItem(item, idx))
        .filter((x): x is OtherIncomeItem => x !== null)
    : [];

  return {
    mode,
    quickMonthlyNet,
    ordinaryPayAmount,
    ordinaryPayCount,
    extraPaychecks,
    otherIncomes,
  };
}

export function sanitizeHouseholdIncomeConfig(
  raw: unknown,
  fallbackSettings?: Pick<HouseholdSettings, 'incomeA' | 'incomeB'>
): HouseholdIncomeConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    memberA: sanitizeMemberIncomeProfile(r.memberA, fallbackSettings?.incomeA ?? 0),
    memberB: sanitizeMemberIncomeProfile(r.memberB, fallbackSettings?.incomeB ?? 0),
    updatedBy: typeof r.updatedBy === 'string' ? r.updatedBy.slice(0, 128) : '',
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt.slice(0, 64) : '',
  };
}

export interface MemberIncomeSummary {
  mode: MemberIncomeMode;
  ordinaryAnnual: number;
  extrasAnnual: number;
  otherRecurringAnnual: number;
  otherUncertainIncludedAnnual: number;
  otherUncertainExcludedAnnual: number;
  estimatedAnnualNet: number;
  monthlyAverageEquivalent: number;
  includedItemCount: number;
  excludedUncertainCount: number;
  warnings: string[];
}

/**
 * Calcula el neto anual estimado y su equivalente mensual promedio (exacto en céntimos).
 * - Los importes son siempre netos introducidos por el usuario (sin cálculo fiscal).
 * - El equivalente mensual es un PROMEDIO anual (/ 12), no un ingreso bancario mensual exacto.
 * - Los ingresos "puntual_o_incierto" NO cuentan por defecto salvo inclusión explícita.
 */
export function computeMemberIncomeSummary(
  profile: MemberIncomeProfile | null | undefined,
  fallbackMonthlyNet = 0
): MemberIncomeSummary {
  const safe = profile
    ? sanitizeMemberIncomeProfile(profile, fallbackMonthlyNet)
    : createDefaultMemberIncomeProfile(fallbackMonthlyNet);

  if (safe.mode === 'rapida') {
    const monthlyCents = toCents(safe.quickMonthlyNet);
    const annualCents = monthlyCents * 12;
    return {
      mode: 'rapida',
      ordinaryAnnual: fromCents(annualCents),
      extrasAnnual: 0,
      otherRecurringAnnual: 0,
      otherUncertainIncludedAnnual: 0,
      otherUncertainExcludedAnnual: 0,
      estimatedAnnualNet: fromCents(annualCents),
      monthlyAverageEquivalent: fromCents(monthlyCents),
      includedItemCount: monthlyCents > 0 ? 1 : 0,
      excludedUncertainCount: 0,
      warnings: [],
    };
  }

  const ordinaryAnnualCents = toCents(safe.ordinaryPayAmount) * safe.ordinaryPayCount;

  let extrasAnnualCents = 0;
  let positiveExtrasCount = 0;
  for (const extra of safe.extraPaychecks) {
    const c = toCents(extra.amount);
    if (c > 0) {
      extrasAnnualCents += c;
      positiveExtrasCount += 1;
    }
  }

  let otherRecurringAnnualCents = 0;
  let otherUncertainIncludedAnnualCents = 0;
  let otherUncertainExcludedAnnualCents = 0;
  let includedOtherCount = 0;
  let excludedUncertainCount = 0;

  for (const item of safe.otherIncomes) {
    const mult = getOtherIncomeAnnualMultiplier(item.frequency);
    const annualCents = toCents(item.amount) * mult;
    if (item.kind === 'recurrente') {
      if (item.includeInAnnualEstimate) {
        otherRecurringAnnualCents += annualCents;
        if (annualCents > 0) includedOtherCount += 1;
      }
    } else {
      if (item.includeInAnnualEstimate) {
        otherUncertainIncludedAnnualCents += annualCents;
        if (annualCents > 0) includedOtherCount += 1;
      } else {
        otherUncertainExcludedAnnualCents += annualCents;
        if (annualCents > 0) excludedUncertainCount += 1;
      }
    }
  }

  const estimatedAnnualNetCents =
    ordinaryAnnualCents +
    extrasAnnualCents +
    otherRecurringAnnualCents +
    otherUncertainIncludedAnnualCents;

  const monthlyAverageEquivalentCents = Math.round(estimatedAnnualNetCents / 12);

  const warnings: string[] = [];
  if (safe.ordinaryPayCount > 12 && positiveExtrasCount > 0) {
    warnings.push(
      `Has indicado ${safe.ordinaryPayCount} pagas ordinarias y además ${positiveExtrasCount} ${positiveExtrasCount === 1 ? 'paga extra' : 'pagas extra'}. Si cobras en 14 pagas, usa 12 pagas ordinarias + 2 pagas extra para no contarlas dos veces.`
    );
  } else if (safe.ordinaryPayCount === 14 && positiveExtrasCount === 0 && safe.ordinaryPayAmount > 0) {
    warnings.push(
      'Estás contando 14 pagas iguales. Si tus 2 pagas extra tienen importes distintos o quieres ver su mes orientativo, usa 12 ordinarias + 2 pagas extra.'
    );
  }

  return {
    mode: 'detallada',
    ordinaryAnnual: fromCents(ordinaryAnnualCents),
    extrasAnnual: fromCents(extrasAnnualCents),
    otherRecurringAnnual: fromCents(otherRecurringAnnualCents),
    otherUncertainIncludedAnnual: fromCents(otherUncertainIncludedAnnualCents),
    otherUncertainExcludedAnnual: fromCents(otherUncertainExcludedAnnualCents),
    estimatedAnnualNet: fromCents(estimatedAnnualNetCents),
    monthlyAverageEquivalent: fromCents(monthlyAverageEquivalentCents),
    includedItemCount:
      (ordinaryAnnualCents > 0 ? 1 : 0) + positiveExtrasCount + includedOtherCount,
    excludedUncertainCount,
    warnings,
  };
}

/**
 * Resuelve los ingresos mensuales equivalentes efectivos para A y B,
 * manteniendo compatibilidad 100% con hogares existentes que solo guardaron settings.incomeA/B.
 */
export function resolveEffectiveMonthlyIncomes(
  settings: Pick<HouseholdSettings, 'incomeA' | 'incomeB'>,
  incomeConfig?: HouseholdIncomeConfig | null
): {
  incomeA: number;
  incomeB: number;
  summaryA: MemberIncomeSummary;
  summaryB: MemberIncomeSummary;
} {
  const summaryA = computeMemberIncomeSummary(incomeConfig?.memberA, settings.incomeA);
  const summaryB = computeMemberIncomeSummary(incomeConfig?.memberB, settings.incomeB);
  return {
    incomeA: incomeConfig ? summaryA.monthlyAverageEquivalent : roundCents(Math.max(0, settings.incomeA || 0)),
    incomeB: incomeConfig ? summaryB.monthlyAverageEquivalent : roundCents(Math.max(0, settings.incomeB || 0)),
    summaryA,
    summaryB,
  };
}

export function applyPaycheckPreset(
  profile: MemberIncomeProfile,
  preset: '12_prorrateadas' | '14_pagas'
): MemberIncomeProfile {
  const baseAmount =
    profile.ordinaryPayAmount > 0 ? profile.ordinaryPayAmount : profile.quickMonthlyNet;
  if (preset === '12_prorrateadas') {
    return {
      ...profile,
      mode: 'detallada',
      ordinaryPayAmount: baseAmount,
      ordinaryPayCount: 12,
      extraPaychecks: [],
    };
  }
  return {
    ...profile,
    mode: 'detallada',
    ordinaryPayAmount: baseAmount,
    ordinaryPayCount: 12,
    extraPaychecks: [
      { id: 'extra_verano', label: 'Paga extra verano', amount: baseAmount, expectedMonth: 6 },
      { id: 'extra_navidad', label: 'Paga extra Navidad', amount: baseAmount, expectedMonth: 12 },
    ],
  };
}
