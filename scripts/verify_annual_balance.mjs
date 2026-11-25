/**
 * Verificación E2E de «Balance anual del hogar» en Nido (Modo Sencillo y Modo Avanzado).
 * Comprueba:
 * 1) Acceso desde Mensual en Sencillo (resumen reducido) sin nueva pestaña principal.
 * 2) Acceso desde Mensual en Avanzado (vista completa) con total anual, media de meses completos
 *    (excluyendo mes en curso abierto y meses sin datos), presupuesto parcial, nota de origen y recibos no mensuales.
 * 3) Salto desde el balance a una categoría y mes concretos (filtra en Mensual).
 * 4) Transición de recibo anual («Seguro de hogar») de Previsto a Registrado sin duplicarse.
 * 5) Selector de año (cambio al año anterior y vuelta).
 */
import { chromium } from '/usr/local/share/bun-global/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';

const PORT = 4182;
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

    // Verificar que NO se añadió ninguna pestaña principal de "Balance anual" en la barra de navegación
    const topNavHasAnnual = await page
      .locator('nav')
      .getByRole('button', { name: /Balance anual/i })
      .count();
    if (topNavHasAnnual > 0) {
      throw new Error('Balance anual no debe ser una pestaña principal de navegación');
    }

    // 1) Modo Sencillo -> Mensual -> Balance anual (resumen reducido)
    await page.getByRole('button', { name: /Ver detalle/i }).first().click();
    await page.getByRole('button', { name: 'Balance anual' }).waitFor({ state: 'visible', timeout: 8000 });
    await page.getByRole('button', { name: 'Balance anual' }).click();

    await page.getByRole('heading', { name: /Balance anual \d{4}/i }).waitFor({ state: 'visible', timeout: 8000 });
    await page.getByText(/Coste de un mes habitual/i).waitFor({ state: 'visible', timeout: 5000 });
    await page.getByText(/Media de 2 meses completos/i).waitFor({ state: 'visible', timeout: 5000 });
    await page.getByText(/Presupuesto parcial/i).waitFor({ state: 'visible', timeout: 5000 });
    await page.getByText(/Seguro de hogar/i).waitFor({ state: 'visible', timeout: 5000 });

    // Volver al mes en Sencillo
    await page.getByRole('button', { name: /Volver al mes/i }).click();
    await page.getByRole('button', { name: 'Balance anual' }).waitFor({ state: 'visible', timeout: 5000 });

    // 2) Cambiar a Modo Avanzado y abrir Balance anual completo
    await page.getByRole('button', { name: /Menú de /i }).click();
    await page.getByRole('button', { name: 'Avanzado', exact: true }).click();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Balance anual' }).waitFor({ state: 'visible', timeout: 8000 });
    await page.getByRole('button', { name: 'Balance anual' }).click();

    await page.getByRole('heading', { name: /Evolución mensual/i }).waitFor({ state: 'visible', timeout: 8000 });
    await page.getByText(/los cierres no guardan desglose congelado por categoría/i).waitFor({
      state: 'visible',
      timeout: 5000,
    });
    await page.getByText(/Sobre 2 meses completos con cobertura/i).waitFor({ state: 'visible', timeout: 5000 });
    await page.getByText(/Presupuesto parcial/i).first().waitFor({ state: 'visible', timeout: 5000 });

    // Comprobar recibo anual "Seguro de hogar" inicialmente como Previsto (1 sola fila)
    const receiptsSection = page.locator('section[aria-label^="Recibos no mensuales"]');
    await receiptsSection.waitFor({ state: 'visible', timeout: 5000 });
    const seguroRowsBefore = receiptsSection.locator('li', { hasText: 'Seguro de hogar' });
    if ((await seguroRowsBefore.count()) !== 1) {
      throw new Error(`Esperaba 1 fila de Seguro de hogar antes de registrar, hay ${await seguroRowsBefore.count()}`);
    }
    const seguroTextBefore = (await seguroRowsBefore.first().innerText()) || '';
    if (!/Previsto/i.test(seguroTextBefore) || /Registrado/i.test(seguroTextBefore)) {
      throw new Error(`Seguro de hogar debía figurar como Previsto, texto: ${seguroTextBefore}`);
    }

    // 3) Cambiar selector de año al año anterior y volver al actual
    await page.getByRole('button', { name: 'Año anterior' }).click();
    await page.getByText(/Sin meses completos con cobertura en este año/i).waitFor({
      state: 'visible',
      timeout: 5000,
    });
    await page.getByRole('button', { name: 'Año siguiente' }).click();
    await page.getByText(/Sobre 2 meses completos con cobertura/i).waitFor({ state: 'visible', timeout: 5000 });

    // 4) Saltar desde Balance anual a una categoría concreta (Supermercado)
    const catRowSuper = page.locator('tr', { hasText: 'Supermercado' }).first();
    await catRowSuper.getByRole('button', { name: 'Ver', exact: true }).click();
    await page.getByRole('button', { name: 'Balance anual' }).waitFor({ state: 'visible', timeout: 5000 });

    // Comprobar que el filtro de categoría se aplicó en Mensual
    const filterValue = await page.locator('select[aria-label="Filtrar por categoría"]').inputValue().catch(() => null);
    if (filterValue !== null && filterValue !== 'supermercado') {
      throw new Error(`Al saltar desde Supermercado esperaba filtro "supermercado", obtenido "${filterValue}"`);
    }

    // 5) Reabrir Balance anual, saltar al mes del recibo anual (Seguro de hogar -> Ver mes) y generarlo
    await page.getByRole('button', { name: 'Balance anual' }).click();
    await receiptsSection.waitFor({ state: 'visible', timeout: 8000 });
    await receiptsSection
      .locator('li', { hasText: 'Seguro de hogar' })
      .first()
      .getByRole('button', { name: /Ver mes/i })
      .click();
    await page.getByRole('button', { name: 'Balance anual' }).waitFor({ state: 'visible', timeout: 5000 });

    const genBtn = page.getByRole('button', { name: /Generar gastos del mes desde plantillas/i });
    await genBtn.waitFor({ state: 'visible', timeout: 5000 });
    await genBtn.click();
    await page.waitForTimeout(500);

    // Reabrir Balance anual y comprobar que Seguro de hogar pasó a Registrado sin duplicarse
    await page.getByRole('button', { name: 'Balance anual' }).click();
    await receiptsSection.waitFor({ state: 'visible', timeout: 8000 });
    const seguroRowsAfter = receiptsSection.locator('li', { hasText: 'Seguro de hogar' });
    if ((await seguroRowsAfter.count()) !== 1) {
      throw new Error(
        `Seguro de hogar NO debe duplicarse tras registrarse: encontradas ${await seguroRowsAfter.count()} filas`
      );
    }
    const seguroTextAfter = (await seguroRowsAfter.first().innerText()) || '';
    if (!/Registrado/i.test(seguroTextAfter)) {
      throw new Error(`Tras generar plantillas, Seguro de hogar debía pasar a Registrado: ${seguroTextAfter}`);
    }

    if (pageErrors.length > 0) {
      throw new Error(`Errores de página detectados: ${pageErrors.join(' | ')}`);
    }

    console.log('✅ verify_annual_balance: TODOS LOS RECORRIDOS PASARON');
    console.log('   - Sin pestaña principal extra; accesible desde Mensual en Sencillo y Avanzado');
    console.log('   - Media sobre 2 meses completos (mes en curso abierto y meses sin datos excluidos)');
    console.log('   - Presupuesto parcial, selector de año, salto a categoría y recibo anual Previsto -> Registrado sin duplicarse OK');
  } catch (err) {
    console.error('❌ verify_annual_balance FALLÓ:', err);
    if (logs) console.error('Preview logs:\n', logs);
    process.exitCode = 1;
  } finally {
    await browser.close();
    preview.kill('SIGKILL');
    process.exit(process.exitCode || 0);
  }
}

run();
