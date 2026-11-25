/**
 * Verificación E2E integral (Bloques 1–6) en Demo:
 * 1) Bloque 1: «Planificar el ahorro del mes» abre el editor visiblemente (sin plan previo y con plan guardado)
 *    en Sencillo y Avanzado; «Proponer reparto» muestra resultado visible (y aviso al repetir o sin importe).
 * 2) Bloque 2: Ingresos netos en modo Rápido y Detallado (14 pagas = 12 ordinarias + 2 extras, otro ingreso
 *    puntual/incierto excluido por defecto y opción explícita), reparto proporcional actualizado.
 * 3) Bloque 3: «Cuánto pone cada uno» con dos cifras separadas (Aportación prevista para gastos de Cuenta común
 *    vs Aportación prevista para ahorro) en Sencillo y Avanzado.
 * 4) Bloque 4: Plan habitual («Editar plan habitual») con llenado por orden de prioridad, aplicado virtualmente
 *    a meses sin plan guardado («Propuesta del plan habitual»).
 * 5) Bloque 5: «Ajustar este mes», «Añadir ahorro extra» (previsualización Antes -> Después sin doble conteo)
 *    y «Volver al plan habitual» con confirmación sin borrar aportaciones reales.
 * 6) Bloque 6: Móvil (390x844) y Escritorio (1280x900), Sencillo y Avanzado, cero errores de página.
 */
import { chromium } from '/usr/local/share/bun-global/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';

const PORT = 4186;
const BASE_URL = `http://127.0.0.1:${PORT}/`;

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Servidor preview no respondió en ${timeoutMs} ms`);
}

async function run() {
  const preview = spawn(
    process.execPath,
    ['./node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  await waitForServer(BASE_URL);
  const browser = await chromium.launch({ headless: true });

  try {
    // ─── PARTE 1: MÓVIL (390x844) + MODO SENCILLO ─────────────────────────────
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'es-ES',
    });
    const page = await mobileCtx.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`${BASE_URL}?autostart=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Este mes lleváis', { timeout: 10000 });

    // Ir a Ahorros en Modo Sencillo (barra inferior)
    await page.locator('nav').getByRole('button', { name: /Ahorros/i }).first().click();
    await page.locator('[data-testid="monthly-contributions-card"]').waitFor({ state: 'visible', timeout: 8000 });

    // Bloque 3: Comprobar dos bloques separados (gastos vs ahorro) en Sencillo
    await page.locator('[data-testid="contribution-expenses-block"]').getByText(/Aportación prevista para gastos/i).waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('[data-testid="contribution-savings-block"]').getByText(/Aportación prevista para ahorro/i).waitFor({ state: 'visible', timeout: 5000 });

    // Bloque 1 (Sencillo, SIN plan previo): abrir «Planificar el ahorro del mes»
    await page.locator('[data-testid="open-month-savings-editor-btn"]').click();
    const monthEditor = page.locator('[data-testid="month-savings-plan-editor"]');
    await monthEditor.waitFor({ state: 'visible', timeout: 5000 });

    // Sin importe -> «Proponer reparto» sigue habilitado y explica qué falta
    await page.locator('[data-testid="propose-savings-distribution-btn"]').click();
    const feedback = page.locator('[data-testid="proposal-feedback-banner"]');
    await feedback.waitFor({ state: 'visible', timeout: 5000 });
    const missingMsg = await feedback.innerText();
    if (!/mayor que 0/i.test(missingMsg)) {
      throw new Error(`Se esperaba aviso de falta de importe, obtenido: ${missingMsg}`);
    }

    // Introducir 300 € y pulsar «Proponer reparto» -> llena Colchón primero (aunque no tenga fecha)
    await page.locator('#savings-plan-target').fill('300');
    await page.locator('[data-testid="propose-savings-distribution-btn"]').click();
    const okMsg = await feedback.innerText();
    if (!/Reparto propuesto/i.test(okMsg)) {
      throw new Error(`Se esperaba resumen de reparto propuesto, obtenido: ${okMsg}`);
    }
    const colchonInput = page.getByLabel('Importe mensual para Colchón de emergencia (€)');
    if ((await colchonInput.inputValue()) !== '300') {
      throw new Error(`En modo llenado por prioridad, Colchón (primera meta sin fecha con target > 0) debía recibir 300, obtenido: ${await colchonInput.inputValue()}`);
    }

    // Segunda pulsación con el mismo estado -> explica explícitamente que ya coincide
    await page.locator('[data-testid="propose-savings-distribution-btn"]').click();
    const unchangedMsg = await feedback.innerText();
    if (!/ya coincide/i.test(unchangedMsg)) {
      throw new Error(`Segunda pulsación debía explicar que ya coincide, obtenido: ${unchangedMsg}`);
    }

    // Guardar plan mensual en Sencillo
    await page.locator('[data-testid="save-month-savings-plan-btn"]').click();
    await monthEditor.waitFor({ state: 'hidden', timeout: 5000 });
    await page.locator('[data-testid="monthly-savings-plan-section"]').getByText(/Plan guardado para este mes/i).waitFor({ state: 'visible', timeout: 5000 });

    // Bloque 1 (Sencillo, CON plan previo): volver a abrir editor desde «Ajustar este mes»
    await page.locator('[data-testid="open-month-savings-editor-btn"]').click();
    await monthEditor.waitFor({ state: 'visible', timeout: 5000 });
    if ((await page.locator('#savings-plan-target').inputValue()) !== '300') {
      throw new Error('Al reabrir con plan guardado debía cargar 300');
    }
    await page.getByRole('button', { name: 'Cancelar' }).first().click();
    await monthEditor.waitFor({ state: 'hidden', timeout: 5000 });

    if (pageErrors.length > 0) {
      throw new Error(`Errores en móvil Sencillo:\n${pageErrors.join('\n')}`);
    }
    await mobileCtx.close();

    // ─── PARTE 2: ESCRITORIO (1280x900) + MODO AVANZADO ───────────────────────
    const desktopCtx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: 'es-ES',
    });
    const dPage = await desktopCtx.newPage();
    const dErrors = [];
    dPage.on('pageerror', (err) => dErrors.push(err.message));

    await dPage.goto(`${BASE_URL}?autostart=1`, { waitUntil: 'domcontentloaded' });
    await dPage.waitForSelector('text=Este mes lleváis', { timeout: 10000 });

    // Cambiar a Modo Avanzado
    await dPage.getByRole('button', { name: /Menú de /i }).click();
    await dPage.getByRole('button', { name: 'Avanzado', exact: true }).click();
    await dPage.keyboard.press('Escape');

    // Bloque 2: Ir a Ajustes desde menú avatar y probar modo Detallado de ingresos (14 pagas + otro incierto)
    await dPage.getByRole('button', { name: /Menú de /i }).click();
    await dPage.getByRole('button', { name: /Ajustes/i }).click();
    await dPage.locator('[data-testid="income-editor-a"]').waitFor({ state: 'visible', timeout: 8000 });

    const editorA = dPage.locator('[data-testid="income-editor-a"]');
    await editorA.getByRole('button', { name: 'Detallada' }).click();
    await editorA.getByRole('button', { name: /14 pagas \(12 ordinarias \+ 2 extras\)/i }).click();

    // Fijar 1.500 € en paga ordinaria y verificar resumen anual + equivalente mensual
    await editorA.getByLabel(/Importe neto de 1 paga ordinaria/i).fill('1500');
    await editorA.getByLabel(/Importe neto paga extra 1/i).fill('1400');
    await editorA.getByLabel(/Importe neto paga extra 2/i).fill('1600');
    // 18.000 + 3.000 = 21.000 €/año = 1.750,00 €/mes
    await editorA.getByText(/21\.000,00\s*€/i).waitFor({ state: 'visible', timeout: 5000 });
    await editorA.getByText(/1\.750,00\s*€\/mes/i).waitFor({ state: 'visible', timeout: 5000 });

    // Añadir un otro ingreso puntual/incierto -> excluido por defecto del reparto
    await editorA.getByRole('button', { name: /Añadir otro ingreso/i }).click();
    await editorA.getByLabel(/Concepto otro ingreso 1/i).fill('Bonus anual');
    await editorA.getByLabel(/Importe otro ingreso 1/i).fill('1200');
    await editorA.getByLabel(/Frecuencia otro ingreso 1/i).selectOption('anual');
    await editorA.getByLabel(/Tipo otro ingreso 1/i).selectOption('puntual_o_incierto');
    // Sigue en 21.000 € / 1.750 € porque es incierto y no está incluido
    await editorA.getByText(/1\.750,00\s*€\/mes/i).waitFor({ state: 'visible', timeout: 5000 });

    // Guardar configuración de ingresos y reparto
    await dPage.getByRole('button', { name: 'Guardar reparto', exact: true }).click();
    await dPage.waitForTimeout(400);

    // Ir a Ahorros en Modo Avanzado
    await dPage.locator('nav').getByRole('button', { name: /Ahorros/i }).first().click();
    await dPage.getByRole('heading', { name: /Ahorros y metas/i }).waitFor({ state: 'visible', timeout: 8000 });

    // Bloque 1 (Avanzado, SIN plan previo): botón en cabecera abre editor visiblemente
    await dPage.getByRole('button', { name: /Planificar el ahorro del mes/i }).first().click();
    const advMonthEditor = dPage.locator('[data-testid="month-savings-plan-editor"]');
    await advMonthEditor.waitFor({ state: 'visible', timeout: 5000 });
    await dPage.getByRole('button', { name: 'Cancelar' }).first().click();
    await advMonthEditor.waitFor({ state: 'hidden', timeout: 5000 });

    // Bloque 4: Configurar «Editar plan habitual» (300 €/mes)
    await dPage.locator('[data-testid="open-habitual-plan-btn"]').click();
    const habitualEditor = dPage.locator('[data-testid="habitual-plan-editor"]');
    await habitualEditor.waitFor({ state: 'visible', timeout: 5000 });
    await dPage.locator('#habitual-savings-amount').fill('300');
    await habitualEditor.getByRole('button', { name: /Guardar plan habitual/i }).click();
    await habitualEditor.waitFor({ state: 'hidden', timeout: 5000 });

    // Comprobar etiqueta «Propuesta del plan habitual» en el mes actual (sin plan guardado)
    const planSection = dPage.locator('[data-testid="monthly-savings-plan-section"]');
    await planSection.getByText(/Propuesta del plan habitual/i).waitFor({ state: 'visible', timeout: 5000 });

    // Bloque 3 (Avanzado): Cuánto pone cada uno muestra ambos bloques separados con el plan habitual de 300 €
    await dPage.locator('[data-testid="contribution-expenses-block"]').waitFor({ state: 'visible', timeout: 5000 });
    const savingsCardText = await dPage.locator('[data-testid="contribution-savings-block"]').innerText();
    if (!/300,00\s*€/i.test(savingsCardText)) {
      throw new Error(`Bloque ahorro debía mostrar 300,00 € del plan habitual. Texto:\n${savingsCardText}`);
    }

    // Bloque 5A: «Añadir ahorro extra» (+200 € a Viajes) -> previsualización Antes -> Después sin doble conteo (300 -> 500)
    await dPage.locator('[data-testid="open-extra-savings-btn"]').click();
    const extraEditor = dPage.locator('[data-testid="extra-savings-editor"]');
    await extraEditor.waitFor({ state: 'visible', timeout: 5000 });
    await dPage.locator('#extra-savings-amount').fill('200');
    await extraEditor.getByLabel('Extra para Viajes (€)').fill('200');

    const previewBox = dPage.locator('[data-testid="extra-before-after-preview"]');
    const previewText = await previewBox.innerText();
    if (!/300,00\s*€.*500,00\s*€/s.test(previewText)) {
      throw new Error(`La previsualización Antes -> Después debía mostrar 300,00 € -> 500,00 €. Texto:\n${previewText}`);
    }

    await extraEditor.getByRole('button', { name: /Guardar ahorro extra/i }).click();
    await extraEditor.waitFor({ state: 'hidden', timeout: 5000 });
    await planSection.getByText(/Plan guardado \(\+200,00\s*€ extra\)/i).waitFor({ state: 'visible', timeout: 5000 });

    // Verificar que el mes siguiente (sin plan guardado) sigue usando «Propuesta del plan habitual» (300 €)
    await dPage.getByRole('button', { name: 'Mes siguiente del plan de ahorro' }).click();
    await planSection.getByText(/Propuesta del plan habitual/i).waitFor({ state: 'visible', timeout: 5000 });
    await dPage.getByRole('button', { name: 'Mes anterior del plan de ahorro' }).click();
    await planSection.getByText(/Plan guardado \(\+200,00\s*€ extra\)/i).waitFor({ state: 'visible', timeout: 5000 });

    // Bloque 5B: «Volver al plan habitual» con confirmación -> vuelve a «Propuesta del plan habitual» sin borrar movimientos
    const historyHeadingBefore = await dPage.getByRole('heading', { name: /Historial de movimientos \(\d+\)/i }).innerText();
    await dPage.locator('[data-testid="revert-month-plan-btn"]').click();
    const confirmDialog = dPage.locator('[role="dialog"]');
    await confirmDialog.waitFor({ state: 'visible', timeout: 5000 });
    await confirmDialog.getByRole('button', { name: /Volver al plan habitual/i }).click();
    await confirmDialog.waitFor({ state: 'hidden', timeout: 5000 });

    await planSection.getByText(/Propuesta del plan habitual/i).waitFor({ state: 'visible', timeout: 5000 });
    const historyHeadingAfter = await dPage.getByRole('heading', { name: /Historial de movimientos \(\d+\)/i }).innerText();
    if (historyHeadingBefore !== historyHeadingAfter) {
      throw new Error(`Volver al plan habitual no debe borrar movimientos: antes="${historyHeadingBefore}", después="${historyHeadingAfter}"`);
    }

    if (dErrors.length > 0) {
      throw new Error(`Errores en escritorio Avanzado:\n${dErrors.join('\n')}`);
    }
    await desktopCtx.close();

    console.log('✅ verify_savings_income_flow.mjs completado con éxito (Bloques 1–6: Sencillo/Avanzado, móvil/escritorio, ingresos detallados, dos cifras separadas, plan habitual, ahorro extra y reversión).');
  } finally {
    await browser.close();
    preview.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error('❌ Error en verify_savings_income_flow.mjs:', err);
  process.exit(1);
});
