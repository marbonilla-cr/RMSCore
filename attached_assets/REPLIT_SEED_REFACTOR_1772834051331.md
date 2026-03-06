# RMSCore — Eliminar Hardcodes de seedTenant

## PROBLEMA

La función `seedTenant` en `server/provision/provision-service.ts`
tiene INSERTs con nombres de columnas hardcodeados que no coinciden
con el schema real. Esto causa errores como:
`column "name" of relation "payment_methods" does not exist`

La causa raíz es que el seed de nuevos tenants está duplicando lógica
que ya existe y funciona en `server/storage.ts`. Cada vez que el schema
evoluciona, hay que actualizar dos lugares — y siempre se olvida uno.

## SOLUCIÓN

Refactorizar `seedTenant` para que reutilice las funciones y constantes
que ya existen en `storage.ts`, en lugar de tener INSERTs manuales.
Cero hardcodes de columnas.

---

## CONTEXTO — Lo que ya existe en storage.ts y funciona

Estas funciones y constantes ya están implementadas y son correctas.
`seedTenant` debe llamarlas en lugar de reimplementarlas:

- `SYSTEM_PERMISSIONS` — array con todos los permisos del sistema
- `DEFAULT_ROLE_PERMISSIONS` — objeto con permisos por rol
- `ensureSystemPermissions()` — inserta permisos faltantes
- `seedDefaultRolePermissions()` — inserta permisos de roles
- `seedExtraTypes()` — inserta tipos extra de HR

El problema es que estas funciones usan la instancia `db` que apunta
al schema del Tenant 1 (`public`). Para un tenant nuevo necesitamos
ejecutar el mismo seed pero en un schema diferente.

---

## T001 — Crear función de seed genérica en storage.ts

**Archivo:** `server/storage.ts`

Agregar esta función exportada AL FINAL del archivo, antes de
`export { getBusinessDate }`:

```typescript
/**
 * Ejecuta el seed inicial en un schema de tenant específico.
 * Usa Pool directo (no el db de Drizzle) para apuntar al schema correcto.
 * Llamada desde provision-service.ts al crear/re-provisionar tenants.
 */
export async function seedTenantSchema(
  pool: import("pg").Pool,
  schemaName: string,
  businessName: string,
  sequences?: {
    orderDailyStart?:  number;
    orderGlobalStart?: number;
    invoiceStart?:     number;
  }
): Promise<void> {
  const s = schemaName; // alias para queries más cortas
  const dailyStart  = sequences?.orderDailyStart  ?? 1;
  const globalStart = sequences?.orderGlobalStart ?? 1;
  const invStart    = sequences?.invoiceStart     ?? 1;

  // 1. business_config
  await pool.query(
    `INSERT INTO "${s}".business_config
       (business_name, legal_note, order_daily_start, order_global_start, invoice_start)
     VALUES ($1, 'Gracias por su preferencia', $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [businessName, dailyStart, globalStart, invStart]
  );

  // 2. payment_methods — usar nombres de columna del schema real
  const pmCols = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'payment_methods'
     ORDER BY ordinal_position`,
    [s]
  );
  const pmColNames = pmCols.rows.map((r: any) => r.column_name);

  // Construir INSERT dinámicamente según columnas que existen
  const pmData = [
    { code: "CASH",  name: "Efectivo",    display_name: "Efectivo",     active: true },
    { code: "CARD",  name: "Tarjeta",     display_name: "Tarjeta",      active: true },
    { code: "SINPE", name: "SINPE Móvil", display_name: "SINPE Móvil",  active: true },
  ];

  for (const pm of pmData) {
    // Solo insertar columnas que realmente existen en la tabla
    const insertCols: string[] = [];
    const insertVals: any[] = [];
    let idx = 1;

    if (pmColNames.includes("code"))         { insertCols.push("code");         insertVals.push(pm.code);         idx++; }
    if (pmColNames.includes("name"))         { insertCols.push("name");         insertVals.push(pm.name);         idx++; }
    if (pmColNames.includes("display_name")) { insertCols.push("display_name"); insertVals.push(pm.display_name); idx++; }
    if (pmColNames.includes("active"))       { insertCols.push("active");       insertVals.push(pm.active);       idx++; }

    if (insertCols.length === 0) continue;

    const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(", ");
    await pool.query(
      `INSERT INTO "${s}".payment_methods (${insertCols.join(", ")})
       VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      insertVals
    );
  }

  // 3. categories TOP por defecto
  const catData = [
    { code: "TOP-COMIDAS",  name: "Comidas",  color: "emerald", sort_order: 1 },
    { code: "TOP-BEBIDAS",  name: "Bebidas",  color: "blue",    sort_order: 2 },
    { code: "TOP-POSTRES",  name: "Postres",  color: "rose",    sort_order: 3 },
    { code: "TOP-ALCOHOL",  name: "Alcohol",  color: "amber",   sort_order: 4 },
  ];
  for (const cat of catData) {
    await pool.query(
      `INSERT INTO "${s}".categories (code, name, active, sort_order, color)
       VALUES ($1, $2, true, $3, $4) ON CONFLICT DO NOTHING`,
      [cat.code, cat.name, cat.sort_order, cat.color]
    );
  }

  // 4. hr_settings
  await pool.query(
    `INSERT INTO "${s}".hr_settings
       (work_start_time, work_end_time, late_tolerance_minutes, overtime_threshold_hours)
     VALUES ('08:00', '22:00', 10, 8) ON CONFLICT DO NOTHING`
  );

  // 5. permissions — usar SYSTEM_PERMISSIONS exportado
  for (const perm of SYSTEM_PERMISSIONS) {
    await pool.query(
      `INSERT INTO "${s}".permissions (key, description)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [perm.key, perm.description]
    );
  }

  // 6. role_permissions — MANAGER recibe todos los permisos
  for (const perm of SYSTEM_PERMISSIONS) {
    await pool.query(
      `INSERT INTO "${s}".role_permissions (role, permission_key, granted)
       VALUES ('MANAGER', $1, true) ON CONFLICT DO NOTHING`,
      [perm.key]
    );
  }

  // 7. Permisos por rol (WAITER, CASHIER, COOK, etc.)
  for (const [role, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    for (const key of keys) {
      await pool.query(
        `INSERT INTO "${s}".role_permissions (role, permission_key, granted)
         VALUES ($1, $2, true) ON CONFLICT DO NOTHING`,
        [role, key]
      );
    }
  }

  // 8. hr_extra_types
  const extraTypes = [
    { typeCode: "BONO",               name: "Bono",               kind: "EARNING" },
    { typeCode: "VIATICO",            name: "Viático",            kind: "EARNING" },
    { typeCode: "REEMBOLSO",          name: "Reembolso",          kind: "EARNING" },
    { typeCode: "PRESTAMO_DEDUCCION", name: "Préstamo / Deducción", kind: "DEDUCTION" },
    { typeCode: "AJUSTE_POSITIVO",    name: "Ajuste Positivo",    kind: "EARNING" },
    { typeCode: "AJUSTE_NEGATIVO",    name: "Ajuste Negativo",    kind: "DEDUCTION" },
  ];
  for (const et of extraTypes) {
    await pool.query(
      `INSERT INTO "${s}".hr_extra_types (type_code, name, kind)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [et.typeCode, et.name, et.kind]
    );
  }

  console.log(`[seed] Schema "${s}" inicializado ✓`);
}
```

**Importante:** `SYSTEM_PERMISSIONS` y `DEFAULT_ROLE_PERMISSIONS` ya
existen en el archivo como constantes privadas. Para que `seedTenantSchema`
pueda usarlas, verificar que están definidas ANTES de esta función en el
archivo (ya lo están, están alrededor de la línea 161). No moverlas ni
duplicarlas.

---

## T002 — Simplificar seedTenant en provision-service.ts

**Archivo:** `server/provision/provision-service.ts`

Agregar import de la nueva función:

```typescript
import { seedTenantSchema } from "../storage";
```

Reemplazar la función `seedTenant` completa por esta versión
que delega al storage:

```typescript
async function seedTenant(
  schemaName: string,
  businessName: string,
  sequences?: {
    orderDailyStart?:  number;
    orderGlobalStart?: number;
    invoiceStart?:     number;
  }
): Promise<void> {
  await seedTenantSchema(publicPool, schemaName, businessName, sequences);
}
```

Eso es todo. La función ahora tiene 3 líneas en lugar de 40+,
y nunca más va a desincronizarse con el schema.

---

## T003 — Verificar columnas de hr_extra_types

**Archivo:** `shared/schema.ts`

Antes de que el Agent aplique el seed, verificar los nombres exactos
de columnas en la tabla `hrExtraTypes`. Buscar la definición de
`hrExtraTypes` en el schema y confirmar que los nombres de columna
usados en T001 (`type_code`, `name`, `kind`) coinciden exactamente.

Si los nombres son diferentes, ajustar el INSERT en `seedTenantSchema`
para que use los nombres correctos.

---

## T004 — Verificar columnas de role_permissions

**Archivo:** `shared/schema.ts`

Buscar la definición de `rolePermissions`. Confirmar que tiene
columnas `role`, `permission_key`, `granted`. Si `granted` no existe,
quitar esa columna del INSERT en `seedTenantSchema`.

---

## VERIFICACIÓN

```bash
# 1. Sin errores TypeScript
npx tsc --noEmit

# 2. Re-provisionar el tenant de prueba desde el superadmin UI
# El error "column does not exist" debe desaparecer
# El log del servidor debe mostrar:
# [seed] Schema "tenant_czykdr77" inicializado ✓
# [reprovision] Tenant "rest-prueba" re-provisionado ✓

# 3. Verificar que el tenant quedó con datos iniciales
psql $DATABASE_URL -c "
  SELECT COUNT(*) as permisos FROM tenant_czykdr77.permissions;
"
# Debe mostrar el número de permisos del sistema (alrededor de 40+)

psql $DATABASE_URL -c "
  SELECT code, name FROM tenant_czykdr77.payment_methods;
"
# Debe mostrar: CASH/Efectivo, CARD/Tarjeta, SINPE/SINPE Móvil
```
