import { db } from "./db";
import { eq, and, desc, asc, sql, isNull, ne, inArray, gte, lte } from "drizzle-orm";
import {
  users, tables, categories, products, paymentMethods,
  orders, orderItems, qrSubmissions, kitchenTickets, kitchenTicketItems,
  payments, cashSessions, splitAccounts, splitItems,
  salesLedgerItems, auditEvents, qboExportJobs, voidedItems,
  businessConfig, printers, permissions, rolePermissions,
  modifierGroups, modifierOptions, itemModifierGroups, orderItemModifiers,
  discounts, orderDiscounts,
  taxCategories, productTaxCategories, orderItemTaxes, orderItemDiscounts,
  type InsertUser, type User,
  type InsertTable, type Table,
  type InsertCategory, type Category,
  type InsertProduct, type Product,
  type InsertPaymentMethod, type PaymentMethod,
  type InsertOrder, type Order,
  type InsertOrderItem, type OrderItem,
  type InsertKitchenTicket, type KitchenTicket,
  type InsertKitchenTicketItem, type KitchenTicketItem,
  type InsertPayment, type Payment,
  type InsertCashSession, type CashSession,
  type InsertAuditEvent,
  type InsertSplitAccount,
  type InsertSplitItem,
  type InsertQboExportJob,
  type InsertVoidedItem,
  type InsertBusinessConfig, type BusinessConfig,
  type InsertPrinter, type Printer,
  type ModifierGroup, type InsertModifierGroup,
  type ModifierOption, type InsertModifierOption,
  type InsertItemModifierGroup,
  type InsertOrderItemModifier, type OrderItemModifier,
  type Discount, type InsertDiscount,
  type OrderDiscount, type InsertOrderDiscount,
  type TaxCategory, type InsertTaxCategory,
  type InsertProductTaxCategory,
  type InsertOrderItemTax,
  type InsertOrderItemDiscount,
} from "@shared/schema";
import bcrypt from "bcryptjs";

function getBusinessDate(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

// Users
export async function getUser(id: number) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function getUserByUsername(username: string) {
  const [user] = await db.select().from(users).where(eq(users.username, username));
  return user;
}

export async function getAllUsers() {
  return db.select().from(users).orderBy(asc(users.displayName));
}

export async function createUser(data: InsertUser) {
  const hash = await bcrypt.hash(data.password, 10);
  const [user] = await db.insert(users).values({ ...data, password: hash }).returning();
  return user;
}

export async function updateUser(id: number, data: Partial<InsertUser>) {
  if (data.password) {
    data.password = await bcrypt.hash(data.password, 10);
  }
  const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
  return user;
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

// PIN Auth
export async function enrollPin(userId: number, pin: string) {
  const hash = await bcrypt.hash(pin, 10);
  const [user] = await db.update(users).set({ pin: hash, pinPlain: pin, pinFailedAttempts: 0, pinLockedUntil: null }).where(eq(users.id, userId)).returning();
  return user;
}

export async function resetPin(userId: number) {
  const [user] = await db.update(users).set({ pin: null, pinPlain: null, pinFailedAttempts: 0, pinLockedUntil: null }).where(eq(users.id, userId)).returning();
  return user;
}

export function generateRandomPin(): string {
  const trivial = ["0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999", "1234", "4321", "1010", "2020"];
  let pin: string;
  do {
    pin = Math.floor(1000 + Math.random() * 9000).toString();
  } while (trivial.includes(pin));
  return pin;
}

export async function generateAndSetPin(userId: number): Promise<string> {
  const pin = generateRandomPin();
  await enrollPin(userId, pin);
  return pin;
}

export async function getAllUsersWithPin() {
  return db.select({
    id: users.id,
    username: users.username,
    displayName: users.displayName,
    role: users.role,
    active: users.active,
    pin: users.pin,
    pinFailedAttempts: users.pinFailedAttempts,
    pinLockedUntil: users.pinLockedUntil,
  }).from(users).where(eq(users.active, true));
}

export async function verifyPin(pin: string, hash: string) {
  return bcrypt.compare(pin, hash);
}

export async function incrementPinFailed(userId: number) {
  const [user] = await db.update(users).set({
    pinFailedAttempts: sql`${users.pinFailedAttempts} + 1`,
  }).where(eq(users.id, userId)).returning();
  return user;
}

export async function lockPinUser(userId: number, minutes: number = 5) {
  const until = new Date(Date.now() + minutes * 60 * 1000);
  const [user] = await db.update(users).set({
    pinLockedUntil: until,
    pinFailedAttempts: 0,
  }).where(eq(users.id, userId)).returning();
  return user;
}

export async function clearPinLock(userId: number) {
  const [user] = await db.update(users).set({
    pinFailedAttempts: 0,
    pinLockedUntil: null,
  }).where(eq(users.id, userId)).returning();
  return user;
}

// Permissions
export async function getAllPermissions() {
  return db.select().from(permissions).orderBy(asc(permissions.key));
}

export async function getRolePermissions(role: string) {
  return db.select().from(rolePermissions).where(eq(rolePermissions.role, role));
}

export async function getPermissionKeysForRole(role: string): Promise<string[]> {
  const rows = await db.select({ key: rolePermissions.permissionKey }).from(rolePermissions).where(eq(rolePermissions.role, role));
  return rows.map(r => r.key);
}

export async function setRolePermissions(role: string, permissionKeys: string[]) {
  await db.delete(rolePermissions).where(eq(rolePermissions.role, role));
  if (permissionKeys.length > 0) {
    await db.insert(rolePermissions).values(permissionKeys.map(key => ({ role, permissionKey: key })));
  }
}

export async function userHasPermission(userId: number, permissionKey: string): Promise<boolean> {
  const user = await getUser(userId);
  if (!user) return false;
  const keys = await getPermissionKeysForRole(user.role);
  return keys.includes(permissionKey);
}

// Tables
export async function getAllTables() {
  return db.select().from(tables).orderBy(asc(tables.sortOrder), asc(tables.id));
}

export async function getTable(id: number) {
  const [table] = await db.select().from(tables).where(eq(tables.id, id));
  return table;
}

export async function getTableByCode(code: string) {
  const [table] = await db.select().from(tables).where(eq(tables.tableCode, code));
  return table;
}

export async function createTable(data: InsertTable) {
  const [table] = await db.insert(tables).values(data).returning();
  return table;
}

export async function updateTable(id: number, data: Partial<InsertTable>) {
  const [table] = await db.update(tables).set(data).where(eq(tables.id, id)).returning();
  return table;
}

// Categories
export async function getAllCategories() {
  return db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.id));
}

export async function getCategory(id: number) {
  const [cat] = await db.select().from(categories).where(eq(categories.id, id));
  return cat;
}

export async function createCategory(data: InsertCategory) {
  const [cat] = await db.insert(categories).values(data).returning();
  return cat;
}

export async function updateCategory(id: number, data: Partial<InsertCategory>) {
  const [cat] = await db.update(categories).set(data).where(eq(categories.id, id)).returning();
  return cat;
}

// Products
export async function getAllProducts() {
  return db.select().from(products).orderBy(asc(products.name));
}

export async function getActiveProducts() {
  return db.select().from(products)
    .where(eq(products.active, true))
    .orderBy(asc(products.name));
}

export async function getQRProducts() {
  return db.select().from(products)
    .where(and(eq(products.active, true), eq(products.visibleQr, true)))
    .orderBy(asc(products.name));
}

export async function getProduct(id: number) {
  const [product] = await db.select().from(products).where(eq(products.id, id));
  return product;
}

export async function createProduct(data: InsertProduct) {
  const [product] = await db.insert(products).values(data).returning();
  return product;
}

export async function updateProduct(id: number, data: Partial<InsertProduct>) {
  const [product] = await db.update(products).set(data).where(eq(products.id, id)).returning();
  return product;
}

export async function decrementPortions(productId: number, qty: number) {
  const product = await getProduct(productId);
  if (!product || product.availablePortions === null) return;
  const newPortions = Math.max(0, product.availablePortions - qty);
  const active = newPortions > 0;
  await db.update(products).set({ availablePortions: newPortions, active }).where(eq(products.id, productId));
}

// Payment Methods
export async function getAllPaymentMethods() {
  return db.select().from(paymentMethods).orderBy(asc(paymentMethods.sortOrder), asc(paymentMethods.id));
}

export async function createPaymentMethod(data: InsertPaymentMethod) {
  const [pm] = await db.insert(paymentMethods).values(data).returning();
  return pm;
}

export async function getPaymentMethod(id: number) {
  const [pm] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, id));
  return pm;
}

export async function updatePaymentMethod(id: number, data: Partial<InsertPaymentMethod>) {
  const [pm] = await db.update(paymentMethods).set(data).where(eq(paymentMethods.id, id)).returning();
  return pm;
}

// Orders
export async function getOpenOrderForTable(tableId: number) {
  const [order] = await db.select().from(orders)
    .where(and(
      eq(orders.tableId, tableId),
      inArray(orders.status, ["OPEN", "IN_KITCHEN", "READY"])
    ));
  return order;
}

export async function createOrder(data: InsertOrder) {
  const dailyMax = await db.select({ max: sql<number>`COALESCE(MAX(${orders.dailyNumber}), 0)` })
    .from(orders).where(eq(orders.businessDate, data.businessDate));
  const dailyNumber = (dailyMax[0]?.max || 0) + 1;

  const globalMax = await db.select({ max: sql<number>`COALESCE(MAX(${orders.globalNumber}), 0)` })
    .from(orders);
  const GLOBAL_START = parseInt(process.env.ORDER_GLOBAL_START || "0", 10);
  const globalNumber = Math.max((globalMax[0]?.max || 0) + 1, GLOBAL_START);

  const [order] = await db.insert(orders).values({ ...data, dailyNumber, globalNumber }).returning();
  return order;
}

export async function updateOrder(id: number, data: Partial<any>) {
  const [order] = await db.update(orders).set(data).where(eq(orders.id, id)).returning();
  return order;
}

export async function recalcOrderTotal(orderId: number) {
  const items = await db.select().from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), ne(orderItems.status, "VOIDED")));

  let subtotal = 0;
  let totalDiscounts = 0;
  let totalTaxes = 0;

  let totalInclusiveTaxes = 0;

  for (const item of items) {
    const mods = await db.select().from(orderItemModifiers).where(eq(orderItemModifiers.orderItemId, item.id));
    const modTotal = mods.reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
    const lineSubtotal = (Number(item.productPriceSnapshot) + modTotal) * item.qty;
    subtotal += lineSubtotal;

    const discountsForItem = await db.select().from(orderItemDiscounts).where(eq(orderItemDiscounts.orderItemId, item.id));
    const discountAmount = discountsForItem.reduce((s, d) => s + Number(d.amountApplied), 0);
    totalDiscounts += discountAmount;

    const discountedSubtotal = lineSubtotal - discountAmount;

    const taxesForItem = await getProductTaxCategories(item.productId);
    const allTaxCats = await getAllTaxCategories();

    await deleteOrderItemTaxesByItem(item.id);

    for (const ptc of taxesForItem) {
      const tc = allTaxCats.find(t => t.id === ptc.taxCategoryId && t.active);
      if (tc) {
        const rate = Number(tc.rate);
        let taxAmount: number;
        if (tc.inclusive) {
          taxAmount = Math.round(discountedSubtotal * rate / (100 + rate) * 100) / 100;
          totalInclusiveTaxes += taxAmount;
        } else {
          taxAmount = Math.round(discountedSubtotal * rate / 100 * 100) / 100;
          totalTaxes += taxAmount;
        }
        await createOrderItemTax({
          orderItemId: item.id,
          taxCategoryId: tc.id,
          taxNameSnapshot: tc.name,
          taxRateSnapshot: tc.rate,
          inclusiveSnapshot: tc.inclusive,
          taxAmount: taxAmount.toFixed(2),
        });
      }
    }
  }

  const total = subtotal - totalDiscounts + totalTaxes;
  await db.update(orders).set({ totalAmount: total.toFixed(2) }).where(eq(orders.id, orderId));
  return total;
}

// Order Items
export async function getOrderItems(orderId: number) {
  return db.select().from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.roundNumber), asc(orderItems.id));
}

export async function createOrderItem(data: InsertOrderItem) {
  const [item] = await db.insert(orderItems).values(data).returning();
  return item;
}

export async function updateOrderItem(id: number, data: Partial<any>) {
  const [item] = await db.update(orderItems).set(data).where(eq(orderItems.id, id)).returning();
  return item;
}

// QR Submissions
export async function createQrSubmission(data: any) {
  const [sub] = await db.insert(qrSubmissions).values(data).returning();
  return sub;
}

export async function getPendingSubmissions(orderId: number) {
  return db.select().from(qrSubmissions)
    .where(and(eq(qrSubmissions.orderId, orderId), eq(qrSubmissions.status, "PENDING")));
}

export async function getSubmission(id: number) {
  const [sub] = await db.select().from(qrSubmissions).where(eq(qrSubmissions.id, id));
  return sub;
}

export async function updateSubmission(id: number, data: any) {
  const [sub] = await db.update(qrSubmissions).set(data).where(eq(qrSubmissions.id, id)).returning();
  return sub;
}

// Kitchen Tickets
export async function createKitchenTicket(data: InsertKitchenTicket) {
  const [ticket] = await db.insert(kitchenTickets).values(data).returning();
  return ticket;
}

export async function getActiveKitchenTickets() {
  return db.select().from(kitchenTickets)
    .where(and(ne(kitchenTickets.status, "READY"), isNull(kitchenTickets.clearedAt)))
    .orderBy(asc(kitchenTickets.createdAt));
}

export async function getHistoryKitchenTickets() {
  return db.select().from(kitchenTickets)
    .where(and(eq(kitchenTickets.status, "READY"), isNull(kitchenTickets.clearedAt)))
    .orderBy(desc(kitchenTickets.createdAt));
}

export async function updateKitchenTicket(id: number, data: any) {
  const [ticket] = await db.update(kitchenTickets).set(data).where(eq(kitchenTickets.id, id)).returning();
  return ticket;
}

export async function clearKitchenHistory() {
  await db.update(kitchenTickets)
    .set({ clearedAt: new Date() })
    .where(and(eq(kitchenTickets.status, "READY"), isNull(kitchenTickets.clearedAt)));
}

// Kitchen Ticket Items
export async function createKitchenTicketItem(data: InsertKitchenTicketItem) {
  const [item] = await db.insert(kitchenTicketItems).values(data).returning();
  return item;
}

export async function getKitchenTicketItems(ticketId: number) {
  return db.select().from(kitchenTicketItems)
    .where(eq(kitchenTicketItems.kitchenTicketId, ticketId));
}

export async function updateKitchenTicketItem(id: number, data: any) {
  const [item] = await db.update(kitchenTicketItems).set(data).where(eq(kitchenTicketItems.id, id)).returning();
  return item;
}

export async function voidKitchenTicketItemsByOrderItem(orderItemId: number, qtyToVoid: number, isFullVoid: boolean) {
  if (isFullVoid) {
    await db.update(kitchenTicketItems)
      .set({ status: "VOIDED" })
      .where(eq(kitchenTicketItems.orderItemId, orderItemId));
  } else {
    const items = await db.select().from(kitchenTicketItems)
      .where(eq(kitchenTicketItems.orderItemId, orderItemId));
    for (const kti of items) {
      const newQty = Math.max(0, kti.qty - qtyToVoid);
      if (newQty === 0) {
        await db.update(kitchenTicketItems).set({ status: "VOIDED" }).where(eq(kitchenTicketItems.id, kti.id));
      } else {
        await db.update(kitchenTicketItems).set({ qty: newQty }).where(eq(kitchenTicketItems.id, kti.id));
      }
    }
  }
}

// Payments
export async function createPayment(data: InsertPayment) {
  const [payment] = await db.insert(payments).values(data).returning();
  return payment;
}

export async function getPaymentsForDate(date: string) {
  return db.select().from(payments).where(eq(payments.businessDate, date));
}

// Cash Sessions
export async function getActiveCashSession() {
  const [session] = await db.select().from(cashSessions)
    .where(isNull(cashSessions.closedAt))
    .orderBy(desc(cashSessions.openedAt))
    .limit(1);
  return session;
}

export async function getLatestCashSession() {
  const [session] = await db.select().from(cashSessions)
    .orderBy(desc(cashSessions.openedAt))
    .limit(1);
  return session;
}

export async function createCashSession(data: InsertCashSession) {
  const [session] = await db.insert(cashSessions).values(data).returning();
  return session;
}

export async function updateCashSession(id: number, data: any) {
  const [session] = await db.update(cashSessions).set(data).where(eq(cashSessions.id, id)).returning();
  return session;
}

// Sales Ledger
export async function createSalesLedgerItem(data: any) {
  const [item] = await db.insert(salesLedgerItems).values(data).returning();
  return item;
}

export async function updateSalesLedgerItems(orderItemId: number, data: any) {
  await db.update(salesLedgerItems).set(data).where(eq(salesLedgerItems.orderItemId, orderItemId));
}

// Audit Events
export async function createAuditEvent(data: InsertAuditEvent) {
  await db.insert(auditEvents).values(data);
}

// Split Accounts
export async function createSplitAccount(data: InsertSplitAccount) {
  const [split] = await db.insert(splitAccounts).values(data).returning();
  return split;
}

export async function getSplitAccountsForOrder(orderId: number) {
  return db.select().from(splitAccounts).where(eq(splitAccounts.orderId, orderId));
}

export async function createSplitItem(data: InsertSplitItem) {
  const [item] = await db.insert(splitItems).values(data).returning();
  return item;
}

export async function getSplitItemsForSplit(splitId: number) {
  return db.select().from(splitItems).where(eq(splitItems.splitId, splitId));
}

export async function getSplitAccount(id: number) {
  const [split] = await db.select().from(splitAccounts).where(eq(splitAccounts.id, id));
  return split;
}

export async function deleteSplitAccount(id: number) {
  await db.delete(splitItems).where(eq(splitItems.splitId, id));
  await db.delete(splitAccounts).where(eq(splitAccounts.id, id));
}

export async function removeSplitItemByOrderItemId(splitId: number, orderItemId: number) {
  await db.delete(splitItems).where(and(eq(splitItems.splitId, splitId), eq(splitItems.orderItemId, orderItemId)));
}

export async function getPaymentsForOrder(orderId: number) {
  return db.select().from(payments).where(eq(payments.orderId, orderId));
}

export async function voidPayment(id: number) {
  const [payment] = await db.update(payments).set({ status: "VOIDED" }).where(eq(payments.id, id)).returning();
  return payment;
}

export async function getPaymentsByDateGrouped(date: string) {
  const allPayments = await db.select().from(payments)
    .where(and(eq(payments.businessDate, date), eq(payments.status, "PAID")));
  const allMethods = await db.select().from(paymentMethods);
  const methodMap = new Map(allMethods.map(m => [m.id, m.paymentName]));

  const grouped: Record<string, number> = {};
  for (const p of allPayments) {
    const methodName = methodMap.get(p.paymentMethodId) || "Otro";
    grouped[methodName] = (grouped[methodName] || 0) + Number(p.amount);
  }
  return grouped;
}

// Voided Items
export async function createVoidedItem(data: InsertVoidedItem) {
  const [item] = await db.insert(voidedItems).values(data).returning();
  return item;
}

export async function getVoidedItemsForOrder(orderId: number) {
  return db.select().from(voidedItems)
    .where(eq(voidedItems.orderId, orderId))
    .orderBy(desc(voidedItems.voidedAt));
}

export async function deleteOrderItem(id: number) {
  await db.delete(voidedItems).where(eq(voidedItems.orderItemId, id));
  await db.delete(orderItems).where(eq(orderItems.id, id));
}

export async function getOrderItem(id: number) {
  const [item] = await db.select().from(orderItems).where(eq(orderItems.id, id));
  return item;
}

export async function incrementPortions(productId: number, qty: number) {
  const product = await getProduct(productId);
  if (!product || product.availablePortions === null) return;
  const newPortions = product.availablePortions + qty;
  await db.update(products).set({ availablePortions: newPortions, active: true }).where(eq(products.id, productId));
}

// QBO Export Jobs
export async function createQboExportJob(data: InsertQboExportJob) {
  const [job] = await db.insert(qboExportJobs).values(data).returning();
  return job;
}

export async function getQboExportJobs(date: string) {
  return db.select().from(qboExportJobs).where(eq(qboExportJobs.businessDate, date));
}

export async function updateQboExportJob(id: number, data: any) {
  const [job] = await db.update(qboExportJobs).set(data).where(eq(qboExportJobs.id, id)).returning();
  return job;
}

export async function getOrder(id: number) {
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  return order;
}

export async function getPayment(id: number) {
  const [payment] = await db.select().from(payments).where(eq(payments.id, id));
  return payment;
}

export async function getLedgerItemsForDate(date: string, status?: string) {
  if (status) {
    return db.select().from(salesLedgerItems)
      .where(and(eq(salesLedgerItems.businessDate, date), eq(salesLedgerItems.status, status)));
  }
  return db.select().from(salesLedgerItems)
    .where(eq(salesLedgerItems.businessDate, date));
}

export async function getLedgerItemsForDateRange(fromDate: string, toDate: string) {
  return db.select().from(salesLedgerItems)
    .where(and(gte(salesLedgerItems.businessDate, fromDate), lte(salesLedgerItems.businessDate, toDate)));
}

export async function getPaymentsByDateRangeGrouped(fromDate: string, toDate: string) {
  const allPayments = await db.select().from(payments)
    .where(and(gte(payments.businessDate, fromDate), lte(payments.businessDate, toDate), eq(payments.status, "PAID")));
  const allMethods = await db.select().from(paymentMethods);
  const methodMap = new Map(allMethods.map(m => [m.id, m.paymentName]));

  const grouped: Record<string, number> = {};
  for (const p of allPayments) {
    const methodName = methodMap.get(p.paymentMethodId) || "Otro";
    grouped[methodName] = (grouped[methodName] || 0) + Number(p.amount);
  }
  return grouped;
}

// Dashboard queries
export async function getDashboardData(dateFrom?: string, dateTo?: string, hourFrom?: number, hourTo?: number) {
  const today = getBusinessDate();
  const fromDate = dateFrom || today;
  const toDate = dateTo || fromDate;

  let allOrders = fromDate === toDate
    ? await db.select().from(orders).where(eq(orders.businessDate, fromDate))
    : await db.select().from(orders).where(
        and(gte(orders.businessDate, fromDate), lte(orders.businessDate, toDate))
      );

  const validHourFilter = hourFrom !== undefined && hourTo !== undefined
    && !isNaN(hourFrom) && !isNaN(hourTo) && hourFrom >= 0 && hourTo <= 23 && hourFrom <= hourTo;

  const filterByHour = <T extends { [key: string]: any }>(items: T[], dateField: string): T[] => {
    if (!validHourFilter) return items;
    return items.filter(item => {
      const dateVal = item[dateField];
      if (!dateVal) return false;
      const h = new Date(dateVal).getHours();
      return h >= hourFrom! && h <= hourTo!;
    });
  };

  if (validHourFilter) {
    allOrders = allOrders.filter(o => {
      if (!o.openedAt) return false;
      const h = new Date(o.openedAt).getHours();
      return h >= hourFrom! && h <= hourTo!;
    });
  }

  const openOrders = allOrders.filter(o => o.status === "OPEN" || o.status === "IN_KITCHEN" || o.status === "READY");
  const paidOrders = allOrders.filter(o => o.status === "PAID");
  const cancelledOrders = allOrders.filter(o => o.status === "CANCELLED" || o.status === "VOID");

  const sumAmount = (orders: any[]) => orders.reduce((s, o) => s + Number(o.totalAmount || 0), 0);

  let ledgerItems = fromDate === toDate
    ? await db.select().from(salesLedgerItems)
        .where(and(eq(salesLedgerItems.businessDate, fromDate), eq(salesLedgerItems.status, "PAID")))
    : await db.select().from(salesLedgerItems)
        .where(and(gte(salesLedgerItems.businessDate, fromDate), lte(salesLedgerItems.businessDate, toDate), eq(salesLedgerItems.status, "PAID")));
  ledgerItems = filterByHour(ledgerItems, "paidAt");

  const productMap = new Map<string, { qty: number; amount: number }>();
  const categoryMap = new Map<string, { qty: number; amount: number }>();

  for (const item of ledgerItems) {
    const pName = item.productNameSnapshot || "Desconocido";
    const existing = productMap.get(pName) || { qty: 0, amount: 0 };
    productMap.set(pName, { qty: existing.qty + item.qty, amount: existing.amount + Number(item.lineSubtotal) });

    const cName = item.categoryNameSnapshot || "Sin categoría";
    const catExisting = categoryMap.get(cName) || { qty: 0, amount: 0 };
    categoryMap.set(cName, { qty: catExisting.qty + item.qty, amount: catExisting.amount + Number(item.lineSubtotal) });
  }

  const topProducts = Array.from(productMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  const topCategories = Array.from(categoryMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  let todayVoidedItems = fromDate === toDate
    ? await db.select().from(voidedItems).where(eq(voidedItems.businessDate, fromDate))
    : await db.select().from(voidedItems).where(
        and(gte(voidedItems.businessDate, fromDate), lte(voidedItems.businessDate, toDate))
      );
  todayVoidedItems = filterByHour(todayVoidedItems, "voidedAt");
  const voidedItemsCount = todayVoidedItems.reduce((s, v) => s + v.qtyVoided, 0);
  const voidedItemsAmount = todayVoidedItems.reduce((s, v) => s + (v.qtyVoided * Number(v.unitPriceSnapshot || 0)), 0);

  const allTables = await getAllTables();
  const tableMap = new Map(allTables.map(t => [t.id, t.tableName]));

  const mapOrders = (list: typeof allOrders) => list.map(o => ({
    id: o.id,
    dailyNumber: o.dailyNumber,
    globalNumber: o.globalNumber,
    tableName: tableMap.get(o.tableId) || `Mesa ${o.tableId}`,
    status: o.status,
    totalAmount: Number(o.totalAmount || 0),
    openedAt: o.openedAt?.toISOString() || null,
    closedAt: o.closedAt?.toISOString() || null,
  }));

  return {
    openOrders: { count: openOrders.length, amount: sumAmount(openOrders), orders: mapOrders(openOrders) },
    paidOrders: { count: paidOrders.length, amount: sumAmount(paidOrders), orders: mapOrders(paidOrders) },
    cancelledOrders: { count: cancelledOrders.length, amount: sumAmount(cancelledOrders), orders: mapOrders(cancelledOrders) },
    voidedItemsSummary: {
      count: voidedItemsCount,
      amount: voidedItemsAmount,
      items: todayVoidedItems.map(v => ({
        id: v.id,
        tableName: tableMap.get(v.tableId!) || v.tableNameSnapshot || "—",
        productName: v.productNameSnapshot || "—",
        qtyVoided: v.qtyVoided,
        unitPrice: Number(v.unitPriceSnapshot || 0),
        total: v.qtyVoided * Number(v.unitPriceSnapshot || 0),
        reason: v.voidReason,
        notes: v.notes,
        voidedAt: v.voidedAt?.toISOString() || null,
      })),
    },
    topProducts,
    topCategories,
  };
}

export async function getOrderDetail(orderId: number) {
  const order = await getOrder(orderId);
  if (!order) return null;
  const items = await getOrderItems(orderId);
  const paymentsList = await db.select().from(payments).where(eq(payments.orderId, orderId));
  const allPayMethods = await db.select().from(paymentMethods);
  const pmMap = new Map(allPayMethods.map(p => [p.id, p.paymentName]));
  const allTbls = await getAllTables();
  const tblMap = new Map(allTbls.map(t => [t.id, t.tableName]));

  return {
    id: order.id,
    dailyNumber: order.dailyNumber,
    globalNumber: order.globalNumber,
    tableName: tblMap.get(order.tableId) || `Mesa ${order.tableId}`,
    status: order.status,
    totalAmount: Number(order.totalAmount || 0),
    openedAt: order.openedAt?.toISOString() || null,
    closedAt: order.closedAt?.toISOString() || null,
    items: items.map(i => ({
      id: i.id,
      productName: i.productNameSnapshot,
      qty: i.qty,
      unitPrice: Number(i.productPriceSnapshot),
      subtotal: Number(i.productPriceSnapshot) * i.qty,
      status: i.status,
      origin: i.origin,
      notes: i.notes,
    })),
    payments: paymentsList.map(p => ({
      id: p.id,
      amount: Number(p.amount),
      method: pmMap.get(p.paymentMethodId) || `Método ${p.paymentMethodId}`,
      paidAt: p.paidAt?.toISOString() || null,
      status: p.status,
    })),
  };
}

// Seed data
export async function seedData() {
  const existingUsers = await db.select().from(users).limit(1);
  if (existingUsers.length > 0) return;

  // Create default users
  const hash = await bcrypt.hash("1234", 10);
  const seedUsers = [
    { username: "gerente", password: hash, displayName: "Carlos Gerente", role: "MANAGER", active: true },
    { username: "salonero", password: hash, displayName: "Salonero", role: "WAITER", active: true },
    { username: "salonero1", password: hash, displayName: "María Salonera", role: "WAITER", active: true },
    { username: "salonero2", password: hash, displayName: "Juan Salonero", role: "WAITER", active: true },
    { username: "cocina", password: hash, displayName: "Ana Cocina", role: "KITCHEN", active: true },
    { username: "cajero", password: hash, displayName: "Pedro Cajero", role: "CASHIER", active: true },
    { username: "caja", password: hash, displayName: "Caja", role: "CASHIER", active: true },
  ];
  await db.insert(users).values(seedUsers);

  const allSeedUsers = await db.select().from(users);
  for (const u of allSeedUsers) {
    const pin = generateRandomPin();
    const pinHash = await bcrypt.hash(pin, 10);
    await db.update(users).set({ pin: pinHash, pinPlain: pin }).where(eq(users.id, u.id));
    console.log(`  ${u.username} PIN: ${pin}`);
  }

  // Default payment methods
  await db.insert(paymentMethods).values([
    { paymentCode: "CASH", paymentName: "Efectivo", active: true, sortOrder: 1 },
    { paymentCode: "CARD", paymentName: "Tarjeta", active: true, sortOrder: 2 },
    { paymentCode: "SINPE", paymentName: "SINPE Móvil", active: true, sortOrder: 3 },
  ]);

  // Default tables
  await db.insert(tables).values([
    { tableCode: "M01", tableName: "Mesa 1", active: true, sortOrder: 1 },
    { tableCode: "M02", tableName: "Mesa 2", active: true, sortOrder: 2 },
    { tableCode: "M03", tableName: "Mesa 3", active: true, sortOrder: 3 },
    { tableCode: "M04", tableName: "Mesa 4", active: true, sortOrder: 4 },
    { tableCode: "M05", tableName: "Mesa 5", active: true, sortOrder: 5 },
    { tableCode: "M06", tableName: "Mesa 6", active: true, sortOrder: 6 },
    { tableCode: "BAR1", tableName: "Barra 1", active: true, sortOrder: 7 },
    { tableCode: "BAR2", tableName: "Barra 2", active: true, sortOrder: 8 },
  ]);

  // Default categories
  await db.insert(categories).values([
    { categoryCode: "ENT", name: "Entradas", active: true, sortOrder: 1 },
    { categoryCode: "PLA", name: "Platos Fuertes", active: true, sortOrder: 2 },
    { categoryCode: "BEB", name: "Bebidas", active: true, sortOrder: 3 },
    { categoryCode: "POS", name: "Postres", active: true, sortOrder: 4 },
  ]);

  const allCats = await db.select().from(categories);
  const catMap = new Map(allCats.map(c => [c.categoryCode, c.id]));

  // Default products
  await db.insert(products).values([
    { productCode: "ENT01", name: "Nachos Supreme", description: "Nachos con queso fundido, jalapeños, guacamole y crema agria", categoryId: catMap.get("ENT")!, price: "5500", active: true, visibleQr: true },
    { productCode: "ENT02", name: "Ceviche de Pescado", description: "Ceviche fresco del día con limón, cilantro y cebolla morada", categoryId: catMap.get("ENT")!, price: "7200", active: true, visibleQr: true },
    { productCode: "ENT03", name: "Empanadas de Pollo", description: "3 empanadas rellenas de pollo especiado con chimichurri", categoryId: catMap.get("ENT")!, price: "4800", active: true, visibleQr: true },
    { productCode: "PLA01", name: "Casado Completo", description: "Arroz, frijoles, ensalada, plátano maduro con carne a elección", categoryId: catMap.get("PLA")!, price: "6500", active: true, visibleQr: true },
    { productCode: "PLA02", name: "Lomo en Salsa BBQ", description: "200g de lomo de res en salsa BBQ casera, papas al horno y vegetales", categoryId: catMap.get("PLA")!, price: "12500", active: true, visibleQr: true },
    { productCode: "PLA03", name: "Pasta Alfredo con Pollo", description: "Fettuccine en cremosa salsa alfredo con pollo grillado", categoryId: catMap.get("PLA")!, price: "9800", active: true, visibleQr: true },
    { productCode: "PLA04", name: "Filete de Pescado", description: "Filete de corvina a la plancha con arroz de coco y ensalada tropical", categoryId: catMap.get("PLA")!, price: "11200", active: true, visibleQr: true },
    { productCode: "BEB01", name: "Café Americano", description: "Café negro recién preparado", categoryId: catMap.get("BEB")!, price: "1800", active: true, visibleQr: true },
    { productCode: "BEB02", name: "Jugo Natural", description: "Jugo fresco de frutas de temporada (naranja, piña, mango)", categoryId: catMap.get("BEB")!, price: "2500", active: true, visibleQr: true },
    { productCode: "BEB03", name: "Cerveza Artesanal", description: "Cerveza artesanal local 330ml", categoryId: catMap.get("BEB")!, price: "3200", active: true, visibleQr: true },
    { productCode: "BEB04", name: "Agua Mineral", description: "Agua mineral con o sin gas 500ml", categoryId: catMap.get("BEB")!, price: "1500", active: true, visibleQr: true },
    { productCode: "POS01", name: "Tres Leches", description: "Pastel tres leches con crema batida y canela", categoryId: catMap.get("POS")!, price: "4200", active: true, visibleQr: true },
    { productCode: "POS02", name: "Flan de Coco", description: "Flan cremoso de coco con caramelo", categoryId: catMap.get("POS")!, price: "3800", active: true, visibleQr: true },
  ]);

  console.log("Seed data created successfully");
}

// Seed permissions & role mappings (idempotent, runs always)
export async function seedPermissions() {
  const ALL_PERMS = [
    { key: "POS_VIEW", description: "Ver módulo POS" },
    { key: "POS_PAY", description: "Procesar pagos" },
    { key: "POS_SPLIT", description: "Dividir cuentas" },
    { key: "POS_PRINT", description: "Imprimir tiquetes" },
    { key: "POS_EMAIL_TICKET", description: "Enviar tiquete por email" },
    { key: "POS_EDIT_CUSTOMER_PREPAY", description: "Editar cliente antes del pago" },
    { key: "POS_EDIT_CUSTOMER_POSTPAY", description: "Editar cliente después del pago" },
    { key: "POS_VOID", description: "Anular pagos" },
    { key: "POS_VOID_ORDER", description: "Anular orden/mesa completa" },
    { key: "POS_REOPEN", description: "Reabrir órdenes pagadas" },
    { key: "CASH_CLOSE", description: "Cierre de caja" },
    { key: "MODULE_TABLES_VIEW", description: "Acceso al módulo Mesas/Salón" },
    { key: "MODULE_POS_VIEW", description: "Acceso al módulo POS/Caja" },
    { key: "MODULE_KDS_VIEW", description: "Acceso al módulo Cocina (KDS)" },
    { key: "MODULE_DASHBOARD_VIEW", description: "Acceso al módulo Dashboard" },
    { key: "MODULE_ADMIN_VIEW", description: "Acceso al módulo Admin" },
  ];

  for (const p of ALL_PERMS) {
    const existing = await db.select().from(permissions).where(eq(permissions.key, p.key)).limit(1);
    if (existing.length === 0) {
      await db.insert(permissions).values(p);
    }
  }

  const ROLE_PERMS: Record<string, string[]> = {
    MANAGER: ALL_PERMS.map(p => p.key),
    CASHIER: [
      "MODULE_TABLES_VIEW", "MODULE_POS_VIEW",
      "POS_VIEW", "POS_PAY", "POS_SPLIT", "POS_PRINT", "POS_EMAIL_TICKET",
      "POS_EDIT_CUSTOMER_PREPAY", "POS_EDIT_CUSTOMER_POSTPAY", "POS_VOID", "POS_VOID_ORDER", "POS_REOPEN", "CASH_CLOSE",
    ],
    WAITER: [
      "MODULE_TABLES_VIEW", "MODULE_POS_VIEW",
      "POS_VIEW", "POS_PAY", "POS_SPLIT", "POS_PRINT", "POS_EMAIL_TICKET", "POS_EDIT_CUSTOMER_PREPAY",
    ],
    KITCHEN: ["MODULE_TABLES_VIEW", "MODULE_KDS_VIEW"],
    STAFF: ["MODULE_TABLES_VIEW"],
  };

  for (const [role, keys] of Object.entries(ROLE_PERMS)) {
    const existing = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role));
    const existingKeys = existing.map(r => r.permissionKey);
    const missing = keys.filter(k => !existingKeys.includes(k));
    if (missing.length > 0) {
      await db.insert(rolePermissions).values(missing.map(k => ({ role, permissionKey: k })));
    }
  }

  // Seed the 4 operation users if they don't exist
  const opUsers = [
    { username: "marcelo", displayName: "Marcelo", role: "MANAGER" },
    { username: "lorenza", displayName: "Maria Lorenza Solis", role: "WAITER" },
    { username: "alexa", displayName: "Alexa Mendez", role: "KITCHEN" },
    { username: "mrivera", displayName: "Maria Rivera", role: "STAFF" },
  ];
  const hash = await bcrypt.hash("1234", 10);
  for (const u of opUsers) {
    const existing = await db.select().from(users).where(eq(users.username, u.username)).limit(1);
    if (existing.length === 0) {
      const pin = generateRandomPin();
      const pinHash = await bcrypt.hash(pin, 10);
      await db.insert(users).values({ ...u, password: hash, active: true, pin: pinHash, pinPlain: pin });
    }
  }

  console.log("Permissions and operation users seeded");
}

// Business Config
export async function getBusinessConfig(): Promise<BusinessConfig | undefined> {
  const [config] = await db.select().from(businessConfig).limit(1);
  return config;
}

export async function upsertBusinessConfig(data: InsertBusinessConfig): Promise<BusinessConfig> {
  const existing = await getBusinessConfig();
  if (existing) {
    const [updated] = await db.update(businessConfig)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(businessConfig.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db.insert(businessConfig).values(data).returning();
  return created;
}

// Printers
export async function getAllPrinters(): Promise<Printer[]> {
  return db.select().from(printers).orderBy(asc(printers.name));
}

export async function getPrinter(id: number): Promise<Printer | undefined> {
  const [printer] = await db.select().from(printers).where(eq(printers.id, id));
  return printer;
}

export async function createPrinter(data: InsertPrinter): Promise<Printer> {
  const [printer] = await db.insert(printers).values(data).returning();
  return printer;
}

export async function updatePrinter(id: number, data: Partial<InsertPrinter>): Promise<Printer> {
  const [printer] = await db.update(printers).set(data).where(eq(printers.id, id)).returning();
  return printer;
}

export async function deletePrinter(id: number): Promise<void> {
  await db.delete(printers).where(eq(printers.id, id));
}

// Modifier Groups
export async function getAllModifierGroups(): Promise<ModifierGroup[]> {
  return db.select().from(modifierGroups).orderBy(asc(modifierGroups.sortOrder), asc(modifierGroups.name));
}

export async function getModifierGroup(id: number): Promise<ModifierGroup | undefined> {
  const [g] = await db.select().from(modifierGroups).where(eq(modifierGroups.id, id));
  return g;
}

export async function getModifierGroupByName(name: string): Promise<ModifierGroup | undefined> {
  const [g] = await db.select().from(modifierGroups).where(eq(modifierGroups.name, name));
  return g;
}

export async function createModifierGroup(data: InsertModifierGroup): Promise<ModifierGroup> {
  const [g] = await db.insert(modifierGroups).values(data).returning();
  return g;
}

export async function updateModifierGroup(id: number, data: Partial<InsertModifierGroup>): Promise<ModifierGroup> {
  const [g] = await db.update(modifierGroups).set(data).where(eq(modifierGroups.id, id)).returning();
  return g;
}

// Modifier Options
export async function getModifierOptionsByGroup(groupId: number): Promise<ModifierOption[]> {
  return db.select().from(modifierOptions).where(eq(modifierOptions.groupId, groupId)).orderBy(asc(modifierOptions.sortOrder), asc(modifierOptions.name));
}

export async function createModifierOption(data: InsertModifierOption): Promise<ModifierOption> {
  const [o] = await db.insert(modifierOptions).values(data).returning();
  return o;
}

export async function updateModifierOption(id: number, data: Partial<InsertModifierOption>): Promise<ModifierOption> {
  const [o] = await db.update(modifierOptions).set(data).where(eq(modifierOptions.id, id)).returning();
  return o;
}

export async function deleteModifierOption(id: number): Promise<void> {
  await db.delete(modifierOptions).where(eq(modifierOptions.id, id));
}

// Item ↔ Modifier Group links
export async function getItemModifierGroups(productId: number) {
  return db.select().from(itemModifierGroups).where(eq(itemModifierGroups.productId, productId));
}

export async function linkItemModifierGroup(productId: number, modifierGroupId: number) {
  const existing = await db.select().from(itemModifierGroups)
    .where(and(eq(itemModifierGroups.productId, productId), eq(itemModifierGroups.modifierGroupId, modifierGroupId)));
  if (existing.length > 0) return existing[0];
  const [row] = await db.insert(itemModifierGroups).values({ productId, modifierGroupId }).returning();
  return row;
}

export async function unlinkItemModifierGroup(productId: number, modifierGroupId: number) {
  await db.delete(itemModifierGroups)
    .where(and(eq(itemModifierGroups.productId, productId), eq(itemModifierGroups.modifierGroupId, modifierGroupId)));
}

// Order Item Modifiers
export async function getOrderItemModifiers(orderItemId: number): Promise<OrderItemModifier[]> {
  return db.select().from(orderItemModifiers).where(eq(orderItemModifiers.orderItemId, orderItemId));
}

export async function createOrderItemModifier(data: InsertOrderItemModifier): Promise<OrderItemModifier> {
  const [m] = await db.insert(orderItemModifiers).values(data).returning();
  return m;
}

// Discounts
export async function getAllDiscounts(): Promise<Discount[]> {
  return db.select().from(discounts).orderBy(asc(discounts.name));
}

export async function getDiscount(id: number): Promise<Discount | undefined> {
  const [d] = await db.select().from(discounts).where(eq(discounts.id, id));
  return d;
}

export async function createDiscount(data: InsertDiscount): Promise<Discount> {
  const [d] = await db.insert(discounts).values(data).returning();
  return d;
}

export async function updateDiscount(id: number, data: Partial<InsertDiscount>): Promise<Discount> {
  const [d] = await db.update(discounts).set(data).where(eq(discounts.id, id)).returning();
  return d;
}

// Order Discounts
export async function getOrderDiscounts(orderId: number): Promise<OrderDiscount[]> {
  return db.select().from(orderDiscounts).where(eq(orderDiscounts.orderId, orderId));
}

export async function createOrderDiscount(data: InsertOrderDiscount): Promise<OrderDiscount> {
  const [od] = await db.insert(orderDiscounts).values(data).returning();
  return od;
}

export async function deleteOrderDiscount(id: number): Promise<void> {
  await db.delete(orderDiscounts).where(eq(orderDiscounts.id, id));
}

// Bulk helpers for seed
export async function getModifierOptionByGroupAndName(groupId: number, name: string): Promise<ModifierOption | undefined> {
  const [o] = await db.select().from(modifierOptions)
    .where(and(eq(modifierOptions.groupId, groupId), eq(modifierOptions.name, name)));
  return o;
}

export async function getDiscountByName(name: string): Promise<Discount | undefined> {
  const [d] = await db.select().from(discounts).where(eq(discounts.name, name));
  return d;
}

export async function normalizeOrderItemsForSplit(orderId: number) {
  const items = await db.select().from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), ne(orderItems.status, "VOIDED")));

  const toSplit = items.filter(i => i.qty > 1);
  if (toSplit.length === 0) return { normalized: false, itemCount: items.length };

  let newCount = 0;
  for (const item of toSplit) {
    const originalQty = item.qty;

    await db.update(orderItems).set({ qty: 1 }).where(eq(orderItems.id, item.id));

    const existingModifiers = await db.select().from(orderItemModifiers)
      .where(eq(orderItemModifiers.orderItemId, item.id));

    const existingLedger = await db.select().from(salesLedgerItems)
      .where(eq(salesLedgerItems.orderItemId, item.id));

    const existingKitchenItems = await db.select().from(kitchenTicketItems)
      .where(eq(kitchenTicketItems.orderItemId, item.id));

    if (existingLedger.length > 0) {
      const ledger = existingLedger[0];
      await db.update(salesLedgerItems).set({
        qty: 1,
        lineSubtotal: ledger.unitPrice,
      }).where(eq(salesLedgerItems.id, ledger.id));
    }

    if (existingKitchenItems.length > 0) {
      for (const kti of existingKitchenItems) {
        await db.update(kitchenTicketItems).set({ qty: 1 }).where(eq(kitchenTicketItems.id, kti.id));
      }
    }

    for (let i = 1; i < originalQty; i++) {
      const [newItem] = await db.insert(orderItems).values({
        orderId: item.orderId,
        productId: item.productId,
        productNameSnapshot: item.productNameSnapshot,
        productPriceSnapshot: item.productPriceSnapshot,
        qty: 1,
        notes: item.notes,
        origin: item.origin,
        createdByUserId: item.createdByUserId,
        responsibleWaiterId: item.responsibleWaiterId,
        status: item.status,
        roundNumber: item.roundNumber,
        qrSubmissionId: item.qrSubmissionId,
        sentToKitchenAt: item.sentToKitchenAt,
      }).returning();

      for (const mod of existingModifiers) {
        await db.insert(orderItemModifiers).values({
          orderItemId: newItem.id,
          modifierOptionId: mod.modifierOptionId,
          nameSnapshot: mod.nameSnapshot,
          priceDeltaSnapshot: mod.priceDeltaSnapshot,
          qty: mod.qty,
        });
      }

      if (existingLedger.length > 0) {
        const ledger = existingLedger[0];
        await db.insert(salesLedgerItems).values({
          businessDate: ledger.businessDate,
          tableId: ledger.tableId,
          tableNameSnapshot: ledger.tableNameSnapshot,
          orderId: ledger.orderId,
          orderItemId: newItem.id,
          productId: ledger.productId,
          productCodeSnapshot: ledger.productCodeSnapshot,
          productNameSnapshot: ledger.productNameSnapshot,
          categoryId: ledger.categoryId,
          categoryCodeSnapshot: ledger.categoryCodeSnapshot,
          categoryNameSnapshot: ledger.categoryNameSnapshot,
          qty: 1,
          unitPrice: ledger.unitPrice,
          lineSubtotal: ledger.unitPrice,
          origin: ledger.origin,
          createdByUserId: ledger.createdByUserId,
          responsibleWaiterId: ledger.responsibleWaiterId,
          status: ledger.status,
          sentToKitchenAt: ledger.sentToKitchenAt,
          kdsReadyAt: ledger.kdsReadyAt,
          paidAt: ledger.paidAt,
        });
      }

      if (existingKitchenItems.length > 0) {
        const kti = existingKitchenItems[0];
        await db.insert(kitchenTicketItems).values({
          kitchenTicketId: kti.kitchenTicketId,
          orderItemId: newItem.id,
          productNameSnapshot: kti.productNameSnapshot,
          qty: 1,
          notes: kti.notes,
          status: kti.status,
          prepStartedAt: kti.prepStartedAt,
          readyAt: kti.readyAt,
        });
      }

      newCount++;
    }
  }

  return { normalized: true, itemCount: items.length + newCount };
}

// ==================== TAX CATEGORIES ====================
export async function getAllTaxCategories(): Promise<TaxCategory[]> {
  return db.select().from(taxCategories).orderBy(asc(taxCategories.sortOrder), asc(taxCategories.name));
}

export async function getTaxCategory(id: number): Promise<TaxCategory | undefined> {
  const [tc] = await db.select().from(taxCategories).where(eq(taxCategories.id, id));
  return tc;
}

export async function createTaxCategory(data: InsertTaxCategory): Promise<TaxCategory> {
  const [tc] = await db.insert(taxCategories).values(data).returning();
  return tc;
}

export async function updateTaxCategory(id: number, data: Partial<InsertTaxCategory>): Promise<TaxCategory> {
  const [tc] = await db.update(taxCategories).set(data).where(eq(taxCategories.id, id)).returning();
  return tc;
}

// ==================== PRODUCT TAX CATEGORIES ====================
export async function getProductTaxCategories(productId: number) {
  return db.select().from(productTaxCategories).where(eq(productTaxCategories.productId, productId));
}

export async function setProductTaxCategories(productId: number, taxCategoryIds: number[]) {
  await db.delete(productTaxCategories).where(eq(productTaxCategories.productId, productId));
  if (taxCategoryIds.length > 0) {
    await db.insert(productTaxCategories).values(
      taxCategoryIds.map(tcId => ({ productId, taxCategoryId: tcId }))
    );
  }
}

// ==================== ORDER ITEM TAXES ====================
export async function getOrderItemTaxes(orderItemId: number) {
  return db.select().from(orderItemTaxes).where(eq(orderItemTaxes.orderItemId, orderItemId));
}

export async function getOrderItemTaxesByOrder(orderId: number) {
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const itemIds = items.map(i => i.id);
  if (itemIds.length === 0) return [];
  return db.select().from(orderItemTaxes).where(inArray(orderItemTaxes.orderItemId, itemIds));
}

export async function createOrderItemTax(data: InsertOrderItemTax) {
  const [row] = await db.insert(orderItemTaxes).values(data).returning();
  return row;
}

export async function deleteOrderItemTaxesByItem(orderItemId: number) {
  await db.delete(orderItemTaxes).where(eq(orderItemTaxes.orderItemId, orderItemId));
}

// ==================== ORDER ITEM DISCOUNTS ====================
export async function getOrderItemDiscounts(orderItemId: number) {
  return db.select().from(orderItemDiscounts).where(eq(orderItemDiscounts.orderItemId, orderItemId));
}

export async function getOrderItemDiscountsByOrder(orderId: number) {
  return db.select().from(orderItemDiscounts).where(eq(orderItemDiscounts.orderId, orderId));
}

export async function createOrderItemDiscount(data: InsertOrderItemDiscount) {
  const [row] = await db.insert(orderItemDiscounts).values(data).returning();
  return row;
}

export async function deleteOrderItemDiscount(id: number) {
  await db.delete(orderItemDiscounts).where(eq(orderItemDiscounts.id, id));
}

export async function deleteOrderItemDiscountsByItem(orderItemId: number) {
  await db.delete(orderItemDiscounts).where(eq(orderItemDiscounts.orderItemId, orderItemId));
}

export async function truncateTransactionalData() {
  await db.delete(splitItems);
  await db.delete(splitAccounts);
  await db.delete(salesLedgerItems);
  await db.delete(voidedItems);
  await db.delete(orderItemModifiers);
  await db.delete(orderItemTaxes);
  await db.delete(orderItemDiscounts);
  await db.delete(orderDiscounts);
  await db.delete(kitchenTicketItems);
  await db.delete(kitchenTickets);
  await db.delete(payments);
  await db.delete(qrSubmissions);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(cashSessions);
  await db.delete(auditEvents);
  await db.delete(qboExportJobs);
  await db.execute(sql`ALTER SEQUENCE IF EXISTS orders_id_seq RESTART WITH 1`);
  await db.execute(sql`ALTER SEQUENCE IF EXISTS order_items_id_seq RESTART WITH 1`);
  await db.execute(sql`ALTER SEQUENCE IF EXISTS payments_id_seq RESTART WITH 1`);
  await db.execute(sql`ALTER SEQUENCE IF EXISTS kitchen_tickets_id_seq RESTART WITH 1`);
  await db.execute(sql`ALTER SEQUENCE IF EXISTS kitchen_ticket_items_id_seq RESTART WITH 1`);
}
