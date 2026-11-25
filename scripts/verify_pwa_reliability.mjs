import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { chromium } from '/usr/local/share/bun-global/node_modules/playwright/index.mjs';

const PREVIEW_PORT = 4174;
const BASE_URL = `http://127.0.0.1:${PREVIEW_PORT}`;

async function waitForServer(url, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // wait
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Servidor preview no respondió en ${timeoutMs}ms (${url})`);
}

async function waitForActiveServiceWorker(page) {
  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false, controlled: false };
    const reg = await navigator.serviceWorker.ready;
    return {
      supported: true,
      hasActive: Boolean(reg.active),
      controlled: Boolean(navigator.serviceWorker.controller),
    };
  });
  assert.ok(swReady.supported && swReady.hasActive, `Service Worker no activo: ${JSON.stringify(swReady)}`);
  if (!swReady.controlled) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Este mes lleváis').waitFor({ timeout: 15000 });
    const controlledNow = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    assert.ok(controlledNow, 'Service Worker no tomó el control tras la primera recarga');
  }
}

async function switchToAdvancedDesktop(page) {
  await page.getByRole('button', { name: /Menú de /i }).click();
  const advBtn = page.getByRole('button', { name: 'Avanzado', exact: true });
  await advBtn.waitFor({ timeout: 5000 });
  if (await advBtn.isEnabled()) {
    await advBtn.click();
    await page.waitForTimeout(150);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

async function deleteMatchingCacheEntries(page, patternStr) {
  return page.evaluate(async (pat) => {
    const rx = new RegExp(pat, 'i');
    const names = await caches.keys();
    let removed = 0;
    for (const name of names) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      for (const req of keys) {
        if (rx.test(req.url)) {
          await cache.delete(req);
          removed += 1;
        }
      }
    }
    return removed;
  }, patternStr);
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

  try {
    await waitForServer(BASE_URL);
    browser = await chromium.launch({ headless: true });

    // ═══════════════════════════════════════════════════════════════════════
    // BLOQUE A: Primera apertura online, SW real, apertura offline,
    //           Mercadona sin descargar vs descargado offline
    // ═══════════════════════════════════════════════════════════════════════
    const ctx1 = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'es-ES',
      acceptDownloads: true,
    });
    const page1 = await ctx1.newPage();
    const unexpectedErrors1 = [];
    page1.on('pageerror', (err) => unexpectedErrors1.push(`pageerror: ${err.message}`));

    const initialUrls = [];
    page1.on('response', (res) => initialUrls.push(res.url()));

    await page1.goto(`${BASE_URL}/?autostart=1`, { waitUntil: 'domcontentloaded' });
    await page1.getByText('Este mes lleváis').waitFor({ timeout: 15000 });

    assert.ok(
      !initialUrls.some((u) => /pdfExport-|html2canvas-|mercadona-catalog\.v1\.json/i.test(u)),
      `Recursos diferidos cargados antes de solicitarlos: ${initialUrls.filter((u) => /pdfExport|html2canvas|mercadona/i.test(u)).join(', ')}`
    );

    // Esperar activación y control real del Service Worker de producción
    await waitForActiveServiceWorker(page1);
    console.log('PWA_CHECK_1_OK: Primera apertura online y Service Worker de producción activo.');

    // Limpiar caché Mercadona si existiera y probar apertura offline + Mercadona sin descargar
    await deleteMatchingCacheEntries(page1, 'mercadona-catalog');
    await ctx1.setOffline(true);

    // Recarga completa SIN conexión (desde precaché del Service Worker)
    await page1.reload({ waitUntil: 'domcontentloaded' });
    await page1.getByText('Este mes lleváis').waitFor({ timeout: 15000 });
    console.log('PWA_CHECK_2_OK: Apertura sin conexión tras uso previo funcionando desde Service Worker.');

    // Abrir Lista de la compra sin haber descargado Mercadona todavía -> debe avisar honestamente y seguir operable
    await page1.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: /Compra/i }).click();
    const shopDialog1 = page1.locator('main');
    await shopDialog1.locator('#shopping-list-title').waitFor({ timeout: 10000 });
    await shopDialog1.getByText(/El catálogo de Mercadona aún no se ha descargado en este dispositivo/i).first().waitFor({ timeout: 10000 });

    // Confirmar que aún offline se puede añadir un artículo propio manualmente
    const shopInput1 = shopDialog1.getByRole('combobox', { name: 'Producto para comprar' });
    await shopInput1.fill('Servilletas offline');
    await shopDialog1.getByRole('button', { name: 'Añadir', exact: true }).click();
    await shopDialog1.getByText('Servilletas offline').first().waitFor({ timeout: 5000 });
    console.log('PWA_CHECK_3A_OK: Catálogo Mercadona no descargado offline informa honestamente sin bloquear la lista.');

    // Volver online y pulsar Reintentar para descargar catálogo Mercadona en CacheStorage
    await ctx1.setOffline(false);
    const retryCatalogBtn = shopDialog1.getByRole('button', { name: /Reintentar/i }).first();
    await retryCatalogBtn.click();
    await shopDialog1.getByText(/Catálogo de referencia no oficial/i).waitFor({ timeout: 15000 });

    // Ir offline otra vez, recargar la app completa y abrir Lista de la compra -> debe cargar Mercadona desde caché
    await ctx1.setOffline(true);
    await page1.reload({ waitUntil: 'domcontentloaded' });
    await page1.locator('#shopping-list-title').waitFor({ timeout: 15000 });
    const shopDialog1Offline = page1.locator('main');
    await shopDialog1Offline.getByText(/Catálogo de referencia no oficial/i).waitFor({ timeout: 15000 });
    const shopSearchOffline = shopDialog1Offline.getByRole('combobox', { name: 'Producto para comprar' });
    await shopSearchOffline.fill('leche');
    await shopDialog1Offline.locator('#shopping-suggestions-list').getByText('Mercadona').first().waitFor({ timeout: 10000 });
    await page1.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: 'Inicio' }).click();
    await page1.getByText('Este mes lleváis').waitFor({ timeout: 10000 });
    console.log('PWA_CHECK_3B_OK: Catálogo Mercadona descargado previamente funciona 100 % sin conexión.');

    // ═══════════════════════════════════════════════════════════════════════
    // BLOQUE B: Vista cacheada offline vs vista no disponible offline + Reintento real
    // ═══════════════════════════════════════════════════════════════════════
    await ctx1.setOffline(false);
    await switchToAdvancedDesktop(page1);

    // Visitar Mensual online (queda cacheada)
    await page1.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: 'Mensual' }).click();
    await page1.getByRole('heading', { name: 'Presupuesto vs real' }).waitFor({ timeout: 10000 });

    // Volver a Inicio, ir offline y abrir Mensual -> debe abrir sin problema
    await page1.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: 'Inicio' }).click();
    await page1.getByRole('heading', { name: /Resumen de /i }).waitFor({ timeout: 10000 });
    await ctx1.setOffline(true);
    await page1.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: 'Mensual' }).click();
    await page1.getByRole('heading', { name: 'Presupuesto vs real' }).waitFor({ timeout: 10000 });

    // Simular chunk de vista NO disponible en caché estando offline (evict AhorrosView del precache)
    await page1.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: 'Inicio' }).click();
    const removedAhorros = await deleteMatchingCacheEntries(page1, 'AhorrosView-');
    assert.ok(removedAhorros > 0, 'No se encontró AhorrosView en caché para simular vista no disponible offline');
    await page1.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: 'Ahorros' }).click();
    await page1.getByText('Sección no disponible sin conexión').waitFor({ timeout: 10000 });

    // Recuperar conexión y pulsar "Reintentar" -> debe re-ejecutar import() y cargar AhorrosView de verdad
    await ctx1.setOffline(false);
    await page1.getByRole('button', { name: 'Reintentar' }).click();
    await page1.getByRole('heading', { name: /Ahorro|Metas/i }).first().waitFor({ timeout: 15000 });
    console.log('PWA_CHECK_4_OK: Vista cacheada offline OK, vista no disponible avisa honestamente y Reintentar carga de verdad.');

    // ═══════════════════════════════════════════════════════════════════════
    // BLOQUE C: Exportación PDF sin módulo descargado offline vs descargado offline
    // ═══════════════════════════════════════════════════════════════════════
    await deleteMatchingCacheEntries(page1, 'pdfExport-|html2canvas-');
    await page1.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: 'Mensual' }).click();
    await page1.getByRole('heading', { name: 'Presupuesto vs real' }).waitFor({ timeout: 10000 });

    await ctx1.setOffline(true);
    await page1.getByRole('button', { name: 'PDF', exact: true }).click();
    await page1.getByText(/sin conexión|conexión/i).first().waitFor({ timeout: 10000 });
    console.log('PWA_CHECK_5A_OK: Exportación PDF sin módulo descargado offline muestra error honesto sin romperse.');

    // Volver online, descargar/generar PDF (cachea módulo en nido-pdf-module-v1)
    await ctx1.setOffline(false);
    const dlOnlinePromise = page1.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await page1.getByRole('button', { name: 'PDF', exact: true }).click();
    await page1.getByText('PDF mensual descargado').waitFor({ timeout: 15000 });
    await dlOnlinePromise;

    // Ahora ir offline, recargar completamente la pestaña y volver a exportar PDF -> debe funcionar offline
    await ctx1.setOffline(true);
    await page1.reload({ waitUntil: 'domcontentloaded' });
    await page1.getByRole('navigation', { name: 'Navegación principal' }).waitFor({ timeout: 15000 });
    await switchToAdvancedDesktop(page1);
    await page1.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: 'Mensual' }).click();
    await page1.getByRole('heading', { name: 'Presupuesto vs real' }).waitFor({ timeout: 10000 });

    const dlOfflinePromise = page1.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await page1.getByRole('button', { name: 'PDF', exact: true }).click();
    await page1.getByText('PDF mensual descargado').waitFor({ timeout: 15000 });
    await dlOfflinePromise;
    console.log('PWA_CHECK_5B_OK: Exportación PDF descargada previamente funciona sin conexión tras recargar.');

    // ═══════════════════════════════════════════════════════════════════════
    // BLOQUE D: Nueva versión publicada con pestaña abierta (chunk 404) +
    //           protección anti-bucle + protección de formulario sin guardar
    // ═══════════════════════════════════════════════════════════════════════
    await ctx1.setOffline(false);

    // 1) Simular formulario abierto con cambios sin guardar mientras llega aviso de actualización
    await page1.getByRole('button', { name: /Menú de /i }).click();
    await page1.getByRole('button', { name: 'Ajustes del hogar', exact: true }).click();
    await page1.getByRole('heading', { name: 'Categorías personalizadas' }).waitFor({ timeout: 10000 });
    await page1.getByRole('button', { name: 'Nueva categoría' }).click();
    const catInput = page1.locator('#custom-cat-name');
    await catInput.fill('Gimnasio sin guardar');

    // Disparar evento de nueva versión mientras edita
    await page1.evaluate(() => {
      sessionStorage.removeItem('nido_chunk_reload_guard_v1');
      window.dispatchEvent(new CustomEvent('nido:stale-chunk'));
    });

    const pwaBanner = page1.getByTestId('pwa-update-banner');
    await pwaBanner.waitFor({ timeout: 5000 });

    // Confirmar que NO recargó automáticamente y el texto escrito sigue intacto
    assert.equal(await catInput.inputValue(), 'Gimnasio sin guardar');

    // Pulsar Recargar -> debe BLOQUEAR la recarga en el primer clic y avisar al usuario
    await pwaBanner.getByRole('button', { name: 'Recargar', exact: true }).click();
    await pwaBanner.getByText(/Tienes un formulario o ventana de edición abierta/i).waitFor({ timeout: 5000 });
    assert.equal(await catInput.inputValue(), 'Gimnasio sin guardar');

    // Pulsar Seguir editando -> sigue editando sin perder cambios
    await pwaBanner.getByRole('button', { name: 'Seguir editando' }).click();
    assert.equal(await catInput.inputValue(), 'Gimnasio sin guardar');

    // Cerrar formulario y banner
    await page1.getByRole('button', { name: 'Cerrar formulario de categoría' }).click();
    await pwaBanner.getByRole('button', { name: 'Cerrar aviso de actualización' }).click();
    console.log('PWA_CHECK_6_OK: Actualización PWA no recarga ni pierde cambios con formulario abierto.');

    // 2) Simular chunk obsoleto real (404 online tras nuevo despliegue) y protección anti-bucle
    await deleteMatchingCacheEntries(page1, 'MudanzaView-');
    await ctx1.route(/\/assets\/MudanzaView-.*\.js(\?.*)?$/, (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' })
    );
    await page1.getByRole('button', { name: /Menú de /i }).click();
    await page1.getByRole('button', { name: 'Mudanza', exact: true }).click();
    await page1.getByText('Hay una versión más reciente de Nido').waitFor({ timeout: 10000 });
    await page1.getByTestId('pwa-update-banner').waitFor({ timeout: 5000 });

    // Comprobar protección anti-bucle: si ya hubo una recarga reciente, bloquea la siguiente
    await page1.evaluate(() => {
      sessionStorage.setItem(
        'nido_chunk_reload_guard_v1',
        JSON.stringify({ count: 1, lastAtMs: Date.now() })
      );
      window.dispatchEvent(new CustomEvent('nido:stale-chunk'));
    });
    await page1.getByText(/Ya se intentó recargar hace un momento/i).waitFor({ timeout: 5000 });
    const reloadBtnDisabled = await page1.getByTestId('pwa-update-banner').getByRole('button', { name: 'Recargar', exact: true }).isDisabled();
    assert.equal(reloadBtnDisabled, true, 'El botón Recargar debería quedar deshabilitado por el freno anti-bucle');
    await ctx1.unroute(/\/assets\/MudanzaView-.*\.js(\?.*)?$/);
    console.log('PWA_CHECK_7_OK: Chunk antiguo 404 detectado, banner visible y freno anti-bucle verificado.');

    // ═══════════════════════════════════════════════════════════════════════
    // BLOQUE E: Finalizar compra en UI: cancelar no altera nada + flujo completo
    // ═══════════════════════════════════════════════════════════════════════
    await page1.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: /Compra/i }).click();
    const shopDlg = page1.locator('main');
    await shopDlg.locator('#shopping-list-title').waitFor({ timeout: 10000 });

    // Añadir un artículo propio y marcarlo como comprado
    await shopDlg.getByRole('combobox', { name: 'Producto para comprar' }).fill('Prueba cancelación segura');
    await shopDlg.getByRole('button', { name: 'Añadir', exact: true }).click();
    await shopDlg.getByText('Prueba cancelación segura').first().waitFor({ timeout: 5000 });
    await shopDlg.getByRole('button', { name: /Marcar Prueba cancelación segura como comprado/i }).first().click();
    await page1.waitForTimeout(150);

    // Abrir Finalizar compra y Cancelar antes de confirmar -> el artículo debe seguir en la lista
    await shopDlg.getByRole('button', { name: /(?:Finalizar compra|Convertir en gasto) \(\d+\)/ }).click();
    await shopDlg.locator('#checkout-amount').waitFor({ timeout: 5000 });
    await shopDlg.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await shopDlg.getByText('Prueba cancelación segura').first().waitFor({ timeout: 5000 });

    // Ahora confirmar la compra -> crea gasto y limpia artículo
    await shopDlg.getByRole('button', { name: /(?:Finalizar compra|Convertir en gasto) \(\d+\)/ }).click();
    await shopDlg.locator('#checkout-amount').fill('27.80');
    await shopDlg.getByRole('button', { name: /Guardar gasto .* y limpiar carro/ }).click();
    await page1.getByText(/Compra finalizada:/).waitFor({ timeout: 10000 });
    await shopDlg.locator('#checkout-amount').waitFor({ state: 'hidden', timeout: 5000 });
    console.log('PWA_CHECK_8_OK: Cancelar antes de confirmar deja la lista intacta y finalizar compra completa limpio.');

    await ctx1.close();

    assert.equal(
      unexpectedErrors1.length,
      0,
      `Errores no esperados de ejecución en navegador:\n${unexpectedErrors1.join('\n')}`
    );

    console.log('PWA_RELIABILITY_PASS: Todas las verificaciones de PWA, offline, chunks obsoletos, formularios y checkout pasaron en build de producción.');
  } catch (err) {
    console.error('PWA_RELIABILITY_FAIL:', err);
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
