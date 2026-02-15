import { db } from "./db";
import { eq, and, or, desc, asc, sql, inArray } from "drizzle-orm";
import { invShortages, invShortageEvents, invAuditAlerts, invItems, products, users } from "@shared/schema";
import type { InvShortage, InvShortageEvent, InvAuditAlert } from "@shared/schema";

// ==================== REPORT SHORTAGE ====================

export async function reportShortage(data: {
  entityType: "INV_ITEM" | "MENU_PRODUCT";
  invItemId?: number;
  menuProductId?: number;
  reportedByEmployeeId: number;
  notes?: string;
  severityReport: "LOW_STOCK" | "NO_STOCK";
}) {
  const conditions = [
    eq(invShortages.entityType, data.entityType),
    inArray(invShortages.status, ["OPEN", "ACKNOWLEDGED"]),
  ];
  if (data.entityType === "INV_ITEM" && data.invItemId) {
    conditions.push(eq(invShortages.invItemId, data.invItemId));
  } else if (data.entityType === "MENU_PRODUCT" && data.menuProductId) {
    conditions.push(eq(invShortages.menuProductId, data.menuProductId));
  }

  const [existing] = await db.select().from(invShortages).where(and(...conditions));

  if (existing) {
    const [updated] = await db.update(invShortages).set({
      reportCount: sql`${invShortages.reportCount} + 1`,
      lastReportedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(invShortages.id, existing.id)).returning();

    await db.insert(invShortageEvents).values({
      shortageId: existing.id,
      eventType: "REPORTED",
      employeeId: data.reportedByEmployeeId,
      message: data.notes || null,
    });

    return { shortage: updated, isNew: false, auditCreated: false };
  }

  let systemOnHandQtyBaseSnapshot: string | null = null;
  let systemAvgCostSnapshot: string | null = null;
  let suggestedPurchaseQtyBase: string | null = null;
  let auditFlag = false;
  let auditReason: string | null = null;
  let auditStatus = "NONE";
  let auditCreated = false;

  if (data.entityType === "INV_ITEM" && data.invItemId) {
    const [item] = await db.select().from(invItems).where(eq(invItems.id, data.invItemId));
    if (item) {
      const onHand = parseFloat(item.onHandQtyBase);
      const avgCost = parseFloat(item.avgCostPerBaseUom);
      const parLevel = parseFloat(item.parLevelQtyBase);
      const reorderPoint = parseFloat(item.reorderPointQtyBase);

      systemOnHandQtyBaseSnapshot = item.onHandQtyBase;
      systemAvgCostSnapshot = item.avgCostPerBaseUom;

      if (parLevel > 0) {
        suggestedPurchaseQtyBase = Math.max(0, parLevel - onHand).toFixed(4);
      } else if (reorderPoint > 0) {
        suggestedPurchaseQtyBase = Math.max(0, reorderPoint - onHand).toFixed(4);
      }

      if (data.severityReport === "NO_STOCK" && onHand > 0.01) {
        auditFlag = true;
        auditReason = "REPORTED_ZERO_BUT_SYSTEM_POSITIVE";
        auditStatus = "OPEN";
      }
    }
  }

  const [shortage] = await db.insert(invShortages).values({
    entityType: data.entityType,
    invItemId: data.invItemId || null,
    menuProductId: data.menuProductId || null,
    status: "OPEN",
    priority: "HIGH",
    severityReport: data.severityReport,
    reportedByEmployeeId: data.reportedByEmployeeId,
    notes: data.notes || null,
    reportCount: 1,
    suggestedPurchaseQtyBase,
    systemOnHandQtyBaseSnapshot,
    systemAvgCostSnapshot,
    auditFlag,
    auditReason,
    auditStatus,
  }).returning();

  await db.insert(invShortageEvents).values({
    shortageId: shortage.id,
    eventType: "REPORTED",
    employeeId: data.reportedByEmployeeId,
    message: data.notes || null,
  });

  if (auditFlag && data.invItemId) {
    const [item] = await db.select().from(invItems).where(eq(invItems.id, data.invItemId));
    const itemName = item?.name || `Item #${data.invItemId}`;
    await db.insert(invAuditAlerts).values({
      alertType: "SHORTAGE_DISCREPANCY",
      severity: "HIGH",
      invItemId: data.invItemId,
      shortageId: shortage.id,
      message: `Discrepancy: "${itemName}" reported as NO_STOCK but system shows ${systemOnHandQtyBaseSnapshot} on hand`,
      status: "OPEN",
      createdByEmployeeId: data.reportedByEmployeeId,
    });
    auditCreated = true;
  }

  return { shortage, isNew: true, auditCreated };
}

// ==================== GET SHORTAGES ====================

export async function getActiveShortages() {
  return db.select({
    id: invShortages.id,
    entityType: invShortages.entityType,
    invItemId: invShortages.invItemId,
    menuProductId: invShortages.menuProductId,
    status: invShortages.status,
    priority: invShortages.priority,
    severityReport: invShortages.severityReport,
    reportedByEmployeeId: invShortages.reportedByEmployeeId,
    reportedAt: invShortages.reportedAt,
    notes: invShortages.notes,
    reportCount: invShortages.reportCount,
    lastReportedAt: invShortages.lastReportedAt,
    suggestedPurchaseQtyBase: invShortages.suggestedPurchaseQtyBase,
    systemOnHandQtyBaseSnapshot: invShortages.systemOnHandQtyBaseSnapshot,
    systemAvgCostSnapshot: invShortages.systemAvgCostSnapshot,
    auditFlag: invShortages.auditFlag,
    auditReason: invShortages.auditReason,
    auditStatus: invShortages.auditStatus,
    auditOwnerEmployeeId: invShortages.auditOwnerEmployeeId,
    auditNotes: invShortages.auditNotes,
    acknowledgedByEmployeeId: invShortages.acknowledgedByEmployeeId,
    acknowledgedAt: invShortages.acknowledgedAt,
    resolvedByEmployeeId: invShortages.resolvedByEmployeeId,
    resolvedAt: invShortages.resolvedAt,
    closedByEmployeeId: invShortages.closedByEmployeeId,
    closedAt: invShortages.closedAt,
    createdAt: invShortages.createdAt,
    updatedAt: invShortages.updatedAt,
    reportedByName: users.displayName,
  }).from(invShortages)
    .leftJoin(users, eq(invShortages.reportedByEmployeeId, users.id))
    .where(inArray(invShortages.status, ["OPEN", "ACKNOWLEDGED"]))
    .orderBy(desc(invShortages.priority), desc(invShortages.createdAt));
}

export async function getAllShortages(status?: string) {
  if (status) {
    return db.select().from(invShortages)
      .where(eq(invShortages.status, status))
      .orderBy(desc(invShortages.createdAt));
  }
  return db.select().from(invShortages).orderBy(desc(invShortages.createdAt));
}

export async function getShortageById(id: number) {
  const [shortage] = await db.select().from(invShortages).where(eq(invShortages.id, id));
  return shortage;
}

// ==================== SHORTAGE EVENTS ====================

export async function getShortageEvents(shortageId: number) {
  return db.select().from(invShortageEvents)
    .where(eq(invShortageEvents.shortageId, shortageId))
    .orderBy(desc(invShortageEvents.eventAt));
}

// ==================== SHORTAGE STATE TRANSITIONS ====================

export async function acknowledgeShortage(id: number, employeeId: number, message?: string) {
  const [updated] = await db.update(invShortages).set({
    status: "ACKNOWLEDGED",
    acknowledgedByEmployeeId: employeeId,
    acknowledgedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(invShortages.id, id)).returning();

  await db.insert(invShortageEvents).values({
    shortageId: id,
    eventType: "ACKNOWLEDGED",
    employeeId,
    message: message || null,
  });

  return updated;
}

export async function resolveShortage(id: number, employeeId: number, message?: string) {
  const [updated] = await db.update(invShortages).set({
    status: "RESOLVED",
    resolvedByEmployeeId: employeeId,
    resolvedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(invShortages.id, id)).returning();

  await db.insert(invShortageEvents).values({
    shortageId: id,
    eventType: "RESOLVED",
    employeeId,
    message: message || null,
  });

  return updated;
}

export async function closeShortage(id: number, employeeId: number, message: string) {
  const [updated] = await db.update(invShortages).set({
    status: "CLOSED",
    closedByEmployeeId: employeeId,
    closedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(invShortages.id, id)).returning();

  await db.insert(invShortageEvents).values({
    shortageId: id,
    eventType: "CLOSED",
    employeeId,
    message,
  });

  return updated;
}

// ==================== AUDIT ALERTS ====================

export async function getAuditAlerts(status?: string) {
  if (status) {
    return db.select({
      id: invAuditAlerts.id,
      alertType: invAuditAlerts.alertType,
      severity: invAuditAlerts.severity,
      invItemId: invAuditAlerts.invItemId,
      shortageId: invAuditAlerts.shortageId,
      message: invAuditAlerts.message,
      status: invAuditAlerts.status,
      createdAt: invAuditAlerts.createdAt,
      createdByEmployeeId: invAuditAlerts.createdByEmployeeId,
      ackByEmployeeId: invAuditAlerts.ackByEmployeeId,
      ackAt: invAuditAlerts.ackAt,
      closedByEmployeeId: invAuditAlerts.closedByEmployeeId,
      closedAt: invAuditAlerts.closedAt,
      notes: invAuditAlerts.notes,
      shortageStatus: invShortages.status,
      shortageEntityType: invShortages.entityType,
    }).from(invAuditAlerts)
      .leftJoin(invShortages, eq(invAuditAlerts.shortageId, invShortages.id))
      .where(eq(invAuditAlerts.status, status))
      .orderBy(desc(invAuditAlerts.createdAt));
  }
  return db.select({
    id: invAuditAlerts.id,
    alertType: invAuditAlerts.alertType,
    severity: invAuditAlerts.severity,
    invItemId: invAuditAlerts.invItemId,
    shortageId: invAuditAlerts.shortageId,
    message: invAuditAlerts.message,
    status: invAuditAlerts.status,
    createdAt: invAuditAlerts.createdAt,
    createdByEmployeeId: invAuditAlerts.createdByEmployeeId,
    ackByEmployeeId: invAuditAlerts.ackByEmployeeId,
    ackAt: invAuditAlerts.ackAt,
    closedByEmployeeId: invAuditAlerts.closedByEmployeeId,
    closedAt: invAuditAlerts.closedAt,
    notes: invAuditAlerts.notes,
    shortageStatus: invShortages.status,
    shortageEntityType: invShortages.entityType,
  }).from(invAuditAlerts)
    .leftJoin(invShortages, eq(invAuditAlerts.shortageId, invShortages.id))
    .orderBy(desc(invAuditAlerts.createdAt));
}

export async function ackAuditAlert(id: number, employeeId: number, notes?: string) {
  const [alert] = await db.select().from(invAuditAlerts).where(eq(invAuditAlerts.id, id));
  if (!alert) return null;

  const [updated] = await db.update(invAuditAlerts).set({
    status: "ACK",
    ackByEmployeeId: employeeId,
    ackAt: new Date(),
    notes: notes || alert.notes,
  }).where(eq(invAuditAlerts.id, id)).returning();

  if (alert.shortageId) {
    await db.update(invShortages).set({
      auditStatus: "INVESTIGATING",
      auditOwnerEmployeeId: employeeId,
      updatedAt: new Date(),
    }).where(eq(invShortages.id, alert.shortageId));
  }

  return updated;
}

export async function closeAuditAlert(id: number, employeeId: number, notes: string) {
  const [alert] = await db.select().from(invAuditAlerts).where(eq(invAuditAlerts.id, id));
  if (!alert) return null;

  const [updated] = await db.update(invAuditAlerts).set({
    status: "CLOSED",
    closedByEmployeeId: employeeId,
    closedAt: new Date(),
    notes,
  }).where(eq(invAuditAlerts.id, id)).returning();

  if (alert.shortageId) {
    await db.update(invShortages).set({
      auditStatus: "RESOLVED",
      auditNotes: notes,
      updatedAt: new Date(),
    }).where(eq(invShortages.id, alert.shortageId));
  }

  return updated;
}

// ==================== COUNTS & TOGGLES ====================

export async function getActiveShortageCount() {
  const [result] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(invShortages)
    .where(inArray(invShortages.status, ["OPEN", "ACKNOWLEDGED"]));
  return result?.count || 0;
}

export async function toggleProductAvailability(productId: number, active: boolean) {
  const [product] = await db.update(products).set({ active }).where(eq(products.id, productId)).returning();
  return product;
}
