import { db } from "./db";
import { eq, and, desc, asc, sql, ne, inArray, gte, lte } from "drizzle-orm";
import { normalizeUom, toSmallUnit, getCalcBasisLabel, type AllowedUom } from "./uom-helpers";
import {
  invItems, invUomConversions, invMovements, invSuppliers, invSupplierItems,
  invPurchaseOrders, invPurchaseOrderLines, invPoReceipts, invPoReceiptLines,
  invPhysicalCounts, invPhysicalCountLines, invRecipes, invRecipeLines,
  invOrderItemConsumptions, invConversions, invConversionOutputs,
  invStockAp, invStockEp, productionBatches, productionBatchOutputs,
  products, auditEvents,
  type InsertInvItem, type InvItem,
  type InsertInvUomConversion, type InvUomConversion,
  type InsertInvMovement, type InvMovement,
  type InsertInvSupplier, type InvSupplier,
  type InsertInvSupplierItem, type InvSupplierItem,
  type InsertInvPurchaseOrder, type InvPurchaseOrder,
  type InsertInvPurchaseOrderLine, type InvPurchaseOrderLine,
  type InsertInvPoReceipt, type InvPoReceipt,
  type InsertInvPoReceiptLine, type InvPoReceiptLine,
  type InsertInvPhysicalCount, type InvPhysicalCount,
  type InsertInvPhysicalCountLine, type InvPhysicalCountLine,
  type InsertInvRecipe, type InvRecipe,
  type InsertInvRecipeLine, type InvRecipeLine,
  type InsertInvOrderItemConsumption, type InvOrderItemConsumption,
} from "@shared/schema";

function getBusinessDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
}

// ==================== INV ITEMS ====================

export async function getAllInvItems() {
  return db.select().from(invItems).orderBy(asc(invItems.name));
}

export async function getInvItem(id: number) {
  const [item] = await db.select().from(invItems).where(eq(invItems.id, id));
  return item;
}

export async function getInvItemBySku(sku: string) {
  const [item] = await db.select().from(invItems).where(eq(invItems.sku, sku)).limit(1);
  return item || null;
}

export async function createInvItem(data: InsertInvItem) {
  const [item] = await db.insert(invItems).values(data).returning();
  return item;
}

export async function updateInvItem(id: number, data: Partial<InsertInvItem>) {
  const [item] = await db.update(invItems).set({ ...data, updatedAt: new Date() }).where(eq(invItems.id, id)).returning();
  return item;
}

export async function deleteInvItem(id: number) {
  const [item] = await db.update(invItems).set({ isActive: false, updatedAt: new Date() }).where(eq(invItems.id, id)).returning();
  return item;
}

export async function hasInvItemRelations(id: number): Promise<boolean> {
  const checks = await Promise.all([
    db.select({ id: invMovements.id }).from(invMovements).where(eq(invMovements.invItemId, id)).limit(1),
    db.select({ id: invConversions.id }).from(invConversions).where(eq(invConversions.apItemId, id)).limit(1),
    db.select({ id: invConversionOutputs.id }).from(invConversionOutputs).where(eq(invConversionOutputs.epItemId, id)).limit(1),
    db.select({ id: invRecipeLines.id }).from(invRecipeLines).where(eq(invRecipeLines.invItemId, id)).limit(1),
    db.select({ id: invPurchaseOrderLines.id }).from(invPurchaseOrderLines).where(eq(invPurchaseOrderLines.invItemId, id)).limit(1),
    db.select({ id: invPhysicalCountLines.id }).from(invPhysicalCountLines).where(eq(invPhysicalCountLines.invItemId, id)).limit(1),
    db.select({ id: productionBatches.id }).from(productionBatches).where(eq(productionBatches.apItemId, id)).limit(1),
    db.select({ id: productionBatchOutputs.id }).from(productionBatchOutputs).where(eq(productionBatchOutputs.epItemId, id)).limit(1),
  ]);
  return checks.some(rows => rows.length > 0);
}

export async function hardDeleteInvItem(id: number) {
  await db.delete(invStockAp).where(eq(invStockAp.invItemId, id));
  await db.delete(invStockEp).where(eq(invStockEp.invItemId, id));
  await db.delete(invUomConversions).where(eq(invUomConversions.invItemId, id));
  await db.delete(invSupplierItems).where(eq(invSupplierItems.invItemId, id));
  const [item] = await db.delete(invItems).where(eq(invItems.id, id)).returning();
  return item;
}

export async function smartDeleteInvItem(id: number): Promise<{ item: InvItem; hardDeleted: boolean }> {
  const hasRelations = await hasInvItemRelations(id);
  if (hasRelations) {
    const item = await deleteInvItem(id);
    return { item, hardDeleted: false };
  } else {
    const item = await hardDeleteInvItem(id);
    return { item, hardDeleted: true };
  }
}

// ==================== UOM CONVERSIONS ====================

export async function getUomConversions(invItemId: number) {
  return db.select().from(invUomConversions).where(eq(invUomConversions.invItemId, invItemId));
}

export async function createUomConversion(data: InsertInvUomConversion) {
  const [conv] = await db.insert(invUomConversions).values(data).returning();
  return conv;
}

export async function updateUomConversion(id: number, data: Partial<InsertInvUomConversion>) {
  const [conv] = await db.update(invUomConversions).set(data).where(eq(invUomConversions.id, id)).returning();
  return conv;
}

export async function deleteUomConversion(id: number) {
  await db.delete(invUomConversions).where(eq(invUomConversions.id, id));
}

// ==================== INV MOVEMENTS (Kardex) ====================

export async function getInvMovements(invItemId: number, limit: number = 100) {
  return db.select().from(invMovements)
    .where(eq(invMovements.invItemId, invItemId))
    .orderBy(desc(invMovements.createdAt))
    .limit(limit);
}

export async function createInvMovement(data: InsertInvMovement) {
  const [movement] = await db.insert(invMovements).values({
    ...data,
    businessDate: data.businessDate || getBusinessDate(),
  }).returning();
  await db.update(invItems).set({
    onHandQtyBase: sql`${invItems.onHandQtyBase} + ${movement.qtyDeltaBase}`,
    updatedAt: new Date(),
  }).where(eq(invItems.id, movement.invItemId));
  return movement;
}

// ==================== WAC UPDATE ====================

export async function updateWACOnReceipt(invItemId: number, receivedQtyBase: string, unitCostPerBaseUom: string) {
  const currentItem = await getInvItem(invItemId);
  if (!currentItem) return;
  const oldQty = Number(currentItem.onHandQtyBase);
  const oldAvg = Number(currentItem.avgCostPerBaseUom);
  const newQty = Number(receivedQtyBase);
  const newCost = Number(unitCostPerBaseUom);
  const totalQty = oldQty + newQty;
  let newAvg: number;
  if (totalQty > 0) {
    newAvg = ((oldQty * oldAvg) + (newQty * newCost)) / totalQty;
  } else {
    newAvg = newCost;
  }
  await db.update(invItems).set({
    avgCostPerBaseUom: newAvg.toFixed(6),
    lastCostPerBaseUom: newCost.toFixed(6),
    updatedAt: new Date(),
  }).where(eq(invItems.id, invItemId));
}

// ==================== SUPPLIERS ====================

export async function getAllSuppliers() {
  return db.select().from(invSuppliers).orderBy(asc(invSuppliers.name));
}

export async function getSupplier(id: number) {
  const [supplier] = await db.select().from(invSuppliers).where(eq(invSuppliers.id, id));
  return supplier;
}

export async function createSupplier(data: InsertInvSupplier) {
  const [supplier] = await db.insert(invSuppliers).values(data).returning();
  return supplier;
}

export async function updateSupplier(id: number, data: Partial<InsertInvSupplier>) {
  const [supplier] = await db.update(invSuppliers).set(data).where(eq(invSuppliers.id, id)).returning();
  return supplier;
}

export async function deleteSupplier(id: number) {
  const [supplier] = await db.update(invSuppliers).set({ isActive: false }).where(eq(invSuppliers.id, id)).returning();
  return supplier;
}

// ==================== SUPPLIER ITEMS ====================

export async function getSupplierItems(supplierId: number) {
  return db.select({
    id: invSupplierItems.id,
    supplierId: invSupplierItems.supplierId,
    invItemId: invSupplierItems.invItemId,
    purchaseUom: invSupplierItems.purchaseUom,
    lastPricePerPurchaseUom: invSupplierItems.lastPricePerPurchaseUom,
    isPreferred: invSupplierItems.isPreferred,
    createdAt: invSupplierItems.createdAt,
    invItemName: invItems.name,
  }).from(invSupplierItems)
    .innerJoin(invItems, eq(invSupplierItems.invItemId, invItems.id))
    .where(eq(invSupplierItems.supplierId, supplierId));
}

export async function getSupplierItemsByInvItem(invItemId: number) {
  return db.select().from(invSupplierItems).where(eq(invSupplierItems.invItemId, invItemId));
}

export async function createSupplierItem(data: InsertInvSupplierItem) {
  const [item] = await db.insert(invSupplierItems).values(data).returning();
  return item;
}

export async function updateSupplierItem(id: number, data: Partial<InsertInvSupplierItem>) {
  const [item] = await db.update(invSupplierItems).set(data).where(eq(invSupplierItems.id, id)).returning();
  return item;
}

export async function deleteSupplierItem(id: number) {
  await db.delete(invSupplierItems).where(eq(invSupplierItems.id, id));
}

// ==================== PURCHASE ORDERS ====================

export async function getAllPurchaseOrders() {
  return db.select({
    id: invPurchaseOrders.id,
    supplierId: invPurchaseOrders.supplierId,
    status: invPurchaseOrders.status,
    createdByEmployeeId: invPurchaseOrders.createdByEmployeeId,
    sentAt: invPurchaseOrders.sentAt,
    expectedDeliveryDate: invPurchaseOrders.expectedDeliveryDate,
    notes: invPurchaseOrders.notes,
    createdAt: invPurchaseOrders.createdAt,
    updatedAt: invPurchaseOrders.updatedAt,
    supplierName: invSuppliers.name,
  }).from(invPurchaseOrders)
    .innerJoin(invSuppliers, eq(invPurchaseOrders.supplierId, invSuppliers.id))
    .orderBy(desc(invPurchaseOrders.createdAt));
}

export async function getPurchaseOrder(id: number) {
  const [po] = await db.select().from(invPurchaseOrders).where(eq(invPurchaseOrders.id, id));
  return po;
}

export async function createPurchaseOrder(data: InsertInvPurchaseOrder) {
  const [po] = await db.insert(invPurchaseOrders).values(data).returning();
  return po;
}

export async function updatePurchaseOrder(id: number, data: Partial<InsertInvPurchaseOrder>) {
  const po = await getPurchaseOrder(id);
  if (!po || po.status !== "DRAFT") return po;
  const [updated] = await db.update(invPurchaseOrders).set({ ...data, updatedAt: new Date() }).where(eq(invPurchaseOrders.id, id)).returning();
  return updated;
}

export async function sendPurchaseOrder(id: number) {
  const [po] = await db.update(invPurchaseOrders).set({ status: "SENT", sentAt: new Date(), updatedAt: new Date() }).where(eq(invPurchaseOrders.id, id)).returning();
  return po;
}

// ==================== PO LINES ====================

export async function getPurchaseOrderLines(purchaseOrderId: number) {
  return db.select({
    id: invPurchaseOrderLines.id,
    purchaseOrderId: invPurchaseOrderLines.purchaseOrderId,
    invItemId: invPurchaseOrderLines.invItemId,
    qtyPurchaseUom: invPurchaseOrderLines.qtyPurchaseUom,
    purchaseUom: invPurchaseOrderLines.purchaseUom,
    unitPricePerPurchaseUom: invPurchaseOrderLines.unitPricePerPurchaseUom,
    toBaseMultiplierSnapshot: invPurchaseOrderLines.toBaseMultiplierSnapshot,
    qtyBaseExpected: invPurchaseOrderLines.qtyBaseExpected,
    qtyBaseReceived: invPurchaseOrderLines.qtyBaseReceived,
    lineStatus: invPurchaseOrderLines.lineStatus,
    createdAt: invPurchaseOrderLines.createdAt,
    invItemName: invItems.name,
  }).from(invPurchaseOrderLines)
    .innerJoin(invItems, eq(invPurchaseOrderLines.invItemId, invItems.id))
    .where(eq(invPurchaseOrderLines.purchaseOrderId, purchaseOrderId));
}

export async function createPurchaseOrderLine(data: InsertInvPurchaseOrderLine) {
  const [line] = await db.insert(invPurchaseOrderLines).values(data).returning();
  return line;
}

export async function updatePurchaseOrderLine(id: number, data: Partial<InsertInvPurchaseOrderLine>) {
  const [line] = await db.update(invPurchaseOrderLines).set(data).where(eq(invPurchaseOrderLines.id, id)).returning();
  return line;
}

export async function deletePurchaseOrderLine(id: number) {
  await db.delete(invPurchaseOrderLines).where(eq(invPurchaseOrderLines.id, id));
}

// ==================== PO RECEIPTS ====================

export async function getPoReceipts(purchaseOrderId: number) {
  return db.select().from(invPoReceipts).where(eq(invPoReceipts.purchaseOrderId, purchaseOrderId));
}

export async function createPoReceipt(data: InsertInvPoReceipt) {
  const [receipt] = await db.insert(invPoReceipts).values(data).returning();
  return receipt;
}

export async function getPoReceiptLines(receiptId: number) {
  return db.select({
    id: invPoReceiptLines.id,
    receiptId: invPoReceiptLines.receiptId,
    poLineId: invPoReceiptLines.poLineId,
    qtyPurchaseUomReceived: invPoReceiptLines.qtyPurchaseUomReceived,
    qtyBaseReceived: invPoReceiptLines.qtyBaseReceived,
    unitPricePerPurchaseUom: invPoReceiptLines.unitPricePerPurchaseUom,
    unitCostPerBaseUom: invPoReceiptLines.unitCostPerBaseUom,
    createdAt: invPoReceiptLines.createdAt,
    invItemName: invItems.name,
  }).from(invPoReceiptLines)
    .innerJoin(invPurchaseOrderLines, eq(invPoReceiptLines.poLineId, invPurchaseOrderLines.id))
    .innerJoin(invItems, eq(invPurchaseOrderLines.invItemId, invItems.id))
    .where(eq(invPoReceiptLines.receiptId, receiptId));
}

// ==================== PO RECEIPT LINES ====================

export async function createPoReceiptLine(data: InsertInvPoReceiptLine) {
  const [line] = await db.insert(invPoReceiptLines).values(data).returning();
  await db.update(invPurchaseOrderLines).set({
    qtyBaseReceived: sql`${invPurchaseOrderLines.qtyBaseReceived} + ${data.qtyBaseReceived}`,
  }).where(eq(invPurchaseOrderLines.id, data.poLineId));
  return line;
}

// ==================== REORDER SUGGESTIONS ====================

export async function getReorderSuggestions() {
  const rows = await db.select({
    invItemId: invItems.id,
    itemName: invItems.name,
    itemSku: invItems.sku,
    baseUom: invItems.baseUom,
    reorderPointQtyBase: invItems.reorderPointQtyBase,
    stockQtyOnHand: invStockAp.qtyOnHand,
  }).from(invItems)
    .leftJoin(invStockAp, and(
      eq(invStockAp.invItemId, invItems.id),
      eq(invStockAp.organizationId, 1),
      eq(invStockAp.locationId, 1),
    ))
    .where(and(
      eq(invItems.isActive, true),
      eq(invItems.itemType, "AP"),
    ))
    .orderBy(asc(invItems.name));

  const suggestions = rows.filter(r => {
    const reorderPoint = Number(r.reorderPointQtyBase || "0");
    if (reorderPoint <= 0) return false;
    const onHand = Number(r.stockQtyOnHand || "0");
    return onHand < reorderPoint;
  });

  const result = [];
  for (const s of suggestions) {
    const supplierItems = await db.select({
      supplierId: invSupplierItems.supplierId,
      supplierName: invSuppliers.name,
      purchaseUom: invSupplierItems.purchaseUom,
      lastPrice: invSupplierItems.lastPricePerPurchaseUom,
      isPreferred: invSupplierItems.isPreferred,
    }).from(invSupplierItems)
      .innerJoin(invSuppliers, eq(invSupplierItems.supplierId, invSuppliers.id))
      .where(eq(invSupplierItems.invItemId, s.invItemId));

    const preferred = supplierItems.find(si => si.isPreferred) || supplierItems[0] || null;

    result.push({
      ...s,
      stockQtyOnHand: s.stockQtyOnHand || "0",
      deficit: (Number(s.reorderPointQtyBase) - Number(s.stockQtyOnHand || "0")).toFixed(4),
      preferredSupplier: preferred ? {
        supplierId: preferred.supplierId,
        supplierName: preferred.supplierName,
        purchaseUom: preferred.purchaseUom,
        lastPrice: preferred.lastPrice,
      } : null,
    });
  }

  return result;
}

// ==================== RECEIVE PO ====================

export async function receivePurchaseOrder(
  purchaseOrderId: number,
  receivedByEmployeeId: number,
  lines: Array<{ poLineId: number; qtyPurchaseUomReceived: string; unitPricePerPurchaseUom: string }>,
  note?: string
) {
  const { pool } = await import("./db");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const receiptRes = await client.query(
      `INSERT INTO inv_po_receipts (purchase_order_id, received_by_employee_id, note)
       VALUES ($1, $2, $3) RETURNING id`,
      [purchaseOrderId, receivedByEmployeeId, note || null]
    );
    const receiptId = receiptRes.rows[0].id;
    const businessDate = getBusinessDate();

    for (const line of lines) {
      const poLineRes = await client.query(
        `SELECT id, inv_item_id, to_base_multiplier_snapshot, qty_base_expected, qty_base_received FROM inv_purchase_order_lines WHERE id = $1`,
        [line.poLineId]
      );
      if (poLineRes.rows.length === 0) continue;
      const poLine = poLineRes.rows[0];

      const qtyBaseReceived = Number(line.qtyPurchaseUomReceived) * Number(poLine.to_base_multiplier_snapshot);
      const unitCostPerBaseUom = Number(line.unitPricePerPurchaseUom) / Number(poLine.to_base_multiplier_snapshot);

      await client.query(
        `INSERT INTO inv_po_receipt_lines (receipt_id, po_line_id, qty_purchase_uom_received, qty_base_received, unit_price_per_purchase_uom, unit_cost_per_base_uom)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [receiptId, line.poLineId, line.qtyPurchaseUomReceived, qtyBaseReceived.toFixed(4), line.unitPricePerPurchaseUom, unitCostPerBaseUom.toFixed(6)]
      );

      await client.query(
        `UPDATE inv_purchase_order_lines SET qty_base_received = qty_base_received + $1 WHERE id = $2`,
        [qtyBaseReceived.toFixed(4), line.poLineId]
      );

      await client.query(
        `INSERT INTO inv_stock_ap (inv_item_id, location_id, organization_id, qty_on_hand)
         VALUES ($1, 1, 1, 0) ON CONFLICT DO NOTHING`,
        [poLine.inv_item_id]
      );

      await client.query(
        `SELECT qty_on_hand FROM inv_stock_ap WHERE organization_id=1 AND location_id=1 AND inv_item_id=$1 FOR UPDATE`,
        [poLine.inv_item_id]
      );

      await client.query(
        `UPDATE inv_stock_ap SET qty_on_hand = qty_on_hand + $1, updated_at = NOW() WHERE organization_id=1 AND location_id=1 AND inv_item_id=$2`,
        [qtyBaseReceived.toFixed(4), poLine.inv_item_id]
      );

      await client.query(
        `INSERT INTO inv_movements (business_date, movement_type, inv_item_id, item_type, qty_delta_base, unit_cost_per_base_uom, reference_type, reference_id, created_by_employee_id)
         VALUES ($1, 'RECEIVE_AP', $2, 'AP', $3, $4, 'PO_RECEIPT', $5, $6)`,
        [businessDate, poLine.inv_item_id, qtyBaseReceived.toFixed(4), unitCostPerBaseUom.toFixed(6), String(receiptId), receivedByEmployeeId]
      );

      await db.update(invItems).set({
        onHandQtyBase: sql`${invItems.onHandQtyBase} + ${qtyBaseReceived.toFixed(4)}`,
        updatedAt: new Date(),
      }).where(eq(invItems.id, poLine.inv_item_id));

      await updateWACOnReceipt(poLine.inv_item_id, qtyBaseReceived.toFixed(4), unitCostPerBaseUom.toFixed(6));

      const updatedLineRes = await client.query(
        `SELECT qty_base_received, qty_base_expected FROM inv_purchase_order_lines WHERE id = $1`,
        [line.poLineId]
      );
      const updatedLine = updatedLineRes.rows[0];
      if (Number(updatedLine.qty_base_received) >= Number(updatedLine.qty_base_expected)) {
        await client.query(`UPDATE inv_purchase_order_lines SET line_status = 'RECEIVED' WHERE id = $1`, [line.poLineId]);
      } else {
        await client.query(`UPDATE inv_purchase_order_lines SET line_status = 'PARTIAL' WHERE id = $1`, [line.poLineId]);
      }
    }

    const allLinesRes = await client.query(
      `SELECT line_status FROM inv_purchase_order_lines WHERE purchase_order_id = $1`,
      [purchaseOrderId]
    );
    const allReceived = allLinesRes.rows.every((l: any) => l.line_status === "RECEIVED");
    if (allReceived) {
      await client.query(`UPDATE inv_purchase_orders SET status = 'RECEIVED', updated_at = NOW() WHERE id = $1`, [purchaseOrderId]);
    } else {
      await client.query(`UPDATE inv_purchase_orders SET status = 'PARTIAL', updated_at = NOW() WHERE id = $1`, [purchaseOrderId]);
    }

    await client.query("COMMIT");
    return { id: receiptId, purchaseOrderId, receivedByEmployeeId, note: note || null };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ==================== PHYSICAL COUNTS ====================

export async function getAllPhysicalCounts() {
  return db.select().from(invPhysicalCounts).orderBy(desc(invPhysicalCounts.createdAt));
}

export async function getPhysicalCount(id: number) {
  const [count] = await db.select().from(invPhysicalCounts).where(eq(invPhysicalCounts.id, id));
  return count;
}

export async function createPhysicalCount(data: InsertInvPhysicalCount) {
  const [count] = await db.insert(invPhysicalCounts).values(data).returning();

  let activeItems: InvItem[];
  const scope = data.scope || "ALL";
  if (scope === "CATEGORY" && data.categoryFilter) {
    activeItems = await db.select().from(invItems).where(and(eq(invItems.isActive, true), eq(invItems.category, data.categoryFilter)));
  } else if (scope === "AP") {
    activeItems = await db.select().from(invItems).where(and(eq(invItems.isActive, true), eq(invItems.itemType, "AP")));
  } else if (scope === "EP") {
    activeItems = await db.select().from(invItems).where(and(eq(invItems.isActive, true), eq(invItems.itemType, "EP")));
  } else {
    activeItems = await db.select().from(invItems).where(eq(invItems.isActive, true));
  }

  for (const item of activeItems) {
    let systemQty = item.onHandQtyBase;
    if (item.itemType === "AP") {
      const [stockRow] = await db.select().from(invStockAp)
        .where(and(eq(invStockAp.organizationId, 1), eq(invStockAp.locationId, 1), eq(invStockAp.invItemId, item.id)));
      if (stockRow) systemQty = stockRow.qtyOnHand;
    } else if (item.itemType === "EP") {
      const [stockRow] = await db.select().from(invStockEp)
        .where(and(eq(invStockEp.organizationId, 1), eq(invStockEp.locationId, 1), eq(invStockEp.invItemId, item.id)));
      if (stockRow) systemQty = stockRow.qtyOnHand;
    }
    await db.insert(invPhysicalCountLines).values({
      physicalCountId: count.id,
      invItemId: item.id,
      systemQtyBase: systemQty,
    });
  }

  return count;
}

export async function getPhysicalCountLines(physicalCountId: number) {
  return db.select({
    id: invPhysicalCountLines.id,
    physicalCountId: invPhysicalCountLines.physicalCountId,
    invItemId: invPhysicalCountLines.invItemId,
    systemQtyBase: invPhysicalCountLines.systemQtyBase,
    countedQtyBase: invPhysicalCountLines.countedQtyBase,
    deltaQtyBase: invPhysicalCountLines.deltaQtyBase,
    adjustmentReason: invPhysicalCountLines.adjustmentReason,
    createdAt: invPhysicalCountLines.createdAt,
    invItemName: invItems.name,
    baseUom: invItems.baseUom,
    itemType: invItems.itemType,
  }).from(invPhysicalCountLines)
    .innerJoin(invItems, eq(invPhysicalCountLines.invItemId, invItems.id))
    .where(eq(invPhysicalCountLines.physicalCountId, physicalCountId));
}

export async function updatePhysicalCountLine(id: number, data: { countedQtyBase: string; adjustmentReason?: string }) {
  const [existing] = await db.select().from(invPhysicalCountLines).where(eq(invPhysicalCountLines.id, id));
  if (!existing) return;
  const deltaQtyBase = (Number(data.countedQtyBase) - Number(existing.systemQtyBase)).toFixed(4);
  const [line] = await db.update(invPhysicalCountLines).set({
    countedQtyBase: data.countedQtyBase,
    deltaQtyBase,
    adjustmentReason: data.adjustmentReason,
  }).where(eq(invPhysicalCountLines.id, id)).returning();
  return line;
}

export async function finalizePhysicalCount(id: number, finalizedByEmployeeId: number) {
  const [count] = await db.update(invPhysicalCounts).set({
    status: "FINALIZED",
    finalizedAt: new Date(),
    finalizedByEmployeeId,
  }).where(eq(invPhysicalCounts.id, id)).returning();

  const linesWithType = await db.select({
    id: invPhysicalCountLines.id,
    invItemId: invPhysicalCountLines.invItemId,
    deltaQtyBase: invPhysicalCountLines.deltaQtyBase,
    countedQtyBase: invPhysicalCountLines.countedQtyBase,
    adjustmentReason: invPhysicalCountLines.adjustmentReason,
    itemType: invItems.itemType,
  }).from(invPhysicalCountLines)
    .innerJoin(invItems, eq(invPhysicalCountLines.invItemId, invItems.id))
    .where(eq(invPhysicalCountLines.physicalCountId, id));

  for (const line of linesWithType) {
    if (line.deltaQtyBase && Number(line.deltaQtyBase) !== 0) {
      const movementType = line.itemType === "EP" ? "ADJUST_EP" : "ADJUST_AP";
      await createInvMovement({
        businessDate: getBusinessDate(),
        movementType,
        invItemId: line.invItemId,
        itemType: line.itemType,
        qtyDeltaBase: line.deltaQtyBase,
        referenceType: "PHYSICAL_COUNT",
        referenceId: count.id.toString(),
        note: line.adjustmentReason,
        createdByEmployeeId: finalizedByEmployeeId,
      });

      if (line.itemType === "EP") {
        await db.execute(sql`INSERT INTO inv_stock_ep (inv_item_id, location_id, organization_id, qty_on_hand, updated_at)
          VALUES (${line.invItemId}, 1, 1, 0, NOW())
          ON CONFLICT DO NOTHING`);
        await db.update(invStockEp).set({
          qtyOnHand: sql`${invStockEp.qtyOnHand} + ${line.deltaQtyBase}`,
          updatedAt: new Date(),
        }).where(and(
          eq(invStockEp.organizationId, 1),
          eq(invStockEp.locationId, 1),
          eq(invStockEp.invItemId, line.invItemId),
        ));
      } else {
        await db.execute(sql`INSERT INTO inv_stock_ap (inv_item_id, location_id, organization_id, qty_on_hand, updated_at)
          VALUES (${line.invItemId}, 1, 1, 0, NOW())
          ON CONFLICT DO NOTHING`);
        await db.update(invStockAp).set({
          qtyOnHand: sql`${invStockAp.qtyOnHand} + ${line.deltaQtyBase}`,
          updatedAt: new Date(),
        }).where(and(
          eq(invStockAp.organizationId, 1),
          eq(invStockAp.locationId, 1),
          eq(invStockAp.invItemId, line.invItemId),
        ));
      }
    }
  }

  return count;
}

// ==================== RECIPES ====================

export async function getAllRecipesWithDetails() {
  const allRecipes = await db.select({
    id: invRecipes.id,
    menuProductId: invRecipes.menuProductId,
    version: invRecipes.version,
    isActive: invRecipes.isActive,
    yieldQty: invRecipes.yieldQty,
    note: invRecipes.note,
    createdAt: invRecipes.createdAt,
    productName: products.name,
    productCode: products.productCode,
  }).from(invRecipes)
    .innerJoin(products, eq(invRecipes.menuProductId, products.id))
    .orderBy(desc(invRecipes.createdAt));

  const recipeIds = allRecipes.map(r => r.id);
  let lineCounts: Record<number, number> = {};
  if (recipeIds.length > 0) {
    const counts = await db.select({
      recipeId: invRecipeLines.recipeId,
      count: sql<number>`count(*)::int`,
    }).from(invRecipeLines)
      .where(inArray(invRecipeLines.recipeId, recipeIds))
      .groupBy(invRecipeLines.recipeId);
    for (const c of counts) {
      lineCounts[c.recipeId] = c.count;
    }
  }

  return allRecipes.map(r => ({
    ...r,
    lineCount: lineCounts[r.id] || 0,
  }));
}

export async function getRecipesForProduct(menuProductId: number) {
  return db.select().from(invRecipes).where(eq(invRecipes.menuProductId, menuProductId));
}

export async function getActiveRecipe(menuProductId: number) {
  const [recipe] = await db.select().from(invRecipes)
    .where(and(eq(invRecipes.menuProductId, menuProductId), eq(invRecipes.isActive, true)))
    .orderBy(desc(invRecipes.version))
    .limit(1);
  return recipe;
}

export async function getActiveRecipeWithLines(menuProductId: number) {
  const recipe = await getActiveRecipe(menuProductId);
  if (!recipe) return null;
  const lines = await getRecipeLines(recipe.id);
  return { ...recipe, lines };
}

export async function getRecipe(id: number) {
  const [recipe] = await db.select().from(invRecipes).where(eq(invRecipes.id, id));
  return recipe;
}

export async function createRecipeWithLines(
  data: InsertInvRecipe,
  lines: Array<{ invItemId: number; itemType: string; qtyBasePerMenuUnit: string; wastePct: string }>
) {
  const existingActive = await db.select().from(invRecipes)
    .where(and(eq(invRecipes.menuProductId, data.menuProductId), eq(invRecipes.isActive, true)));
  
  let nextVersion = 1;
  if (existingActive.length > 0) {
    for (const old of existingActive) {
      await db.update(invRecipes).set({ isActive: false }).where(eq(invRecipes.id, old.id));
      nextVersion = Math.max(nextVersion, old.version + 1);
    }
  } else {
    const [latest] = await db.select().from(invRecipes)
      .where(eq(invRecipes.menuProductId, data.menuProductId))
      .orderBy(desc(invRecipes.version))
      .limit(1);
    if (latest) nextVersion = latest.version + 1;
  }

  const [recipe] = await db.insert(invRecipes).values({
    ...data,
    version: nextVersion,
    isActive: true,
  }).returning();

  for (const line of lines) {
    await db.insert(invRecipeLines).values({
      recipeId: recipe.id,
      invItemId: line.invItemId,
      itemType: line.itemType || "AP",
      qtyBasePerMenuUnit: line.qtyBasePerMenuUnit,
      wastePct: line.wastePct || "0",
    });
  }

  const recipeLines = await getRecipeLines(recipe.id);
  return { ...recipe, lines: recipeLines };
}

export async function createRecipe(data: InsertInvRecipe) {
  const [recipe] = await db.insert(invRecipes).values(data).returning();
  return recipe;
}

export async function updateRecipe(id: number, data: Partial<InsertInvRecipe>) {
  const [recipe] = await db.update(invRecipes).set(data).where(eq(invRecipes.id, id)).returning();
  return recipe;
}

export async function deactivateRecipe(id: number) {
  const [recipe] = await db.update(invRecipes).set({ isActive: false }).where(eq(invRecipes.id, id)).returning();
  return recipe;
}

export async function getRecipeLines(recipeId: number) {
  return db.select({
    id: invRecipeLines.id,
    recipeId: invRecipeLines.recipeId,
    invItemId: invRecipeLines.invItemId,
    itemType: invRecipeLines.itemType,
    qtyBasePerMenuUnit: invRecipeLines.qtyBasePerMenuUnit,
    wastePct: invRecipeLines.wastePct,
    createdAt: invRecipeLines.createdAt,
    invItemName: invItems.name,
    baseUom: invItems.baseUom,
    itemCost: invItems.lastCostPerBaseUom,
  }).from(invRecipeLines)
    .innerJoin(invItems, eq(invRecipeLines.invItemId, invItems.id))
    .where(eq(invRecipeLines.recipeId, recipeId));
}

export async function createRecipeLine(data: InsertInvRecipeLine) {
  const [line] = await db.insert(invRecipeLines).values(data).returning();
  return line;
}

export async function updateRecipeLine(id: number, data: Partial<InsertInvRecipeLine>) {
  const [line] = await db.update(invRecipeLines).set(data).where(eq(invRecipeLines.id, id)).returning();
  return line;
}

export async function deleteRecipeLine(id: number) {
  await db.delete(invRecipeLines).where(eq(invRecipeLines.id, id));
}

// ==================== CONVERSIONS (AP→EP) ====================

function enrichConversionWithCosts(
  conv: any,
  apItem: { name: string; sku: string; baseUom: string; lastCostPerBaseUom: string; unitWeightG: string | null },
  rawOutputs: any[],
) {
  const mermaPct = Number(conv.mermaPct) || 0;
  const cookFactor = Number(conv.cookFactor) || 1;
  const extraLossPct = Number(conv.extraLossPct) || 0;
  const apCostPerBaseUom = Number(apItem.lastCostPerBaseUom) || 0;

  let apNormUom: AllowedUom | null = null;
  let apUomValid = true;
  try {
    apNormUom = normalizeUom(apItem.baseUom);
  } catch {
    apUomValid = false;
  }

  const usableQtyBase = 1 * (1 - mermaPct / 100) * cookFactor * (1 - extraLossPct / 100);
  const apCalcBasisLabel = apUomValid && apNormUom ? getCalcBasisLabel(apNormUom) : `por 1 ${apItem.baseUom}`;

  let defaultUsableQtySmall = usableQtyBase;
  let defaultSmallUom = apNormUom || apItem.baseUom;
  if (apUomValid && apNormUom) {
    const converted = toSmallUnit(usableQtyBase, apNormUom);
    defaultUsableQtySmall = converted.qty;
    defaultSmallUom = converted.smallUom;
  }

  const hasNullPctInMultiOutput = rawOutputs.length > 1 && rawOutputs.some(o => o.outputPct == null || o.outputPct === "");
  let convCostWarning: string | null = null;
  if (hasNullPctInMultiOutput) {
    convCostWarning = "Falta % de salida en una o más salidas";
  }

  const enrichedOutputs = rawOutputs.map((out) => {
    const portionSize = out.portionSize != null ? Number(out.portionSize) : null;

    let epNormUom: AllowedUom | null = null;
    let epUomValid = true;
    try {
      epNormUom = normalizeUom(out.epBaseUom || "");
    } catch {
      epUomValid = false;
    }

    if (!apUomValid) {
      return { ...out, epUnitCost: null, portionCost: null, epBaseUom: out.epBaseUom, epQtySmall: null, smallUom: defaultSmallUom, costWarning: "UOM inválida (AP)" };
    }
    if (!epUomValid) {
      return { ...out, epUnitCost: null, portionCost: null, epBaseUom: out.epBaseUom, epQtySmall: null, smallUom: defaultSmallUom, costWarning: "UOM inválida (EP)" };
    }
    if (convCostWarning) {
      return { ...out, epUnitCost: null, portionCost: null, epBaseUom: out.epBaseUom, epQtySmall: null, smallUom: defaultSmallUom, costWarning: convCostWarning };
    }

    let effectiveOutputPct: number;
    if (rawOutputs.length === 1 && (out.outputPct == null || out.outputPct === "")) {
      effectiveOutputPct = 100;
    } else {
      effectiveOutputPct = Number(out.outputPct) || 0;
    }

    let usableQtySmall = defaultUsableQtySmall;
    let smallUom = defaultSmallUom;
    let costWarning: string | null = null;

    if (apNormUom === 'UNIT' && epNormUom && ['G', 'KG'].includes(epNormUom)) {
      const unitWeight = Number(apItem.unitWeightG) || 0;
      if (unitWeight > 0) {
        usableQtySmall = usableQtyBase * unitWeight;
        smallUom = 'G';
      } else {
        return { ...out, epUnitCost: null, portionCost: null, epBaseUom: out.epBaseUom, epQtySmall: null, smallUom: 'G', costWarning: "Falta peso promedio por unidad" };
      }
    } else if (apNormUom === 'UNIT' && epNormUom && ['ML', 'L'].includes(epNormUom)) {
      return { ...out, epUnitCost: null, portionCost: null, epBaseUom: out.epBaseUom, epQtySmall: null, smallUom: 'ML', costWarning: "Falta equivalencia por unidad" };
    }

    const epQtySmall = usableQtySmall * (effectiveOutputPct / 100);
    if (epQtySmall <= 0) {
      return { ...out, epUnitCost: null, portionCost: null, epBaseUom: out.epBaseUom, epQtySmall: 0, smallUom, costWarning: costWarning || "Rendimiento cero" };
    }
    if (apCostPerBaseUom <= 0) {
      return { ...out, epUnitCost: null, portionCost: null, epBaseUom: out.epBaseUom, epQtySmall, smallUom, costWarning: "Falta costo AP" };
    }

    const epUnitCost = apCostPerBaseUom / epQtySmall;

    let portionCost: number | null = null;
    if (epNormUom === 'PORTION') {
      portionCost = null;
    } else if (epNormUom && ['G', 'ML', 'UNIT'].includes(epNormUom) && portionSize && portionSize > 0) {
      portionCost = epUnitCost * portionSize;
    }

    return {
      ...out,
      epUnitCost: Math.round(epUnitCost * 100) / 100,
      portionCost: portionCost != null ? Math.round(portionCost * 100) / 100 : null,
      epBaseUom: out.epBaseUom,
      epQtySmall: Math.round(epQtySmall * 100) / 100,
      smallUom,
      costWarning,
    };
  });

  return {
    ...conv,
    apItemName: apItem.name,
    apItemSku: apItem.sku,
    apBaseUom: apItem.baseUom,
    apCostPerBaseUom: apCostPerBaseUom || null,
    usableQtyBase: Math.round(usableQtyBase * 10000) / 10000,
    usableQtySmall: Math.round(defaultUsableQtySmall * 100) / 100,
    smallUom: defaultSmallUom,
    apCalcBasisLabel,
    convCostWarning,
    outputs: enrichedOutputs,
  };
}

export async function getAllConversions() {
  const convs = await db.select().from(invConversions).orderBy(desc(invConversions.createdAt));
  const results = [];
  for (const conv of convs) {
    const outputs = await db.select({
      id: invConversionOutputs.id,
      conversionId: invConversionOutputs.conversionId,
      epItemId: invConversionOutputs.epItemId,
      outputPct: invConversionOutputs.outputPct,
      portionSize: invConversionOutputs.portionSize,
      label: invConversionOutputs.label,
      createdAt: invConversionOutputs.createdAt,
      epItemName: invItems.name,
      epItemSku: invItems.sku,
      epBaseUom: invItems.baseUom,
    }).from(invConversionOutputs)
      .innerJoin(invItems, eq(invConversionOutputs.epItemId, invItems.id))
      .where(eq(invConversionOutputs.conversionId, conv.id));
    const [apItem] = await db.select({
      name: invItems.name,
      sku: invItems.sku,
      baseUom: invItems.baseUom,
      lastCostPerBaseUom: invItems.lastCostPerBaseUom,
      unitWeightG: invItems.unitWeightG,
    }).from(invItems).where(eq(invItems.id, conv.apItemId));
    if (!apItem) {
      results.push({ ...conv, apItemName: "", apItemSku: "", outputs });
      continue;
    }
    results.push(enrichConversionWithCosts(conv, apItem, outputs));
  }
  return results;
}

export async function getConversion(id: number) {
  const [conv] = await db.select().from(invConversions).where(eq(invConversions.id, id));
  if (!conv) return null;
  const outputs = await db.select({
    id: invConversionOutputs.id,
    conversionId: invConversionOutputs.conversionId,
    epItemId: invConversionOutputs.epItemId,
    outputPct: invConversionOutputs.outputPct,
    portionSize: invConversionOutputs.portionSize,
    label: invConversionOutputs.label,
    createdAt: invConversionOutputs.createdAt,
    epItemName: invItems.name,
    epBaseUom: invItems.baseUom,
  }).from(invConversionOutputs)
    .innerJoin(invItems, eq(invConversionOutputs.epItemId, invItems.id))
    .where(eq(invConversionOutputs.conversionId, conv.id));
  const [apItem] = await db.select({
    name: invItems.name,
    sku: invItems.sku,
    baseUom: invItems.baseUom,
    lastCostPerBaseUom: invItems.lastCostPerBaseUom,
    unitWeightG: invItems.unitWeightG,
  }).from(invItems).where(eq(invItems.id, conv.apItemId));
  if (!apItem) return { ...conv, apItemName: "", outputs };
  return enrichConversionWithCosts(conv, { ...apItem, sku: apItem.sku || "" }, outputs);
}

export async function createConversion(data: {
  apItemId: number;
  name: string;
  mermaPct: string;
  cookFactor: string;
  extraLossPct: string;
  notes?: string | null;
  outputs: Array<{ epItemId: number; outputPct: string; portionSize?: string | null; label?: string | null }>;
}) {
  const { outputs, ...header } = data;
  const [conv] = await db.insert(invConversions).values({
    ...header,
    organizationId: 1,
  }).returning();

  for (const out of outputs) {
    await db.insert(invConversionOutputs).values({
      conversionId: conv.id,
      epItemId: out.epItemId,
      outputPct: out.outputPct || "100",
      portionSize: out.portionSize || null,
      label: out.label || null,
    });
  }

  return getConversion(conv.id);
}

export async function updateConversion(id: number, data: {
  name?: string;
  mermaPct?: string;
  cookFactor?: string;
  extraLossPct?: string;
  notes?: string | null;
  outputs?: Array<{ epItemId: number; outputPct: string; portionSize?: string | null; label?: string | null }>;
}) {
  const { outputs, ...header } = data;
  const [conv] = await db.update(invConversions).set(header).where(eq(invConversions.id, id)).returning();
  if (!conv) return null;

  if (outputs !== undefined) {
    await db.delete(invConversionOutputs).where(eq(invConversionOutputs.conversionId, id));
    for (const out of outputs) {
      await db.insert(invConversionOutputs).values({
        conversionId: id,
        epItemId: out.epItemId,
        outputPct: out.outputPct || "100",
        portionSize: out.portionSize || null,
        label: out.label || null,
      });
    }
  }

  return getConversion(id);
}

export async function deactivateConversion(id: number) {
  const [conv] = await db.update(invConversions).set({ isActive: false }).where(eq(invConversions.id, id)).returning();
  return conv;
}

// ==================== STOCK AP/EP ====================

export async function getStockAp() {
  return db.select({
    id: invStockAp.id,
    invItemId: invStockAp.invItemId,
    locationId: invStockAp.locationId,
    organizationId: invStockAp.organizationId,
    qtyOnHand: invStockAp.qtyOnHand,
    updatedAt: invStockAp.updatedAt,
    itemName: invItems.name,
    itemSku: invItems.sku,
    baseUom: invItems.baseUom,
  }).from(invStockAp)
    .innerJoin(invItems, eq(invStockAp.invItemId, invItems.id))
    .where(and(eq(invStockAp.organizationId, 1), eq(invStockAp.locationId, 1)))
    .orderBy(asc(invItems.name));
}

export async function getStockEp() {
  return db.select({
    id: invStockEp.id,
    invItemId: invStockEp.invItemId,
    locationId: invStockEp.locationId,
    organizationId: invStockEp.organizationId,
    qtyOnHand: invStockEp.qtyOnHand,
    updatedAt: invStockEp.updatedAt,
    itemName: invItems.name,
    itemSku: invItems.sku,
    baseUom: invItems.baseUom,
  }).from(invStockEp)
    .innerJoin(invItems, eq(invStockEp.invItemId, invItems.id))
    .where(and(eq(invStockEp.organizationId, 1), eq(invStockEp.locationId, 1)))
    .orderBy(asc(invItems.name));
}

export async function getAllProductionBatches() {
  const batches = await db.select({
    id: productionBatches.id,
    conversionId: productionBatches.conversionId,
    apItemId: productionBatches.apItemId,
    apQtyUsed: productionBatches.apQtyUsed,
    locationId: productionBatches.locationId,
    organizationId: productionBatches.organizationId,
    status: productionBatches.status,
    createdByUserId: productionBatches.createdByUserId,
    createdAt: productionBatches.createdAt,
    conversionName: invConversions.name,
    apItemName: invItems.name,
  }).from(productionBatches)
    .innerJoin(invConversions, eq(productionBatches.conversionId, invConversions.id))
    .innerJoin(invItems, eq(productionBatches.apItemId, invItems.id))
    .orderBy(desc(productionBatches.createdAt));

  const results = [];
  for (const batch of batches) {
    const outputs = await db.select({
      id: productionBatchOutputs.id,
      batchId: productionBatchOutputs.batchId,
      epItemId: productionBatchOutputs.epItemId,
      qtyEpGenerated: productionBatchOutputs.qtyEpGenerated,
      createdAt: productionBatchOutputs.createdAt,
      epItemName: invItems.name,
    }).from(productionBatchOutputs)
      .innerJoin(invItems, eq(productionBatchOutputs.epItemId, invItems.id))
      .where(eq(productionBatchOutputs.batchId, batch.id));
    results.push({ ...batch, outputs });
  }
  return results;
}

// ==================== CONSUMPTION & REVERSAL ====================

export async function consumeForOrderItem(orderItemId: number, menuProductId: number, quantity: number, employeeId: number) {
  const [existing] = await db.select().from(invOrderItemConsumptions)
    .where(and(eq(invOrderItemConsumptions.orderItemId, orderItemId), eq(invOrderItemConsumptions.status, "CONSUMED")));
  if (existing) return;

  const recipe = await getActiveRecipe(menuProductId);
  if (!recipe) return;

  const lines = await db.select().from(invRecipeLines).where(eq(invRecipeLines.recipeId, recipe.id));

  for (const line of lines) {
    const qtyToConsume = Number(line.qtyBasePerMenuUnit) * quantity * (1 + Number(line.wastePct) / 100) / Number(recipe.yieldQty);
    await createInvMovement({
      businessDate: getBusinessDate(),
      movementType: "CONSUMPTION",
      invItemId: line.invItemId,
      qtyDeltaBase: (-qtyToConsume).toFixed(4),
      referenceType: "ORDER_ITEM",
      referenceId: orderItemId.toString(),
      createdByEmployeeId: employeeId,
    });
  }

  await db.insert(invOrderItemConsumptions).values({
    orderItemId,
    recipeId: recipe.id,
    status: "CONSUMED",
  });
}

export async function reverseConsumptionForOrderItem(orderItemId: number, employeeId: number) {
  const [consumption] = await db.select().from(invOrderItemConsumptions)
    .where(and(eq(invOrderItemConsumptions.orderItemId, orderItemId), eq(invOrderItemConsumptions.status, "CONSUMED")));
  if (!consumption) return;

  const movements = await db.select().from(invMovements)
    .where(and(
      eq(invMovements.referenceType, "ORDER_ITEM"),
      eq(invMovements.referenceId, orderItemId.toString()),
      eq(invMovements.movementType, "CONSUMPTION"),
    ));

  for (const movement of movements) {
    await createInvMovement({
      businessDate: getBusinessDate(),
      movementType: "REVERSAL",
      invItemId: movement.invItemId,
      qtyDeltaBase: (-(Number(movement.qtyDeltaBase))).toFixed(4),
      referenceType: "ORDER_ITEM",
      referenceId: orderItemId.toString(),
      createdByEmployeeId: employeeId,
    });
  }

  await db.update(invOrderItemConsumptions).set({
    status: "REVERSED",
    reversedAt: new Date(),
  }).where(eq(invOrderItemConsumptions.id, consumption.id));
}

// ==================== PRODUCT INVENTORY TOGGLE ====================

export async function toggleProductInventoryControl(productId: number, enabled: boolean) {
  const [product] = await db.update(products).set({ inventoryControlEnabled: enabled }).where(eq(products.id, productId)).returning();
  return product;
}

// ==================== INVENTORY VALUE REPORT ====================

export async function getInventoryValueReport() {
  return db.select({
    id: invItems.id,
    sku: invItems.sku,
    name: invItems.name,
    category: invItems.category,
    onHandQtyBase: invItems.onHandQtyBase,
    avgCostPerBaseUom: invItems.avgCostPerBaseUom,
    totalValue: sql<string>`(${invItems.onHandQtyBase} * ${invItems.avgCostPerBaseUom})::numeric(12,2)`,
    baseUom: invItems.baseUom,
  }).from(invItems)
    .where(eq(invItems.isActive, true))
    .orderBy(asc(invItems.category), asc(invItems.name));
}
