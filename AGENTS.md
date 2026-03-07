# RMSCore — Instrucciones Permanentes para Replit Agent

## PRINCIPIO FUNDAMENTAL
RMSCore es una plataforma SaaS multi-tenant en producción con clientes reales.
Cualquier error en base de datos, autenticación, pagos o datos de negocio
tiene impacto directo en operaciones de restaurantes reales.

ANTES DE HACER CUALQUIER CAMBIO: pensar en el impacto en todos los tenants,
en los datos existentes, y en la integridad del sistema.

EN CASO DE DUDA: preguntar al usuario antes de proceder.

---

## REGLA #1 — Cambios de Base de Datos (CRÍTICO — NUNCA SALTARSE)

### Lo que SIEMPRE debes hacer:
1. Crear archivo en `/migrations/` con formato: `XXXX_descripcion.sql`
   - XXXX = número secuencial (revisar último archivo en /migrations/ y sumar 1)
   - Ejemplo: `0004_add_trial_base_plan.sql`
2. Usar SOLO sentencias seguras y reversibles:
   - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
   - `CREATE TABLE IF NOT EXISTS ...`
   - `CREATE INDEX IF NOT EXISTS ...`
3. Cada migración debe ser idempotente — si se corre dos veces, no debe fallar
4. Documentar en comentarios SQL qué hace cada migración y por qué

### Lo que NUNCA debes hacer:
- Ejecutar ALTER TABLE o CREATE TABLE directamente en la DB
- Modificar o eliminar columnas existentes sin confirmación explícita del usuario
- Usar DROP TABLE, DROP COLUMN, TRUNCATE sin confirmación explícita
- Renombrar tablas o columnas existentes sin plan de migración completo
- Modificar tipos de datos de columnas existentes que tienen datos
- Tocar las tablas del schema public que son del sistema multi-tenant:
  - `public.tenants`
  - `public.tenant_modules`
  - `public.superadmin_users`
  - `public.provision_log`
  - `public.billing_events`
  - `schema_migrations`

### Proceso de migración multi-tenant:
- El servidor aplica migraciones de /migrations/ a TODOS los schemas de tenants al arrancar
- El schema `public` es el schema de Tenant 1 (Rest La Antigua)
- Cada nuevo tenant tiene su propio schema (ej: tenant_x7k2m9qp)
- Una migración nueva se aplica a TODOS los tenants existentes y futuros
- Por eso toda migración DEBE ser compatible con datos existentes

---

## REGLA #2 — Cambios de Datos (DML)

### Para seeds y datos de configuración:
1. Crear archivo en `/migrations/data/` con formato: `XXXX_descripcion_data.sql`
2. Usar siempre INSERT ... WHERE NOT EXISTS o ON CONFLICT DO NOTHING
3. Usar UPDATE ... WHERE con condiciones específicas, nunca UPDATE sin WHERE
4. Documentar qué datos se modifican y por qué

### NUNCA:
- DELETE sin WHERE
- UPDATE sin WHERE
- Modificar datos de órdenes, pagos o sales_ledger_items existentes
- Modificar datos de usuarios sin confirmación del usuario

---

## REGLA #3 — Integridad de Datos de Negocio (CRÍTICO)

Las siguientes tablas contienen datos financieros y operacionales críticos.
NUNCA modificar su estructura o datos sin análisis completo de impacto:

- `orders` — órdenes del restaurante
- `order_items` — items de cada orden
- `payments` — pagos procesados
- `sales_ledger_items` — libro de ventas (incluye histórico Loyverse)
- `cash_sessions` — sesiones de caja
- `split_accounts` / `split_items` — división de cuentas
- `voided_items` — items anulados (audit trail)
- `kitchen_tickets` / `kitchen_ticket_items` — tickets de cocina
- `inv_movements` — movimientos de inventario
- `hr_time_punches` — marcaciones de empleados

Si necesitas modificar alguna de estas tablas, PRIMERO:
1. Explicar al usuario exactamente qué se va a cambiar
2. Esperar confirmación explícita
3. Crear la migración con IF NOT EXISTS
4. Nunca modificar datos históricos

---

## REGLA #4 — Arquitectura Multi-Tenant (NO ROMPER)

### Cómo funciona:
- PostgreSQL con schema por tenant
- Tenant 1 (Rest La Antigua): schema = `public`, slug = `rms`
- Nuevos tenants: schema = `tenant_XXXXXXXX`
- El middleware de tenant lee el subdominio para identificar el tenant
- `req.tenantSchema` contiene el schema del tenant actual
- `req.db` es la instancia de Drizzle con el schema correcto

### NUNCA:
- Hardcodear el schema `public` en queries — usar siempre `req.tenantSchema`
- Mezclar datos entre tenants
- Acceder a tablas de un tenant desde el contexto de otro
- Modificar el middleware de tenant sin análisis completo

### Rutas protegidas por módulo:
- `/api/inventory/*` → requiere MOD_INVENTORY
- `/api/hr/*` → requiere MOD_HR
- `/api/reservations/*` → requiere MOD_RESERVATIONS
- `/api/reports/sales-cube` → requiere MOD_ANALYTICS
- `/api/qbo/*` → requiere MOD_QBO

---

## REGLA #5 — Stack Tecnológico (NO CAMBIAR SIN AUTORIZACIÓN)

### Frontend:
- React + Vite + TypeScript
- Tailwind CSS + shadcn/ui
- Wouter (routing) — NO cambiar a React Router
- TanStack Query v5 — sintaxis de objeto obligatoria
- Design system: Linen (tokens: coral, sage, accent blue, amber)
- Tipografía: Outfit, IBM Plex Sans, IBM Plex Mono
- NO agregar librerías de UI adicionales sin autorización

### Backend:
- Express.js + TypeScript
- Drizzle ORM (schema definitions) + SQL puro para migraciones
- WebSocket: librería `ws` — NO migrar a Socket.IO sin autorización
- Autenticación: express-session + memorystore
- NO cambiar el sistema de autenticación sin análisis completo

### Base de datos:
- PostgreSQL
- Migraciones: archivos SQL en `/migrations/` — NO usar `drizzle-kit push` en producción
- La tabla `schema_migrations` rastrea qué migraciones se aplicaron

---

## REGLA #6 — Deploy y Entornos

### Flujo obligatorio:
1. Desarrollo y pruebas: Replit
2. Sync a GitHub (branch: main)
3. Railway detecta el push y redeploya automáticamente
4. Las migraciones en /migrations/ se aplican solas al arrancar en Railway

### Variables de entorno:
- Replit: Replit Secrets
- Railway: Railway Variables (configurar manualmente para cada variable nueva)
- NUNCA hardcodear en el código
- Cuando agregues una variable nueva, avisar al usuario para que la configure en Railway

### Variables críticas actuales:
- `DATABASE_URL` — conexión a PostgreSQL
- `SESSION_SECRET` — secreto de sesiones
- `SUPERADMIN_TOKEN` — token del panel superadmin
- `RESEND_API_KEY` — API key de Resend para emails
- `EMAIL_FROM` — dirección de envío (noreply@rmscore.app)
- `NODE_ENV` — production en Railway
- `PORT` — 3000 en Railway

---

## REGLA #7 — Seguridad (NUNCA COMPROMETER)

- Passwords: bcrypt, salt rounds mínimo 10
- PINs: bcrypt antes de guardar, NUNCA en texto plano
- Reset tokens: `crypto.randomBytes(32).toString('hex')`
- API keys y tokens: SOLO desde process.env, nunca en código
- SUPERADMIN_TOKEN: leer de process.env, nunca mostrar en UI
- Datos sensibles: nunca loggear passwords, tokens o PINs
- SQL injection: usar siempre queries parametrizadas de Drizzle
- El superadmin es accesible en /superadmin — no exponer su token

---

## REGLA #8 — Sistema de Email

- Proveedor: Resend (resend.com)
- Usar SIEMPRE `server/services/email-service.ts`
- From: `process.env.EMAIL_FROM` (noreply@rmscore.app)
- Si RESEND_API_KEY no está configurado: loggear a consola, NO crashear
- Dominios configurados: rmscore.app
- NUNCA enviar emails con datos sensibles en texto plano excepto en el welcome email inicial

---

## REGLA #9 — Lógica de Negocio Crítica (NO MODIFICAR SIN AUTORIZACIÓN)

Las siguientes funcionalidades tienen lógica crítica que NO debe modificarse
sin análisis completo y confirmación explícita del usuario:

- **Tax snapshots**: los impuestos se capturan al crear el item de orden, no al pagar
- **Order consecutives**: numeración diaria y global de órdenes — no resetear
- **Payment validation**: validación de pagos y sesiones de caja
- **WAC (Weighted Average Cost)**: cálculo de costo promedio ponderado en inventario
- **Shortage lifecycle**: OPEN → ACKNOWLEDGED → RESOLVED → CLOSED
- **Soft-void vs hard-delete**: waiters solo pueden soft-void, managers pueden hard-delete
- **Timezone**: America/Costa_Rica (UTC-6) para todas las fechas de negocio
- **Multi-printer**: configuración de impresoras por destino (cocina/bar)
- **Print bridge**: WebSocket con autenticación por header, NO query string
- **QBO sync**: solo sincroniza origin=SYSTEM, nunca LOYVERSE

---

## REGLA #10 — Comunicación con el Usuario

- Antes de cualquier cambio que afecte datos existentes: explicar y pedir confirmación
- Antes de modificar lógica de negocio crítica: explicar el impacto completo
- Si algo no está claro en el requerimiento: preguntar antes de implementar
- Cuando agregues una variable de entorno nueva: avisar para configurarla en Railway
- Cuando una migración requiere correrse manualmente: indicarlo claramente
- Al terminar cambios de schema: listar todos los archivos de migración creados

---

## MÓDULOS Y SU ESTADO

| Módulo | Estado | moduleKey |
|--------|--------|-----------|
| Mesas + KDS | Completo | CORE_TABLES |
| POS + Caja | Completo | CORE_POS |
| QR Autoorden | Completo | CORE_QR |
| Dashboard | Completo | CORE_DASHBOARD |
| Inventario | Completo | MOD_INVENTORY |
| RRHH | Completo | MOD_HR |
| Reservaciones | En desarrollo | MOD_RESERVATIONS |
| Loyalty | Pendiente | MOD_LOYALTY |
| Sales Cube | Completo | MOD_ANALYTICS |
| QuickBooks Online | En desarrollo | MOD_QBO |
| Multi-ubicación | Pendiente | MOD_MULTI_LOCATION |
| API Access | Pendiente | MOD_API |

---

## ARCHIVOS CLAVE — NO ELIMINAR NI RENOMBRAR

- `server/middleware/tenant.ts` — identificación de tenant por subdominio
- `server/middleware/tenant-db.ts` — inyección de req.db con schema correcto
- `server/middleware/module-access.ts` — control de acceso por módulo
- `server/provision/provision-service.ts` — provisioning de nuevos tenants
- `server/provision/migrate-tenants.ts` — aplicación de migraciones a todos los tenants
- `server/services/email-service.ts` — servicio de email con Resend
- `migrations/` — NUNCA eliminar archivos de migración existentes
- `client/src/lib/auth.tsx` — contexto de autenticación
- `client/src/lib/ws.ts` — WebSocket manager singleton
