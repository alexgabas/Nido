# Estado de desarrollo de Nido

Última actualización: 2026-11-23

## 1. Resumen ejecutivo

- **Aplicación**: **Nido** (finanzas compartidas del hogar, gastos de mudanza, presupuestos, metas de ahorro y lista de la compra compartida). Idioma: español de España (`es-ES`). Moneda: `EUR`.
- **Arquitectura**: SPA React + TypeScript + Vite + Tailwind + PWA offline-first (`vite-plugin-pwa`) + Firebase Auth / Firestore en plan gratuito Spark (coste cero: sin Cloud Functions, Cloud Billing ni servicios de pago), con paridad funcional en modo demostración local (`DemoHouseholdRepository`).
- **Estado actual**: Cierre de verificaciones pendientes y endurecimiento de los casos límite solicitados completado en código y pruebas locales (**39/39 pruebas unitarias**, `tsc --noEmit`, ESLint de `firestore.rules`, build de producción + PWA y **2 suites E2E en Chromium**). Quedan pendientes exclusivamente la ejecución en GitHub Actions / máquina con Java 21+ del workflow de emulador de `firestore.rules` (preparado pero no ejecutado aún) y el checklist manual de 8 pruebas con 2 cuentas y 2 dispositivos (`/MANUAL_ACCEPTANCE_CHECKLIST.md`).

---

## 2. Código implementado

### A) Cierre de verificaciones y casos límite de compra (última iteración)
- **Pagador por defecto = Cuenta común (`COMMON_ACCOUNT_ID`) en nuevos gastos**:
  - `src/components/QuickExpenseModal.tsx`: al crear un gasto nuevo, `paidBy` se inicializa a `COMMON_ACCOUNT_ID` (salvo `prefill.paidBy` explícito); al editar gastos existentes se respeta el pagador guardado y al marcar **Gasto solo mío (privado)** se fuerza `currentUserProfile.uid`.
  - `src/components/ShoppingCheckoutPanel.tsx`: `paidBy` inicializado a `COMMON_ACCOUNT_ID` (coherente con `RecurringTemplateModal`, `MudanzaView` y `BankCsvImportModal`).
- **Recuperación en compras ≤10 artículos tras respuesta perdida + cierre de sesión/cambio de hogar + reentrada**:
  - Al cerrarse de forma atómica en Fase 1 (`transactions/tx_${checkoutId}` + borrado de `≤10` artículos sin crear `shoppingCheckouts`), cerrar sesión borra `localStorage` (`clearAllLocalPendingCheckouts()`, cero fuga de datos privados). Al reentrar, el estado sincronizado ya muestra el gasto una sola vez y los artículos retirados; incluso si un cliente desactualizado reintenta con un nuevo `checkoutId` sobre las instantáneas antiguas, el servidor aborta con `overlap_conflict` sin duplicar gasto.
  - `src/components/ShoppingCheckoutPanel.tsx`: mensaje de conflicto actualizado para explicar ambas causas (cierre por la pareja o intento previo confirmado en servidor tras corte de red o cierre de sesión).
- **Solapamiento en compras >10 artículos exclusivo en lotes posteriores (lote 2+)**:
  - `src/repositories/FirestoreHouseholdRepository.ts` y `src/repositories/DemoHouseholdRepository.ts`: `commitShoppingCheckoutPhase1` verifica ahora **todos** los artículos seleccionados (`ordered`, lote 1 y lotes posteriores `≥11`) dentro de la misma `runTransaction`, manteniendo el límite de escrituras en Fase 1 (`≤10` borrados, `≤13` escrituras totales). Si cualquier artículo de lote 2+ ya fue retirado, aborta con `overlap_conflict` sin crear gasto; si algún artículo de lote 2+ fue editado/desmarcado concurrentemente, se excluye de `pendingItemIds`.
  - `src/components/ShoppingCheckoutPanel.tsx`: comprobación previa frente a `pendingShoppingCheckouts` activos en el hogar para bloquear inmediatamente solapamientos sobre lotes pendientes de otro cierre en curso.
  - `src/domain/shoppingCheckout.ts` y `src/context/NidoContext.tsx`: acumulación explícita de `alreadyGoneCount` en `executeDurableShoppingCheckout` y `resumePendingShoppingCheckout`, mostrando aviso visible si en una carrera simultánea en Fase 1 con lotes 1 disjuntos algún artículo de lote 2+ ya había sido retirado por otro cierre.
- **Workflow reproducible de emulador de reglas (sin credenciales ni producción)**:
  - `package.json`: script `test:rules` fijado con `--project demo-nido-rules-test` para ejecución 100 % local sin credenciales ni acceso a producción.
  - `.github/workflows/firestore-rules.yml`: workflow preparado para GitHub Actions con Node 22 + Java 21 + `firebase-tools` ejecutando `npm run lint`, `npx eslint firestore.rules`, `npm run test:unit` y `npm run test:rules` (solo lectura de código, cero secretos, cero despliegues, coste cero).
- **Checklist manual acotado (8 pruebas)**:
  - `MANUAL_ACCEPTANCE_CHECKLIST.md`: 8 recorridos concretos para 2 cuentas y 2 dispositivos (todos marcados como pendientes).

### B) Base de fiabilidad ya implementada anteriormente
- Idempotencia duradera de `Finalizar compra` (`chk_<ts>_<rand>`, `tx_${checkoutId}`, estado local aislado por `(householdId, viewerUid)` y `shoppingCheckouts/{checkoutId}` solo si `>10` artículos).
- Limpieza atómica por lotes (`≤10` artículos/transacción) con preservación de ediciones/desmarcados/altas concurrentes de pareja.
- Endurecimiento de `firestore.rules` (bloqueo de meses cerrados en servidor en `transactions`, `budgets` y `categoryBudgets`; reglas estrictas para `shoppingCheckouts`; consultas sin índices compuestos faltantes) ya desplegado en la iteración anterior.
- Protección PWA (registro único, bloqueo de recarga durante edición/escritura, reintento real de chunks tras volver online con bypass de caché de módulo fallido, validación de caché de catálogo Mercadona y freno anti-bucle de 60 s).

---

## 3. Pruebas ejecutadas (verificadas localmente)

| Comprobación | Estado | Evidencia real |
|---|---|---|
| Comprobación de tipos (`npm run lint` / `tsc --noEmit`) | **Verificado mediante prueba ejecutada** | 0 errores (`src/` y `firestore.rules.test.ts`) |
| Pruebas unitarias (`npm run test:unit`) | **Verificado mediante prueba ejecutada** | **39/39 en verde** (`src/domain/finance.test.ts`, incluyendo nuevas pruebas **31**: recuperación ≤10 artículos tras respuesta perdida + logout + reentrada sin duplicar gasto, y **32**: solapamiento exclusivo en lote 2+ tanto secuencial como carrera simultánea en Fase 1) |
| Lint de Security Rules (`npx eslint firestore.rules`) | **Verificado mediante prueba ejecutada** | 0 errores, 0 advertencias |
| Build de producción + PWA (`npm run build`) | **Verificado mediante prueba ejecutada** | `dist/sw.js` generado (29 entradas precacheadas, PDF y catálogo Mercadona diferidos bajo demanda) |
| E2E general móvil/escritorio (`node scripts/verify_nido_e2e.mjs`) | **Verificado mediante prueba ejecutada** | `E2E_PASS` (móvil `390×844` y escritorio `1280×800`, 0 errores) |
| E2E fiabilidad PWA/offline/chunks (`node scripts/verify_pwa_reliability.mjs`) | **Verificado mediante prueba ejecutada** | `PWA_RELIABILITY_PASS` sobre `vite preview` con Service Worker real (8/8 escenarios en verde) |

---

## 4. Workflow preparado pero no ejecutado

- **Archivo**: `.github/workflows/firestore-rules.yml`
- **Estado**: **Preparado, pendiente de ejecución en GitHub Actions** (en este contenedor no existe Java, por lo que no se ha ejecutado `npm run test:rules` ni se ha ejecutado el workflow en GitHub; no se afirma que los 20 tests del emulador hayan pasado todavía).
- **Qué ejecuta**: `npm run lint`, `npx eslint firestore.rules`, `npm run test:unit` y `npm run test:rules` (`firebase emulators:exec --project demo-nido-rules-test --only firestore "npx tsx --test firestore.rules.test.ts"`) usando únicamente el proyecto demo local del emulador, sin secretos, sin acceso a producción y sin despliegues.
- **Cómo activarlo**:
  1. Hacer commit y push de `.github/workflows/firestore-rules.yml` y `package.json` a la rama `main` (o `master`) en GitHub, o abrir una Pull Request.
  2. En el repositorio de GitHub, abrir la pestaña **Actions** (habilitar GitHub Actions si estuviera desactivado).
  3. Ejecutar automáticamente con el push/PR o manualmente mediante **Verificación de reglas de Firestore → Run workflow** (`workflow_dispatch`).
  4. Como alternativa local en cualquier equipo con **Java 21+** y `firebase-tools`: ejecutar directamente `npm run test:rules`.

---

## 5. Pruebas manuales pendientes

- **Archivo**: `MANUAL_ACCEPTANCE_CHECKLIST.md`
- **Estado**: **Pendiente de ejecución manual por el usuario** con 2 cuentas y 2 dispositivos reales (8 pruebas: sincronización de gasto compartido y pagador por defecto en Cuenta común, privacidad de gasto personal, categoría personalizada y presupuesto, cierre simultáneo de compra, recuperación tras pérdida de conexión, mes cerrado, actualización PWA con formulario abierto, y cerrar sesión y volver a entrar).

---

## 6. Riesgos conocidos y limitaciones

- **Tests de emulador (`firestore.rules.test.ts`) aún no ejecutados**: hasta que el workflow `.github/workflows/firestore-rules.yml` se ejecute en GitHub Actions (o `npm run test:rules` en local con Java 21+), la autorización en emulador sigue pendiente de verificación real (ESLint y el despliegue previo no sustituyen la ejecución de los 20 casos de `firestore.rules.test.ts`).
- **Carrera simultánea pura en Fase 1 sobre lotes 1 disjuntos con solapamiento en lote 2**: si ambos miembros confirman exactamente a la vez dos compras `>10` artículos cuyos primeros 10 artículos son distintos y solo coinciden en los artículos `11+`, Firestore puede aceptar ambas transacciones Fase 1 (al no modificar los artículos `11+` en Fase 1); ahora la comprobación previa contra `pendingShoppingCheckouts` bloquea la ventana cuando un cierre ya está visible, Fase 1 bloquea cualquier solapamiento en lote 2+ una vez borrado, y Fase 2 acumula y muestra `alreadyGoneCount` avisando explícitamente al segundo miembro para revisar los gastos recientes sin duplicar su propio gasto.
- **Límite de 100 artículos por cierre de compra**: `MAX_CHECKOUT_PENDING_ITEMS = 100` (procesado en transacciones de `≤ 10` artículos).

---

## 7. Siguiente paso exacto

1. Subir los cambios a GitHub y ejecutar el workflow **Verificación de reglas de Firestore** (`.github/workflows/firestore-rules.yml`) o correr `npm run test:rules` en local con Java 21+ para verificar los 20 casos de `firestore.rules.test.ts`.
2. Ejecutar las 8 pruebas manuales de `MANUAL_ACCEPTANCE_CHECKLIST.md` con 2 cuentas y 2 dispositivos reales.
