import type {
  ChecklistItem,
  ExpenseCategory,
  FurnitureItem,
  FurniturePriority,
  FurnitureRoom,
  FurnitureStatus,
  GoalType,
  InitialCost,
  InitialCostCategory,
  RecurrenceFrequency,
  RecurringExpense,
  SavingsGoal,
  TransactionCategory,
} from '../types/nido';

export const INITIAL_COST_CATEGORY_LABELS: Record<InitialCostCategory, string> = {
  alquiler: 'Alquiler',
  fianza: 'Fianza legal',
  garantia_adicional: 'Garantía adicional',
  suministros: 'Suministros',
  cerrajeria: 'Cerrajería',
  mudanza: 'Mudanza',
  mobiliario: 'Mobiliario',
  otros: 'Otros',
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  alquiler: 'Alquiler',
  luz: 'Luz',
  agua: 'Agua',
  gas: 'Gas',
  internet: 'Fibra e internet',
  movil: 'Móvil',
  suscripciones: 'Suscripciones',
  seguros: 'Seguros',
  comunidad: 'Comunidad',
  supermercado: 'Supermercado',
  transporte: 'Transporte',
  ocio: 'Ocio y salidas',
  otros: 'Otros',
};

export const TRANSACTION_CATEGORY_LABELS: Record<TransactionCategory, string> = {
  ...EXPENSE_CATEGORY_LABELS,
  liquidacion: 'Liquidación',
};

export const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  mensual: 'Mensual',
  bimestral: 'Bimestral',
  trimestral: 'Trimestral',
  anual: 'Anual',
};

export const ROOM_LABELS: Record<FurnitureRoom, string> = {
  salon: 'Salón',
  dormitorio: 'Dormitorio',
  cocina: 'Cocina',
  baño: 'Baño',
  entrada: 'Entrada',
  terraza: 'Terraza',
  otros: 'Otros',
};

export const PRIORITY_LABELS: Record<FurniturePriority, string> = {
  imprescindible: 'Imprescindible',
  pronto: 'Pronto',
  algun_dia: 'Algún día',
};

export const FURNITURE_STATUS_LABELS: Record<FurnitureStatus, string> = {
  ya_lo_tenemos: 'Ya lo tenemos',
  pendiente: 'Pendiente',
  en_carrito: 'En carrito',
  comprado: 'Comprado',
};

export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  navidad: 'Navidad',
  viajes: 'Viajes',
  cumpleaños: 'Cumpleaños',
  ahorro_comun: 'Ahorro común',
  emergencia: 'Colchón de emergencia',
  custom: 'Personalizada',
};

export const DEFAULT_INITIAL_COSTS: Array<
  Pick<InitialCost, 'concept' | 'category' | 'amount' | 'status' | 'notes'>
> = [
  { concept: 'Primer mes de alquiler', category: 'alquiler', amount: 0, status: 'pendiente', notes: '' },
  { concept: 'Fianza legal (1 mensualidad)', category: 'fianza', amount: 0, status: 'pendiente', notes: 'Obligatorio depositar en INCASÒL en 2 meses.' },
  { concept: 'Garantía adicional (opcional, máx. 2 meses)', category: 'garantia_adicional', amount: 0, status: 'pendiente', notes: '' },
  { concept: 'Alta / cambio de titular luz', category: 'suministros', amount: 0, status: 'pendiente', notes: '' },
  { concept: 'Alta / cambio de titular agua', category: 'suministros', amount: 0, status: 'pendiente', notes: '' },
  { concept: 'Alta / cambio de titular gas', category: 'suministros', amount: 0, status: 'pendiente', notes: '' },
  { concept: 'Instalación fibra / móvil', category: 'suministros', amount: 0, status: 'pendiente', notes: '' },
  { concept: 'Cambio de bombín', category: 'cerrajeria', amount: 0, status: 'pendiente', notes: '' },
  { concept: 'Seguro de hogar (inquilinos)', category: 'otros', amount: 0, status: 'pendiente', notes: '' },
  { concept: 'Mudanza y transporte', category: 'mudanza', amount: 0, status: 'pendiente', notes: '' },
  { concept: 'Limpieza inicial', category: 'otros', amount: 0, status: 'pendiente', notes: '' },
];

export const DEFAULT_CHECKLIST_CATALUNYA: Array<
  Pick<ChecklistItem, 'text' | 'group' | 'order'>
> = [
  {
    text: 'Comprobar en el contrato que la fianza es 1 mensualidad y la garantía adicional no supera 2 mensualidades (sin seguro de impago obligatorio)',
    group: 'Contrato y normativa Catalunya',
    order: 1,
  },
  {
    text: 'Pedir al propietario copia del justificante de depósito de la fianza en el INCASÒL (plazo máximo 2 meses)',
    group: 'Contrato y normativa Catalunya',
    order: 2,
  },
  {
    text: 'Verificar si Sant Sadurní d’Anoia aplica límite de renta como zona tensionada',
    group: 'Contrato y normativa Catalunya',
    order: 3,
  },
  {
    text: 'Leer contadores de luz, agua y gas el día de entrada (foto en el móvil)',
    group: 'Entrega de llaves',
    order: 4,
  },
  {
    text: 'Hacer inventario y fotos fechadas del estado del piso y electrodomésticos',
    group: 'Entrega de llaves',
    order: 5,
  },
  {
    text: 'Cambiar el bombín de la puerta principal y guardar el original',
    group: 'Entrega de llaves',
    order: 6,
  },
  {
    text: 'Cambio de titular de suministros (luz, agua, gas, fibra)',
    group: 'Suministros y trámites',
    order: 7,
  },
  {
    text: 'Contratar seguro de hogar para contenido y responsabilidad civil',
    group: 'Suministros y trámites',
    order: 8,
  },
  {
    text: 'Empadronamiento en el Ayuntamiento de Sant Sadurní d’Anoia',
    group: 'Suministros y trámites',
    order: 9,
  },
];

export const DEFAULT_FURNITURE_ITEMS: Array<
  Pick<FurnitureItem, 'name' | 'room' | 'priority' | 'status' | 'store' | 'qty'>
> = [
  { name: 'Sofá', room: 'salon', priority: 'imprescindible', status: 'pendiente', store: 'IKEA', qty: 1 },
  { name: 'Mesa de comedor', room: 'salon', priority: 'imprescindible', status: 'pendiente', store: 'IKEA', qty: 1 },
  { name: 'Sillas de comedor', room: 'salon', priority: 'imprescindible', status: 'pendiente', store: 'IKEA', qty: 4 },
  { name: 'Estantería', room: 'salon', priority: 'pronto', status: 'pendiente', store: 'IKEA', qty: 1 },
  { name: 'Canapé + colchón', room: 'dormitorio', priority: 'imprescindible', status: 'pendiente', store: 'IKEA', qty: 1 },
  { name: 'Armario', room: 'dormitorio', priority: 'imprescindible', status: 'pendiente', store: 'IKEA', qty: 1 },
  { name: 'Ropa de cama', room: 'dormitorio', priority: 'imprescindible', status: 'pendiente', store: 'IKEA', qty: 2 },
  { name: 'Lámparas', room: 'salon', priority: 'pronto', status: 'pendiente', store: 'IKEA', qty: 3 },
  { name: 'Cortinas y barras', room: 'salon', priority: 'pronto', status: 'pendiente', store: 'IKEA', qty: 2 },
  { name: 'Menaje de cocina básico', room: 'cocina', priority: 'imprescindible', status: 'pendiente', store: 'IKEA', qty: 1 },
  { name: 'Sartenes y ollas', room: 'cocina', priority: 'imprescindible', status: 'pendiente', store: 'IKEA', qty: 1 },
  { name: 'Vajilla completa', room: 'cocina', priority: 'imprescindible', status: 'pendiente', store: 'IKEA', qty: 1 },
  { name: 'Cubiertos', room: 'cocina', priority: 'imprescindible', status: 'pendiente', store: 'IKEA', qty: 1 },
  { name: 'Microondas', room: 'cocina', priority: 'pronto', status: 'pendiente', store: 'IKEA', qty: 1 },
  { name: 'Cubo de basura y reciclaje', room: 'cocina', priority: 'imprescindible', status: 'pendiente', store: 'IKEA', qty: 1 },
  { name: 'Toallas de baño', room: 'baño', priority: 'imprescindible', status: 'pendiente', store: 'IKEA', qty: 4 },
  { name: 'Tendedero plegable', room: 'terraza', priority: 'imprescindible', status: 'pendiente', store: 'IKEA', qty: 1 },
  { name: 'Aspiradora', room: 'otros', priority: 'pronto', status: 'pendiente', store: 'IKEA', qty: 1 },
];

export const DEFAULT_GOALS: Array<
  Pick<SavingsGoal, 'name' | 'icon' | 'color' | 'targetAmount' | 'targetDate' | 'type'>
> = [
  { name: 'Colchón de emergencia', icon: 'shield', color: '#0E5A64', targetAmount: 4500, targetDate: '', type: 'emergencia' },
  { name: 'Ahorro común', icon: 'piggy-bank', color: '#15803D', targetAmount: 3000, targetDate: '', type: 'ahorro_comun' },
  { name: 'Viajes', icon: 'plane', color: '#0284C7', targetAmount: 1500, targetDate: '', type: 'viajes' },
  { name: 'Navidad', icon: 'gift', color: '#D97706', targetAmount: 600, targetDate: '', type: 'navidad' },
  { name: 'Cumpleaños', icon: 'cake', color: '#9333EA', targetAmount: 400, targetDate: '', type: 'cumpleaños' },
];

export const RECURRING_CATALOG_SEED_VERSION = 1;

export type RecurringCatalogGroup =
  | 'Vivienda'
  | 'Suministros y comunicaciones'
  | 'Suscripciones';

export interface RecurringCatalogPreset {
  id: string;
  group: RecurringCatalogGroup;
  concept: string;
  category: ExpenseCategory;
  frequency: RecurrenceFrequency;
  hint?: string;
  aliases?: string[];
}

export const RECURRING_CATALOG_GROUPS: readonly RecurringCatalogGroup[] = [
  'Vivienda',
  'Suministros y comunicaciones',
  'Suscripciones',
];

export const RECURRING_CATALOG_PRESETS: readonly RecurringCatalogPreset[] = [
  // Vivienda
  {
    id: 'seed_rec_alquiler',
    group: 'Vivienda',
    concept: 'Alquiler',
    category: 'alquiler',
    frequency: 'mensual',
    aliases: ['alquiler piso', 'renta piso'],
  },
  {
    id: 'seed_rec_comunidad',
    group: 'Vivienda',
    concept: 'Comunidad',
    category: 'comunidad',
    frequency: 'mensual',
    hint: 'Solo si nos corresponde pagarla',
    aliases: ['gastos de comunidad'],
  },
  {
    id: 'seed_rec_seguro_hogar',
    group: 'Vivienda',
    concept: 'Seguro de hogar / contenido',
    category: 'seguros',
    frequency: 'anual',
    aliases: ['seguro de hogar', 'seguro hogar', 'seguro contenido'],
  },
  // Suministros y comunicaciones
  {
    id: 'seed_rec_electricidad',
    group: 'Suministros y comunicaciones',
    concept: 'Electricidad',
    category: 'luz',
    frequency: 'mensual',
    aliases: ['luz', 'factura luz'],
  },
  {
    id: 'seed_rec_agua',
    group: 'Suministros y comunicaciones',
    concept: 'Agua',
    category: 'agua',
    frequency: 'bimestral',
    aliases: ['agua (bimestral)', 'factura agua'],
  },
  {
    id: 'seed_rec_gas',
    group: 'Suministros y comunicaciones',
    concept: 'Gas',
    category: 'gas',
    frequency: 'mensual',
    aliases: ['factura gas'],
  },
  {
    id: 'seed_rec_fibra_internet',
    group: 'Suministros y comunicaciones',
    concept: 'Fibra / internet',
    category: 'internet',
    frequency: 'mensual',
    aliases: ['fibra y moviles', 'fibra', 'internet'],
  },
  {
    id: 'seed_rec_lineas_moviles',
    group: 'Suministros y comunicaciones',
    concept: 'Líneas móviles compartidas',
    category: 'movil',
    frequency: 'mensual',
    aliases: ['movil', 'moviles', 'lineas moviles'],
  },
  // Suscripciones
  {
    id: 'seed_rec_plataformas_video',
    group: 'Suscripciones',
    concept: 'Plataformas de vídeo',
    category: 'suscripciones',
    frequency: 'mensual',
  },
  {
    id: 'seed_rec_musica',
    group: 'Suscripciones',
    concept: 'Música',
    category: 'suscripciones',
    frequency: 'mensual',
  },
  {
    id: 'seed_rec_nube',
    group: 'Suscripciones',
    concept: 'Almacenamiento en la nube',
    category: 'suscripciones',
    frequency: 'mensual',
  },
  {
    id: 'seed_rec_otras_suscripciones',
    group: 'Suscripciones',
    concept: 'Otras suscripciones compartidas',
    category: 'suscripciones',
    frequency: 'mensual',
  },
];

export interface VariableBudgetSuggestion {
  id: string;
  concept: string;
  category: ExpenseCategory;
  hint?: string;
}

export const VARIABLE_BUDGET_SUGGESTIONS: readonly VariableBudgetSuggestion[] = [
  { id: 'var_supermercado', concept: 'Supermercado y alimentación', category: 'supermercado' },
  { id: 'var_limpieza', concept: 'Limpieza y productos del hogar', category: 'otros' },
  { id: 'var_higiene', concept: 'Higiene y cuidado personal compartido', category: 'otros' },
  { id: 'var_transporte', concept: 'Transporte compartido', category: 'transporte' },
  { id: 'var_ocio', concept: 'Ocio, restaurantes y pedidos a domicilio', category: 'ocio' },
  { id: 'var_mascotas', concept: 'Mascotas', category: 'otros' },
  { id: 'var_mantenimiento', concept: 'Mantenimiento y pequeñas reparaciones', category: 'otros' },
  {
    id: 'var_tasas',
    concept: 'Tasas o recibos del hogar',
    category: 'otros',
    hint: 'Solo si nos corresponden',
  },
];

export function normalizePresetText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function findMatchingRecurringForPreset(
  preset: RecurringCatalogPreset,
  existing: RecurringExpense[]
): RecurringExpense | undefined {
  const targetConcept = normalizePresetText(preset.concept);
  const aliasSet = new Set((preset.aliases ?? []).map(normalizePresetText));
  return existing.find((rec) => {
    if (rec.id === preset.id) return true;
    const normConcept = normalizePresetText(rec.concept);
    return normConcept === targetConcept || aliasSet.has(normConcept);
  });
}

export const SPLIT_PRESETS: Array<{ label: string; a: number; b: number }> = [
  { label: '50 / 50', a: 50, b: 50 },
  { label: '60 / 40', a: 60, b: 40 },
  { label: '40 / 60', a: 40, b: 60 },
  { label: '70 / 30', a: 70, b: 30 },
  { label: '30 / 70', a: 30, b: 70 },
];

export const DEFAULT_CSV_KEYWORDS: Record<ExpenseCategory, string> = {
  alquiler: 'alquiler, renta piso, arrendamiento, inmobiliaria',
  luz: 'endesa, iberdrola, naturgy, holaluz, energia, electricidad',
  agua: 'aigues, agbar, aqualia, agua, ematsa',
  gas: 'gas natural, nedgia, repsol gas, butano',
  internet: 'digi, movistar, orange, vodafone, o2, fibra, pepephone',
  movil: 'simyo, lowi, yoigo, masmovil, finetwork, recarga movil',
  suscripciones: 'netflix, spotify, hbo, disney, prime video, youtube, icloud, apple',
  seguros: 'mapfre, mutua, axa, allianz, adeslas, sanitas, seguro',
  comunidad: 'comunidad, fincas, administrador',
  supermercado: 'mercadona, bonpreu, esclat, lidl, aldi, carrefour, alcampo, consum, caprabo, dia, eroski, supermercado',
  transporte: 'tmb, renfe, rodalies, fgc, metro, uber, cabify, gasolinera, repsol, cepsa, bp, autopista, peaje, parking',
  ocio: 'restaurante, bar, cafe, cafeteria, glovo, just eat, cine, teatro, concierto, amazon, decathlon',
  otros: '',
};

