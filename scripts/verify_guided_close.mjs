/**
 * Verificación E2E del cierre de mes guiado en Nido (Modo Sencillo y Modo Avanzado).
 * Comprueba:
 * 1) Aviso discreto en Inicio los primeros días del mes (con reloj simulado día 3) y salto directo al asistente.
 * 2) Asistente en Modo Sencillo (3 pasos: Pendientes, Cuentas, Cerrar).
 * 3) Asistente en Modo Avanzado (5 pasos: Pendientes, Revisión, Cuentas, Próximo mes, Cerrar).
 * 4) Paso 1: registrar un cargo previsto con importe editado y marcar otro como "No se ha producido este mes"
 *    (desaparece de este mes pero sigue activo y pendiente en el mes siguiente).
 * 5) Reanudar a mitad tras cerrar y volver a abrir el asistente (progreso derivado del estado real).
 * 6) Paso 3: registrar liquidación con el flujo existente.
 * 7) Paso 4: copiar presupuestos al mes siguiente sin sobrescribir límites existentes.
 * 8) Paso 5: cerrar el mes y reabrir en modo solo lectura.
 */
import { chromium } from '/usr/local/share/bun-global/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';

const PORT = 4181;
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
    // ─── 0) Verificar aviso discreto en Inicio en día 3 del mes ───
    const bannerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES' });
    const bannerPage = await bannerCtx.newPage();
    await bannerPage.clock.install({ time: new Date(2026, 10, 3, 10, 0, 0) }); // 3 nov 2026 local
    await bannerPage.goto(`${BASE_URL}?autostart=1`, { waitUntil: 'domcontentloaded' });
    await bannerPage.waitForSelector('text=Este mes lleváis', { timeout: 10000 });
    const reminderBanner = bannerPage.locator(
      'section[aria-label="Recordatorio de cierre del mes anterior"]'
    );
    await reminderBanner.waitFor({ state: 'visible', timeout: 8000 });
    await reminderBanner.getByRole('button', { name: /Cerrar /i }).click();
    const bannerDialog = bannerPage.getByRole('dialog');
    await bannerDialog.waitFor({ state: 'visible', timeout: 5000 });
    const bannerDialogTitle = (await bannerDialog.locator('#guided-close-title').textContent()) || '';
    if (!/octubre/i.test(bannerDialogTitle)) {
      throw new Error(`El aviso de inicio debía abrir octubre, abrió: "${bannerDialogTitle}"`);
    }
    await bannerCtx.close();

    // ─── Recorrido principal: Sencillo (3 pasos) + Avanzado (5 pasos) ───
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES' });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto(`${BASE_URL}?autostart=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Este mes lleváis', { timeout: 10000 });

    // 1) Modo Sencillo: abrir Mensual y verificar asistente de 3 pasos
    await page.getByRole('button', { name: /Ver detalle/i }).first().click();
    await page.getByRole('button', { name: 'Cerrar mes' }).waitFor({ state: 'visible', timeout: 8000 });
    await page.getByRole('button', { name: 'Cerrar mes' }).click();

    const dialogSencillo = page.getByRole('dialog');
    await dialogSencillo.waitFor({ state: 'visible', timeout: 5000 });

    const stepsSencillo = await dialogSencillo
      .locator('nav[aria-label="Pasos del cierre de mes"] li')
      .count();
    if (stepsSencillo !== 3) {
      throw new Error(`Esperados 3 pasos en Modo Sencillo, encontrados ${stepsSencillo}`);
    }

    await dialogSencillo.getByRole('button', { name: /Cerrar asistente/i }).click();
    await dialogSencillo.waitFor({ state: 'hidden', timeout: 5000 });

    // 2) Cambiar a Modo Avanzado
    await page.getByRole('button', { name: /Menú de /i }).click();
    await page.getByRole('button', { name: 'Avanzado', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Cerrar mes' }).waitFor({ state: 'visible', timeout: 8000 });

    // Configurar primero un presupuesto distinto en el mes siguiente (para verificar NO sobrescritura)
    await page.getByRole('button', { name: 'Mes siguiente' }).click();
    await page.getByRole('button', { name: /Ajustar presupuestos|Editar límites/i }).first().click();
    const budgetDialog = page.getByRole('dialog');
    await budgetDialog.waitFor({ state: 'visible', timeout: 5000 });
    await budgetDialog.locator('#bud-supermercado').fill('420');
    await budgetDialog.getByRole('button', { name: /Guardar límites/i }).click();
    await budgetDialog.waitFor({ state: 'hidden', timeout: 5000 });

    // Volver al mes actual
    await page.getByRole('button', { name: 'Mes anterior' }).click();
    await page.getByRole('button', { name: 'Cerrar mes' }).waitFor({ state: 'visible', timeout: 5000 });

    // Abrir asistente en Modo Avanzado
    await page.getByRole('button', { name: 'Cerrar mes' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });

    const stepsAvanzado = await dialog
      .locator('nav[aria-label="Pasos del cierre de mes"] li')
      .count();
    if (stepsAvanzado !== 5) {
      throw new Error(`Esperados 5 pasos en Modo Avanzado, encontrados ${stepsAvanzado}`);
    }

    // 3) Paso 1: registrar 1 pendiente con importe editado y omitir otro
    const pendingList = dialog.locator('ul[aria-label="Cargos previstos pendientes"] > li');
    const initialPendingCount = await pendingList.count();
    if (initialPendingCount < 2) {
      throw new Error(`Esperados al menos 2 pendientes en Demo, encontrados ${initialPendingCount}`);
    }

    // Elegir una plantilla mensual para omitir (y comprobarla en el mes siguiente) y otra para registrar con importe editado
    const itemCount = await pendingList.count();
    let skipIdx = -1;
    for (let i = 0; i < itemCount; i++) {
      const txt = (await pendingList.nth(i).locator('p.text-sm.font-bold').textContent())?.trim() || '';
      if (!/bimestral|trimestral|anual/i.test(txt)) {
        skipIdx = i;
        break;
      }
    }
    if (skipIdx === -1) skipIdx = 0;
    const regIdx = skipIdx === 0 ? 1 : 0;

    const firstItem = pendingList.nth(regIdx);
    const firstConcept = (await firstItem.locator('p.text-sm.font-bold').textContent())?.trim() || '';
    await firstItem.locator('input').fill('73.50');
    await firstItem.getByRole('button', { name: 'Registrar' }).click();
    await page.waitForTimeout(300);

    const afterRegCount = await pendingList.count();
    if (afterRegCount !== initialPendingCount - 1) {
      throw new Error(
        `Tras registrar "${firstConcept}", esperaba ${initialPendingCount - 1} pendientes, hay ${afterRegCount}`
      );
    }

    const skipItem = pendingList.nth(0);
    const skippedConcept = (await skipItem.locator('p.text-sm.font-bold').textContent())?.trim() || '';
    await skipItem.getByRole('button', { name: 'No se ha producido este mes' }).click();
    await page.waitForTimeout(300);

    const skippedNotice = await dialog.getByText(/Omitidos solo en/i).isVisible();
    if (!skippedNotice) {
      throw new Error('No se mostró el bloque de plantillas omitidas solo en este mes');
    }

    // Omitir cualquier otro pendiente restante para probar reanudación con 0 pendientes
    while ((await pendingList.count()) > 0) {
      await pendingList.nth(0).getByRole('button', { name: 'No se ha producido este mes' }).click();
      await page.waitForTimeout(250);
    }

    // 4) Reanudar a mitad: salir y volver a abrir el asistente
    await dialog.getByRole('button', { name: /Cerrar asistente/i }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });

    await page.getByRole('button', { name: 'Cerrar mes' }).click();
    await dialog.waitFor({ state: 'visible', timeout: 5000 });

    const cuentasVisible = await dialog
      .getByRole('heading', { name: /Cuentas entre vosotros/i })
      .isVisible();
    if (!cuentasVisible) {
      throw new Error(
        'Al reanudar con 0 pendientes y saldo pendiente, no retomó en Cuentas entre vosotros'
      );
    }

    // Revisar Paso 2 (Revisión solo lectura)
    await dialog.getByRole('button', { name: /Revisión/i }).click();
    await dialog
      .getByRole('heading', { name: /Revisión: presupuesto frente a gasto real/i })
      .waitFor({ state: 'visible' });

    // 5) Paso 3: Cuentas entre vosotros — registrar liquidación
    await dialog.getByRole('button', { name: /Cuentas/i }).click();
    const settleBtn = dialog.getByRole('button', { name: /Registrar liquidación/i });
    if (await settleBtn.isVisible()) {
      await settleBtn.click();
      await dialog.getByText(/en paz/i).waitFor({ state: 'visible', timeout: 5000 });
    }

    // 6) Paso 4: Próximo mes — copiar presupuestos sin sobrescribir
    await dialog.getByRole('button', { name: /Próximo mes/i }).click();
    await dialog
      .getByText(/ya tenía.*límite|se conservarán intactas/i)
      .waitFor({ state: 'visible', timeout: 5000 });
    await dialog.getByRole('button', { name: /Copiar presupuestos a/i }).click();
    await dialog
      .getByText(/ya tiene cubiertas todas las categorías/i)
      .waitFor({ state: 'visible', timeout: 5000 });

    // 7) Paso 5: Cerrar mes y comprobar vista solo lectura
    await dialog.locator('nav[aria-label="Pasos del cierre de mes"] li').nth(4).locator('button').click();
    await dialog
      .getByRole('heading', { name: /Confirmar cierre/i })
      .waitFor({ state: 'visible', timeout: 5000 });
    await dialog.getByRole('button', { name: /Confirmar y cerrar/i }).click();

    await dialog.getByText(/Mes cerrado · Solo lectura/i).waitFor({ state: 'visible', timeout: 5000 });
    const hasMutateBtn = await dialog
      .getByRole('button', { name: /Confirmar y cerrar|Registrar/i })
      .count();
    if (hasMutateBtn > 0) {
      throw new Error('La vista de mes cerrado muestra botones de mutación');
    }
    await dialog.getByRole('button', { name: 'Entendido' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });

    // Reabrir desde "Ver resumen de cierre" y verificar solo lectura
    await page.getByRole('button', { name: 'Ver resumen de cierre' }).click();
    await dialog.getByText(/Mes cerrado · Solo lectura/i).waitFor({ state: 'visible', timeout: 5000 });
    await dialog.getByRole('button', { name: 'Entendido' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });

    // Comprobar en el mes siguiente que:
    // a) La plantilla omitida en este mes SÍ sigue pendiente en el mes siguiente
    // b) Supermercado conservó 420 € (no fue sobrescrito)
    await page.getByRole('button', { name: 'Mes siguiente' }).click();
    await page.getByRole('button', { name: 'Cerrar mes' }).click();
    await dialog.waitFor({ state: 'visible', timeout: 5000 });
    const nextMonthStillHasSkipped = await dialog
      .getByText(skippedConcept, { exact: false })
      .isVisible();
    if (!nextMonthStillHasSkipped) {
      throw new Error(`La plantilla omitida "${skippedConcept}" no aparece en el mes siguiente`);
    }
    await dialog.getByRole('button', { name: /Cerrar asistente/i }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });

    await page.getByRole('button', { name: /Ajustar presupuestos|Editar límites/i }).first().click();
    await budgetDialog.waitFor({ state: 'visible', timeout: 5000 });
    const preservedSuperVal = await budgetDialog.locator('#bud-supermercado').inputValue();
    if (preservedSuperVal !== '420') {
      throw new Error(
        `Supermercado en mes siguiente fue sobrescrito: esperado "420", obtenido "${preservedSuperVal}"`
      );
    }

    if (consoleErrors.length > 0) {
      throw new Error(`Errores de página detectados: ${consoleErrors.join(' | ')}`);
    }

    console.log('✅ verify_guided_close: TODOS LOS RECORRIDOS PASARON');
    console.log('   - Aviso discreto en Inicio (día 3) abrió directamente el mes anterior');
    console.log('   - Sencillo (3 pasos) y Avanzado (5 pasos) verificados');
    console.log(
      `   - Pendientes: "${firstConcept}" registrado (73,50 €), "${skippedConcept}" omitido solo este mes y activo en el siguiente`
    );
    console.log(
      '   - Reanudación a mitad, liquidación, copia sin sobrescribir (420 € preservado) y mes cerrado solo lectura OK'
    );
  } catch (err) {
    console.error('❌ verify_guided_close FALLÓ:', err);
    try {
      const pages = browser.contexts().flatMap((c) => c.pages());
      for (const p of pages) {
        const dlg = p.getByRole('dialog');
        if (await dlg.isVisible().catch(() => false)) {
          console.error('Dialog text:\n', await dlg.innerText());
        }
      }
    } catch {
      // ignore
    }
    if (logs) console.error('Preview logs:\n', logs);
    process.exitCode = 1;
  } finally {
    await browser.close();
    preview.kill('SIGKILL');
    process.exit(process.exitCode || 0);
  }
}

run();
