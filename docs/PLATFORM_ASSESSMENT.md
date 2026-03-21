# RMSCore — Platform Assessment (Marzo 2026)

Documento maestro del estado del repositorio, bases de datos, módulos, riesgos y plan de acción. Generado según el brief de assessment de marzo 2026.

**Ambientes (referencia):**

| Ambiente   | Host / branch        | DB (proxy)              | Notas |
|-----------|----------------------|-------------------------|--------|
| Producción | `*.rmscore.app`, `main` | `nozomi.proxy.rlwy.net:49340` | `public.tenants`: tenant `rms` id **3**, schema `public`; segundo tenant id 31 en `tenant_rg4tbbz7` |
| Staging2  | `rmscore-staging2.up.railway.app`, `develop` | `caboose.proxy.rlwy.net:51840` | Un solo tenant `rms` id **1**, schema `public` |

**Regla de despliegue:** cambios → `develop` → validación en staging2 → aprobación explícita → merge a `main` → producción.

---

## 1.1 Estado del repositorio

### `git log --oneline -15 origin/main`

```
ef99c18 fix: dispatch beeper display and POS navigation
05009f3 feat: dispatch beeper input and receipt
bb9d649 fix(login): use RMScore logo in auth screens
4ed850d feat: add beeperNumber to KDS ticket response
f3f064d fix(android): restore safe-area inset and refresh app icons
c7149bb fix(hr): make bulk OT approval use per-day endpoint
9a44624 fix(hr): refresh payroll after overtime approvals
ab13cdd fix(payroll): normalize service ledger dates for report
ec72008 fix: deduplicate dispatch orders in POS tables
92ea816 fix(payroll): stabilize date rendering in CR timezone
26c4331 fix(print): use session tenant for bridge endpoints
4668e8c fix(ws): resolve tenant from session for print bridge
ad4ae52 fix(android): status bar safe-area padding
433f311 fix: safe-area notch top navbar
8a33365 fix: pos tabs safe area
```

### `git log --oneline -15 origin/develop`

```
6992a5d fix: repair sequences after schema migration
f23d54b debug: log pos pay error detail
36acf89 fix: recalc order totals when price snapshots are invalid
bb44e0f fix: dispatch always navigate to POS after round
ef99c18 fix: dispatch beeper display and POS navigation
05009f3 feat: dispatch beeper input and receipt
bb9d649 fix(login): use RMScore logo in auth screens
4ed850d feat: add beeperNumber to KDS ticket response
f3f064d fix(android): restore safe-area inset and refresh app icons
c7149bb fix(hr): make bulk OT approval use per-day endpoint
9a44624 fix(hr): refresh payroll after overtime approvals
ab13cdd fix(payroll): normalize service ledger dates for report
ec72008 fix: deduplicate dispatch orders in POS tables
92ea816 fix(payroll): stabilize date rendering in CR timezone
26c4331 fix(print): use session tenant for bridge endpoints
```

### Archivos en `develop` que no están en `main`

(`git diff origin/main..origin/develop --name-only`)

```
client/src/pages/table-detail.tsx
migrations/0030_fix_staging_sequences.sql
server/routes.ts
server/storage.ts
```

### Commits en `develop` no mergeados a `main`

(`git log origin/main..origin/develop --oneline`)

```
6992a5d fix: repair sequences after schema migration
f23d54b debug: log pos pay error detail
36acf89 fix: recalc order totals when price snapshots are invalid
bb44e0f fix: dispatch always navigate to POS after round
```

*(Tras el commit de este assessment, esta lista incluirá el commit de cleanup.)*

---

## 1.2 Estado de la base de datos

Consultas ejecutadas desde el entorno local con credenciales en `.env` (`DATABASE_URL` = producción, `STAGING_DATABASE_URL` = staging2). SSL `rejectUnauthorized: false` vía cliente Node/pg.

### Producción

- **Schemas:** `public`, `tenant_rg4tbbz7`
- **Tablas por schema:** `public`: 91 tablas base · `tenant_rg4tbbz7`: 80 tablas base
- **`SELECT id, slug, schema_name, plan, is_active FROM public.tenants`:**

| id | slug | schema_name | plan | is_active |
|----|------|---------------|------|-----------|
| 3 | rms | public | ENTERPRISE | true |
| 31 | rest-entresantos | tenant_rg4tbbz7 | PRO | true |

- **Conteos (tablas operativas en `public` para tenant principal):**
  - `orders`: 456  
  - `payments`: 11 609  
  - `sales_ledger_items`: 60 748  
  - `users`: 15  

### Staging2

- **Schemas:** `public` únicamente
- **Tablas:** 91 tablas base en `public`
- **Tenants:**

| id | slug | schema_name | plan | is_active |
|----|------|---------------|------|-----------|
| 1 | rms | public | PRO | true |

- **Conteos:** `orders` 0 · `payments` 0 · `sales_ledger_items` 0 · `users` 15  

**Observación:** Staging2 está vacío en órdenes/pagos/ledger; las pruebas E2E de POS/pay requieren datos de prueba o flujo manual con sesión autenticada.

---

## 1.3 Módulos y su estado

Estimación de **estado** según rutas en `App.tsx`, uso en producción y brechas conocidas (cursorrules / assessment). **LOC** = líneas aproximadas del archivo principal indicado (marzo 2026).

| Módulo | Ruta(s) frontend | Archivo principal | LOC | Estado |
|--------|------------------|-------------------|-----|--------|
| Mesas | `/tables` | `client/src/pages/tables.tsx` | ~1338 | Completo |
| Detalle de mesa / despacho UI | `/tables/:id`, `/tables/dispatch/:orderId`, `/tables/quick/:orderId` | `client/src/pages/table-detail.tsx` | ~2808 | Completo (incluye flujos despacho / venta rápida) |
| KDS | `/kds`, `/kds-bar` | `client/src/pages/kds.tsx` | ~966 | Completo |
| POS | `/pos` | `client/src/pages/pos.tsx` | ~3022 | Completo (PayDialog v3 mixto en diseño) |
| Dashboard | `/dashboard` | `client/src/pages/dashboard.tsx` | ~1502 | Completo |
| Sales Cube | `/reports/sales-cube` | `client/src/pages/sales-cube.tsx` | ~909 | Completo |
| Cliente QR | `/qr/:tableCode` | `client/src/pages/qr-client.tsx` | ~1913 | Completo |
| Admin Panel | `/admin/*` | Varios (ej. `admin/employees`, `admin/products`, …) | — | Completo |
| Inventario | `/inventory/*`, `/inventory/basic` | `inventory-basic.tsx` + rutas inventario | ~478+ | Completo |
| Faltantes | `/shortages/*` | `client/src/pages/shortages/report.tsx` | ~431 | Completo |
| RRHH | `/hr/*` | `client/src/pages/hr/mi-turno.tsx` (entrada típica) | ~380+ | Completo |
| Despacho / Beeper | Integrado en mesas + API | `server/dispatch-routes.ts` + `table-detail.tsx` | ~115 + parte de table-detail | En progreso / validación staging2 |
| Venta rápida | `/tables/quick/:orderId` | `table-detail.tsx` | (mismo) | Completo |
| Loyalty (admin) | `/admin/loyalty` | `client/src/pages/admin/loyalty.tsx` | ~390 | Completo (PWA loyalty separada) |
| Reservaciones | `/reserve`, componentes | `client/src/pages/reserve.tsx` | ~519 | En diseño / parcial |
| Superadmin | `/superadmin` | `client/src/pages/superadmin.tsx` | ~1223 | Completo (auditorías pendientes según cursorrules) |
| QBO | `/admin/quickbooks` | `client/src/pages/admin/quickbooks.tsx` + `server/quickbooks.ts` | ~819 + ~789 | En progreso (OAuth roto) |
| Print Bridge | Cliente WS + admin impresoras | `client/src/lib/print-bridge-client.ts`, `server/services/print-service.ts` | — | Completo (bridge en hardware local, no Railway) |

---

## 1.4 Problemas conocidos (severidad)

| Problema | Severidad | Notas |
|----------|-----------|--------|
| Error 500 en `POST /api/pos/pay` | **ALTO** | En staging2, llamada mínima **sin cookie** devuelve **401** (esperado). No se reprodujo 500 en esa prueba; requiere sesión + orden real para confirmar. En `develop` existía commit de debug `f23d54b`; el cleanup alinea logging con el middleware global. |
| Planilla HR — service charge muestra ₡0 | **MEDIO** | Posible desajuste fechas ledger vs rango planilla o datos; ya hubo fixes en `develop` (normalización fechas, timezone). Seguir validación en staging2 con datos. |
| QBO OAuth — `client_id missing` | **ALTO** | Config/credenciales o lectura env; no corregido en este assessment. |
| Logs de debug en producción (commits 7535757, 6b0e9b, eceb4cf — referencia usuario) | **MEDIO** | Eliminados en código los `[DEBUG payroll/*]` en `routes.ts` y `[DEBUG compute]` en `payroll.ts`; `POST /api/pos/pay` usa el mismo patrón que `server/index.ts` (mensaje genérico al cliente en prod). Quedan otros `console.log` (PERF, print, dispatch, etc.) — ver 1.5. |
| Migración `public` → `tenant_la_antigua` pendiente en producción | **ALTO** (infra) | Producción actual usa `public` para `rms` (id 3) y schema separado `tenant_rg4tbbz7` para otro tenant; no coincide con el guion “tenant_la_antigua” del doc interno. Alinear expectativa con estado real antes de migraciones. |
| Secuencias DB rotas | **RESUELTO** (staging2) | Migración `0030_fix_staging_sequences.sql` en `develop` para staging; prod según procedimiento aparte. |
| `TENANT_ID=3` prod vs `TENANT_ID=1` staging2 | **BAJO** (esperado) | Normal entre ambientes; documentar en pruebas y seeds. |

---

## 1.5 Deuda técnica

### Comentarios `TODO` / `FIXME` / `HACK` / `XXX`

Búsqueda en `*.ts` / `*.tsx` orientada a etiquetas estándar: **no hay coincidencias reales** (solo falsos positivos tipo “Pagar Todo”, “todo el equipo”, texto en español en scripts).

### `console.log` / debug en servidor

Persisten logs operativos o de rendimiento, entre otros:

- `server/routes.ts`: varios `[PERF] ...` cuando duración > 200 ms; `[Review]`, ACKs de print en WS.
- `server/quickbooks.ts`: `[QBO AUTH]` con metadatos de credenciales (revisar en prod).
- `server/qr-subaccount-routes.ts`: `[perf] accept-v2 ...`
- Provisionamiento, migrate, email, dispatch jobs, etc.

**Recomendación:** unificar logger con niveles (`debug` desactivado en producción) sin cambiar lógica de negocio.

### Endpoints sin validación de schema

El acceso tenant pasa por **middleware de tenant** (`req.db`, `req.tenantSchema`). No se hizo auditoría ruta por ruta de rutas legacy o excepciones; cualquier ruta que use `db` global sin `req.db` sería riesgo — **revisión puntual recomendada**, fuera del scope de este cleanup.

### Archivos > 1500 líneas (candidatos a refactor)

| Archivo | LOC (aprox.) |
|---------|----------------|
| `server/routes.ts` | ~8891 |
| `server/storage.ts` | ~2700 |
| `client/src/pages/pos.tsx` | ~3022 |
| `client/src/pages/table-detail.tsx` | ~2808 |
| `client/src/pages/qr-client.tsx` | ~1913 |
| `client/src/pages/dashboard.tsx` | ~1502 |

---

## 1.6 Funcionalidades pendientes de prueba en staging2

- Módulo de **Despacho con Beeper** (flujo completo).
- **Navegación POS** después de despacho.
- **Totales en tickets** (fix reciente en `develop`).
- **Deduplicación de órdenes** en POS (dispatch).
- **`beeperNumber` en respuesta KDS**.
- **Beeper en ticket impreso**.

---

## 1.7 Plan de acción (por problema)

| Problema | Causa raíz (hipótesis) | Solución | Archivos | Riesgo regresión | Tiempo estimado |
|----------|-------------------------|----------|----------|------------------|-----------------|
| 500 POS pay | Datos inconsistentes, snapshots, permisos, o error no capturado | Reproducir con sesión; revisar stack en logs; aplicar fix puntual tras causa | `server/routes.ts`, `server/storage.ts` | Medio | 2–8 h |
| Service charge ₡0 | Rango fechas / modo BOLSA vs VENTA / ledger vacío | Validar con datos reales; ajustar query o normalización si falla caso concreto | `server/routes.ts` (payroll API), `server/payroll.ts`, storage | Medio | 4–8 h |
| QBO client_id | Env vacío o credenciales no guardadas | Configurar credenciales en Railway + flujo admin QBO | `server/quickbooks.ts`, admin UI, env | Bajo | 1–4 h |
| Debug logs | Commits de diagnóstico | Logger estructurado / quitar DEBUG | varios `server/*.ts` | Bajo | 2–4 h |
| Migración multi-schema | Estrategia tenant por schema vs public | Runbook explícito + migraciones numeradas + ventana | `migrations/`, scripts provision | **Alto** | días |
| Secuencias | Inserts tras restore/migración | SQL de repair idempotente por entorno | `migrations/0030_*` (staging) | Medio | 1–2 h |

---

## Paso 2 — Fixes aplicados en esta sesión

1. **`server/routes.ts` — `POST /api/pos/pay`:** catch unificado con `server/index.ts`: `console.error("Internal Server Error:", msg, isDev ? stack : "")`; respuesta JSON **genérica en producción**.
2. **`server/routes.ts` — payroll API:** eliminados todos los `console.log` con prefijo `[DEBUG payroll]`, `[DEBUG entry]`, `[DEBUG dates]`.
3. **`server/payroll.ts`:** eliminado `[DEBUG compute]`.
4. **Staging2 — prueba `POST /api/pos/pay`:** `curl` sin sesión → **401** (no 500).

**Verificación:** `npx tsc --noEmit` — **0 errores**.

**Commit:** `fix: platform assessment cleanup and bug fixes` en rama `develop` (push según ejecución del agente).

---

## Paso 3 — Resumen ejecutivo

### Qué está funcionando correctamente

- **Pipeline git:** `develop` adelantado respecto a `main` con fixes de despacho, beeper, payroll, secuencias (staging), y totales POS.
- **Producción:** datos operativos estables (miles de pagos y líneas de ledger); multi-tenant con segundo schema activo.
- **Staging2:** esquema alineado (91 tablas, tenant id 1); adecuado para smoke tests tras cargar datos.
- **Typecheck** del proyecto tras cleanup: **OK**.

### Qué necesita atención antes de producción

- Validación **E2E en staging2** de la lista 1.6 (beeper, KDS, tickets, POS).
- **QBO OAuth** y configuración de credenciales.
- Alinear documentación de **migración tenant** con el estado real de prod (`public` + `tenant_rg4tbbz7`).
- Reducir ruido de logs (**PERF**, QBO auth) en producción si se expone información sensible o volumen alto.

### Qué está roto o bloqueado

- **QBO** por `client_id missing` / OAuth (según cursorrules y assessment).
- **Superadmin / QBO ledger** y otras features marcadas como pendientes en `.cursorrules` (no bloquean POS core si no se usan).

### Próximos pasos (priorizados)

1. Pruebas manuales en **staging2** con sesión real: cobro POS, despacho, impresión, KDS.  
2. Si reaparece **500 en pay**, capturar stack en Railway y abrir fix acotado.  
3. Resolver **QBO** credenciales y flujo OAuth.  
4. Merge `develop` → `main` solo tras **aprobación explícita** post-staging2.  
5. Planificar refactor incremental de **`routes.ts` / `storage.ts`** (opcional, no urgente).

---

*Documento generado como parte del assessment marzo 2026. No modifica migraciones existentes ni hace push a `main`.*
