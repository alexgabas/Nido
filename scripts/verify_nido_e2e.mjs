import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { chromium } from '/usr/local/share/bun-global/node_modules/playwright/index.mjs';

const PREVIEW_PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PREVIEW_PORT}`;

async function waitForServer(url, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // ignore until ready
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Servidor preview no respondió en ${timeoutMs}ms (${url})`);
}

async function assertNoHorizontalOverflow(page, contextLabel) {
  const dims = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  assert.ok(
    dims.scrollWidth <= dims.innerWidth + 1,
    `Desbordamiento horizontal en ${contextLabel}: scrollWidth=${dims.scrollWidth}, innerWidth=${dims.innerWidth}`
  );
}

async function run() {
  const server = spawn(
    './node_modules/.bin/vite',
    ['preview', '--host', '127.0.0.1', '--port', String(PREVIEW_PORT), '--strictPort'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    }
  );

  let serverLogs = '';
  server.stdout.on('data', (d) => {
    serverLogs += d.toString();
  });
  server.stderr.on('data', (d) => {
    serverLogs += d.toString();
  });

  let browser;
  const runtimeErrors = [];

  try {
    await waitForServer(BASE_URL);

    browser = await chromium.launch({ headless: true });

    // ─── 1. MÓVIL (390x844): MODO SENCILLO + MERCADONA + CATEGORÍAS + MENSUAL ─
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'es-ES',
    });
    const page = await mobileContext.newPage();

    page.on('pageerror', (err) => {
      runtimeErrors.push(`pageerror: ${err.message}`);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        runtimeErrors.push(`console.error: ${msg.text()}`);
      }
    });

    const loadedUrls = [];
    page.on('response', (res) => {
      loadedUrls.push(res.url());
    });

    await page.goto(`${BASE_URL}/?autostart=1`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Este mes lleváis').waitFor({ timeout: 15000 });
    await assertNoHorizontalOverflow(page, 'móvil Inicio (Sencillo, claro)');

    // Bloque 1: confirmar que el arranque inicial NO ha descargado el chunk diferido de PDF
    assert.ok(
      !loadedUrls.some((u) => /pdfExport-|html2canvas-|jspdf/i.test(u)),
      `El chunk de PDF se cargó en el arranque inicial: ${loadedUrls.filter((u) => /pdf|html2canvas/i.test(u)).join(', ')}`
    );

    // Verificar lista de la compra + catálogo Mercadona + exploración por secciones (Bloque 3) en Modo Sencillo
    await page.getByRole('button', { name: /Lista de la compra/i }).first().click();
    const shoppingDialog = page.getByRole('dialog');
    await shoppingDialog.waitFor();
    await shoppingDialog.locator('h2#shopping-list-title').waitFor();

    // Esperar a que cargue el JSON diferido de Mercadona
    await shoppingDialog.getByText(/Catálogo de referencia no oficial/i).waitFor({ timeout: 15000 });

    // Bloque 3: explorar una sección de supermercado sin texto y ver conteo exacto
    const sectionSelect = shoppingDialog.getByRole('combobox', {
      name: 'Explorar catálogo por sección de supermercado',
    });
    await sectionSelect.selectOption('Bebidas');
    const listbox = shoppingDialog.locator('#shopping-suggestions-list');
    await listbox.waitFor({ timeout: 10000 });
    await shoppingDialog.getByText(/en «Bebidas»/i).waitFor({ timeout: 5000 });

    // Combinar sección + texto
    const searchInput = shoppingDialog.getByRole('combobox', { name: 'Producto para comprar' });
    await searchInput.fill('agua');
    await page.waitForTimeout(150);
    const filteredCount = await listbox.locator('li[role="option"]').count();
    assert.ok(filteredCount > 0, 'Filtrar Bebidas + "agua" no devolvió resultados');

    // Volver a Todas y buscar leche para comprobar el resto del flujo
    await sectionSelect.selectOption('todas');
    await searchInput.click();
    await searchInput.fill('leche');
    await listbox.waitFor({ timeout: 10000 });

    // Comprobar que el desplegable NO se solapa con el campo de cantidad ni botón Añadir
    const overlapCheck = await shoppingDialog.evaluate(() => {
      const qty = document.querySelector('input[aria-label="Cantidad"]');
      const addBtn = Array.from(document.querySelectorAll('button[type="submit"]')).find((b) =>
        b.textContent?.includes('Añadir')
      );
      const list = document.getElementById('shopping-suggestions-list');
      if (!qty || !addBtn || !list) return { ok: false, reason: 'missing_nodes' };
      const qRect = qty.getBoundingClientRect();
      const aRect = addBtn.getBoundingClientRect();
      const lRect = list.getBoundingClientRect();
      return {
        ok: lRect.top >= qRect.bottom - 2 && lRect.top >= aRect.bottom - 2,
        qBottom: qRect.bottom,
        aBottom: aRect.bottom,
        lTop: lRect.top,
      };
    });
    assert.ok(
      overlapCheck.ok,
      `El desplegable de autocompletado solapa los controles: ${JSON.stringify(overlapCheck)}`
    );

    // Verificar insignia Mercadona en resultados
    await listbox.getByText('Mercadona').first().waitFor();

    // Verificar paginación "Ver más resultados"
    const countBeforeMore = await listbox.locator('li[role="option"]').count();
    const showMoreBtn = shoppingDialog.getByRole('button', { name: 'Ver más resultados' });
    if (await showMoreBtn.isVisible()) {
      await showMoreBtn.dispatchEvent('mousedown');
      await page.waitForTimeout(150);
      const countAfterMore = await listbox.locator('li[role="option"]').count();
      assert.ok(
        countAfterMore > countBeforeMore,
        `La paginación no incrementó resultados (${countBeforeMore} -> ${countAfterMore})`
      );
    }

    // Seleccionar primer resultado Mercadona con mouseDown (onMouseDown)
    const firstOptionBtn = listbox.locator('li[role="option"] button').first();
    const chosenText = (await firstOptionBtn.locator('span.font-semibold').first().textContent())?.trim() || '';
    assert.ok(chosenText.length > 0, 'Opción de autocompletado sin texto');
    await firstOptionBtn.dispatchEvent('mousedown');
    await shoppingDialog.getByRole('button', { name: 'Añadir', exact: true }).click();

    // Si existía duplicado pendiente en la demo, pulsar Añadir aparte
    const addSeparateBtn = shoppingDialog.getByRole('button', { name: 'Añadir aparte' });
    if (await addSeparateBtn.isVisible().catch(() => false)) {
      await addSeparateBtn.click();
    }

    // Probar toggle de favorito en Favoritos y recientes y toque >= 44px
    const favBtn = shoppingDialog.locator('button[aria-label*="favorito"]').first();
    await favBtn.waitFor();
    const favBox = await favBtn.boundingBox();
    assert.ok(favBox && favBox.height >= 44 && favBox.width >= 44, `Botón favorito <44px: ${JSON.stringify(favBox)}`);
    const pressedBefore = await favBtn.getAttribute('aria-pressed');
    await favBtn.click();
    await page.waitForTimeout(150);
    const pressedAfter = await favBtn.getAttribute('aria-pressed');
    assert.notEqual(pressedAfter, pressedBefore, 'El estado de favorito no cambió');

    // Probar Lista simple vs Por secciones
    await shoppingDialog.getByRole('button', { name: 'Lista simple' }).click();
    await shoppingDialog.getByText(/^Pendientes \(\d+\)/).waitFor();
    await shoppingDialog.getByRole('button', { name: 'Por secciones' }).click();

    // Probar Modo compra (>=48px) y banner de progreso
    await shoppingDialog.getByRole('button', { name: 'Modo compra' }).click();
    await shoppingDialog.getByText(/Faltan \d+ producto|¡Todo en el carro!/).waitFor();
    const toggleItemBtn = shoppingDialog.locator('button[aria-label*="como comprado"]').first();
    const toggleBox = await toggleItemBtn.boundingBox();
    assert.ok(toggleBox && toggleBox.height >= 48 && toggleBox.width >= 48, `Check en Modo compra <48px: ${JSON.stringify(toggleBox)}`);
    await toggleItemBtn.click();

    // Probar Deshacer
    const undoBtn = page.getByRole('button', { name: 'Deshacer' });
    await undoBtn.waitFor({ timeout: 5000 });
    await undoBtn.click();
    await page.waitForTimeout(150);

    // Bloque 4: marcar un producto en Modo compra y finalizar compra en menos pasos
    await shoppingDialog.locator('button[aria-label*="como comprado"]').first().click();
    await page.waitForTimeout(150);
    const finalizeBtn = shoppingDialog.getByRole('button', { name: /Finalizar compra \(\d+\)/ });
    await finalizeBtn.waitFor({ timeout: 5000 });
    await finalizeBtn.click();

    // Panel simplificado dentro del mismo modal
    const amountInput = shoppingDialog.locator('#checkout-amount');
    await amountInput.waitFor({ timeout: 5000 });
    await amountInput.fill('34.90');
    // Desplegar Más detalles para verificar acceso sin sobrecargar el flujo por defecto
    await shoppingDialog.getByRole('button', { name: /Más detalles/ }).click();
    await shoppingDialog.locator('#checkout-date').waitFor();
    await shoppingDialog.getByRole('button', { name: /Guardar gasto .* y limpiar carro/ }).click();
    await page.getByText(/Compra finalizada:/).waitFor({ timeout: 5000 });
    await shoppingDialog.waitFor({ state: 'hidden', timeout: 5000 });
    await assertNoHorizontalOverflow(page, 'móvil tras finalizar compra');

    // Cambiar a Modo Avanzado y Tema Oscuro desde el avatar
    await page.getByRole('button', { name: /Menú de /i }).click();
    await page.getByRole('button', { name: 'Avanzado', exact: true }).click();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: /Cambiar a tema oscuro/i }).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    assert.ok(isDark, 'El modo oscuro no se activó');

    await assertNoHorizontalOverflow(page, 'móvil Inicio (Avanzado, oscuro)');

    // Ir a Ajustes -> Categorías personalizadas
    await page.getByRole('navigation', { name: 'Navegación inferior móvil' }).getByRole('button', { name: 'Ajustes' }).click();
    await page.getByRole('heading', { name: 'Categorías personalizadas' }).waitFor({ timeout: 10000 });
    await assertNoHorizontalOverflow(page, 'móvil Ajustes (Avanzado, oscuro)');

    await page.getByRole('button', { name: 'Nueva categoría' }).click();
    await page.locator('#custom-cat-name').fill('Gimnasio E2E');
    await page.getByRole('button', { name: 'Crear categoría' }).click();
    await page.getByText('Categoría «Gimnasio E2E» creada').waitFor();

    // Como el hogar demo tiene 2 miembros, NO debe ofrecer eliminación destructiva directa
    const deleteCatCount = await page.locator('button[aria-label="Eliminar categoría Gimnasio E2E"]').count();
    assert.equal(
      deleteCatCount,
      0,
      'Se mostró botón de eliminar categoría en hogar compartido (>1 miembro)'
    );

    // Archivar y reactivar categoría
    const catCard = page.locator('div', { hasText: 'Gimnasio E2E' }).filter({ has: page.getByRole('button', { name: 'Archivar' }) }).first();
    await catCard.getByRole('button', { name: 'Archivar' }).click();
    await page.getByText('Categoría «Gimnasio E2E» archivada').waitFor();
    const archivedCard = page.locator('div', { hasText: 'Gimnasio E2E' }).filter({ has: page.getByRole('button', { name: 'Reactivar' }) }).first();
    await archivedCard.getByRole('button', { name: 'Reactivar' }).click();
    await page.getByText('Categoría «Gimnasio E2E» reactivada').waitFor();

    // Ir a Mensual -> editar presupuesto de categoría personalizada + límite 0 + copiar mes anterior (Bloque 2)
    await page.getByRole('navigation', { name: 'Navegación inferior móvil' }).getByRole('button', { name: 'Mensual' }).click();
    await page.getByRole('heading', { name: 'Presupuesto vs real' }).waitFor({ timeout: 10000 });
    await assertNoHorizontalOverflow(page, 'móvil Mensual (Avanzado, oscuro)');

    await page.getByRole('button', { name: 'Editar límites' }).click();
    const customBudgetInput = page.locator('input[id^="bud-cat_gimnasio_e2e"]');
    await customBudgetInput.waitFor();
    await customBudgetInput.fill('95');
    // Probar límite explícito 0 € en otra categoría (ej. suscripciones)
    const zeroBudgetInput = page.locator('#bud-suscripciones');
    await zeroBudgetInput.fill('0');
    await page.getByRole('button', { name: 'Guardar límites' }).click();
    await page.getByText('Presupuesto mensual actualizado').waitFor();

    // Comprobar persistencia de 0 € al reabrir + probar botón "Copiar del mes anterior"
    await page.getByRole('button', { name: 'Editar límites' }).click();
    const persistedZero = await page.locator('#bud-suscripciones').inputValue();
    assert.equal(persistedZero, '0', `El límite 0 no persistió: ${persistedZero}`);
    await page.getByRole('button', { name: /Copiar del mes anterior/ }).click();
    await page
      .getByText(/Vista previa desde|No hay presupuestos guardados en/)
      .first()
      .waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Cancelar' }).click();

    // Ahora abrir HabitualCatalogModal y guardar un cambio en supermercado (no debe romper ni borrar la personalizada)
    await page.getByRole('button', { name: 'Añadir gastos habituales' }).click();
    const supInput = page.locator('#hab-bud-supermercado');
    await supInput.waitFor();
    await supInput.fill('425');
    await page.getByRole('button', { name: 'Añadir seleccionados' }).click();
    await page.getByText(/Presupuesto orientativo guardado|actualizado el presupuesto/).waitFor();

    // Verificar que el presupuesto de Gimnasio E2E sigue intacto tras guardar HabitualCatalogModal
    await page.getByRole('button', { name: 'Editar límites' }).click();
    const savedCustomVal = await page.locator('input[id^="bud-cat_gimnasio_e2e"]').inputValue();
    assert.equal(savedCustomVal, '95', 'HabitualCatalogModal sobrescribió/perdió el presupuesto personalizado');
    await page.getByRole('button', { name: 'Cancelar' }).click();

    // Bloque 5: Búsqueda global ampliada (Mensual + Mudanza + subtotales separados + filtro pagador + salto a Mudanza)
    await page.getByRole('button', { name: 'Búsqueda global' }).click();
    const globalSearchSection = page.locator('section[aria-label="Búsqueda global de gastos"]');
    await globalSearchSection.waitFor({ timeout: 10000 });
    // Comprobar controles de origen y pagador
    await globalSearchSection.locator('#global-search-payer').waitFor();
    await globalSearchSection.getByRole('button', { name: 'Mudanza', exact: true }).click();
    await globalSearchSection.getByText(/Mudanza \(\d+\):/).waitFor({ timeout: 5000 });
    await globalSearchSection.getByRole('button', { name: 'Todos', exact: true }).click();
    await globalSearchSection.locator('#global-search-payer').selectOption({ label: 'Cuenta común' });
    await globalSearchSection.getByText(/\d+ resultados?/).waitFor({ timeout: 5000 });
    await globalSearchSection.locator('#global-search-payer').selectOption({ label: 'Todos los pagadores' });
    await globalSearchSection.getByRole('button', { name: 'Mudanza', exact: true }).click();
    await globalSearchSection.getByRole('button', { name: 'Ver en Mudanza' }).first().click();

    // Verificar que navegó a Mudanza sin errores ni overflow
    await page.waitForTimeout(200);
    await assertNoHorizontalOverflow(page, 'móvil Mudanza');

    await page.getByRole('navigation', { name: 'Navegación inferior móvil' }).getByRole('button', { name: 'Ahorros' }).click();
    await page.waitForTimeout(200);
    await assertNoHorizontalOverflow(page, 'móvil Ahorros');

    await mobileContext.close();

    // ─── 2. ESCRITORIO (1280x800): NAVEGACIÓN PRINCIPAL + MODO OSCURO ─────────
    const desktopContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'es-ES',
    });
    const dPage = await desktopContext.newPage();
    dPage.on('pageerror', (err) => runtimeErrors.push(`desktop pageerror: ${err.message}`));
    dPage.on('console', (msg) => {
      if (msg.type() === 'error') runtimeErrors.push(`desktop console.error: ${msg.text()}`);
    });

    await dPage.goto(`${BASE_URL}/?autostart=1`, { waitUntil: 'domcontentloaded' });
    await dPage.getByText('Este mes lleváis').waitFor({ timeout: 15000 });
    await dPage.getByRole('button', { name: /Menú de /i }).click();
    await dPage.getByRole('button', { name: 'Avanzado', exact: true }).click();
    await dPage.waitForTimeout(150);
    await dPage.getByRole('button', { name: /Cambiar a tema oscuro/i }).click();
    await dPage.keyboard.press('Escape');
    await dPage.waitForTimeout(150);

    for (const tabLabel of ['Inicio', 'Mudanza', 'Mensual', 'Ahorros', 'Ajustes']) {
      await dPage.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: tabLabel }).click();
      await dPage.waitForTimeout(200);
      await assertNoHorizontalOverflow(dPage, `escritorio ${tabLabel} (oscuro)`);
    }

    await desktopContext.close();

    assert.equal(
      runtimeErrors.length,
      0,
      `Errores de consola o ejecución en navegador:\n${runtimeErrors.join('\n')}`
    );

    console.log('E2E_PASS: Todos los flujos móvil (390x844) y escritorio (1280x800) —incluidos bloques 1 a 5— verificados sin errores.');
  } catch (err) {
    console.error('E2E_FAIL:', err);
    if (serverLogs) {
      console.error('PREVIEW_LOGS:\n', serverLogs);
    }
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (!server.killed) {
      server.kill('SIGKILL');
    }
  }
}

await run();
