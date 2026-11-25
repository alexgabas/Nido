/**
 * Verificación E2E de «Plan de ahorro mensual» en Ahorros (Modo Avanzado y Modo Sencillo).
 * Comprueba:
 * 1) No se añade pestaña principal ni panel nuevo en Inicio.
 * 2) En Avanzado -> Ahorros: abrir «Planificar el ahorro del mes», comprobar referencia secundaria
 *    de capacidad sin auto-relleno en el input manual.
 * 3) Proponer reparto con importe insuficiente (muestra desviación bajo cuota recomendada y 0 €
 *    en metas sin fecha) y con excedente (muestra "Sin asignar").
 * 4) Reordenar prioridades, ajustar importe manual en meta sin fecha («Colchón de emergencia»)
 *    y guardar plan comprobando que NO crea movimientos ni cambia el Total ahorrado.
 * 5) Comprobar aportación previa existente en Demo («Viajes» 320 € > 150 € -> exceso +170 € y pendiente 0 €).
 * 6) Usar «Aportar pendiente» desde el plan (reutilizando modal con importe pre-rellenado editable y selector de persona).
 * 7) Registrar una retirada en el mismo mes y comprobar que se muestra aparte sin restar de «Aportado».
 * 8) Archivar una meta incluida en el plan y comprobar que el plan guardado sigue legible con etiqueta «Archivada».
 * 9) Cambiar a Modo Sencillo y comprobar tarjeta resumen (Planificado, Aportado, Ver detalle del plan) sin cambiar de modo.
 */
import { chromium } from '/usr/local/share/bun-global/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';

const PORT = 4183;
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
  let logs = '';
  preview.stdout.on('data', (d) => (logs += d.toString()));
  preview.stderr.on('data', (d) => (logs += d.toString()));

  await waitForServer(BASE_URL);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES' });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`${BASE_URL}?autostart=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Este mes lleváis', { timeout: 10000 });

    // 1) Sin nueva pestaña principal y sin panel de plan de ahorro en Inicio
    const navPlanCount = await page.locator('nav').getByRole('button', { name: /Plan de ahorro/i }).count();
    if (navPlanCount > 0) {
      throw new Error('Plan de ahorro no debe ser una pestaña principal');
    }
    const inicioHasPlan = await page.locator('#savings-plan-section').count();
    if (inicioHasPlan > 0) {
      throw new Error('Inicio no debe renderizar un panel nuevo de plan de ahorro');
    }

    // Cambiar a Modo Avanzado
    await page.getByRole('button', { name: /Menú de /i }).click();
    await page.getByRole('button', { name: 'Avanzado', exact: true }).click();
    await page.keyboard.press('Escape');

    // Ir a la pestaña Ahorros
    await page.locator('nav').getByRole('button', { name: /Ahorros/i }).first().click();
    await page.getByRole('heading', { name: /Ahorros y metas/i }).waitFor({ state: 'visible', timeout: 8000 });

    // Capturar recuento inicial de movimientos en Historial
    const historyHeadingBefore = await page.getByRole('heading', { name: /Historial de movimientos \(\d+\)/i }).innerText();

    // 2) Abrir «Planificar el ahorro del mes»
    await page.getByRole('button', { name: /Planificar el ahorro del mes/i }).first().click();
    const targetInput = page.locator('#savings-plan-target-amount');
    await targetInput.waitFor({ state: 'visible', timeout: 5000 });

    // Referencia secundaria visible y NO auto-rellenada en el input manual
    await page.getByText(/Referencia orientativa \(no se aplica sola\)/i).waitFor({ state: 'visible', timeout: 5000 });
    const initialTargetVal = await targetInput.inputValue();
    if (initialTargetVal !== '') {
      throw new Error(`El importe a apartar no debe auto-rellenarse con la capacidad; valor="${initialTargetVal}"`);
    }

    // 3A) Proponer reparto con importe insuficiente (150 € < ~196,67 € de Viajes)
    await targetInput.fill('150');
    await page.getByRole('button', { name: /Proponer reparto/i }).click();
    const viajesInput = page.locator('#plan-amt-goal_3');
    const colchonInput = page.locator('#plan-amt-goal_1');
    if ((await viajesInput.inputValue()) !== '150') {
      throw new Error(`Esperaba 150 en Viajes con presupuesto insuficiente, obtenido: ${await viajesInput.inputValue()}`);
    }
    if ((await colchonInput.inputValue()) !== '0') {
      throw new Error(`Meta sin fecha debe proponer 0, obtenido: ${await colchonInput.inputValue()}`);
    }
    await page.getByText(/Metas por debajo de su cuota recomendada/i).waitFor({ state: 'visible', timeout: 5000 });

    // 3B) Proponer reparto con excedente (400 € > ~196,67 € de Viajes) -> deja sobrante "Sin asignar"
    await targetInput.fill('400');
    await page.getByRole('button', { name: /Proponer reparto/i }).click();
    await page.getByText(/sin asignar/i).first().waitFor({ state: 'visible', timeout: 5000 });

    // 4) Reordenar prioridad + ajustar manualmente Colchón (100 €) y Viajes (150 €) + guardar
    await page.getByRole('button', { name: 'Bajar prioridad de Colchón de emergencia' }).click();
    await page.getByRole('button', { name: 'Subir prioridad de Colchón de emergencia' }).click();
    await colchonInput.fill('100');
    await viajesInput.fill('150');
    await page.getByRole('button', { name: /Guardar plan/i }).click();

    // Esperar a que cierre el editor y comprobar que NO creó movimientos
    await targetInput.waitFor({ state: 'hidden', timeout: 5000 });
    const historyHeadingAfterSave = await page.getByRole('heading', { name: /Historial de movimientos \(\d+\)/i }).innerText();
    if (historyHeadingAfterSave !== historyHeadingBefore) {
      throw new Error(`Guardar plan no debe crear movimientos: antes="${historyHeadingBefore}", después="${historyHeadingAfterSave}"`);
    }

    // 5) Comprobar aportación previa de Viajes (320 € frente a 150 € -> +170,00 € sobre lo planificado, pendiente 0 €)
    const planSection = page.locator('#savings-plan-section');
    await planSection.getByText(/\+170,00\s*€ sobre lo planificado/i).waitFor({ state: 'visible', timeout: 5000 });

    // 6) Aportar pendiente de Colchón de emergencia (100,00 €) reutilizando modal existente
    const colchonPlanRowBtn = planSection.getByRole('button', { name: /Aportar pendiente \(100,00\s*€\)/i });
    await colchonPlanRowBtn.waitFor({ state: 'visible', timeout: 5000 });
    await colchonPlanRowBtn.click();

    const moveModal = page.locator('[role="dialog"]');
    await moveModal.waitFor({ state: 'visible', timeout: 5000 });
    const moveAmountVal = await moveModal.locator('#move-amount').inputValue();
    if (moveAmountVal !== '100') {
      throw new Error(`El modal Aportar debía pre-rellenarse con 100, obtenido "${moveAmountVal}"`);
    }
    // Comprobar selector de persona presente y confirmar
    await moveModal.getByRole('button', { name: /Marta/i }).click();
    await moveModal.getByRole('button', { name: 'Confirmar' }).click();
    await moveModal.waitFor({ state: 'hidden', timeout: 5000 });

    // Verificar que Colchón pasó a Plan cubierto
    await planSection.getByText(/Plan cubierto/i).first().waitFor({ state: 'visible', timeout: 5000 });

    // 7) Registrar una retirada de 40 € en Colchón y comprobar que se muestra aparte sin restar de Aportado (100,00 €)
    const colchonCard = page.locator('[data-testid="goal-card-goal_1"]');
    await colchonCard.getByRole('button', { name: 'Retirar' }).click();
    await moveModal.waitFor({ state: 'visible', timeout: 5000 });
    await moveModal.locator('#move-amount').fill('40');
    await moveModal.getByRole('button', { name: 'Confirmar' }).click();
    await moveModal.waitFor({ state: 'hidden', timeout: 5000 });

    await planSection.getByText(/Retirado este mes:\s*40,00\s*€/i).waitFor({ state: 'visible', timeout: 5000 });
    // El plan de Colchón sigue cubierto (100 € aportado; retirada 40 € mostrada aparte)
    const colchonCardText = await colchonCard.innerText();
    if (!/Aportado:\s*100,00\s*€/i.test(colchonCardText) || !/Retirado en el mes \(aparte\):\s*40,00\s*€/i.test(colchonCardText)) {
      throw new Error(`La tarjeta de Colchón debía mostrar Aportado 100,00 € y Retirado 40,00 € aparte. Texto:\n${colchonCardText}`);
    }

    // 8) Archivar Colchón de emergencia y comprobar que el plan histórico conserva la fila legible con badge «Archivada»
    await colchonCard.getByRole('button', { name: /Archivar o eliminar meta Colchón de emergencia/i }).click();
    await page.getByRole('button', { name: /Archivar \(recomendado\)/i }).click();
    await planSection.getByText('Archivada').waitFor({ state: 'visible', timeout: 5000 });
    const planTextAfterArchive = await planSection.innerText();
    if (!/Colchón de emergencia/i.test(planTextAfterArchive) || !/100,00\s*€/i.test(planTextAfterArchive)) {
      throw new Error('Al archivar la meta, el plan guardado debe conservar su nombre y asignación histórica');
    }

    // 9) Cambiar a Modo Sencillo y comprobar tarjeta resumen sin volver a Avanzado
    await page.getByRole('button', { name: /Menú de /i }).click();
    await page.getByRole('button', { name: 'Sencillo', exact: true }).click();
    await page.keyboard.press('Escape');

    await page.locator('#savings-plan-section').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#savings-plan-section').getByRole('button', { name: /Ver detalle del plan/i }).click();
    await page.locator('#savings-plan-section').getByText(/Colchón de emergencia/i).waitFor({ state: 'visible', timeout: 5000 });

    // Confirmar que seguimos en Modo Sencillo (el título en Sencillo es "Ahorros", no "Ahorros y metas")
    const h1Text = (await page.locator('h1').first().innerText()).trim();
    if (h1Text !== 'Ahorros') {
      throw new Error(`Debíamos seguir en Modo Sencillo (h1="Ahorros"), obtenido "${h1Text}"`);
    }

    if (pageErrors.length > 0) {
      throw new Error(`Errores de página detectados:\n${pageErrors.join('\n')}`);
    }

    console.log('✅ verify_savings_plan.mjs completado con éxito (Avanzado + Sencillo, propuesta, aportación previa, retirada aparte, exceso y archivado).');
  } finally {
    await browser.close();
    preview.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error('❌ Error en verify_savings_plan.mjs:', err);
  process.exit(1);
});
