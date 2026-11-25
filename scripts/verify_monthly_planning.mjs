import { chromium } from '/usr/local/share/bun-global/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';

const PORT = 4177;
const URL = `http://127.0.0.1:${PORT}/`;

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
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  preview.stdout.on('data', (d) => (logs += d.toString()));
  preview.stderr.on('data', (d) => (logs += d.toString()));

  try {
    await waitForServer(URL);
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 }, locale: 'es-ES' });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto(`${URL}?autostart=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Este mes lleváis', { timeout: 10000 });

    // 1. Verificar cifras coherentes en Inicio (Modo Sencillo)
    const inicioSencilloText = await page.locator('body').innerText();
    if (!inicioSencilloText.includes('1.160,80')) {
      throw new Error('Inicio Sencillo no muestra 1.160,80 € registrados');
    }
    if (!inicioSencilloText.includes('288,00')) {
      throw new Error('Inicio Sencillo no muestra 288,00 € en cargos previstos');
    }
    if (!inicioSencilloText.includes('1.670,00')) {
      throw new Error('Inicio Sencillo no muestra 1.670,00 € de estimación de cierre');
    }
    if (!inicioSencilloText.includes('1.086,00')) {
      throw new Error('Inicio Sencillo no muestra 1.086,00 € previstos para Cuenta común');
    }

    // 2. Ir a Mensual en Modo Sencillo y verificar resumen + Cuenta común
    await page.getByRole('button', { name: /Ver detalle/i }).first().click();
    await page.waitForSelector('text=Cuenta común este mes', { timeout: 8000 });
    const mensualSencilloText = await page.locator('body').innerText();
    for (const expected of ['1.160,80', '288,00', '1.670,00', '1.086,00', '597,30', '488,70', 'Presupuesto parcial']) {
      if (!mensualSencilloText.includes(expected)) {
        throw new Error(`Mensual Sencillo no muestra "${expected}"`);
      }
    }

    // 3. Cambiar a Modo Avanzado y verificar paridad exacta + interacción categorías variables y saldo manual
    await page.getByRole('button', { name: /Menú de /i }).click();
    await page.getByRole('button', { name: 'Avanzado', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.waitForSelector('text=Planificación del mes', { timeout: 8000 });
    const mensualAvanzadoText = await page.locator('body').innerText();
    for (const expected of ['1.450,00', '1.160,80', '288,00', '1.670,00', '1.086,00', '597,30', '488,70', 'Presupuesto parcial']) {
      if (!mensualAvanzadoText.includes(expected)) {
        throw new Error(`Mensual Avanzado no muestra "${expected}"`);
      }
    }

    // Abrir selector de categorías variables en Cuenta común y marcar Supermercado
    await page.getByRole('button', { name: /Categorías variables/i }).click();
    await page.getByRole('button', { name: /Supermercado/i }).first().click();
    await page.waitForSelector('text=1.229,20', { timeout: 5000 });

    // Indicar saldo disponible manual de 200 € y luego quitarlo
    await page.getByRole('button', { name: /Indicar saldo/i }).click();
    await page.getByPlaceholder('Ej. 450,00').fill('200');
    await page.getByRole('button', { name: /Guardar saldo/i }).click();
    await page.waitForSelector('text=Saldo disponible de Cuenta común: 200,00', { timeout: 5000 });

    // Quitar saldo disponible
    await page.getByRole('button', { name: /Quitar saldo disponible/i }).click();
    await page.waitForSelector('text=Importe previsto que debéis tener disponible', { timeout: 5000 });

    // Volver a Sencillo y confirmar que refleja 1.229,20 € (mismos datos compartidos)
    await page.getByRole('button', { name: /Menú de /i }).click();
    await page.getByRole('button', { name: 'Sencillo', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.waitForSelector('text=1.229,20', { timeout: 5000 });

    if (pageErrors.length > 0) {
      throw new Error(`Errores en consola: ${pageErrors.join(' | ')}`);
    }

    await browser.close();
    console.log('MONTHLY_PLANNING_E2E_PASS: Resumen mensual, Cuenta común, categorías variables, saldo manual y paridad Sencillo/Avanzado verificados.');
  } catch (err) {
    console.error('MONTHLY_PLANNING_E2E_FAIL:', err);
    if (logs) console.error('PREVIEW_LOGS:', logs);
    process.exitCode = 1;
  } finally {
    preview.kill('SIGKILL');
  }
}

run().finally(() => process.exit(process.exitCode ?? 0));
