import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  calculateCoupleBalance,
  computeEffectiveSplitPctA,
  computeFurnitureSummary,
  computeGoalProgress,
  computeInitialCostsSummary,
  formatDateES,
  formatEUR,
  formatPctES,
  getTodayLocalISO,
} from '../domain/finance';
import {
  FURNITURE_STATUS_LABELS,
  INITIAL_COST_CATEGORY_LABELS,
  ROOM_LABELS,
  TRANSACTION_CATEGORY_LABELS,
} from '../domain/presets';
import type {
  FurnitureItem,
  GoalMovement,
  Household,
  HouseholdMember,
  InitialCost,
  SavingsGoal,
  Transaction,
} from '../types/nido';

export type PdfReportScope = 'mensual' | 'mudanza' | 'ahorros' | 'completo';

interface PdfExportInput {
  scope: PdfReportScope;
  household: Household;
  members: HouseholdMember[];
  fromDate: string;
  toDate: string;
  transactions: Transaction[];
  initialCosts: InitialCost[];
  items: FurnitureItem[];
  goals: SavingsGoal[];
  goalMovements: GoalMovement[];
}

function memberLabel(uid: string, members: HouseholdMember[]): string {
  if (uid === 'cuenta_comun' || uid === 'comun') return 'Cuenta común';
  return members.find((m) => m.uid === uid)?.displayName || uid;
}

export function exportNidoPDF(input: PdfExportInput): void {
  const {
    scope,
    household,
    members,
    fromDate,
    toDate,
    transactions,
    initialCosts,
    items,
    goals,
    goalMovements,
  } = input;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const splitA = computeEffectiveSplitPctA(household.settings);
  const splitB = Math.round((100 - splitA) * 10) / 10;
  const memberA = members.find((m) => m.role === 'member_a') ?? members[0];
  const memberB = members.find((m) => m.role === 'member_b') ?? members[1];
  const nameA = memberA?.displayName?.split(' ')[0] || 'Persona A';
  const nameB = memberB?.displayName?.split(' ')[0] || 'Persona B';

  const titles: Record<PdfReportScope, string> = {
    mensual: 'Informe de gastos mensuales',
    mudanza: 'Informe de mudanza y mobiliario',
    ahorros: 'Informe de ahorros y metas',
    completo: 'Informe completo del hogar',
  };

  // Header
  doc.setFillColor(14, 90, 100);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.text(`Nido · ${household.name}`, 14, 13);
  doc.setFontSize(10);
  doc.text(
    `${titles[scope]} | Periodo: ${formatDateES(fromDate)} – ${formatDateES(toDate)} | Reparto: ${nameA} ${splitA}% / ${nameB} ${splitB}%`,
    14,
    21
  );

  doc.setTextColor(15, 31, 36);
  let cursorY = 36;

  const filteredTx = transactions.filter((t) => t.date >= fromDate && t.date <= toDate);
  const filteredMovements = goalMovements.filter((m) => m.date >= fromDate && m.date <= toDate);

  if (scope === 'mensual' || scope === 'completo') {
    const balance = calculateCoupleBalance(filteredTx, memberA, memberB);
    doc.setFontSize(13);
    doc.text('1. Resumen mensual y liquidación', 14, cursorY);
    cursorY += 5;

    autoTable(doc, {
      startY: cursorY,
      head: [['Total gastado', `Pagado ${nameA}`, `Pagado ${nameB}`, 'Cuenta común', 'Estado de saldo']],
      body: [[
        formatEUR(balance.totalSpent),
        formatEUR(balance.paidA),
        formatEUR(balance.paidB),
        formatEUR(balance.paidComun),
        balance.summaryText,
      ]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [14, 90, 100] },
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

    autoTable(doc, {
      startY: cursorY,
      head: [['Fecha', 'Concepto', 'Categoría', 'Pagó', 'Reparto', 'Importe']],
      body: filteredTx.length
        ? filteredTx.map((t) => [
            formatDateES(t.date),
            t.concept,
            TRANSACTION_CATEGORY_LABELS[t.category] || t.category,
            memberLabel(t.paidBy, members),
            `${t.splitPctA}% / ${Math.round((100 - t.splitPctA) * 10) / 10}%`,
            formatEUR(t.amount),
          ])
        : [['—', 'Sin movimientos en el periodo seleccionado', '—', '—', '—', '0,00 €']],
      styles: { fontSize: 8.5 },
      headStyles: { fillColor: [30, 41, 59] },
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }

  if (scope === 'mudanza' || scope === 'completo') {
    if (cursorY > 235) {
      doc.addPage();
      cursorY = 20;
    }
    const icSummary = computeInitialCostsSummary(
      initialCosts,
      splitA,
      memberA?.uid || 'member_a',
      memberB?.uid || 'member_b'
    );
    const furSummary = computeFurnitureSummary(items);

    doc.setFontSize(13);
    doc.text('2. Gastos iniciales y mobiliario', 14, cursorY);
    cursorY += 5;

    autoTable(doc, {
      startY: cursorY,
      head: [['Gastos iniciales previstos', 'Pagado', 'Pendiente', 'Mobiliario gastado', 'Mobiliario pendiente']],
      body: [[
        formatEUR(icSummary.totalPlanned),
        formatEUR(icSummary.totalPaid),
        formatEUR(icSummary.totalPending),
        formatEUR(furSummary.totalSpent),
        formatEUR(furSummary.totalPending),
      ]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [14, 90, 100] },
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

    autoTable(doc, {
      startY: cursorY,
      head: [['Concepto inicial', 'Categoría', 'Estado', 'Pagó', 'Importe']],
      body: initialCosts.map((c) => [
        c.concept,
        INITIAL_COST_CATEGORY_LABELS[c.category],
        c.status === 'pagado' ? 'Pagado' : 'Pendiente',
        memberLabel(c.paidBy, members),
        formatEUR(c.amount),
      ]),
      styles: { fontSize: 8.5 },
      headStyles: { fillColor: [30, 41, 59] },
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

    autoTable(doc, {
      startY: cursorY,
      head: [['Artículo', 'Estancia', 'Estado', 'Uds.', 'Total']],
      body: items.map((it) => [
        it.name,
        ROOM_LABELS[it.room],
        FURNITURE_STATUS_LABELS[it.status],
        String(it.qty),
        formatEUR(it.unitPrice * it.qty),
      ]),
      styles: { fontSize: 8.5 },
      headStyles: { fillColor: [30, 41, 59] },
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }

  if (scope === 'ahorros' || scope === 'completo') {
    if (cursorY > 235) {
      doc.addPage();
      cursorY = 20;
    }
    const todayISO = getTodayLocalISO();
    doc.setFontSize(13);
    doc.text('3. Metas de ahorro', 14, cursorY);
    cursorY += 5;

    autoTable(doc, {
      startY: cursorY,
      head: [['Meta', 'Ahorrado', 'Objetivo', 'Progreso', 'Fecha objetivo']],
      body: goals.map((g) => {
        const prog = computeGoalProgress(g, goalMovements, todayISO);
        return [
          g.name,
          formatEUR(prog.savedAmount),
          formatEUR(g.targetAmount),
          formatPctES(prog.pct),
          g.targetDate ? formatDateES(g.targetDate) : 'Sin fecha',
        ];
      }),
      styles: { fontSize: 8.5 },
      headStyles: { fillColor: [14, 90, 100] },
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

    if (filteredMovements.length > 0) {
      autoTable(doc, {
        startY: cursorY,
        head: [['Fecha', 'Meta', 'Persona', 'Nota', 'Importe']],
        body: filteredMovements.map((m) => [
          formatDateES(m.date),
          goals.find((g) => g.id === m.goalId)?.name || 'Meta',
          memberLabel(m.by, members),
          m.note || '—',
          formatEUR(m.amount),
        ]),
        styles: { fontSize: 8.5 },
        headStyles: { fillColor: [30, 41, 59] },
      });
    }
  }

  const filename = `nido-${scope}-${fromDate}_${toDate}.pdf`;
  doc.save(filename);
}
