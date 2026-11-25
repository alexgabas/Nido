# Estado de desarrollo de Nido

Última actualización: 2026-11-25

## 1. Resumen ejecutivo

- **Aplicación**: **Nido** (finanzas compartidas del hogar, etapa de mudanza e histórico, presupuestos, planificación mensual, Cuenta común, cierre de mes guiado, balance anual del hogar, metas y plan de ahorro mensual, y lista de la compra compartida). Idioma: español de España (`es-ES`). Moneda: `EUR`.
- **Arquitectura**: SPA React + TypeScript + Vite + Tailwind + PWA offline-first (`vite-plugin-pwa`) + Firebase Auth / Firestore en plan gratuito Spark (coste cero: sin Cloud Functions, Cloud Billing, notificaciones push de pago, SDKs de IA ni APIs bancarias), con paridad funcional en modo demostración local (`DemoHouseholdRepository`).
- **Proyecto y base de datos objetivo** (verificado en `firebase-applet-config.json`): `projectId = "irontrack-509315"`, `firestoreDatabaseId = "ai-studio-9bf93440-758c-4b3e-8cff-72543716da70"`.
- **Estado actual**: Iteración de **revisión global de navegación y fin de etapa de Mudanza** **implementada, con reglas desplegadas en Firestore y verificada en local** (`tsc --noEmit`, **66/66 pruebas unitarias**, ESLint de `firestore.rules` 0 errores, despliegue de reglas `DeployRules` OK, build de producción + PWA, **E2E navegación + Mudanza + capturas ANTES/DESPUÉS** y las **6 suites E2E de regresión** en verde). Quedan pendientes la ejecución de los **27 tests del emulador** (`npm run test:rules` en GitHub Actions o máquina con Java 21+) y la verificación manual en cuenta real.

---

## 2. Completado en la última iteración (Reorganización de navegación y fin de etapa de Mudanza)

### 1. Reorganización de navegación sin duplicidades (`src/components/AppShell.tsx`, `src/views/InicioView.tsx`, `src/views/CompraView.tsx`, `src/components/ShoppingListSection.tsx`, `src/context/NidoContext.tsx`, `src/App.tsx`)
- **Modo Sencillo (móvil `390×844`)**:
  - Se conserva la barra inferior de 3 ranuras (`Inicio`, `+`, `Ahorros`).
  - **Compra** y **Mensual** pasan a una fila compacta de 2 columnas al principio de `Inicio` (visibles sobre el pliegue a `y = 148 px`, frente a `1103 px` y `1014 px` antes), eliminando los accesos duplicados del final de la pantalla.
- **Modo Avanzado (móvil `390×844`)**:
  - Navegación inferior simplificada a 4 pestañas principales: **Inicio**, **Mensual**, **Compra** (con insignia de pendientes) y **Ahorros**.
  - **+ Gasto** permanece accesible en la cabecera superior.
  - **Ajustes del hogar**, **Ayuda e instalación** y **Hogar → Mudanza / Histórico de mudanza** pasan al menú avatar sin crear ninguna pestaña principal «Hogar».
  - Eliminada la tarjeta duplicada de «Lista de la compra» en `Inicio` y el enlace duplicado en el menú avatar.
- **Escritorio (`1280×800`)**:
  - Barra superior unificada en ambos modos con las 4 áreas principales (`Inicio`, `Mensual`, `Compra`, `Ahorros`), `+ Añadir gasto` y menú avatar sin duplicar `Ajustes`, `Ayuda` ni `Mudanza`.
- **Lista de la compra como pantalla dedicada (`CompraView` + `ShoppingListSection variant="page"`)**:
  - Reutiliza íntegramente el componente existente sin duplicar lógica; mantiene el botón `← Inicio` en Sencillo móvil y evita abrir un modal superpuesto.
- **Compatibilidad, botón Atrás y cambio de modo (`src/domain/mudanzaStage.ts`, `src/context/NidoContext.tsx`)**:
  - Conservados todos los atajos PWA (`/?action=add-expense`, `/?tab=inicio&open=shopping`, `/?tab=mensual`) y enlaces anteriores (`/?tab=mudanza`, `/?tab=compra`, `/?tab=ajustes`, `/?tab=ahorros`, `/?tab=ayuda`).
  - Historial del navegador sincronizado con `history.pushState` / `popstate` para que el botón **Atrás** recorra las pantallas de forma natural.
  - Cambiar entre Sencillo y Avanzado conserva la sección equivalente (`Compra`, `Mensual`, `Ahorros`, `Mudanza`, `Ayuda`) y redirige `Ajustes → Inicio` al pasar a Sencillo sin cambiar nunca de modo silenciosamente.
  - **Balance anual** y **cierre guiado** permanecen dentro de `Mensual`; **Plan de ahorro mensual** permanece dentro de `Ahorros`.

### 2. Fin de la etapa de Mudanza compartido y reversible (`src/domain/mudanzaStage.ts`, `src/views/MudanzaView.tsx`, `src/views/AjustesView.tsx`, `src/repositories/*`, `firestore.rules`, `src/domain/backup.ts`)
- **Estado compartido y retrocompatible**: campos opcionales `mudanzaCompleted`, `mudanzaCompletedAt` y `mudanzaCompletedBy` en el documento del hogar. Los hogares existentes sin el campo mantienen Mudanza activa por defecto (`false`).
- **Acciones «Dar por terminada la mudanza» y «Reabrir mudanza»** disponibles en `MudanzaView` (Sencillo y Avanzado) y en `Ajustes → Hogar compartido` (Avanzado).
- **Aviso no bloqueante ni destructivo**: al darla por terminada muestra el recuento exacto de muebles pendientes y tareas sin completar sin bloquear la acción ni marcar ningún elemento como hecho o comprado.
- **Visibilidad al terminar**: oculta el acceso destacado en `Inicio` (Sencillo y Avanzado) y deja el acceso en **menú avatar → Hogar → Histórico de mudanza** y en **Ajustes → Hogar**, conservando intactos la búsqueda global, los gastos iniciales, el mobiliario, el checklist, los informes CSV/PDF y los backups JSON `NidoBackupV1` (con compatibilidad hacia atrás con copias antiguas sin estos campos).
- **Firestore Rules (`firestore.rules`, `firebase-blueprint.json`, `firestore.rules.test.ts`)**:
  - Añadida **Acción 9** en `/households/{hid}` (`allow update` restringida a miembros, `affectedKeys().hasOnly(['mudanzaCompleted', 'mudanzaCompletedAt', 'mudanzaCompletedBy', 'updatedAt'])`, anti-suplantación `mudanzaCompletedBy == request.auth.uid`, timestamps validados con `request.time`).
  - Validada con ESLint (0 errores) y desplegada mediante `DeployRules`. Añadido **Test 27** en `firestore.rules.test.ts`.
- **Optimización de suscripciones**: `checklist` y `furniture` dejan de suscribirse en `Inicio` cuando `mudanzaCompleted === true`.

---

## 3. Estado de verificación

| Comprobación | Estado | Evidencia real |
|---|---|---|
| Comprobación de tipos (`npx tsc --noEmit`) | **Verificado mediante prueba ejecutada** | 0 errores |
| Pruebas unitarias (`npm run test:unit`) | **Verificado mediante prueba ejecutada** | **66/66 en verde** (`src/domain/finance.test.ts`, incluidas pruebas **65–66** de navegación, equivalencia de modo, atajos PWA, estado compartido reversible de Mudanza, aviso sin mutar pendientes, búsqueda global e import/export de backups antiguos y nuevos) |
| Lint de Security Rules (`npx eslint firestore.rules`) | **Verificado mediante prueba ejecutada** | 0 errores, 0 advertencias |
| Despliegue de Security Rules (`DeployRules`) | **Verificado mediante acción ejecutada** | Desplegadas en `irontrack-509315` / `ai-studio-9bf93440-758c-4b3e-8cff-72543716da70` |
| Build de producción + PWA (`npm run build`) | **Verificado mediante prueba ejecutada** | Build limpio, `dist/sw.js` generado |
| E2E navegación, enlaces, Atrás, modos y fin de Mudanza (`node scripts/verify_navigation_and_mudanza.mjs`) | **Verificado mediante prueba ejecutada** | Pasado en móvil `390×844` (Sencillo y Avanzado) y escritorio `1280×800`, con inspección visual de capturas **ANTES y DESPUÉS** |
| E2E general móvil/escritorio (`node scripts/verify_nido_e2e.mjs`) | **Verificado mediante prueba ejecutada** | `E2E_PASS` |
| E2E planificación mensual y Cuenta común (`node scripts/verify_monthly_planning.mjs`) | **Verificado mediante prueba ejecutada** | `MONTHLY_PLANNING_E2E_PASS` |
| E2E cierre de mes guiado (`node scripts/verify_guided_close.mjs`) | **Verificado mediante prueba ejecutada** | `verify_guided_close: TODOS LOS RECORRIDOS PASARON` |
| E2E balance anual del hogar (`node scripts/verify_annual_balance.mjs`) | **Verificado mediante prueba ejecutada** | `verify_annual_balance: TODOS LOS RECORRIDOS PASARON` |
| E2E plan de ahorro mensual (`node scripts/verify_savings_plan.mjs`) | **Verificado mediante prueba ejecutada** | `verify_savings_plan.mjs completado con éxito` |
| E2E fiabilidad PWA/offline/chunks (`node scripts/verify_pwa_reliability.mjs`) | **Verificado mediante prueba ejecutada** | `PWA_RELIABILITY_PASS` (8/8) |
| Tests de Security Rules en emulador (`npm run test:rules`) | **Implementado, pendiente de verificación en emulador** | **27 casos** en `firestore.rules.test.ts` (incluido Test 27 para Acción 9 de `mudanzaCompleted`). No ejecutado aquí porque el contenedor carece de Java; ejecutable vía `.github/workflows/firestore-rules.yml` o en local con Java 21+ |
| Pruebas manuales en cuenta real y 2 dispositivos | **Pendiente de verificar por el usuario** | Comprobar en cuenta real la nueva barra en móvil/escritorio, «Dar por terminada la mudanza» / «Reabrir mudanza» sincronizado entre los dos miembros y atajos de la PWA instalada |

---

## 4. Riesgos conocidos y limitaciones

- **Emulador de reglas pendiente**: ESLint y el despliegue están confirmados, pero los **27 casos** de `firestore.rules.test.ts` siguen pendientes de ejecutarse en un entorno con Java 21+ (local o GitHub Actions `.github/workflows/firestore-rules.yml`).
- **Verificación de facturación GCP/Firebase**: este entorno no tiene acceso a la API de Google Cloud Billing ni a la consola de Firebase, por lo que el plan activo (Spark vs Blaze) debe comprobarse manualmente en Firebase Console → *Uso y facturación*.
- **Propuestas de mejora e IA (Bloque 4)**: documentadas exclusivamente como propuestas; no se ha instalado ningún SDK de IA ni habilitado ninguna API externa.

---

## 5. Siguiente paso exacto

1. Probar en tu cuenta real (móvil y escritorio, Sencillo y Avanzado) la nueva navegación, el botón Atrás y «Dar por terminada la mudanza» / «Reabrir mudanza» entre los dos dispositivos.
2. Ejecutar `.github/workflows/firestore-rules.yml` (o `npm run test:rules` con Java 21+) para verificar en emulador los **27 casos** de Security Rules.
3. Si decides priorizar alguna de las propuestas del Bloque 4 (p. ej. pegado rápido de lista o resumen local), indícalo para diseñarla e implementarla en la siguiente iteración.
