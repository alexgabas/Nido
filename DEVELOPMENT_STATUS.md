# Estado de desarrollo de Nido

Última actualización: 2026-11-25

## 1. Resumen ejecutivo

- **Aplicación**: **Nido** (finanzas compartidas del hogar, etapa de mudanza e histórico, presupuestos, planificación mensual, Cuenta común, cierre de mes guiado, balance anual del hogar, metas, plan habitual y mensual de ahorro, reparto por ingresos rápidos/detallados y lista de la compra compartida). Idioma: español de España (`es-ES`). Moneda: `EUR`.
- **Arquitectura**: SPA React + TypeScript + Vite + Tailwind + PWA offline-first (`vite-plugin-pwa`) + Firebase Auth / Firestore en plan gratuito Spark (coste cero: sin Cloud Functions, Cloud Billing, notificaciones push de pago, SDKs de IA ni APIs bancarias), con paridad funcional en modo demostración local (`DemoHouseholdRepository`).
- **Proyecto y base de datos objetivo** (verificado en `firebase-applet-config.json`): `projectId = "irontrack-509315"`, `firestoreDatabaseId = "ai-studio-9bf93440-758c-4b3e-8cff-72543716da70"`.
- **Estado actual**: Corrección e investigación de **Ajustes → Ingresos y reparto (modo Rápido y Detallado)** **completada en código, con reglas validadas y desplegadas en Firestore y verificación local al día** (`npx tsc --noEmit`, **73/73 pruebas unitarias**, ESLint de `firestore.rules` 0 errores, despliegue `DeployRules` OK, build de producción + PWA, `verify_savings_income_flow.mjs` + regresiones E2E en verde). Quedan pendientes la ejecución de los **29 tests del emulador** (`npm run test:rules` en GitHub Actions o máquina con Java 21+) y la comprobación en cuenta real.

---

## 2. Completado recientemente

### A. Trazado y corrección de «Ingresos y reparto» (modo Rápido y Detallado) y privacidad de errores
- **Diagnóstico trazado de extremo a extremo**:
  - Ambos modos (`Rápida` y `Detallada`) en `AjustesView.tsx` envían la misma escritura atómica `repo.updateSettings(householdId, draftSettings, currentUserProfile, summary, { incomeConfig })` (`writeBatch` con `update households/{hid}` sobre `{ settings, updatedAt, incomeConfig }` + `create households/{hid}/activity/{actId}`).
  - En el código local, la Acción 1 de `firestore.rules` y los validadores (`isValidHousehold`, `isValidIncomeConfig`, `isValidMemberIncomeProfile`, `isValidSettings`) ya admiten el esquema de `Detallado` (`ordinaryPayCount is int`, `expectedMonth == null || (is int && 1..12)`, `otherIncomes`, `splitMode`), por lo que se redesplegaron explícitamente las reglas vigentes (`DeployRules`) sobre `irontrack-509315` / `ai-studio-9bf93440-758c-4b3e-8cff-72543716da70` para eliminar cualquier desfase en vivo, además de corregir los fallos reales detectados en cliente, sanitización y privacidad:
- **Cambios aplicados**:
  1. **Sanitización previa y prevención de `-0`** (`src/domain/incomeProfile.ts`, `src/views/AjustesView.tsx`): normalización explícita de `-0` a `+0` en `sanitizeExtraPaycheckItem`, `sanitizeOtherIncomeItem` y `sanitizeMemberIncomeProfile`, y aplicación de `sanitizeHouseholdIncomeConfig(rawIncomeConfig)` justo antes de llamar a `repo.updateSettings`.
  2. **Conservación del borrador, protección contra reenvío e inline `role="alert"` sin PII** (`src/views/AjustesView.tsx`, `src/components/ajustes/DetailedIncomeEditor.tsx`):
     - `AjustesView.tsx` añade `savingSplit`, `splitSaveError` (`data-testid="split-save-error"`, `role="alert"`), `hydratedHouseholdIdRef`, `splitDirtyRef` y `nameDirtyRef` para que refrescos de `onSnapshot` o un fallo al guardar nunca borren lo editado por el usuario.
     - `DetailedIncomeEditor.tsx` pasa el campo numérico en modo Rápido a estado controlado (`quickInputText` + `quickFocusedRef`) para mantener sincronizados los cambios al alternar Rápida ↔ Detallada sin perder `ordinaryPayAmount`, `ordinaryPayCount`, `extraPaychecks` ni `otherIncomes`.
  3. **Diagnóstico seguro sin PII ni exposición de salarios** (`src/services/firestoreError.ts`, `src/services/firebase.ts`, `src/views/InicioView.tsx`):
     - Eliminado `authInfo` (`uid`, `email`, `providerInfo`, `tenantId`) y redactado `households/{id}` en `handleFirestoreError` y en los mensajes de error mostrados al usuario (`código`, `operación` y `ruta` redactada, sin emails, UIDs, JSON crudo ni salarios).
     - En `InicioView.tsx`, `handleSaveIncomes` ahora sincroniza `household.incomeConfig` (`mode: 'rapida'`, `quickMonthlyNet`) preservando el desglose detallado previo y sin registrar importes salariales en el resumen de actividad.

### B. Iteración anterior (Bloques 1–6: Ahorros + Ingresos detallados + Aportaciones separadas)
- `AhorrosView.tsx`, `MonthlySavingsPlanSection.tsx`, `MonthlyContributionsCard.tsx`, `CommonAccountRadarCard.tsx`, `incomeProfile.ts`, `savingsPlan.ts`, `firestore.rules`, `firebase-blueprint.json` y `backup.ts`: flujo de «Planificar el ahorro del mes», «Proponer reparto» por prioridad, dos cifras separadas (Cuenta común para gastos vs ahorro del mes), plan habitual, excepciones mensuales y ahorro extra.

---

## 3. Estado de verificación

| Comprobación | Estado | Evidencia real |
|---|---|---|
| Comprobación de tipos (`npx tsc --noEmit`) | **Verificado mediante prueba ejecutada** | 0 errores |
| Pruebas unitarias (`npm run test:unit`) | **Verificado mediante prueba ejecutada** | **73/73 en verde** (`src/domain/finance.test.ts`, incluidas pruebas **64–66**: payload exacto Detallado/Rápido, preservación al alternar modos, cálculo 60/40 en `1.200 €` + `300 €`, `splitOverride` y no recalcular histórico, y cero PII en `firestoreError.ts`) |
| Lint de Security Rules (`npx eslint firestore.rules`) | **Verificado mediante prueba ejecutada** | 0 errores, 0 advertencias |
| Despliegue de Security Rules (`DeployRules`) | **Verificado mediante acción ejecutada** | Desplegadas en `irontrack-509315` / `ai-studio-9bf93440-758c-4b3e-8cff-72543716da70` |
| Build de producción + PWA (`npm run build`) | **Verificado mediante prueba ejecutada** | Build limpio, `dist/sw.js` generado |
| E2E integral ingresos y ahorros (`node scripts/verify_savings_income_flow.mjs`) | **Verificado mediante prueba ejecutada** | Pasado en móvil `390×844` (Sencillo) y escritorio `1280×900` (Avanzado), con ingreso detallado `12 × 1.500 + 2 × 1.800 = 21.600 €/año` (`1.800,00 €/mes`) frente a `1.200 €/mes` → `60/40`, ahorro `180/120 €` y preservación al alternar Rápida ↔ Detallada |
| E2E regresión plan de ahorro (`node scripts/verify_savings_plan.mjs`) | **Verificado mediante prueba ejecutada** | Pasado |
| E2E regresión planificación mensual y Cuenta común (`node scripts/verify_monthly_planning.mjs`) | **Verificado mediante prueba ejecutada** | `MONTHLY_PLANNING_E2E_PASS` |
| Tests de Security Rules en emulador (`npm run test:rules`) | **Implementado, pendiente de verificación en emulador** | **29 casos** en `firestore.rules.test.ts` (incluido **Test 29** con la `writeBatch` real de `updateSettings` en Rápida ↔ Detallada y casos de rechazo). No ejecutado aquí porque el contenedor carece de Java; ejecutable vía `.github/workflows/firestore-rules.yml` o en local con Java 21+ |
| Pruebas manuales en cuenta real | **Pendiente de verificar por el usuario** | Confirmar guardado de modo Detallado en `Ajustes → Ingresos y reparto`, recarga, reflejo `720/480 €` y `180/120 €` y conservación del desglose al cambiar entre Rápido y Detallado |

---

## 4. Riesgos conocidos y limitaciones

- **Emulador de reglas pendiente**: ESLint y el despliegue están confirmados, pero los **29 casos** de `firestore.rules.test.ts` siguen pendientes de ejecutarse en un entorno con Java 21+ (local o GitHub Actions `.github/workflows/firestore-rules.yml`).
- **Cuenta real con datos propios**: en el entorno del agente no hay sesión autenticada contra tu cuenta real de Firestore, por lo que queda pendiente tu comprobación directa tras este redespliegue de reglas y la actualización de cliente. Si volviera a producirse algún fallo, el aviso en pantalla (`role="alert"`) mostrará `código`, `operación` y `ruta` redactada (`households/{id}`) sin PII para aislarlo al instante.
- **Verificación de facturación GCP/Firebase**: este entorno no tiene acceso a la API de Google Cloud Billing ni a la consola de Firebase, por lo que el plan activo (Spark vs Blaze) debe comprobarse manualmente en Firebase Console → *Uso y facturación*.

---

## 5. Siguiente paso exacto

1. Probar en tu cuenta real (`Ajustes → Ingresos y reparto`):
   - Configurar `Por salario` con modo **Detallado** para una persona (`12 × 1.500 € + 2 × 1.800 € = 21.600 €/año`, `1.800 €/mes`) y **Rápido** `1.200 €/mes` para la otra, guardar, recargar la página y confirmar que persiste y que `Mensual` (`1.200 €` → `720 / 480 €`) y `Ahorros` (`300 €` → `180 / 120 €`) reflejan el `60/40`.
   - Alternar **Detallado ↔ Rápido** y verificar que se conserva el desglose detallado previo; si apareciera algún error al guardar, compartir los tres datos del aviso (`código`, `operación` y `ruta`).
2. Ejecutar `.github/workflows/firestore-rules.yml` (o `npm run test:rules` con Java 21+) para verificar en emulador los **29 casos** de Security Rules.
