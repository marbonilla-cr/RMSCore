import { db } from "./db";
import { eq, and, desc, asc, sql, isNull, ne, inArray } from "drizzle-orm";
import {
  users, tables, categories, products, paymentMethods,
  orders, orderItems, qrSubmissions, kitchenTickets, kitchenTicketItems,
  payments, cashSessions, splitAccounts, splitItems,
  salesLedgerItems, auditEvents, qboExportJobs,
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
  const [order] = await db.insert(orders).values(data).returning();
  return order;
}

export async function updateOrder(id: number, data: Partial<any>) {
  const [order] = await db.update(orders).set(data).where(eq(orders.id, id)).returning();
  return order;
}

export async function recalcOrderTotal(orderId: number) {
  const items = await db.select().from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), ne(orderItems.status, "VOIDED")));
  const total = items.reduce((s, i) => s + Number(i.productPriceSnapshot) * i.qty, 0);
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

// Dashboard queries
export async function getDashboardData() {
  const today = getBusinessDate();

  const allOrders = await db.select().from(orders).where(eq(orders.businessDate, today));

  const openOrders = allOrders.filter(o => o.status === "OPEN" || o.status === "IN_KITCHEN" || o.status === "READY");
  const paidOrders = allOrders.filter(o => o.status === "PAID");
  const cancelledOrders = allOrders.filter(o => o.status === "CANCELLED" || o.status === "VOID");

  const sumAmount = (orders: any[]) => orders.reduce((s, o) => s + Number(o.totalAmount || 0), 0);

  const ledgerItems = await db.select().from(salesLedgerItems)
    .where(and(eq(salesLedgerItems.businessDate, today), eq(salesLedgerItems.status, "PAID")));

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

  return {
    openOrders: { count: openOrders.length, amount: sumAmount(openOrders) },
    paidOrders: { count: paidOrders.length, amount: sumAmount(paidOrders) },
    cancelledOrders: { count: cancelledOrders.length, amount: sumAmount(cancelledOrders) },
    topProducts,
    topCategories,
  };
}

// Seed data
export async function seedData() {
  const existingUsers = await db.select().from(users).limit(1);
  if (existingUsers.length > 0) return;

  // Create default users
  const hash = await bcrypt.hash("1234", 10);
  await db.insert(users).values([
    { username: "gerente", password: hash, displayName: "Carlos Gerente", role: "MANAGER", active: true },
    { username: "salonero", password: hash, displayName: "Salonero", role: "WAITER", active: true },
    { username: "salonero1", password: hash, displayName: "María Salonera", role: "WAITER", active: true },
    { username: "salonero2", password: hash, displayName: "Juan Salonero", role: "WAITER", active: true },
    { username: "cocina", password: hash, displayName: "Ana Cocina", role: "KITCHEN", active: true },
    { username: "cajero", password: hash, displayName: "Pedro Cajero", role: "CASHIER", active: true },
    { username: "caja", password: hash, displayName: "Caja", role: "CASHIER", active: true },
  ]);

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
