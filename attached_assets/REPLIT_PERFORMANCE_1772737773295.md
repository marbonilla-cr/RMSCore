# RMSCore — Performance: Diagnóstico y Corrección

---

## PARTE 1 — PROMPT DE DIAGNÓSTICO

Ejecutar este prompt primero. El objetivo es recolectar los datos
necesarios para cuantificar el problema antes de modificar código.

---

### DIAGNÓSTICO DE RENDIMIENTO — RMSCore Frontend/Backend

Necesito medir los tiempos de respuesta reales del sistema en las rutas
más usadas durante operación. Ejecutar las siguientes acciones y
reportar los resultados.

#### 1. Habilitar logging de performance en el servidor

Abrir `server/routes.ts` (o el archivo principal de rutas).

Buscar si existe este patrón (ya está en algunos endpoints):
```typescript
if (Date.now() - t0 > 200) console.log(`[PERF] ...`);
```

Cambiar el umbral de 200ms a 0ms temporalmente en los siguientes
endpoints para capturar TODOS los tiempos, no solo los lentos:

```typescript
// Cambiar en estos endpoints específicos:
// GET /api/pos/tables              → threshold: 0
// GET /api/pos/orders/:id/splits   → threshold: 0
// POST /api/pos/pay                → threshold: 0
// POST /api/pos/pay-multi          → threshold: 0
// POST /api/pos/pay-split          → threshold: 0
// GET /api/pos/paid-orders         → threshold: 0
```

Para endpoints que NO tienen logging de performance aún, agregar:
```typescript
const t0 = Date.now();
// ... lógica existente ...
console.log(`[PERF] GET /api/waiter/tables ${Date.now() - t0}ms`);
console.log(`[PERF] GET /api/tables/:id/current ${Date.now() - t0}ms`);
```

#### 2. Verificar índices existentes en PostgreSQL

Ejecutar este SQL en la base de datos y copiar el output completo:

```sql
-- Índices en tablas críticas
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename IN (
  'orders',
  'order_items',
  'split_accounts',
  'split_items',
  'payments',
  'sales_ledger_items',
  'kitchen_tickets',
  'kitchen_ticket_items'
)
ORDER BY tablename, indexname;
```

#### 3. Verificar tamaños de tablas

```sql
SELECT
  relname AS table_name,
  n_live_tup AS row_count,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE relname IN (
  'orders',
  'order_items',
  'split_accounts',
  'split_items',
  'payments',
  'sales_ledger_items',
  'order_item_modifiers',
  'order_item_taxes',
  'order_item_discounts'
)
ORDER BY n_live_tup DESC;
```

#### 4. Identificar queries lentas en PostgreSQL

```sql
-- Queries más lentas del sistema (requiere pg_stat_statements)
SELECT
  query,
  calls,
  round(mean_exec_time::numeric, 2) AS avg_ms,
  round(total_exec_time::numeric, 2) AS total_ms,
  round(stddev_exec_time::numeric, 2) AS stddev_ms
FROM pg_stat_statements
WHERE query ILIKE '%order%'
   OR query ILIKE '%split%'
   OR query ILIKE '%payment%'
ORDER BY mean_exec_time DESC
LIMIT 20;
```

Si `pg_stat_statements` no está disponible, reportarlo.

#### 5. Simular carga de operación y capturar logs

Con el sistema funcionando normalmente (no en idle):
1. Abrir 3 o más mesas con órdenes activas
2. Navegar a POS → hacer clic en una mesa
3. Abrir el dialog de separación de cuenta
4. Mover 2-3 artículos entre cuentas
5. Intentar un cobro completo

Copiar TODOS los logs `[PERF]` del servidor que aparezcan.

#### 6. Reportar configuración del entorno

Responder:
- ¿El servidor está en Replit o Railway en este momento?
- ¿Cuántas mesas tienen órdenes abiertas típicamente en hora pico?
- ¿La base de datos es local (misma instancia) o remota (Neon/Railway DB)?
- ¿El pool de conexiones tiene alguna configuración especial?
  (buscar en `server/db.ts` el valor de `max`)

---
---

## PARTE 2 — PROMPT DE IMPLEMENTACIÓN

Aplicar este prompt después de tener los datos del diagnóstico.
Contiene todas las optimizaciones identificadas como seguras de aplicar
sin cambiar el comportamiento del sistema.

---

### OPTIMIZACIONES DE RENDIMIENTO — RMSCore

#### CONTEXTO

Los cuellos de botella identificados son:

1. **Polling agresivo:** POS, Tables y KDS hacen refetch cada 5s aunque
   WebSocket ya notifica cambios instantáneamente. Esto genera load
   constante en el servidor incluso cuando no hay cambios.

2. **`invalidateQueries` en cascada:** Cada acción de split/move invalida
   todas las queries relacionadas, provocando 3-5 re-fetches simultáneos
   por cada movimiento de artículo.

3. **`split-items/move` secuencial:** Mover artículos individuales hace
   un POST por artículo. Con 8 artículos = 8 requests secuenciales antes
   de que la UI responda.

4. **Falta de optimistic updates:** La UI espera la respuesta del servidor
   antes de mostrar el cambio. En cada movimiento de artículo el usuario
   ve un lag de ~200-400ms por request.

5. **`getSplitAccountsForOrder` + `getSplitItemsByAccountIds`:** Dos
   queries secuenciales para cargar splits. Se pueden hacer en paralelo.

6. **`bulkMoveSplitItems` con loop en storage:** Hace N inserts/deletes
   individuales dentro de una transacción en lugar de usar
   `INSERT ... VALUES` en batch.

---

#### OPTIMIZACIÓN 1 — Reducir polling, confiar en WebSocket

**Archivos:** `client/src/pages/pos.tsx`, `client/src/pages/tables.tsx`,
`client/src/pages/kds.tsx`

El sistema ya tiene WebSocket que notifica `order_updated`,
`table_status_changed`, `payment_completed` y `qr_submission_created`.
El polling de 5s es redundante y genera carga innecesaria.

**Cambio: aumentar `refetchInterval` en las queries que ya tienen
cobertura WebSocket completa.**

En `pos.tsx`, localizar la query de `/api/pos/tables` y cambiar:
```typescript
// ANTES:
refetchInterval: 5000,

// DESPUÉS:
refetchInterval: 30000,   // fallback cada 30s, WS cubre el resto
staleTime: 10000,         // considerar fresco por 10s
```

Hacer el mismo cambio en:
- `tables.tsx` → query de `/api/waiter/tables`
- `kds.tsx` → query de tickets activos

**IMPORTANTE:** No tocar los WebSocket handlers — deben seguir
invalidando las queries al recibir eventos. Solo se cambia el intervalo
de polling como fallback.

---

#### OPTIMIZACIÓN 2 — Optimistic updates en movimientos de splits

**Archivo:** `client/src/pages/pos.tsx` (o el archivo donde vive
`SplitDialog.tsx` y sus handlers)

Actualmente el flujo de mover un artículo es:
```
Usuario toca artículo → POST /api/pos/split-items/move → esperar respuesta
→ invalidateQueries → re-fetch splits → UI actualiza
```

Con optimistic update:
```
Usuario toca artículo → UI actualiza inmediatamente →
POST /api/pos/split-items/move en background → si error: rollback
```

Localizar el handler que llama a `POST /api/pos/split-items/move`
(buscar por la URL en el código). Modificar para usar `useMutation`
con `onMutate` / `onError` / `onSettled`:

```typescript
const moveMutation = useMutation({
  mutationFn: (data: { orderItemId: number; fromSplitId: number | null; toSplitId: number | null }) =>
    apiRequest("POST", "/api/pos/split-items/move", data),

  onMutate: async ({ orderItemId, fromSplitId, toSplitId }) => {
    // Cancelar refetches en curso para evitar que sobreescriban el estado optimista
    await queryClient.cancelQueries({ queryKey: ["/api/pos/orders", orderId, "splits"] });

    // Snapshot del estado actual para rollback
    const previousSplits = queryClient.getQueryData(["/api/pos/orders", orderId, "splits"]);

    // Actualizar cache inmediatamente (optimistic)
    queryClient.setQueryData(
      ["/api/pos/orders", orderId, "splits"],
      (old: any[]) => {
        if (!old) return old;
        return old.map(split => {
          let items = [...(split.items || [])];
          // Remover del split origen
          if (split.id === fromSplitId) {
            items = items.filter(i => i.orderItemId !== orderItemId);
          }
          // Agregar al split destino
          if (split.id === toSplitId) {
            items = [...items, { orderItemId, splitId: toSplitId }];
          }
          return { ...split, items };
        });
      }
    );

    return { previousSplits };
  },

  onError: (_err, _variables, context) => {
    // Rollback si falla
    if (context?.previousSplits) {
      queryClient.setQueryData(
        ["/api/pos/orders", orderId, "splits"],
        context.previousSplits
      );
    }
    toast({ variant: "destructive", title: "Error al mover artículo" });
  },

  onSettled: () => {
    // Sincronizar con el servidor después de la operación (exitosa o fallida)
    queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", orderId, "splits"] });
  },
});
```

Verificar que `orderId` esté disponible en el scope del handler. Si no,
pasarlo como parámetro adicional.

---

#### OPTIMIZACIÓN 3 — Batch de movimientos en el backend

**Archivo:** `server/storage.ts` (o `storage-2.ts`)

Localizar la función `bulkMoveSplitItems`. Actualmente hace un loop con
inserts/deletes individuales. Reemplazar con operaciones batch:

```typescript
export async function bulkMoveSplitItems(
  orderItemIds: number[],
  fromSplitId: number | null,
  toSplitId: number | null
) {
  if (orderItemIds.length === 0) return;

  await db.transaction(async (tx) => {
    // DELETE en batch (una sola query)
    if (fromSplitId) {
      await tx.delete(splitItems).where(
        and(
          eq(splitItems.splitId, fromSplitId),
          inArray(splitItems.orderItemId, orderItemIds)
        )
      );
    }

    // INSERT en batch (una sola query con múltiples values)
    if (toSplitId) {
      await tx.insert(splitItems).values(
        orderItemIds.map(orderItemId => ({ splitId: toSplitId, orderItemId }))
      ).onConflictDoNothing();
    }
  });
}
```

Asegurarse de que `inArray` esté importado desde `drizzle-orm`.

---

#### OPTIMIZACIÓN 4 — Cargar splits en paralelo

**Archivo:** `server/routes.ts`

Localizar el endpoint `GET /api/pos/orders/:orderId/splits`:

```typescript
// ANTES (secuencial):
const splits = await storage.getSplitAccountsForOrder(orderId);
const splitIds = splits.map(s => s.id);
const allSplitItems = await storage.getSplitItemsByAccountIds(splitIds);

// DESPUÉS (paralelo donde sea posible, con short-circuit si no hay splits):
const splits = await storage.getSplitAccountsForOrder(orderId);
if (splits.length === 0) return res.json([]);

const splitIds = splits.map(s => s.id);
const allSplitItems = await storage.getSplitItemsByAccountIds(splitIds);
// (estas dos queries YA son paralelas implícitamente si splitIds ya está listo)
// El short-circuit en splits.length === 0 evita la segunda query innecesariamente
```

El cambio real aquí es agregar el early return cuando no hay splits,
que es el caso más frecuente (mesas sin cuentas separadas).

---

#### OPTIMIZACIÓN 5 — Agregar índices faltantes en PostgreSQL

Ejecutar este SQL directamente en la base de datos. Los índices son
`IF NOT EXISTS` — seguros de ejecutar aunque ya existan:

```sql
-- Índices críticos para las queries del POS y splits
CREATE INDEX IF NOT EXISTS idx_split_accounts_order_id
  ON split_accounts (order_id);

CREATE INDEX IF NOT EXISTS idx_split_items_split_id
  ON split_items (split_id);

CREATE INDEX IF NOT EXISTS idx_split_items_order_item_id
  ON split_items (order_item_id);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id_status
  ON order_items (order_id, status);

CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders (status)
  WHERE status IN ('OPEN', 'IN_KITCHEN', 'PREPARING', 'READY');

CREATE INDEX IF NOT EXISTS idx_payments_order_id
  ON payments (order_id);

CREATE INDEX IF NOT EXISTS idx_payments_business_date
  ON payments (business_date, status);

CREATE INDEX IF NOT EXISTS idx_sales_ledger_business_date
  ON sales_ledger_items (business_date);
```

Si la base de datos es Neon o Railway PostgreSQL, ejecutar desde el
panel SQL de esa plataforma o via `psql`.

Después de crear los índices, ejecutar:
```sql
ANALYZE orders;
ANALYZE order_items;
ANALYZE split_accounts;
ANALYZE split_items;
ANALYZE payments;
```

---

#### OPTIMIZACIÓN 6 — Reducir invalidaciones en cascada post-pago

**Archivo:** `client/src/pages/pos.tsx`

Después de un pago exitoso, el frontend actualmente invalida múltiples
queries. Verificar cuántas queries se invalidan en el handler de pago
y reducir a las estrictamente necesarias.

Localizar el handler de éxito del pago (buscar donde se llama a
`POST /api/pos/pay` o `POST /api/pos/pay-multi`). El patrón correcto es:

```typescript
onSuccess: () => {
  // Solo invalidar lo que cambió realmente
  queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
  // NO invalidar listas que no cambian con un pago:
  // - /api/pos/payment-methods (no cambia)
  // - /api/pos/cash-session (solo cambia si fue efectivo — invalidar condicionalmente)
  // - /api/waiter/tables (el WS ya notifica)
},
```

Si el método de pago fue CASH, entonces sí invalidar también:
```typescript
if (paymentMethod === "CASH") {
  queryClient.invalidateQueries({ queryKey: ["/api/pos/cash-session"] });
}
```

---

#### RESTAURAR LOGGING

Después de aplicar todas las optimizaciones, restaurar el threshold
de logging a 200ms en todos los endpoints donde se cambió a 0ms:

```typescript
if (Date.now() - t0 > 200) console.log(`[PERF] ...`);
```

---

#### VERIFICACIÓN

1. `npx tsc --noEmit` — sin errores TypeScript
2. Navegar a POS → abrir una mesa con artículos → verificar que carga
   sin delay visible
3. Abrir dialog de separación → mover un artículo → verificar que el
   artículo se mueve instantáneamente en la UI sin esperar al servidor
4. Si el artículo rebota de vuelta, significa que el optimistic update
   falló — revisar que `orderId` esté correctamente en scope
5. Ejecutar el SQL de índices y confirmar que todos se crearon:
   ```sql
   SELECT indexname FROM pg_indexes
   WHERE tablename IN ('split_accounts','split_items','order_items','payments')
   ORDER BY tablename, indexname;
   ```
6. Con el logging en 0ms activo por 5 minutos de operación normal,
   confirmar que los tiempos de `/api/pos/tables` bajan a <50ms
   y `/api/pos/orders/:id/splits` baja a <30ms
