# Estado de desarrollo de Nido

Última actualización: 2026-11-25

## 1. Resumen ejecutivo

- **Aplicación**: **Nido** (finanzas compartidas del hogar, etapa de mudanza e histórico, presupuestos, planificación mensual, Cuenta común, cierre de mes guiado, balance anual del hogar, metas, plan habitual y mensual de ahorro, reparto por ingresos rápidos/detallados y lista de la compra compartida). Idioma: español de España (`es-ES`). Moneda: `EUR`.
- **Arquitectura**: SPA React + TypeScript + Vite + Tailwind + PWA offline-first (`vite-plugin-pwa`) + Firebase Auth / Firestore en plan gratuito Spark (coste cero: sin Cloud Functions, Cloud Billing, notificaciones push de pago, SDKs de IA ni APIs bancarias), con paridad funcional en modo demostración local (`DemoHouseholdRepository`).
- **Proyecto y base de datos objetivo** (verificado en `firebase-applet-config.json`): `projectId = "irontrack-509315"`, `firestoreDatabaseId = "ai-studio-9bf93440-758c-4b3e-8cff-72543716da70"`.
- **Estado actual**: Iteración de **Ahorros, ingresos netos detallados, aportaciones separadas y plan habitual/excepciones** (Bloques 1–6) **implementada, con reglas desplegadas en Firestore y verificada en local** (`tsc --noEmit`, **70/70 pruebas unitarias**, ESLint de `firestore.rules` 0 errores, despliegue de reglas `DeployRules` OK, build de producción + PWA, nueva E2E integral `verify_savings_income_flow.mjs` y regresiones E2E en verde). Quedan pendientes la ejecución de los **28 tests del emulador** (`npm run test:rules` en GitHub Actions o máquina con Java 21+) y la verificación manual en cuenta real.

---

## 2. Completado en la última iteración (Bloques 1–6: Ahorros + Ingresos detallados + Aportaciones separadas)

### 1. Corrección de «Planificar el ahorro del mes» y «Proponer reparto» (`src/views/AhorrosView.tsx`, `src/components/ahorros/MonthlySavingsPlanSection.tsx`, `src/context/NidoContext.tsx`)
- **Causas raíz demostradas**:
  1. En hogares reales (`DEFAULT_GOALS`), todas las metas nacen con `targetDate: ''` (sin fecha objetivo). La función anterior `proposeMonthlySavingsDistribution` devolvía `0 €` a toda meta sin fecha, dejando todos los campos a `0` sin explicación. Además, si faltaba importe o el reparto ya coincidía, no mostraba ningún mensaje de estado.
  2. En Avanzado, `#savings-plan-section` estaba por debajo del pliegue (debajo de Donut, reparto, colchón y sugerencias), y el botón superior lanzaba un `scrollIntoView` en un único `requestAnimationFrame` antes de asentarse el layout.
  3. El `useEffect` de hidratación del borrador omitía `goals`, dejando `draftItems = []` si el editor se abría antes de llegar las metas de Firestore.
  4. `handleSaveSavingsPlan` silenciaba errores de escritura en vez de propagarlos, cerrando el editor en silencio si fallaba Firestore.
- **Solución aplicada**:
  - `MonthlyContributionsCard` y `MonthlySavingsPlanSection` movidos a la parte superior de `Ahorros` (Sencillo y Avanzado), con apertura fiable tanto con plan guardado como sin plan previo.
  - Sincronización segura de hidratación de `goals` (`goalsLoaded`), `savingsPlansLoading` y `savingsPlansError`.
  - «Proponer reparto» siempre activo con banner de feedback explícito (resultado aplicado, aviso si falta importe > 0 €, aviso si no hay metas con objetivo, o aviso cuando ya coincide con el borrador actual).
  - Errores de guardado/carga propagados y mostrados en línea sin cerrar nunca el editor ni perder el borrador.

### 2. Ingresos netos en modo Rápido y Detallado (`src/domain/incomeProfile.ts`, `src/components/ajustes/DetailedIncomeEditor.tsx`, `src/views/AjustesView.tsx`)
- Por persona (`memberA` y `memberB`), selector **Rápida** (neto mensual) o **Detallada** (paga ordinaria neta × nº de pagas/año, pagas extra individuales con mes orientativo opcional 1..12, otros ingresos con frecuencia y tipo `recurrente` vs `puntual_o_incierto` excluido por defecto salvo inclusión explícita).
- Plantillas rápidas `12 pagas (extras prorrateadas)` y `14 pagas (12 ordinarias + 2 extras)` y aviso automático anti doble conteo si se ponen `> 12` ordinarias junto con pagas extra.
- Desglose claro: **Neto anual estimado** + **Equivalente mensual (promedio / 12)**, sin cálculo fiscal, sin recalcular repartos históricos y sin registrar importes de salario en logs de actividad ni exportaciones generales.

### 3. Dos cifras mensuales separadas: «Cuánto pone cada uno» (`src/domain/savingsPlan.ts`, `src/components/ahorros/MonthlyContributionsCard.tsx`, `src/components/mensual/CommonAccountRadarCard.tsx`)
- **A) Aportación prevista para gastos (Cuenta común)**: reutiliza `computeCommonAccountRadar` (`totalMonthlyNeed`, `monthlyShareA`, `monthlyShareB`), etiquetada claramente como previsión de gastos (no como «lo que falta ingresar»; el saldo manual sigue aparte en Mensual).
- **B) Aportación prevista para ahorro**: usa el plan efectivo del mes (guardado o propuesta habitual) con redondeo al céntimo exacto por persona, separando previsto vs aportado real por persona (`goalMovements.by`), retiradas aparte y sobrante sin asignar. Nunca se fusionan como deuda única ni transferencia obligatoria.

### 4. Plan habitual de ahorro con llenado por prioridad (`src/domain/savingsPlan.ts`, `src/components/ahorros/MonthlySavingsPlanSection.tsx`)
- Acción «Editar plan habitual» con importe mensual manual (capacidad estimada solo como referencia secundaria) y orden de prioridad (por defecto `Colchón de emergencia` primero, `Ahorro común` segundo, y el resto; respeta el orden guardado).
- Regla de llenado por prioridad: llena la 1.ª meta hasta `remaining` (`targetAmount - saved`) y pasa el sobrante a la siguiente, sin topar a `monthlyNeeded` (se conserva como referencia informativa). Las metas sin `targetDate` SÍ reciben dinero si tienen `targetAmount > 0`; las de `targetAmount <= 0` quedan manuales con explicación; archivadas y completadas se saltan.
- Aplicado virtualmente en meses sin plan guardado con distinción visual clara (**«Propuesta del plan habitual»** vs **«Plan guardado para este mes»**), sin crear movimientos ni reescribir meses pasados.

### 5. Excepciones mensuales y ahorro extra (`src/domain/savingsPlan.ts`, `src/components/ahorros/MonthlySavingsPlanSection.tsx`)
- **«Ajustar este mes»**: guarda un plan específico para el mes seleccionado sin alterar el plan habitual ni otros meses.
- **«Añadir ahorro extra»**: suma un importe extra explícito sobre el plan base, asignando **solo el extra** a las metas elegidas sin duplicar la base habitual, con previsualización **Antes → Después** (total, por persona y por meta).
- **«Volver al plan habitual»**: requiere confirmación explícita y nunca borra aportaciones reales registradas.

### 6. Datos, Firestore Rules y copias de seguridad (`src/types/nido.ts`, `src/repositories/*`, `src/domain/backup.ts`, `firestore.rules`, `firebase-blueprint.json`, `firestore.rules.test.ts`)
- Persistencia opcional y retrocompatible de `incomeConfig` y `habitualSavingsPlan` en `/households/{hid}` y de `adjustmentKind`/`extraAmount` en `/households/{hid}/savingsPlans/{monthKey}` con paridad completa Demo/Firestore.
- `firestore.rules` ampliadas (Acción 1 endurecida con anti-suplantación en `incomeConfig.updatedBy` cuando está en `affectedKeys()`, nueva **Acción 10** para `habitualSavingsPlan`, y validación de `adjustmentKind`/`extraAmount` en `savingsPlans`), validadas con ESLint (0 errores) y **desplegadas** con `DeployRules`.
- **Test 28** añadido a `firestore.rules.test.ts`. Round-trip y compatibilidad hacia atrás con backups JSON antiguos cubiertos en pruebas unitarias.

---

## 3. Estado de verificación

| Comprobación | Estado | Evidencia real |
|---|---|---|
| Comprobación de tipos (`npx tsc --noEmit`) | **Verificado mediante prueba ejecutada** | 0 errores |
| Pruebas unitarias (`npm run test:unit`) | **Verificado mediante prueba ejecutada** | **70/70 en verde** (`src/domain/finance.test.ts`, incluidas pruebas **53–54** actualizadas al llenado por prioridad y **60–63** nuevas de ingresos detallados, aceptación exacta 1.200 € + 300 € al 60/40, plan habitual, ahorro extra sin doble conteo, Demo y backups antiguos/nuevos) |
| Lint de Security Rules (`npx eslint firestore.rules`) | **Verificado mediante prueba ejecutada** | 0 errores, 0 advertencias |
| Despliegue de Security Rules (`DeployRules`) | **Verificado mediante acción ejecutada** | Desplegadas en `irontrack-509315` / `ai-studio-9bf93440-758c-4b3e-8cff-72543716da70` |
| Build de producción + PWA (`npm run build`) | **Verificado mediante prueba ejecutada** | Build limpio, `dist/sw.js` generado |
| E2E integral Bloques 1–6 (`node scripts/verify_savings_income_flow.mjs`) | **Verificado mediante prueba ejecutada** | Pasado en móvil `390×844` (Sencillo) y escritorio `1280×900` (Avanzado), con y sin plan previo, cero errores de página |
| E2E regresión plan de ahorro (`node scripts/verify_savings_plan.mjs`) | **Verificado mediante prueba ejecutada** | Pasado (Avanzado + Sencillo, propuesta, aportación previa, retirada aparte, exceso y archivado) |
| E2E regresión planificación mensual y Cuenta común (`node scripts/verify_monthly_planning.mjs`) | **Verificado mediante prueba ejecutada** | `MONTHLY_PLANNING_E2E_PASS` |
| E2E regresión navegación y Mudanza (`node scripts/verify_navigation_and_mudanza.mjs`) | **Verificado mediante prueba ejecutada** | Pasado (móvil y escritorio, Sencillo y Avanzado) |
| Tests de Security Rules en emulador (`npm run test:rules`) | **Implementado, pendiente de verificación en emulador** | **28 casos** en `firestore.rules.test.ts` (incluido Test 28 para `incomeConfig`, `habitualSavingsPlan` y `savingsPlans` con `adjustmentKind`/`extraAmount`). No ejecutado aquí porque el contenedor carece de Java; ejecutable vía `.github/workflows/firestore-rules.yml` o en local con Java 21+ |
| Pruebas manuales en cuenta real y 2 dispositivos | **Pendiente de verificar por el usuario** | Comprobar en cuenta real abrir «Planificar el ahorro del mes», pulsar «Proponer reparto», configurar ingresos detallados en Ajustes, guardar plan habitual y añadir ahorro extra entre ambos dispositivos |

---

## 4. Riesgos conocidos y limitaciones

- **Emulador de reglas pendiente**: ESLint y el despliegue están confirmados, pero los **28 casos** de `firestore.rules.test.ts` siguen pendientes de ejecutarse en un entorno con Java 21+ (local o GitHub Actions `.github/workflows/firestore-rules.yml`).
- **Cuenta real con datos propios**: el arreglo de los botones del Bloque 1 está diagnosticado en código y verificado en Demo (móvil/escritorio, Sencillo/Avanzado) con las reglas ya desplegadas, pero queda pendiente de comprobación directa en tu cuenta real de Firestore.
- **Verificación de facturación GCP/Firebase**: este entorno no tiene acceso a la API de Google Cloud Billing ni a la consola de Firebase, por lo que el plan activo (Spark vs Blaze) debe comprobarse manualmente en Firebase Console → *Uso y facturación*.

---

## 5. Siguiente paso exacto

1. Probar en tu cuenta real (móvil y escritorio, Sencillo y Avanzado):
   - En `Ajustes → Ingresos y reparto`: configurar ingresos detallados (p. ej. 14 pagas) y guardar.
   - En `Ahorros`: abrir «Planificar el ahorro del mes» / «Editar plan habitual», pulsar «Proponer reparto», comprobar las dos cifras separadas en «Cuánto pone cada uno» y probar «Añadir ahorro extra» + «Volver al plan habitual».
2. Ejecutar `.github/workflows/firestore-rules.yml` (o `npm run test:rules` con Java 21+) para verificar en emulador los **28 casos** de Security Rules.
