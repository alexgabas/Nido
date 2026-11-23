# Checklist de aceptación manual — Nido (2 cuentas, 2 dispositivos)

**Estado general:** Pendiente de ejecución manual en entorno real (ninguna prueba de este documento ha sido ejecutada aún).

**Requisitos previos:**
- Dispositivo A (móvil o escritorio) conectado con **Cuenta A** en el hogar compartido real.
- Dispositivo B (móvil o escritorio distinto) conectado con **Cuenta B** en el mismo hogar.
- Ambos con la misma versión publicada y conexión a internet (salvo en el paso de desconexión de la prueba 5).

---

### 1. Sincronización de gasto compartido (y pagador por defecto = Cuenta común)
- [ ] **Pendiente**
- **Pasos:**
  1. En Dispositivo A (Cuenta A), abrir **Añadir gasto** (en modo Sencillo o Avanzado).
  2. Comprobar que el pagador preseleccionado por defecto es **Cuenta común**.
  3. Registrar un gasto compartido de prueba (p. ej., `12,34 €`, concepto `Prueba sync`, fecha de hoy).
  4. Observar Dispositivo B (Cuenta B) sin recargar la página.
- **Resultado esperado:**
  - El gasto aparece en tiempo real en Dispositivo B con importe `12,34 €`, pagador **Cuenta común** y totales/saldo actualizados.
  - Si se elimina o edita desde Dispositivo B, el cambio se refleja en Dispositivo A.

---

### 2. Privacidad de gasto personal
- [ ] **Pendiente**
- **Pasos:**
  1. En Dispositivo A (Cuenta A), crear un gasto marcando **Gasto solo mío (privado)** (p. ej., `19,99 €`, concepto `Privado A`).
  2. Comprobar que en el formulario pasa a pagarlo Cuenta A y no entra en el reparto de pareja.
  3. En Dispositivo B (Cuenta B), revisar **Inicio**, **Mensual** (lista, calendario, búsqueda global y presupuestos), **Actividad reciente** y exportar un **Backup JSON** o **PDF**.
- **Resultado esperado:**
  - El gasto `Privado A` es visible únicamente para Cuenta A.
  - En Dispositivo B no aparece en ninguna vista, total compartido, gráfico, actividad reciente ni exportación.

---

### 3. Categoría personalizada y presupuesto
- [ ] **Pendiente**
- **Pasos:**
  1. En Dispositivo A (modo **Avanzado → Mensual**), crear una categoría personalizada (p. ej., `Mascotas`) con un color propio y asignarle un presupuesto mensual (p. ej., `100 €`).
  2. Registrar un gasto compartido en `Mascotas` de `40 €`.
  3. En Dispositivo B, cambiar entre **Sencillo** y **Avanzado** y comprobar la categoría, el color y el progreso de presupuesto.
  4. Archivar `Mascotas` desde Dispositivo A y comprobar que el gasto histórico de `40 €` conserva su etiqueta y color sin borrarse.
- **Resultado esperado:**
  - La categoría y su color se sincronizan entre ambos dispositivos y modos.
  - El presupuesto refleja `40 € / 100 €` (`40%`) y archivar la categoría no pierde ni reclasifica movimientos históricos.

---

### 4. Cierre simultáneo de compra
- [ ] **Pendiente**
- **Pasos:**
  1. Añadir 4–6 productos a la **Lista de la compra** y marcarlos todos como comprados (`✓`).
  2. Abrir **Finalizar compra** a la vez en Dispositivo A y Dispositivo B (verificando que **Cuenta común** aparece preseleccionada) e introducir el importe.
  3. Pulsar **Guardar gasto y limpiar carro** en Dispositivo A y, 1–2 segundos después, pulsar también en Dispositivo B.
- **Resultado esperado:**
  - Dispositivo A confirma el gasto una única vez y retira los productos marcados.
  - Dispositivo B muestra el aviso de conflicto/solapamiento (*«Estos productos ya fueron procesados»*) y **no crea ningún gasto duplicado**.

---

### 5. Recuperación tras pérdida de conexión
- [ ] **Pendiente**
- **Pasos:**
  1. En Dispositivo A, marcar varios productos en la **Lista de la compra** y abrir **Finalizar compra**.
  2. Activar **modo avión** (sin conexión) e intentar finalizar la compra.
  3. Desactivar modo avión y volver a finalizar una compra de **> 10 productos** (p. ej., 12 productos); si se simula corte de red justo al confirmar, pulsar **Reanudar limpieza** al recuperar conexión (desde Dispositivo A o desde Dispositivo B).
- **Resultado esperado:**
  - Sin conexión, el cierre queda bloqueado con aviso claro (sin fingir guardado en servidor) y los productos siguen marcados.
  - Con conexión, al reanudar tras corte intermedio se retiran los lotes pendientes **sin duplicar el gasto** en **Mensual**.

---

### 6. Mes cerrado
- [ ] **Pendiente**
- **Pasos:**
  1. En Dispositivo A (modo **Avanzado → Mensual**), elegir un mes pasado de prueba y pulsar **Cerrar mes**.
  2. En Dispositivo B, navegar a ese mismo mes e intentar crear un gasto con fecha de ese mes, editar/borrar un gasto existente de ese mes o modificar su presupuesto.
  3. Reabrir el mes desde Dispositivo A y volver a intentar una edición controlada.
- **Resultado esperado:**
  - Mientras el mes está cerrado, ni Dispositivo A ni Dispositivo B pueden crear, modificar o borrar gastos/presupuestos de ese mes (bloqueado en UI y en Firestore Rules).
  - Al reabrir el mes, las ediciones vuelven a permitirse con normalidad.

---

### 7. Actualización PWA con formulario abierto
- [ ] **Pendiente**
- **Pasos:**
  1. Con la PWA instalada o abierta en navegador con una versión anterior en caché, desplegar una nueva compilación (o simular aviso de nueva versión disponible).
  2. Abrir **Añadir gasto** y escribir importe y concepto **sin guardar**.
  3. Cuando aparezca el banner de **Nueva versión disponible**, pulsar **Actualizar ahora**.
- **Resultado esperado:**
  - La aplicación **no recarga automáticamente** ni borra el formulario.
  - Al pulsar **Actualizar ahora** con el formulario abierto, solicita confirmación explícita (*«Seguir editando»* / *«Recargar igualmente»*); al elegir *«Seguir editando»* se conservan intactos los datos escritos.

---

### 8. Cerrar sesión y volver a entrar
- [ ] **Pendiente**
- **Pasos:**
  1. En Dispositivo A (Cuenta A), abrir un gasto privado y verificar que aparece en la vista.
  2. Pulsar **Cerrar sesión**.
  3. Iniciar sesión en el mismo navegador/dispositivo con **Cuenta B** (o volver a entrar con Cuenta A tras limpiar/recargar).
- **Resultado esperado:**
  - Al cerrar sesión se limpian los datos en memoria, cachés de búsqueda y cualquier estado local de compra pendiente.
  - Al entrar con Cuenta B, no aparece ningún dato privado, búsqueda ni estado residual de Cuenta A; al volver a entrar con Cuenta A, el estado se sincroniza desde servidor sin duplicados.
