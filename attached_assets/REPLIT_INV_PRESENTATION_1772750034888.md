# RMSCore — Inventario: Presentación de Compra, UOM Editable y Recálculo de Costos

## CONTEXTO CRÍTICO — LEER ANTES DE MODIFICAR

- Rutas de inventario: prefijo `/api/inv/` (NO `/api/inventory/`)
- Schema: `shared/schema.ts` — tabla `invItems` definida con `pgTable`
- Storage: `server/inventory-storage.ts` — `updateInvItem(id, Partial<InsertInvItem>)`
  acepta cualquier campo sin validación adicional — no requiere cambios
- Routes: `server/inventory-routes.ts` — `coerceNumericFields()` convierte campos
  numéricos a string antes del PATCH. Los nuevos campos numéricos deben agregarse
  a esa función
- El select de `GET /api/inv/items` es explícito (no `SELECT *`) — los nuevos
  campos deben agregarse manualmente al select
- `insertInvItemSchema` se genera con `createInsertSchema(invItems).omit(...)` —
  los nuevos campos se incluyen automáticamente al agregarlos a la tabla
- Los campos numéricos en Drizzle/PostgreSQL se devuelven como `string` al frontend
- Frontend: `client/src/pages/inventory/items.tsx`

---

## PASO 1 — Migración SQL directa

Ejecutar este SQL en la base de datos (es idempotente con `IF NOT EXISTS`):

```sql
ALTER TABLE inv_items
  ADD COLUMN IF NOT EXISTS purchase_presentation TEXT,
  ADD COLUMN IF NOT EXISTS purchase_qty_per_base_uom NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS last_cost_per_presentation NUMERIC(12,2);
```

Verificar que las columnas se crearon:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'inv_items'
  AND column_name IN (
    'purchase_presentation',
    'purchase_qty_per_base_uom',
    'last_cost_per_presentation'
  );
```
Debe devolver 3 filas. Si devuelve menos, detener y reportar.

---

## PASO 2 — Schema Drizzle (`shared/schema.ts`)

Abrir `shared/schema.ts`. Localizar la tabla `invItems` (línea ~540).

Agregar los 3 campos DESPUÉS de `lastCostPerBaseUom` y ANTES de `unitWeightG`:

```typescript
purchasePresentation: text("purchase_presentation"),
purchaseQtyPerBaseUom: numeric("purchase_qty_per_base_uom", { precision: 12, scale: 4 }),
lastCostPerPresentation: numeric("last_cost_per_presentation", { precision: 12, scale: 2 }),
```

NO modificar el `insertInvItemSchema` ni el tipo `InvItem` — se generan
automáticamente desde la tabla y se actualizarán solos.

---

## PASO 3 — Agregar campos al SELECT de la API (`server/inventory-routes.ts`)

### 3a — GET `/api/inv/items` (línea ~59)

En el objeto `.select({...})`, agregar los 3 campos nuevos después de
`lastCostPerBaseUom`:

```typescript
purchasePresentation: invItems.purchasePresentation,
purchaseQtyPerBaseUom: invItems.purchaseQtyPerBaseUom,
lastCostPerPresentation: invItems.lastCostPerPresentation,
```

### 3b — GET `/api/inv/items/:id` (línea ~90)

Mismo cambio — agregar los mismos 3 campos al select de ese endpoint.

### 3c — `coerceNumericFields` (línea ~119)

Agregar los campos numéricos nuevos al array `numericKeys`:

```typescript
const numericKeys = [
  "onHandQtyBase", "reorderPointQtyBase", "parLevelQtyBase",
  "avgCostPerBaseUom", "lastCostPerBaseUom", "unitWeightG",
  "purchaseQtyPerBaseUom", "lastCostPerPresentation",  // nuevos
];
```

### 3d — Endpoint de recálculo de costos promedio

Agregar ANTES del endpoint de bulk-import (`POST /api/inv/items/bulk-import`):

```typescript
app.post("/api/inv/items/recalc-avg-cost",
  requirePermission("INV_MANAGE_ITEMS"),
  async (_req, res) => {
    try {
      const result = await db.execute(sql`
        UPDATE inv_items
        SET avg_cost_per_base_uom = last_cost_per_base_uom,
            updated_at = NOW()
        WHERE is_active = true
          AND last_cost_per_base_uom > 0
          AND avg_cost_per_base_uom != last_cost_per_base_uom
      `);
      const updated = result.rowCount ?? 0;
      res.json({ updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);
```

Verificar que `sql` esté importado desde `drizzle-orm` al inicio del archivo.
Si no está, agregarlo al import existente.

---

## PASO 4 — Frontend (`client/src/pages/inventory/items.tsx`)

### 4a — Actualizar el tipo/interface de InvItem

Localizar donde se define el tipo `InvItem` o la interface del item en el
frontend (buscar `interface InvItem` o `type InvItem`).

Agregar los 3 campos nuevos:
```typescript
purchasePresentation: string | null;
purchaseQtyPerBaseUom: string | null;
lastCostPerPresentation: string | null;
```

### 4b — Opciones de presentación

Agregar esta constante cerca de donde están definidas las opciones de UOM
(buscar `UOM_OPTIONS` o similar):

```typescript
const PRESENTATION_OPTIONS = [
  "Bolsa", "Caja", "Paquete", "Botella",
  "Saco", "Lata", "Unidad", "Rollo", "Garrafa",
];
```

### 4c — Grid de escritorio: columnas nuevas

En la tabla de escritorio, agregar 3 columnas después de la columna UOM:

**Columna "Present."** — select editable:
```tsx
<TableHead>Present.</TableHead>
// En cada fila:
<TableCell>
  <select
    value={item.purchasePresentation ?? ""}
    onChange={(e) => patchItem(item.id, {
      purchasePresentation: e.target.value || null
    })}
    className="text-xs border-0 bg-transparent w-full"
  >
    <option value="">—</option>
    {PRESENTATION_OPTIONS.map(p => (
      <option key={p} value={p}>{p}</option>
    ))}
  </select>
</TableCell>
```

**Columna "Cant. Present."** — número editable:
```tsx
<TableHead className="text-right">Cant. Present.</TableHead>
// En cada fila:
<TableCell className="text-right">
  <input
    type="number"
    min="0"
    step="0.0001"
    value={item.purchaseQtyPerBaseUom ?? ""}
    onChange={(e) => markDirtyAndDebounce(item.id,
      "purchaseQtyPerBaseUom", e.target.value
    )}
    onBlur={(e) => patchItem(item.id, {
      purchaseQtyPerBaseUom: e.target.value || null
    })}
    className="text-xs text-right w-20 border-0 bg-transparent"
  />
</TableCell>
```

**Columna "Costo Present."** — número editable con cálculo automático:
```tsx
<TableHead className="text-right">Costo Present.</TableHead>
// En cada fila:
<TableCell className="text-right">
  <input
    type="number"
    min="0"
    step="0.01"
    value={item.lastCostPerPresentation ?? ""}
    onChange={(e) => markDirtyAndDebounce(item.id,
      "lastCostPerPresentation", e.target.value
    )}
    onBlur={(e) => {
      const costPres = parseFloat(e.target.value);
      const qty = parseFloat(item.purchaseQtyPerBaseUom ?? "0");
      const patch: any = { lastCostPerPresentation: e.target.value || null };
      // Auto-calcular costo por base UOM si tiene cantidad de presentación
      if (!isNaN(costPres) && qty > 0) {
        patch.lastCostPerBaseUom = (costPres / qty).toFixed(6);
      }
      patchItem(item.id, patch);
    }}
    className="text-xs text-right w-24 border-0 bg-transparent"
  />
</TableCell>
```

NOTA: Usar los mismos patrones de edición que usan las demás columnas
numéricas editables en la tabla. Si el componente usa un patrón diferente
a `markDirtyAndDebounce`/`patchItem`, adaptar al patrón existente.

### 4d — UOM editable en grid de escritorio

Localizar la columna UOM en la tabla de escritorio. Cambiar de texto
estático a select editable:

```tsx
// ANTES (texto estático):
<TableCell>{item.baseUom}</TableCell>

// DESPUÉS (select editable):
<TableCell>
  <select
    value={item.baseUom}
    onChange={(e) => patchItem(item.id, { baseUom: e.target.value })}
    className="text-xs border-0 bg-transparent"
  >
    {UOM_OPTIONS.map(u => (
      <option key={u} value={u}>{u}</option>
    ))}
  </select>
</TableCell>
```

### 4e — Formulario mobile: campos nuevos

En el formulario de edición mobile (buscar `MobileEditForm` o el Dialog
de edición), agregar los 3 campos nuevos después del campo UOM:

```tsx
{/* UOM — cambiar de label estático a select */}
<div>
  <label className="text-xs font-medium text-muted-foreground">UOM Base</label>
  <select
    value={editValues.baseUom ?? item.baseUom}
    onChange={(e) => handleFieldChange("baseUom", e.target.value)}
    className="w-full border rounded px-2 py-1.5 text-sm mt-1"
  >
    {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
  </select>
</div>

{/* Presentación */}
<div>
  <label className="text-xs font-medium text-muted-foreground">Presentación de compra</label>
  <select
    value={editValues.purchasePresentation ?? item.purchasePresentation ?? ""}
    onChange={(e) => handleFieldChange("purchasePresentation", e.target.value || null)}
    className="w-full border rounded px-2 py-1.5 text-sm mt-1"
  >
    <option value="">— Sin especificar —</option>
    {PRESENTATION_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
  </select>
</div>

{/* Cantidad por presentación */}
<div>
  <label className="text-xs font-medium text-muted-foreground">
    Cantidad por presentación ({item.baseUom})
  </label>
  <input
    type="number"
    min="0"
    step="0.0001"
    value={editValues.purchaseQtyPerBaseUom ?? item.purchaseQtyPerBaseUom ?? ""}
    onChange={(e) => handleFieldChange("purchaseQtyPerBaseUom", e.target.value || null)}
    className="w-full border rounded px-2 py-1.5 text-sm mt-1"
    placeholder="ej: 5000 para una bolsa de 5kg"
  />
</div>

{/* Costo por presentación */}
<div>
  <label className="text-xs font-medium text-muted-foreground">
    Costo por presentación (₡)
  </label>
  <input
    type="number"
    min="0"
    step="0.01"
    value={editValues.lastCostPerPresentation ?? item.lastCostPerPresentation ?? ""}
    onChange={(e) => handleFieldChange("lastCostPerPresentation", e.target.value || null)}
    className="w-full border rounded px-2 py-1.5 text-sm mt-1"
    placeholder="ej: 870"
  />
  {/* Mostrar el cálculo automático */}
  {(() => {
    const costPres = parseFloat(
      String(editValues.lastCostPerPresentation ?? item.lastCostPerPresentation ?? "0")
    );
    const qty = parseFloat(
      String(editValues.purchaseQtyPerBaseUom ?? item.purchaseQtyPerBaseUom ?? "0")
    );
    if (costPres > 0 && qty > 0) {
      return (
        <p className="text-xs text-muted-foreground mt-1">
          = ₡{(costPres / qty).toLocaleString("es-CR", { minimumFractionDigits: 4 })}
          {" "}por {item.baseUom}
        </p>
      );
    }
    return null;
  })()}
</div>
```

Adaptar `handleFieldChange` al patrón existente en el formulario mobile.
Al guardar el formulario mobile, incluir el cálculo automático:

```typescript
// En la función de guardado del form mobile:
const patch: any = { ...editValues };
const costPres = parseFloat(String(patch.lastCostPerPresentation ?? "0"));
const qty = parseFloat(String(patch.purchaseQtyPerBaseUom ?? item.purchaseQtyPerBaseUom ?? "0"));
if (!isNaN(costPres) && qty > 0) {
  patch.lastCostPerBaseUom = (costPres / qty).toFixed(6);
}
await patchItem(item.id, patch);
```

### 4f — Botón "Recalcular Costos Promedio"

En el header de la página de inventario, agregar el botón junto a
"Importar" y "+ Nuevo":

```tsx
import { Calculator } from "lucide-react";

// Mutation:
const recalcMutation = useMutation({
  mutationFn: () => apiRequest("POST", "/api/inv/items/recalc-avg-cost", {}),
  onSuccess: (data: any) => {
    queryClient.invalidateQueries({ queryKey: ["/api/inv/items"] });
    toast({
      title: "Costos actualizados",
      description: `${data.updated} insumo${data.updated !== 1 ? "s" : ""} actualizado${data.updated !== 1 ? "s" : ""}`,
    });
  },
  onError: () => {
    toast({ variant: "destructive", title: "Error al recalcular costos" });
  },
});

// Botón en el header:
<Button
  variant="outline"
  size="sm"
  onClick={() => recalcMutation.mutate()}
  disabled={recalcMutation.isPending}
>
  {recalcMutation.isPending
    ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
    : <Calculator className="h-4 w-4 mr-1" />
  }
  Recalcular Costos
</Button>
```

---

## VERIFICACIÓN FINAL

1. `npx tsc --noEmit` — sin errores TypeScript
2. Las 3 columnas existen en la DB:
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'inv_items'
     AND column_name IN ('purchase_presentation',
       'purchase_qty_per_base_uom', 'last_cost_per_presentation');
   ```
3. Editar un insumo con UOM=G → ingresar Presentación="Bolsa",
   Cantidad=5000, Costo=₡870 → al guardar verificar que
   `lastCostPerBaseUom` = 0.174000 (870/5000)
4. El select de UOM en grid y mobile permite cambiar la unidad base
5. El botón "Recalcular Costos" muestra toast con cantidad de items
   actualizados
6. En el formulario mobile, al ingresar costo y cantidad, aparece
   el texto calculado "= ₡0.1740 por G" debajo del campo
