/**
 * Verificación E2E de la reorganización de navegación y fin de etapa de Mudanza
 * en móvil (390x844) y escritorio (1280x800), en Sencillo y Avanzado.
 *
 * Además guarda capturas AFTER en el directorio de artefactos si NIDO_CAPTURE_DIR está definido.
 */
import { chromium } from '/usr/local/share/bun-global/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 4185;
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const CAPTURE_DIR = process.env.NIDO_CAPTURE_DIR || '';

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

async function maybeScreenshot(page, filename) {
  if (!CAPTURE_DIR) return;
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(CAPTURE_DIR, filename), fullPage: false });
}

async function openAvatarMenu(page) {
  await page.getByRole('button', { name: /Menú de /i }).click();
}

async function switchUiMode(page, modeLabel) {
  await openAvatarMenu(page);
  await page.getByRole('button', { name: modeLabel, exact: true }).click();
  await page.keyboard.press('Escape');
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
    // =========================================================================
    // 1) MÓVIL (390x844): Sencillo, Avanzado, Compra, Back, cambio de modo y Mudanza
    // =========================================================================
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'es-ES',
    });
    const page = await mobileCtx.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`${BASE_URL}?autostart=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Este mes lleváis', { timeout: 10000 });

    // Verificar barra inferior en Sencillo (3 ranuras: Inicio, Añadir gasto / +, Ahorros)
    const sencilloBottomNav = await page.locator('nav[aria-label="Navegación inferior móvil"] button').evaluateAll((els) =>
      els.map((el) => ({
        text: el.textContent?.trim() || '',
        aria: el.getAttribute('aria-label') || '',
        height: Math.round(el.getBoundingClientRect().height),
      }))
    );
    if (sencilloBottomNav.length !== 3) {
      throw new Error(`Barra inferior en Sencillo debe tener 3 ranuras, tiene ${sencilloBottomNav.length}: ${JSON.stringify(sencilloBottomNav)}`);
    }
    if (!/Inicio/i.test(sencilloBottomNav[0].text) || !/Ahorros/i.test(sencilloBottomNav[2].text)) {
      throw new Error(`Barra inferior Sencillo inesperada: ${JSON.stringify(sencilloBottomNav)}`);
    }

    // Verificar que Compra y Mensual están visibles sobre el pliegue (y + height <= 844) en Inicio Sencillo
    const compraCard = page.locator('main').getByRole('button', { name: /Compra/i }).first();
    const mensualCard = page.locator('main').getByRole('button', { name: /Mensual/i }).first();
    const compraBox = await compraCard.boundingBox();
    const mensualBox = await mensualCard.boundingBox();
    const scrollHeightSencillo = await page.evaluate(() => document.documentElement.scrollHeight);

    if (!compraBox || compraBox.y + compraBox.height > 844) {
      throw new Error(`Acceso Compra en Sencillo debe estar sobre el pliegue (<=844px): ${JSON.stringify(compraBox)}`);
    }
    if (!mensualBox || mensualBox.y + mensualBox.height > 844) {
      throw new Error(`Acceso Mensual en Sencillo debe estar sobre el pliegue (<=844px): ${JSON.stringify(mensualBox)}`);
    }

    console.log('METRICS_AFTER_SENCILLO_MOBILE:', JSON.stringify({
      bottomNav: sencilloBottomNav,
      compraY: Math.round(compraBox.y),
      mensualY: Math.round(mensualBox.y),
      scrollHeight: scrollHeightSencillo,
    }));
    await maybeScreenshot(page, 'after_sencillo_mobile_top.png');

    // Probar navegación Compra -> Mensual -> Atrás -> Atrás en Sencillo
    await compraCard.click();
    await page.getByRole('heading', { name: /Lista de la compra/i }).waitFor({ state: 'visible', timeout: 8000 });
    await maybeScreenshot(page, 'after_compra_mobile.png');

    // Cambiar de modo Sencillo -> Avanzado estando en Compra: debe quedarse en Compra
    await switchUiMode(page, 'Avanzado');
    await page.getByRole('heading', { name: /Lista de la compra/i }).waitFor({ state: 'visible', timeout: 5000 });

    // Verificar barra inferior en Avanzado (4 pestañas: Inicio, Mensual, Compra, Ahorros)
    const avanzadoBottomNav = await page.locator('nav[aria-label="Navegación inferior móvil"] button').evaluateAll((els) =>
      els.map((el) => ({
        text: el.textContent?.trim() || '',
        height: Math.round(el.getBoundingClientRect().height),
      }))
    );
    const navLabelsAv = avanzadoBottomNav.map((b) => b.text.replace(/\d+/g, '').trim());
    if (navLabelsAv.join('|') !== 'Inicio|Mensual|Compra|Ahorros') {
      throw new Error(`Barra inferior Avanzado esperada Inicio|Mensual|Compra|Ahorros, obtenida: ${navLabelsAv.join('|')}`);
    }
    for (const btn of avanzadoBottomNav) {
      if (btn.height < 44) {
        throw new Error(`Objetivo táctil < 44px en barra inferior Avanzado: ${JSON.stringify(btn)}`);
      }
    }

    // Ir a Mensual y comprobar botón Atrás vuelve a Compra y luego a Inicio
    await page.locator('nav[aria-label="Navegación inferior móvil"]').getByRole('button', { name: /Mensual/i }).click();
    await page.getByRole('button', { name: /Balance anual/i }).waitFor({ state: 'visible', timeout: 8000 });

    // Cambiar a Sencillo estando en Mensual: conserva sección equivalente (Mensual)
    await switchUiMode(page, 'Sencillo');
    await page.getByRole('button', { name: 'Mes anterior' }).waitFor({ state: 'visible', timeout: 5000 });
    await switchUiMode(page, 'Avanzado');
    await page.getByRole('button', { name: /Balance anual/i }).waitFor({ state: 'visible', timeout: 5000 });

    // Botón Atrás del navegador: Mensual -> Compra -> Inicio
    await page.goBack();
    await page.getByRole('heading', { name: /Lista de la compra/i }).waitFor({ state: 'visible', timeout: 6000 });
    await page.goBack();
    await page.getByRole('heading', { name: /Resumen de /i }).waitFor({ state: 'visible', timeout: 6000 });

    // En Inicio Avanzado: comprobar que NO hay tarjeta duplicada de "Lista de la compra" y que "+ Gasto" está en cabecera
    const dupCompraInInicio = await page.locator('main').getByText('Lista de la compra').count();
    if (dupCompraInInicio > 0) {
      throw new Error('Inicio en Avanzado no debe duplicar la tarjeta Lista de la compra');
    }
    await page.locator('header').getByRole('button', { name: /Gasto/i }).waitFor({ state: 'visible', timeout: 5000 });

    const scrollHeightAvanzado = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log('METRICS_AFTER_AVANZADO_MOBILE:', JSON.stringify({
      bottomNav: navLabelsAv,
      scrollHeight: scrollHeightAvanzado,
    }));
    await maybeScreenshot(page, 'after_avanzado_mobile_top.png');

    // =========================================================================
    // 2) FIN DE LA ETAPA DE MUDANZA (compartido, reversible, aviso sin mutar, búsqueda intacta)
    // =========================================================================
    // Comprobar que el progreso de mudanza aparece inicialmente en Inicio Avanzado
    await page.locator('main').getByText('Progreso de mudanza').waitFor({ state: 'visible', timeout: 5000 });

    // Abrir Mudanza desde menú avatar (Hogar -> Mudanza)
    await openAvatarMenu(page);
    await page.getByRole('button', { name: 'Mudanza', exact: true }).click();
    await page.getByRole('heading', { name: 'Mudanza', exact: true }).waitFor({ state: 'visible', timeout: 8000 });

    // Leer estado de pendientes antes de terminar
    await page.getByRole('button', { name: /Dar por terminada la mudanza/i }).click();
    const confirmDialog = page.locator('[role="dialog"]');
    await confirmDialog.waitFor({ state: 'visible', timeout: 5000 });
    const warnText = await confirmDialog.innerText();
    if (!/Aviso: todavía quedan/i.test(warnText) || !/No se borrará ningún gasto/i.test(warnText)) {
      throw new Error(`El diálogo de cierre de mudanza debe avisar con pendientes sin bloquear ni mutar. Texto:\n${warnText}`);
    }
    await confirmDialog.getByRole('button', { name: /Sí, terminar mudanza/i }).click();
    await confirmDialog.waitFor({ state: 'hidden', timeout: 5000 });

    // Debe pasar a «Histórico de mudanza» con banner compartido y botón «Reabrir mudanza»
    await page.getByRole('heading', { name: /Histórico de mudanza/i }).waitFor({ state: 'visible', timeout: 5000 });
    await page.getByText('Etapa de mudanza terminada · Histórico compartido').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /Reabrir mudanza/i }).waitFor({ state: 'visible', timeout: 5000 });

    // Volver a Inicio Avanzado: Progreso de mudanza oculto
    await page.locator('nav[aria-label="Navegación inferior móvil"]').getByRole('button', { name: /Inicio/i }).click();
    await page.getByRole('heading', { name: /Resumen de /i }).waitFor({ state: 'visible', timeout: 5000 });
    if ((await page.locator('main').getByText('Progreso de mudanza').count()) > 0) {
      throw new Error('Al terminar mudanza debe ocultarse Progreso de mudanza en Inicio Avanzado');
    }

    // Cambiar a Inicio Sencillo: acceso destacado de Mudanza oculto
    await switchUiMode(page, 'Sencillo');
    await page.waitForSelector('text=Este mes lleváis', { timeout: 5000 });
    if ((await page.locator('main').getByRole('button', { name: /Mudanza/i }).count()) > 0) {
      throw new Error('Al terminar mudanza debe ocultarse el acceso destacado de Mudanza en Inicio Sencillo');
    }

    // En menú avatar (Sencillo) sigue disponible Hogar -> Histórico de mudanza
    await openAvatarMenu(page);
    await page.getByRole('button', { name: /Histórico de mudanza/i }).click();
    await page.getByRole('heading', { name: /Histórico de mudanza/i }).waitFor({ state: 'visible', timeout: 6000 });

    // Volver a Avanzado -> Mensual -> Búsqueda global sigue encontrando gastos iniciales de mudanza
    await switchUiMode(page, 'Avanzado');
    await page.locator('nav[aria-label="Navegación inferior móvil"]').getByRole('button', { name: /Mensual/i }).click();
    await page.getByRole('button', { name: 'Búsqueda global' }).click();
    const globalSearchSection = page.locator('section[aria-label="Búsqueda global de gastos"]');
    await globalSearchSection.waitFor({ state: 'visible', timeout: 8000 });
    await globalSearchSection.getByRole('button', { name: 'Mudanza', exact: true }).click();
    await globalSearchSection.getByText(/Mudanza \(\d+\):/).waitFor({ state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: 'Cerrar búsqueda global' }).click();

    // Abrir Ajustes desde menú avatar -> verificar sección Etapa de mudanza y Reabrir mudanza
    await openAvatarMenu(page);
    await page.getByRole('button', { name: /Ajustes del hogar/i }).click();
    await page.getByRole('heading', { name: /Ajustes/i }).waitFor({ state: 'visible', timeout: 6000 });
    await page.getByText(/Etapa de mudanza/i).waitFor({ state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /Reabrir mudanza/i }).click();

    // Comprobar que al cambiar de Ajustes a Sencillo se redirige limpiamente a Inicio
    await switchUiMode(page, 'Sencillo');
    await page.waitForSelector('text=Este mes lleváis', { timeout: 6000 });
    // Y que Mudanza vuelve a aparecer en Inicio Sencillo al reabrirse
    await page.locator('main').getByRole('button', { name: /Mudanza/i }).waitFor({ state: 'visible', timeout: 5000 });

    // =========================================================================
    // 3) ATAJOS PWA Y ENLACES ANTERIORES
    // =========================================================================
    await page.goto(`${BASE_URL}?autostart=1&action=add-expense`, { waitUntil: 'domcontentloaded' });
    await page.locator('[role="dialog"]').getByText(/¿Cuánto ha costado\?|Añadir gasto/i).first().waitFor({ state: 'visible', timeout: 10000 });

    await page.goto(`${BASE_URL}?autostart=1&tab=inicio&open=shopping`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Lista de la compra/i }).waitFor({ state: 'visible', timeout: 10000 });

    await page.goto(`${BASE_URL}?autostart=1&tab=mudanza`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Mudanza/i }).first().waitFor({ state: 'visible', timeout: 10000 });

    await page.goto(`${BASE_URL}?autostart=1&tab=ajustes`, { waitUntil: 'domcontentloaded' });
    // En modo Sencillo por defecto, ?tab=ajustes NO cambia de modo silenciosamente: aterriza en Inicio Sencillo
    await page.waitForSelector('text=Este mes lleváis', { timeout: 10000 });

    if (pageErrors.length > 0) {
      throw new Error(`Errores en móvil:\n${pageErrors.join('\n')}`);
    }
    await mobileCtx.close();

    // =========================================================================
    // 4) ESCRITORIO (1280x800): navegación unificada sin menús duplicados
    // =========================================================================
    const deskCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'es-ES',
    });
    const dPage = await deskCtx.newPage();
    const deskErrors = [];
    dPage.on('pageerror', (err) => deskErrors.push(err.message));

    await dPage.goto(`${BASE_URL}?autostart=1`, { waitUntil: 'domcontentloaded' });
    await dPage.waitForSelector('text=Este mes lleváis', { timeout: 10000 });

    const deskSencilloNav = await dPage.locator('nav[aria-label="Navegación principal"] button').evaluateAll((els) =>
      els.map((el) => el.textContent?.replace(/\d+/g, '').trim() || '')
    );
    if (deskSencilloNav.join('|') !== 'Inicio|Mensual|Compra|Ahorros') {
      throw new Error(`Nav escritorio Sencillo esperada Inicio|Mensual|Compra|Ahorros, obtenida: ${deskSencilloNav.join('|')}`);
    }

    // Cambiar a Avanzado en escritorio y verificar misma nav sin duplicar Ajustes/Ayuda/Mudanza
    await switchUiMode(dPage, 'Avanzado');
    await dPage.getByRole('heading', { name: /Resumen de /i }).waitFor({ state: 'visible', timeout: 6000 });
    const deskAvanzadoNav = await dPage.locator('nav[aria-label="Navegación principal"] button').evaluateAll((els) =>
      els.map((el) => el.textContent?.replace(/\d+/g, '').trim() || '')
    );
    if (deskAvanzadoNav.join('|') !== 'Inicio|Mensual|Compra|Ahorros') {
      throw new Error(`Nav escritorio Avanzado esperada Inicio|Mensual|Compra|Ahorros, obtenida: ${deskAvanzadoNav.join('|')}`);
    }

    // Verificar que no hay enlaces duplicados de Ayuda/Ajustes en la barra principal
    const headerText = await dPage.locator('header').innerText();
    if (/Ajustes/i.test(headerText) || /Ayuda/i.test(headerText)) {
      throw new Error(`Cabecera escritorio no debe mostrar Ajustes ni Ayuda fuera del menú avatar: "${headerText}"`);
    }

    console.log('METRICS_AFTER_DESKTOP:', JSON.stringify({
      sencilloNav: deskSencilloNav,
      avanzadoNav: deskAvanzadoNav,
    }));
    await maybeScreenshot(dPage, 'after_avanzado_desktop.png');

    if (deskErrors.length > 0) {
      throw new Error(`Errores en escritorio:\n${deskErrors.join('\n')}`);
    }
    await deskCtx.close();

    console.log('✅ verify_navigation_and_mudanza.mjs completado con éxito.');
  } finally {
    await browser.close();
    preview.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error('❌ Error en verify_navigation_and_mudanza.mjs:', err);
  process.exit(1);
});
