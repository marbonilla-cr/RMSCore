import { db } from "./db";
import { eq, and, desc, asc, sql, ne, inArray, gte, lte } from "drizzle-orm";
import {
  invItems, invUomConversions, invMovements, invSuppliers, invSupplierItems,
  invPurchaseOrders, invPurchaseOrderLines, invPoReceipts, invPoReceiptLines,
  invPhysicalCounts, invPhysicalCountLines, invRecipes, invRecipeLines,
  invOrderItemConsumptions, products, auditEvents,
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

// ==================== RECEIVE PO ====================

export async function receivePurchaseOrder(
  purchaseOrderId: number,
  receivedByEmployeeId: number,
  lines: Array<{ poLineId: number; qtyPurchaseUomReceived: string; unitPricePerPurchaseUom: string }>,
  note?: string
) {
  const receipt = await createPoReceipt({ purchaseOrderId, receivedByEmployeeId, note: note || null });

  for (const line of lines) {
    const [poLine] = await db.select().from(invPurchaseOrderLines).where(eq(invPurchaseOrderLines.id, line.poLineId));
    if (!poLine) continue;

    const qtyBaseReceived = Number(line.qtyPurchaseUomReceived) * Number(poLine.toBaseMultiplierSnapshot);
    const unitCostPerBaseUom = Number(line.unitPricePerPurchaseUom) / Number(poLine.toBaseMultiplierSnapshot);

    await createPoReceiptLine({
      receiptId: receipt.id,
      poLineId: line.poLineId,
      qtyPurchaseUomReceived: line.qtyPurchaseUomReceived,
      qtyBaseReceived: qtyBaseReceived.toFixed(4),
      unitPricePerPurchaseUom: line.unitPricePerPurchaseUom,
      unitCostPerBaseUom: unitCostPerBaseUom.toFixed(6),
    });

    await createInvMovement({
      businessDate: getBusinessDate(),
      movementType: "RECEIPT",
      invItemId: poLine.invItemId,
      qtyDeltaBase: qtyBaseReceived.toFixed(4),
      unitCostPerBaseUom: unitCostPerBaseUom.toFixed(6),
      referenceType: "PO_RECEIPT",
      referenceId: receipt.id.toString(),
      createdByEmployeeId: receivedByEmployeeId,
    });

    await updateWACOnReceipt(poLine.invItemId, qtyBaseReceived.toFixed(4), unitCostPerBaseUom.toFixed(6));

    const [updatedPoLine] = await db.select().from(invPurchaseOrderLines).where(eq(invPurchaseOrderLines.id, line.poLineId));
    if (Number(updatedPoLine.qtyBaseReceived) >= Number(updatedPoLine.qtyBaseExpected)) {
      await db.update(invPurchaseOrderLines).set({ lineStatus: "RECEIVED" }).where(eq(invPurchaseOrderLines.id, line.poLineId));
    } else {
      await db.update(invPurchaseOrderLines).set({ lineStatus: "PARTIAL" }).where(eq(invPurchaseOrderLines.id, line.poLineId));
    }
  }

  const allLines = await db.select().from(invPurchaseOrderLines).where(eq(invPurchaseOrderLines.purchaseOrderId, purchaseOrderId));
  const allReceived = allLines.every(l => l.lineStatus === "RECEIVED");
  if (allReceived) {
    await db.update(invPurchaseOrders).set({ status: "RECEIVED", updatedAt: new Date() }).where(eq(invPurchaseOrders.id, purchaseOrderId));
  } else {
    await db.update(invPurchaseOrders).set({ status: "PARTIAL", updatedAt: new Date() }).where(eq(invPurchaseOrders.id, purchaseOrderId));
  }

  return receipt;
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
  if (data.scope === "CATEGORY" && data.categoryFilter) {
    activeItems = await db.select().from(invItems).where(and(eq(invItems.isActive, true), eq(invItems.category, data.categoryFilter)));
  } else {
    activeItems = await db.select().from(invItems).where(eq(invItems.isActive, true));
  }

  for (const item of activeItems) {
    await db.insert(invPhysicalCountLines).values({
      physicalCountId: count.id,
      invItemId: item.id,
      systemQtyBase: item.onHandQtyBase,
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

  const lines = await db.select().from(invPhysicalCountLines).where(eq(invPhysicalCountLines.physicalCountId, id));
  for (const line of lines) {
    if (line.deltaQtyBase && Number(line.deltaQtyBase) !== 0) {
      await createInvMovement({
        businessDate: getBusinessDate(),
        movementType: "ADJUSTMENT",
        invItemId: line.invItemId,
        qtyDeltaBase: line.deltaQtyBase,
        referenceType: "PHYSICAL_COUNT",
        referenceId: count.id.toString(),
        note: line.adjustmentReason,
        createdByEmployeeId: finalizedByEmployeeId,
      });
    }
  }

  return count;
}

// ==================== RECIPES ====================

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

export async function getRecipe(id: number) {
  const [recipe] = await db.select().from(invRecipes).where(eq(invRecipes.id, id));
  return recipe;
}

export async function createRecipe(data: InsertInvRecipe) {
  const [recipe] = await db.insert(invRecipes).values(data).returning();
  return recipe;
}

export async function updateRecipe(id: number, data: Partial<InsertInvRecipe>) {
  const [recipe] = await db.update(invRecipes).set(data).where(eq(invRecipes.id, id)).returning();
  return recipe;
}

export async function getRecipeLines(recipeId: number) {
  return db.select({
    id: invRecipeLines.id,
    recipeId: invRecipeLines.recipeId,
    invItemId: invRecipeLines.invItemId,
    qtyBasePerMenuUnit: invRecipeLines.qtyBasePerMenuUnit,
    wastePct: invRecipeLines.wastePct,
    createdAt: invRecipeLines.createdAt,
    invItemName: invItems.name,
    baseUom: invItems.baseUom,
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
