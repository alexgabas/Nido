# Estado de desarrollo de Nido

Última actualización: 2026-11-23

## 1. Resumen ejecutivo

- **Aplicación**: **Nido** (finanzas compartidas del hogar, gastos de mudanza, presupuestos, metas de ahorro y lista de la compra compartida). Idioma: español de España (`es-ES`). Moneda: `EUR`.
- **Arquitectura**: SPA React + TypeScript + Vite + Tailwind + PWA offline-first (`vite-plugin-pwa`) + Firebase Auth / Firestore en plan gratuito Spark (coste cero: sin Cloud Functions, Cloud Billing ni servicios de pago), con paridad funcional en modo demostración local (`DemoHouseholdRepository`).
- **Estado actual**: Iteración dirigida de fiabilidad completada en los 4 frentes solicitados (idempotencia duradera al finalizar compra, atomicidad y concurrencia en limpieza de productos, endurecimiento y despliegue de `firestore.rules`, y ciclo de vida PWA/offline/chunks obsoletos), con **37/37 pruebas unitarias**, build de producción, **2 suites E2E en Chromium sobre `vite preview`**, ESLint de `firestore.rules` y despliegue real de reglas en Firestore.

---

## 2. Completado en la iteración de fiabilidad

### 1) Finalizar compra: idempotencia duradera y recuperación
- **Identidad estable por operación**: cada confirmación genera un `checkoutId` (`chk_<ts>_<rand>`) y deriva un ID de gasto determinista `expenseId = tx_${checkoutId}` (`src/domain/shoppingCheckout.ts`). Dos compras reales distintas con igual fecha, importe y concepto obtienen `checkoutId` distintos y nunca sufren falsos duplicados.
- **Recuperación duradera local y en servidor**:
  - Estado local mínimo persistido en `localStorage` bajo clave estrictamente aislada por `(householdId, viewerUid)` (`nido_pending_checkout_v1:${householdId}:${viewerUid}`), limpiado al cerrar sesión o cambiar de modo/hogar.
  - Estado compartido/privado mínimo en servidor (`households/{hid}/shoppingCheckouts/{checkoutId}`) creado **únicamente** si el carro supera `MAX_CHECKOUT_BATCH_ITEMS = 10` artículos y eliminado atómicamente al terminar el último lote (0 documentos en reposo).
- **Transacción atómica en Fase 1 (`commitShoppingCheckoutPhase1`)**: en `FirestoreHouseholdRepository` (y paridad en `DemoHouseholdRepository`), una única `runTransaction` (≤ 13 escrituras):
  - Comprueba si `transactions/tx_${checkoutId}` ya existe → devuelve `already_committed` sin duplicar gasto ni recargar tras respuesta de red perdida o cierre/recarga de la app.
  - Verifica `monthClosures/{monthKey}` en servidor.
  - Ordena deterministamente los `snapshots` por `id` y lee el lote 1 (≤ 10 documentos de `shopping`): si algún artículo ya fue borrado por la pareja en un cierre simultáneo, aborta con `overlap_conflict` **sin crear gasto duplicado**.
  - Compromete atómicamente el gasto, la entrada de actividad (solo si no es privado), la eliminación de los artículos sin modificar del lote 1 y, si quedan artículos, el documento de continuación `shoppingCheckouts/{checkoutId}`.
- **Honestidad offline y UI de recuperación**: en modo real sin conexión se bloquea el cierre transaccional con aviso honesto (no se simula confirmación de servidor). Tanto en `InicioView` como en `ShoppingListSection` se muestran avisos accionables para comprobar un cierre local incierto o reanudar/descartar limpiezas multi-lote desde cualquier dispositivo sin duplicar el gasto. Cancelar antes de confirmar no genera estado local ni altera la lista.

### 2) Limpieza de productos y concurrencia
- **Cierre de la ventana TOCTOU**: la lectura del estado vivo de cada artículo de `shopping`, su verificación y su borrado se ejecutan ahora dentro de la misma `runTransaction` en servidor (`commitShoppingCheckoutPhase1` y `cleanupShoppingCheckoutBatch`), con lotes acotados a `≤ 10` artículos por transacción (`≤ 15` escrituras totales).
- **Preservación de cambios de la pareja**:
  - En el mismo dispositivo: `isShoppingItemUnchangedForCheckout` exige `done === true`, mismo `text`, `qty`, `unit` y `updatedAt`.
  - Desde un segundo dispositivo sin instantánea local: `isShoppingItemSafeForCrossDeviceCleanup` solo permite eliminar artículos con `done === true` y `updatedAt <= checkout.createdAt`.
  - Cualquier artículo editado, desmarcado o añadido recientemente por la pareja se conserva intacto.
- **Reanudación sin recrear gasto**: `cleanupShoppingCheckoutBatch` jamás escribe en `transactions`; reduce `pendingItemIds` de forma estrictamente decreciente o elimina el documento `shoppingCheckouts/{checkoutId}` al finalizar.

### 3) Firestore Rules, consultas reales y despliegue
- **Causa raíz corregida en reglas (`firestore.rules` y `firebase-blueprint.json`)**:
  - **Meses cerrados en capa de servidor**: añadida `isMonthClosed(hid, monthKey)` y exigida (`!isMonthClosed(...)`) en `create`, `update` y `delete` de `transactions`, `budgets` y `categoryBudgets`, cerrando el hueco donde el bloqueo existía solo en cliente. También se protegió `importBackup` en ambos repositorios para no sobrescribir meses ya cerrados.
  - **Subcolección `shoppingCheckouts/{checkoutId}`**: reglas estrictas con validación de ID, existencia enlazada (`exists`/`existsAfter`) de `transactions/tx_${checkoutId}`, privacidad `isPrivate`/`createdBy` (los cierres privados obligan a `amount == 0` y `concept == 'Compra privada'`), inmutabilidad de campos y `pendingItemIds.size() < existing().pendingItemIds.size()` en `update`.
- **Causa raíz corregida en consultas (`FirestoreHouseholdRepository.ts`)**:
  - `deleteUnusedCustomCategory` utilizaba consultas compuestas `where` de 2 campos sobre `transactions` (`isPrivate + category` y `createdBy + category`) sin índice compuesto declarado; sustituido por `fetchVisibleTransactionsMap` (dos consultas de un solo campo coherentes con `firestore.rules` y sin índices compuestos extra).
  - Eliminada una duplicación accidental de `mapPendingShoppingCheckout` y los métodos de checkout en `FirestoreHouseholdRepository.ts` detectada al compilar con Rolldown.
- **Ampliación de `firestore.rules.test.ts`**: añadidos tests 18 (meses cerrados + reapertura), 19 (`shoppingCheckouts` atómicos, privacidad y progreso decreciente) y 20 (consultas reales de `FirestoreHouseholdRepository`).
- **Despliegue ejecutado**: `firestore.rules` validado con `npx eslint firestore.rules` (0 errores) y desplegado al proyecto de Firestore mediante `DeployRules`.

### 4) PWA: actualizaciones, chunks obsoletos y offline
- **Registro único y protección de edición (`src/services/pwaUpdateGuard.ts`, `src/main.tsx`, `src/components/PWAUpdateBanner.tsx`)**:
  - Eliminado el doble `registerSW` en `main.tsx`; registro único centralizado en `PWAUpdateBanner` con comprobación al volver al foco si hay red.
  - Bloqueo de recarga durante escrituras activas (`pending_write`) y aviso con doble confirmación explícita (`Seguir editando` / `Recargar igualmente`) cuando hay un formulario modal o inline abierto (`unsaved_form`, incluyendo `CategoryManagerSection`, `QuickExpenseModal`, `ShoppingCheckoutPanel`, etc.). Nunca recarga automáticamente.
  - Freno anti-bucle en `sessionStorage` (`nido_chunk_reload_guard_v1`, máximo 1 recarga en ventana de 60 s).
- **Reintento real de chunks tras volver online (corrección de mapa de módulos de Chromium/WebKit)**:
  - Corregido `vite:preloadError` en `main.tsx` (retirado `event.preventDefault()` que convertía el rechazo en `undefined` y ocultaba el error real de chunk).
  - En `src/App.tsx` (`getRetryableLazyView`) y `src/services/pdfExportLoader.ts`, cuando una importación dinámica falla offline y el navegador cachea `null` en su mapa de módulos (especificación HTML), el botón **Reintentar** reintenta con una ruta del mismo origen validada `/assets/*.js?nido_retry=N`, permitiendo recuperar vistas y PDF al volver la conexión sin perder el estado ni recargar.
  - `vite.config.ts`: añadidos `cleanupOutdatedCaches: true`, `navigateFallbackDenylist: [/^\/assets\//, /^\/data\//]`, `cacheableResponse: { statuses: [200] }` y `matchOptions: { ignoreSearch: true }` en `nido-pdf-module-v1` para que el PDF descargado tras reintento quede usable offline incluso tras recargar.
- **Validación del catálogo Mercadona en caché (`src/services/mercadonaCatalogLoader.ts` y `ShoppingListSection.tsx`)**:
  - Valida `content-type` y esquema JSON no vacío antes de guardar en `CacheStorage`, expulsa entradas corruptas/HTML en lugar de fallar permanentemente y muestra mensaje honesto en español cuando aún no se ha descargado offline.

---

## 3. Pruebas ejecutadas y estado de verificación

| Comprobación | Estado | Evidencia real |
|---|---|---|
| Comprobación de tipos (`npm run lint` / `tsc --noEmit`) | **Verificado mediante prueba ejecutada** | 0 errores (incluidos `src/` y `firestore.rules.test.ts`) |
| Pruebas unitarias (`npm run test:unit`) | **Verificado mediante prueba ejecutada** | **37/37 en verde** (`src/domain/finance.test.ts`, pruebas 26–30 nuevas: idempotencia duradera tras recarga/red perdida, sin falsos duplicados, solapamiento simultáneo de pareja, limpieza multi-lote >10 con fallo intermedio + edición/desmarcado/alta concurrente + reanudación cross-device, aislamiento de estado local, meses cerrados en capa de datos e importación, guardas PWA y anti-bucle) |
| Lint de Security Rules (`npx eslint firestore.rules`) | **Verificado mediante prueba ejecutada** | 0 errores, 0 advertencias |
| Despliegue de Security Rules (`DeployRules`) | **Verificado mediante prueba ejecutada** | Desplegado sin errores al proyecto configurado |
| Build de producción + PWA (`npm run build`) | **Verificado mediante prueba ejecutada** | `dist/sw.js` generado (29 entradas precacheadas, PDF y catálogo Mercadona diferidos bajo demanda) |
| E2E general móvil/escritorio (`node scripts/verify_nido_e2e.mjs`) | **Verificado mediante prueba ejecutada** | `E2E_PASS` (móvil `390×844` y escritorio `1280×800`, 0 errores de consola/página, 0 desbordamiento) |
| E2E fiabilidad PWA/offline/chunks (`node scripts/verify_pwa_reliability.mjs`) | **Verificado mediante prueba ejecutada** | `PWA_RELIABILITY_PASS` sobre build de producción (`vite preview` con Service Worker real): 8/8 escenarios en verde (arranque online + SW activo, recarga offline, Mercadona no descargado vs descargado offline, vista cacheada vs no disponible + reintento real online, PDF no descargado vs descargado offline tras recarga, formulario sin guardar protegido ante aviso de actualización, chunk 404 + banner + anti-bucle, cancelar checkout sin alterar lista + cierre completo) |
| Suite de reglas contra emulador (`npm run test:rules`) | **Pendiente de verificar (bloqueado por entorno)** | No existe `java` en este contenedor (`java: not found`), por lo que el emulador local de Firestore no puede arrancarse aquí. Ejecutar en máquina con Java 21+: `npm run test:rules` |
| Validación en producción con 2 cuentas y 2 dispositivos reales | **Pendiente de verificar** | Requiere prueba manual en el entorno desplegado con las dos cuentas reales de pareja |

---

## 4. Riesgos conocidos y limitaciones

- **Emulador de Firestore pendiente en entorno con Java 21+**: `firestore.rules` superó ESLint y el despliegue real en Firebase (que compila las reglas en servidor), pero los 20 casos de `firestore.rules.test.ts` deben ejecutarse en local con `npm run test:rules` donde haya Java 21+.
- **Límite de 100 artículos por cierre de compra**: `MAX_CHECKOUT_PENDING_ITEMS = 100` (procesado en transacciones de `≤ 10` artículos). Si una compra superase 100 líneas simultáneas en el carro, habría que dividirla en dos cierres.
- **Límite del borrado en `shoppingCheckouts` desde segundo dispositivo**: al reanudar desde otro dispositivo sin instantánea local, se protege cualquier artículo cuya `updatedAt` sea posterior a `checkout.createdAt`; si el reloj de un cliente desincronizado escribiese fechas locales (no ocurre en Firestore porque usa `serverTimestamp()`), el servidor impone su propia marca temporal.
- **Offline real en Firestore**: Nido no finge que un cierre de compra o escritura offline esté confirmado por el servidor; el cierre de compra exige conexión activa para garantizar atomicidad real y evitar duplicados entre pareja.

---

## 5. Siguiente paso exacto

1. En un equipo con **Java 21+** y `firebase-tools`, ejecutar `npm run test:rules` para verificar los 20 tests de `firestore.rules.test.ts` contra el emulador local de Firestore.
2. Completar el checklist manual de 2 cuentas y 2 dispositivos (cierre simultáneo de compra, corte de red a mitad de limpieza multi-lote, mes cerrado y recarga PWA con formulario abierto).
