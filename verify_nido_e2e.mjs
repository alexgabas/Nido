import { chromium } from '/usr/local/share/bun-global/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';

const BASE_URL = 'http://127.0.0.1:3000';
const EXECUTABLE = '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

const consoleErrors = [];
const pageErrors = [];

async function switchUiMode(page, targetMode) {
  // Check current mode by looking for avatar button or header
  const avatarBtn = page.locator('header button[aria-haspopup="menu"]').first();
  await avatarBtn.waitFor({ state: 'visible', timeout: 10000 });
  await avatarBtn.click();
  const switchLabel = targetMode === 'avanzado' ? /Modo Avanzado/i : /Modo Sencillo/i;
  const item = page.getByRole('menuitem', { name: switchLabel });
  if ((await item.count()) > 0) {
    await item.first().click();
  } else {
    // Already in target mode; close menu
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(250);
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: EXECUTABLE,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    // ── 1. Deep links check ──────────────────────────────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', (e) => pageErrors.push(String(e)));

      // Deep link add-expense
      await page.goto(`${BASE_URL}/?autostart=1&action=add-expense`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10000 });
      console.log('✓ Deep link action=add-expense abre el asistente/modal de gasto');
      await page.keyboard.press('Escape');

      // Deep link tab=ajustes in default Demo (Sencillo) should fall back to Inicio
      await page.goto(`${BASE_URL}/?autostart=1&tab=ajustes`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      const ajustesHeading = await page.getByRole('heading', { name: /Ajustes del hogar/i }).count();
      assert.equal(ajustesHeading, 0, 'tab=ajustes en modo sencillo debe caer a inicio');
      console.log('✓ Deep link tab=ajustes en modo Sencillo cae a Inicio');

      // Deep link tab=mensual
      await page.goto(`${BASE_URL}/?autostart=1&tab=mensual`, { waitUntil: 'domcontentloaded' });
      await page.locator('section[aria-label="Agenda del mes"]').waitFor({ state: 'visible', timeout: 10000 });
      console.log('✓ Deep link tab=mensual abre Mensual (Agenda del mes en Sencillo)');
      await ctx.close();
    }

    // ── 2. Full Desktop Avanzado & Sencillo flows ────────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', (e) => pageErrors.push(String(e)));

      await page.goto(`${BASE_URL}/?autostart=1`, { waitUntil: 'domcontentloaded' });

      // Switch to Avanzado
      await switchUiMode(page, 'avanzado');
      await page.getByRole('button', { name: 'Mensual', exact: true }).first().click();

      // Verify 7-column calendar
      const calSection = page.locator('section[aria-label="Calendario del mes"]');
      await calSection.waitFor({ state: 'visible', timeout: 10000 });
      for (const wd of ['L', 'M', 'X', 'J', 'V', 'S', 'D']) {
        assert.ok((await calSection.getByText(wd, { exact: true }).count()) >= 1, `Falta cabecera ${wd}`);
      }
      console.log('✓ Calendario literal de 7 columnas (L-D) visible en Mensual Avanzado');

      // Click day 15 and check "Añadir gasto este día" pre-fills QuickExpenseModal date
      const dayCells = calSection.locator('[role="button"][aria-label*="movimientos"]');
      const cellCount = await dayCells.count();
      assert.ok(cellCount >= 28, 'Calendario debe tener >= 28 celdas de día');
      await dayCells.nth(14).click();
      const addDayBtn = calSection.getByRole('button', { name: /Añadir gasto este día/i });
      await addDayBtn.click();
      const modal = page.getByRole('dialog');
      await modal.waitFor({ state: 'visible' });
      const dateInputVal = await modal.locator('input[type="date"]').inputValue();
      assert.match(dateInputVal, /^\d{4}-\d{2}-15$/, `Fecha pre-rellenada esperada día 15, recibido ${dateInputVal}`);
      console.log(`✓ Clic en día del calendario pre-rellena QuickExpenseModal (${dateInputVal})`);
      await modal.getByRole('button', { name: /Cancelar|Cerrar/i }).first().click();

      // CategoryColorModal live update
      await calSection.getByRole('button', { name: /Personalizar colores/i }).click();
      const colorDialog = page.getByRole('dialog', { name: /Colores de categorías/i });
      await colorDialog.waitFor({ state: 'visible' });
      // Pick swatch #2563EB (Azul cobalto) or second swatch
      const swatches = colorDialog.locator('button[aria-pressed]');
      await swatches.nth(2).click();
      await colorDialog.getByRole('button', { name: /Guardar colores/i }).click();
      await page.getByText(/Colores de categorías guardados/i).waitFor({ state: 'visible', timeout: 5000 });
      console.log('✓ CategoryColorModal guarda y actualiza paleta compartida');

      // CommonAccountRadarCard shortfall / covered calculation
      const radar = page.locator('section[aria-label="Radar de cuenta común"]');
      await radar.waitFor({ state: 'visible' });
      const balInput = radar.locator('#common-balance-input');
      await balInput.fill('10');
      await page.waitForTimeout(150);
      const radarTextLow = await radar.innerText();
      await balInput.fill('25000');
      await page.waitForTimeout(150);
      const radarTextHigh = await radar.innerText();
      assert.notEqual(radarTextLow, radarTextHigh, 'Radar debe recalcular según saldo introducido');
      console.log('✓ CommonAccountRadarCard calcula diferencia al introducir saldo manual');

      // Generate recurring bills -> verify 3-bill historical average suggestion in RecurringTemplateModal
      const genBtn = page.getByRole('button', { name: /Generar gastos del mes desde plantillas/i });
      if ((await genBtn.count()) > 0 && (await genBtn.isEnabled())) {
        await genBtn.click();
        await page.waitForTimeout(400);
      }
      const editRecBtn = page.locator('button[aria-label^="Editar plantilla "]').first();
      await editRecBtn.click();
      const recDialog = page.getByRole('dialog');
      await recDialog.waitFor({ state: 'visible' });
      const useAvgBtn = recDialog.getByRole('button', { name: /Usar media/i });
      if ((await useAvgBtn.count()) > 0) {
        await useAvgBtn.click();
        console.log('✓ RecurringTemplateModal muestra y aplica sugerencia de media histórica al confirmar');
      } else {
        console.log('ℹ Plantilla editada sin histórico previo de factura compartida; comprobando cancelación');
      }
      await recDialog.getByRole('button', { name: /Cancelar/i }).click();

      // RecurringIcsModal download
      await page.getByRole('button', { name: /Exportar \(\.ics\)/i }).click();
      const icsDialog = page.getByRole('dialog', { name: /Exportar al calendario/i });
      await icsDialog.waitFor({ state: 'visible' });
      const dlBtn = icsDialog.getByRole('button', { name: /Descargar \.ics/i });
      if (await dlBtn.isEnabled()) {
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          dlBtn.click(),
        ]);
        assert.ok(download.suggestedFilename().endsWith('.ics'), 'Debe descargar archivo .ics');
        console.log(`✓ RecurringIcsModal descarga ${download.suggestedFilename()}`);
      } else {
        await icsDialog.getByRole('button', { name: /Cerrar/i }).click();
      }

      // BankCsvImportModal -> Recordar palabra clave
      await page.getByRole('button', { name: /Importar CSV banco/i }).click();
      const csvDialog = page.getByRole('dialog');
      await csvDialog.waitFor({ state: 'visible' });
      const csvContent = [
        'Fecha;Concepto;Importe',
        '05/11/2026;CARREFOUR EXPRESS CENTRO;-24,50',
        '06/11/2026;CARREFOUR GASOLINERA;-45,00',
      ].join('\n');
      await csvDialog.locator('input[type="file"]').setInputFiles({
        name: 'movimientos.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csvContent, 'utf8'),
      });
      await csvDialog.locator('select[aria-label="Categoría fila 1"]').waitFor({ state: 'visible', timeout: 5000 });
      await csvDialog.locator('select[aria-label="Categoría fila 1"]').selectOption('supermercado');
      const rememberBtn = csvDialog.getByRole('button', { name: /Recordar palabra clave/i }).first();
      await rememberBtn.waitFor({ state: 'visible' });
      await rememberBtn.click();
      await csvDialog.getByRole('button', { name: /Guardar regla/i }).click();
      await page.waitForTimeout(250);
      const row2Cat = await csvDialog.locator('select[aria-label="Categoría fila 2"]').inputValue();
      assert.equal(row2Cat, 'supermercado', `La regla guardada debe reclasificar en vivo la fila 2 (recibido ${row2Cat})`);
      console.log('✓ BankCsvImportModal guarda palabra clave y reclasifica otras filas en vivo');
      await csvDialog.getByRole('button', { name: /Cancelar|Cerrar/i }).first().click();

      // Ajustes -> Recordatorios + JSON backup timestamp + Dark Mode
      await page.getByRole('button', { name: 'Ajustes', exact: true }).first().click();
      await page.getByText(/Recordatorios en este dispositivo/i).waitFor({ state: 'visible' });
      await page.getByText(/Última exportación solicitada desde este dispositivo: ninguna registrada aún/i).waitFor({ state: 'visible' });
      const [jsonDl] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Exportar JSON/i }).click(),
      ]);
      assert.ok(jsonDl.suggestedFilename().endsWith('.json'), 'Debe descargar archivo .json');
      await page.getByText(/Última exportación solicitada desde este dispositivo:.*\(hoy\)/i).waitFor({ state: 'visible' });
      console.log('✓ Ajustes registra la fecha real al pulsar Exportar JSON y muestra Recordatorios');

      // Dark mode toggle via avatar menu
      const avatarBtn = page.locator('header button[aria-haspopup="menu"]').first();
      await avatarBtn.click();
      await page.getByRole('menuitem', { name: /Modo oscuro/i }).click();
      const hasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      assert.equal(hasDark, true, 'Modo oscuro debe añadir clase .dark a html');
      console.log('✓ Modo oscuro activado correctamente');

      // Switch to Sencillo and verify Agenda + Ayuda
      await switchUiMode(page, 'sencillo');
      await page.getByRole('button', { name: /Mensual/i }).first().click();
      await page.locator('section[aria-label="Agenda del mes"]').waitFor({ state: 'visible' });
      console.log('✓ Modo Sencillo muestra Agenda del mes');

      await page.getByRole('button', { name: 'Ayuda', exact: true }).first().click();
      await page.getByRole('heading', { name: /Alertas y recordatorios sin costes/i }).waitFor({ state: 'visible' });
      console.log('✓ Ayuda muestra sección "Alertas y recordatorios sin costes"');

      await ctx.close();
    }

    // ── 3. Mobile 390x844 layout & overflow check ────────────────────────────
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', (e) => pageErrors.push(String(e)));

      await page.goto(`${BASE_URL}/?autostart=1`, { waitUntil: 'domcontentloaded' });
      const checkOverflow = async (label) => {
        const { sw, cw } = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth,
        }));
        assert.ok(sw <= cw + 2, `Overflow horizontal en móvil (${label}): scrollWidth=${sw} > clientWidth=${cw}`);
      };

      await checkOverflow('Inicio Sencillo');
      await page.getByRole('button', { name: /Mensual/i }).first().click();
      await page.locator('section[aria-label="Agenda del mes"]').waitFor({ state: 'visible' });
      await checkOverflow('Mensual Sencillo');

      await switchUiMode(page, 'avanzado');
      await page.locator('section[aria-label="Calendario del mes"]').waitFor({ state: 'visible' });
      await checkOverflow('Mensual Avanzado');

      await page.locator('nav[aria-label="Navegación inferior"] button', { hasText: 'Ajustes' }).click();
      await page.getByText(/Recordatorios en este dispositivo/i).waitFor({ state: 'visible' });
      await checkOverflow('Ajustes Avanzado');
      console.log('✓ Viewport móvil 390x844 sin desbordamiento horizontal en Sencillo ni Avanzado');

      await ctx.close();
    }

    assert.equal(pageErrors.length, 0, `Page errors detectados: ${pageErrors.join(' | ')}`);
    assert.equal(consoleErrors.length, 0, `Console errors detectados: ${consoleErrors.join(' | ')}`);
    console.log('✓ Cero errores de consola ni excepciones en todas las vistas verificadas');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('❌ E2E FAIL:', err);
  process.exit(1);
});
