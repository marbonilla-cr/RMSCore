# RMSCore — Fix: Reportes de Inventario + Recepción de OC

## CONTEXTO CRÍTICO — LEER ANTES DE TOCAR CÓDIGO

- El frontend de OCs (`purchase-orders.tsx`) ya tiene el botón "Recibir",
  el dialog, y la mutation — TODO está implementado correctamente
- El backend de recepción (`POST /api/inv/purchase-orders/:id/receive`)
  funciona y actualiza stock + WAC + movimientos
- El único problema del flujo de recepción es que el endpoint
  `GET /api/inv/purchase-orders/:id/receipts` devuelve datos incompletos:
  le falta `receivedByName` y las `lines` con `purchaseUom`
- NO modificar `purchase-orders.tsx` — solo arreglar el backend
- NO modificar `receivePurchaseOrder` en storage — funciona correctamente
- Archivos a modificar: `server/inventory-routes.ts` y
  `client/src/pages/inventory/reports.tsx` únicamente

---

## T001 — Fix endpoint de historial de recepciones

**Archivo:** `server/inventory-routes.ts`

**Problema:** `GET /api/inv/purchase-orders/:id/receipts` llama a
`invStorage.getPoReceipts()` que devuelve solo las columnas crudas
de `inv_po_receipts`, sin el nombre del receptor ni las líneas de
cada recepción. El frontend espera:

```typescript
{
  id: number,
  receivedAt: string,
  receivedByName: string,   // ← falta
  note: string | null,
  lines: {                  // ← falta
    id: number,
    invItemName: string,
    qtyPurchaseUomReceived: string,
    unitPricePerPurchaseUom: string,
    purchaseUom: string,    // ← falta en getPoReceiptLines actual
    qtyBaseReceived: string,
  }[]
}
```

**Fix:** Reemplazar el handler del endpoint en `inventory-routes.ts`.
Localizar estas líneas exactas (alrededor de línea 672):

```typescript
app.get("/api/inv/purchase-orders/:id/receipts", requirePermission("INV_MANAGE_PO"), async (req, res) => {
  try {
    res.json(await invStorage.getPoReceipts(parseInt(req.params.id)));
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});
```

Reemplazarlas por:

```typescript
app.get("/api/inv/purchase-orders/:id/receipts", requirePermission("INV_MANAGE_PO"), async (req, res) => {
  try {
    const purchaseOrderId = parseInt(req.params.id);
    const receipts = await invStorage.getPoReceipts(purchaseOrderId);

    const result = await Promise.all(receipts.map(async (receipt) => {
      // Obtener nombre del receptor desde tabla users
      let receivedByName = "—";
      if (receipt.receivedByEmployeeId) {
        const receptor = await storage.getUser(receipt.receivedByEmployeeId);
        receivedByName = receptor?.displayName || receptor?.username || "—";
      }

      // Obtener líneas de la recepción con nombre del artículo y purchaseUom
      const rawLines = await invStorage.getPoReceiptLines(receipt.id);

      // getPoReceiptLines ya incluye invItemName pero NO incluye purchaseUom.
      // Necesitamos obtener purchaseUom desde inv_purchase_order_lines via poLineId.
      const linesWithUom = await Promise.all(rawLines.map(async (line) => {
        // Obtener purchaseUom de la línea de OC original
        const [poLine] = await db
          .select({ purchaseUom: invPurchaseOrderLines.purchaseUom })
          .from(invPurchaseOrderLines)
          .where(eq(invPurchaseOrderLines.id, line.poLineId));

        return {
          id: line.id,
          invItemName: line.invItemName,
          qtyPurchaseUomReceived: line.qtyPurchaseUomReceived,
          unitPricePerPurchaseUom: line.unitPricePerPurchaseUom,
          purchaseUom: poLine?.purchaseUom ?? "—",
          qtyBaseReceived: line.qtyBaseReceived,
        };
      }));

      return {
        id: receipt.id,
        receivedAt: receipt.receivedAt ?? receipt.createdAt,
        receivedByName,
        note: receipt.note ?? null,
        lines: linesWithUom,
      };
    }));

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});
```

Verificar que `invPurchaseOrderLines` esté importado en el archivo.
Buscar al inicio del archivo donde se importan las tablas del schema
(buscar `invPurchaseOrderLines`). Si no está en el import, agregarlo.
El import típico se ve así:
```typescript
import { invItems, invPurchaseOrders, invPurchaseOrderLines, ... } from "@shared/schema";
```

---

## T002 — Fix reportes de inventario

**Archivo:** `client/src/pages/inventory/reports.tsx`

**Problema:** Los campos del API tienen nombres distintos a los que
usa el frontend, y todos llegan como `string` en vez de `number`.

### Fix ValueTab

Localizar la interface (o type) que describe los items del reporte
de valor. Buscar campos como `onHand`, `avgCost`, `totalValue`.
Reemplazar la interface completa por:

```typescript
interface ValueItem {
  sku: string;
  name: string;
  category: string;
  baseUom: string;
  onHandQtyBase: string;
  avgCostPerBaseUom: string;
  totalValue: string;
}
```

En TODOS los lugares donde se acceda a estos campos, actualizar:
- `item.onHand` → `parseFloat(item.onHandQtyBase)`
- `item.avgCost` → `parseFloat(item.avgCostPerBaseUom)`
- `item.totalValue` (como número) → `parseFloat(item.totalValue)`

Para el total general (el `reduce` que suma todos los valores):
```typescript
// ANTES:
items.reduce((sum, item) => sum + item.totalValue, 0)

// DESPUÉS:
items.reduce((sum, item) => sum + parseFloat(item.totalValue), 0)
```

Para la función de formato de moneda `fmt()` — si existe, asegurarse
que acepte `string | number`:
```typescript
const fmt = (val: string | number) =>
  `₡${parseFloat(String(val)).toLocaleString("es-CR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
```

### Fix LowStockTab

Localizar la interface de items de bajo stock. Reemplazar por:

```typescript
interface LowStockItem {
  id: number;
  sku: string;
  name: string;
  category: string;
  baseUom: string;
  onHandQtyBase: string;
  reorderPointQtyBase: string;
  avgCostPerBaseUom: string;
}
```

En todos los usos, actualizar:
- `item.onHand` → `parseFloat(item.onHandQtyBase)`
- `item.reorderPoint` → `parseFloat(item.reorderPointQtyBase)`

Para el cálculo del déficit:
```typescript
const deficit = parseFloat(item.reorderPointQtyBase) - parseFloat(item.onHandQtyBase);
```

---

## VERIFICACIÓN

1. `npx tsc --noEmit` — sin errores TypeScript

2. **Reportes:** Navegar a `/inventory/reports` → ambas tabs muestran
   datos. Ninguna muestra pantalla en blanco. El total de valor suma
   correctamente en colones.

3. **Recepción — flujo completo:**
   - Ir a `/inventory/purchase-orders`
   - Abrir una OC con status `SENT` o `PARTIAL`
   - Verificar que el botón "Recibir" está visible
   - Hacer clic → se abre el dialog con las líneas y cantidades
     pre-llenadas
   - Ajustar cantidades si se desea → clic "Confirmar Recepción"
   - Toast "Recepción registrada" aparece
   - El status de la OC cambia a `PARTIAL` o `RECEIVED`
   - En `/inventory/items`, el `onHandQtyBase` del artículo recibido
     aumentó con la cantidad recibida

4. **Historial de recepciones:**
   - Abrir una OC que ya tenga recepciones previas
   - La sección "Historial de Recepciones" muestra: fecha, nombre del
     receptor, nota (si existe), y tabla de líneas con artículo,
     cantidad, UOM y precio
   - NO muestra errores ni campos vacíos en `receivedByName` o `purchaseUom`
