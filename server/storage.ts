import { db } from "./db";
import { eq, and, desc, asc, sql, isNull, ne, inArray, gte, lte, count } from "drizzle-orm";
import {
  users, tables, categories, products, paymentMethods,
  orders, orderItems, qrSubmissions, kitchenTickets, kitchenTicketItems,
  payments, cashSessions, splitAccounts, splitItems,
  salesLedgerItems, auditEvents, qboExportJobs, voidedItems,
  businessConfig, printers, permissions, rolePermissions,
  modifierGroups, modifierOptions, itemModifierGroups, orderItemModifiers,
  discounts, orderDiscounts,
  taxCategories, productTaxCategories, orderItemTaxes, orderItemDiscounts,
  portionReservations, qrRateLimits,
  invRecipes, invShortages,
  hrSettings, hrWeeklySchedules, hrScheduleDays, hrTimePunches, serviceChargeLedger, serviceChargePayouts,
  hrExtraTypes, hrPayrollExtras,
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
  type InsertPortionReservation,
  type PortionReservation,
  type QrRateLimit,
  type HrSettings, type InsertHrSettings,
  type HrWeeklySchedule, type InsertHrWeeklySchedule,
  type HrScheduleDay, type InsertHrScheduleDay,
  type HrTimePunch, type InsertHrTimePunch,
  type ServiceChargeLedgerEntry, type InsertServiceChargeLedgerEntry,
  type ServiceChargePayout, type InsertServiceChargePayout,
} from "@shared/schema";
import bcrypt from "bcryptjs";
import { getTenantTimezone, getBusinessDateInTZ } from "./utils/timezone";

export async function getBusinessDate(schema?: string): Promise<string> {
  const tz = await getTenantTimezone(schema || process.env.TENANT_SCHEMA || "public");
  return getBusinessDateInTZ(tz);
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
  const [user] = await db.update(users).set({ pin: hash, pinFailedAttempts: 0, pinLockedUntil: null }).where(eq(users.id, userId)).returning();
  return user;
}

export async function resetPin(userId: number) {
  const [user] = await db.update(users).set({ pin: null, pinFailedAttempts: 0, pinLockedUntil: null }).where(eq(users.id, userId)).returning();
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

export async function setResetToken(userId: number, token: string, expires: Date) {
  await db.update(users).set({ resetToken: token, resetTokenExpires: expires }).where(eq(users.id, userId));
}

export async function getUserByResetToken(token: string) {
  const [user] = await db.select().from(users).where(
    and(eq(users.resetToken, token), gte(users.resetTokenExpires, new Date()))
  );
  return user || null;
}

export async function resetPassword(userId: number, hashedPassword: string) {
  await db.update(users).set({ password: hashedPassword, resetToken: null, resetTokenExpires: null }).where(eq(users.id, userId));
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

const SYSTEM_PERMISSIONS: { key: string; description: string }[] = [
  { key: "MODULE_TABLES_VIEW", description: "Ver módulo de mesas" },
  { key: "MODULE_POS_VIEW", description: "Ver módulo POS" },
  { key: "MODULE_KDS_VIEW", description: "Ver módulo KDS" },
  { key: "MODULE_DASHBOARD_VIEW", description: "Ver módulo Dashboard" },
  { key: "MODULE_ADMIN_VIEW", description: "Ver módulo Administración" },
  { key: "MODULE_PRODUCTS_VIEW", description: "Ver módulo Productos" },
  { key: "POS_VIEW", description: "Acceso al punto de venta" },
  { key: "POS_PAY", description: "Procesar pagos" },
  { key: "POS_PRINT", description: "Imprimir tiquetes" },
  { key: "POS_EMAIL_TICKET", description: "Enviar tiquete por email" },
  { key: "POS_REOPEN", description: "Reabrir órdenes pagadas" },
  { key: "POS_SPLIT", description: "Dividir cuentas" },
  { key: "POS_VOID", description: "Anular pagos" },
  { key: "POS_VOID_ITEM", description: "Anular ítems en POS" },
  { key: "POS_VOID_ORDER", description: "Anular órdenes en POS" },
  { key: "POS_VOID_PAYMENT", description: "Anular pagos en POS" },
  { key: "POS_APPLY_DISCOUNT", description: "Aplicar descuentos en POS" },
  { key: "POS_SPLIT_ORDER", description: "Dividir órdenes en POS" },
  { key: "POS_VIEW_CASH_REPORT", description: "Ver desglose de totales por método de pago" },
  { key: "POS_EDIT_CUSTOMER_PREPAY", description: "Editar cliente antes del pago" },
  { key: "POS_EDIT_CUSTOMER_POSTPAY", description: "Editar cliente después del pago" },
  { key: "CASH_OPEN", description: "Abrir caja" },
  { key: "CASH_CLOSE", description: "Cerrar caja" },
  { key: "KDS_VIEW", description: "Ver pantalla de cocina" },
  { key: "ORDER_CREATE", description: "Crear órdenes" },
  { key: "ORDER_EDIT", description: "Editar órdenes" },
  { key: "QR_MANAGE", description: "Gestionar pedidos QR" },
  { key: "PAYMENT_CORRECT", description: "Anular pagos y reabrir órdenes" },
  { key: "ORDERITEM_VOID_POST_KDS", description: "Anular ítems ya enviados a cocina" },
  { key: "MODULE_HR_VIEW", description: "Ver módulo de Recursos Humanos" },
  { key: "HR_VIEW_SELF", description: "Ver su propio horario y marcas" },
  { key: "HR_CLOCK_IN_OUT_ALLOW", description: "Permitir marcar entrada/salida" },
  { key: "HR_VIEW_TEAM", description: "Ver horarios y marcas de todo el equipo" },
  { key: "HR_MANAGE_SCHEDULES", description: "Crear y editar horarios semanales" },
  { key: "HR_EDIT_PUNCHES", description: "Editar marcas de asistencia" },
  { key: "HR_MANAGE_SETTINGS", description: "Configurar ajustes de HR" },
  { key: "SERVICE_VIEW_REPORTS", description: "Ver reportes de cargo por servicio" },
  { key: "SERVICE_GENERATE_PAYOUTS", description: "Generar liquidaciones de servicio" },
  { key: "GEO_OVERRIDE", description: "Saltar validación de geofence" },
  { key: "MODULE_INV_VIEW", description: "Ver módulo de Inventario" },
  { key: "INV_VIEW", description: "Ver inventario" },
  { key: "INV_MANAGE_ITEMS", description: "Gestionar insumos de inventario" },
  { key: "INV_MANAGE_SUPPLIERS", description: "Gestionar proveedores" },
  { key: "INV_MANAGE_PO", description: "Gestionar órdenes de compra" },
  { key: "INV_RECEIVE_PO", description: "Recibir órdenes de compra" },
  { key: "INV_PHYSICAL_COUNT", description: "Realizar conteos físicos" },
  { key: "INV_MANAGE_RECIPES", description: "Gestionar recetas/BOM" },
  { key: "INV_VIEW_REPORTS", description: "Ver reportes de inventario" },
  { key: "SHORTAGES_VIEW", description: "Ver faltantes" },
  { key: "SHORTAGES_REPORT", description: "Reportar faltantes" },
  { key: "SHORTAGES_ACK", description: "Reconocer faltantes" },
  { key: "SHORTAGES_RESOLVE", description: "Resolver faltantes" },
  { key: "SHORTAGES_CLOSE", description: "Cerrar faltantes" },
  { key: "AUDIT_VIEW", description: "Ver auditoría de faltantes" },
  { key: "AUDIT_MANAGE", description: "Gestionar alertas de auditoría" },
  { key: "MENU_TOGGLE_AVAILABILITY", description: "Cambiar disponibilidad de productos" },
  { key: "VOID_AUTHORIZE", description: "Autorizar anulaciones de items enviados a cocina" },
];

export async function ensureSystemPermissions() {
  const existing = await db.select({ key: permissions.key }).from(permissions);
  const existingKeys = new Set(existing.map(p => p.key));
  const missing = SYSTEM_PERMISSIONS.filter(p => !existingKeys.has(p.key));
  if (missing.length > 0) {
    await db.insert(permissions).values(missing);
    console.log(`[system] Added ${missing.length} missing permissions: ${missing.map(p => p.key).join(", ")}`);
  }
}

const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  MANAGER: SYSTEM_PERMISSIONS.map(p => p.key),
  WAITER: [
    "MODULE_TABLES_VIEW", "MODULE_POS_VIEW", "MODULE_KDS_VIEW", "MODULE_HR_VIEW",
    "POS_VIEW", "ORDER_CREATE", "ORDER_EDIT", "QR_MANAGE",
    "KDS_VIEW", "HR_VIEW_SELF", "HR_CLOCK_IN_OUT_ALLOW",
    "SHORTAGES_VIEW", "SHORTAGES_REPORT",
    "MENU_TOGGLE_AVAILABILITY",
  ],
  CASHIER: [
    "MODULE_POS_VIEW", "MODULE_HR_VIEW",
    "POS_VIEW", "POS_PAY", "POS_PRINT", "POS_EMAIL_TICKET", "POS_SPLIT",
    "POS_VIEW_CASH_REPORT", "POS_EDIT_CUSTOMER_PREPAY",
    "CASH_OPEN", "CASH_CLOSE",
    "HR_VIEW_SELF", "HR_CLOCK_IN_OUT_ALLOW",
    "SHORTAGES_VIEW", "SHORTAGES_REPORT",
  ],
  COOK: [
    "MODULE_KDS_VIEW", "MODULE_HR_VIEW",
    "KDS_VIEW",
    "HR_VIEW_SELF", "HR_CLOCK_IN_OUT_ALLOW",
    "SHORTAGES_VIEW", "SHORTAGES_REPORT",
  ],
  STAFF: [
    "MODULE_HR_VIEW",
    "HR_VIEW_SELF", "HR_CLOCK_IN_OUT_ALLOW",
    "SHORTAGES_VIEW", "SHORTAGES_REPORT",
  ],
  KITCHEN: [
    "MODULE_HR_VIEW",
    "HR_VIEW_SELF", "HR_CLOCK_IN_OUT_ALLOW",
    "SHORTAGES_VIEW", "SHORTAGES_REPORT",
  ],
};

export async function seedDefaultRolePermissions() {
  let totalInserted = 0;
  for (const [role, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const existing = await db.select({ key: rolePermissions.permissionKey })
      .from(rolePermissions).where(eq(rolePermissions.role, role));
    const existingKeys = new Set(existing.map(r => r.key));
    const missing = keys.filter(k => !existingKeys.has(k));
    if (missing.length > 0) {
      await db.insert(rolePermissions).values(missing.map(key => ({ role, permissionKey: key })));
      totalInserted += missing.length;
    }
  }
  if (totalInserted > 0) {
    console.log(`[permissions] Seeded ${totalInserted} default role permissions`);
  } else {
    console.log(`[permissions] Default role permissions already set`);
  }
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

export async function getEffectivePermissions(userId: number): Promise<string[]> {
  const user = await getUser(userId);
  if (!user) return [];
  return getPermissionKeysForRole(user.role);
}

// Tables
export async function getAllTables(includeDeleted = false) {
  if (includeDeleted) {
    return db.select().from(tables).orderBy(asc(tables.sortOrder), asc(tables.id));
  }
  return db.select().from(tables).where(isNull(tables.deletedAt)).orderBy(asc(tables.sortOrder), asc(tables.id));
}

export async function getTable(id: number) {
  const [table] = await db.select().from(tables).where(eq(tables.id, id));
  return table;
}

export async function getTableByCode(code: string) {
  const [table] = await db.select().from(tables).where(and(eq(tables.tableCode, code), isNull(tables.deletedAt)));
  return table;
}

export async function softDeleteTable(id: number) {
  const [table] = await db.select().from(tables).where(eq(tables.id, id));
  if (!table) return null;
  if (table.deletedAt) return table;
  const suffix = `[DEL-${Date.now().toString(36)}]`;
  const [updated] = await db.update(tables).set({
    deletedAt: new Date(),
    tableCode: `${table.tableCode}-${suffix}`,
    tableName: `${table.tableName} ${suffix}`,
    active: false,
  }).where(eq(tables.id, id)).returning();
  return updated;
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

export async function getProductsByIds(ids: number[]) {
  if (ids.length === 0) return [];
  return db.select().from(products).where(inArray(products.id, ids));
}

export async function createProduct(data: InsertProduct) {
  const [product] = await db.insert(products).values(data).returning();
  return product;
}

export async function updateProduct(id: number, data: Partial<InsertProduct>) {
  const [product] = await db.update(products).set(data).where(eq(products.id, id)).returning();
  return product;
}

export async function decrementPortions(productId: number, qty: number, orderItemId?: number, actorUserId?: number) {
  if (orderItemId) {
    const [existing] = await db.select({ id: auditEvents.id }).from(auditEvents)
      .where(and(
        eq(auditEvents.action, "BASIC_STOCK_DEDUCT"),
        eq(auditEvents.entityType, "order_item"),
        eq(auditEvents.entityId, orderItemId),
      ))
      .limit(1);
    if (existing) return;
  }

  const product = await getProduct(productId);
  if (!product || product.availablePortions === null) return;
  const newPortions = Math.max(0, product.availablePortions - qty);
  const wasActive = product.active;
  const active = newPortions > 0;
  await db.update(products).set({ availablePortions: newPortions, active }).where(eq(products.id, productId));

  if (orderItemId) {
    await db.insert(auditEvents).values({
      actorType: actorUserId ? "USER" : "SYSTEM",
      actorUserId: actorUserId || null,
      action: "BASIC_STOCK_DEDUCT",
      entityType: "order_item",
      entityId: orderItemId,
      metadata: { productId, productName: product.name, qty, previousPortions: product.availablePortions, newPortions },
    });
  }

  if (wasActive && !active) {
    await db.insert(auditEvents).values({
      actorType: "SYSTEM",
      actorUserId: actorUserId || null,
      action: "BASIC_AUTO_DISABLE",
      entityType: "product",
      entityId: productId,
      metadata: { productName: product.name, lastQtyDeducted: qty, orderItemId: orderItemId || null },
    });
  }

  return { productId, newPortions, autoDisabled: wasActive && !active };
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
      inArray(orders.status, ["OPEN", "IN_KITCHEN", "PREPARING", "READY"]),
      sql`${orders.parentOrderId} IS NULL`
    ));
  return order;
}

export async function getOpenOrdersForTable(tableId: number) {
  return db.select().from(orders)
    .where(and(
      eq(orders.tableId, tableId),
      inArray(orders.status, ["OPEN", "IN_KITCHEN", "PREPARING", "READY"])
    ));
}

export async function getOpenOrders() {
  return db.select().from(orders)
    .where(inArray(orders.status, ["OPEN", "IN_KITCHEN", "PREPARING", "READY"]));
}

export async function getChildOrders(parentOrderId: number) {
  return db.select().from(orders)
    .where(eq(orders.parentOrderId, parentOrderId));
}

export async function moveOrderItem(itemId: number, newOrderId: number) {
  const [item] = await db.update(orderItems)
    .set({ orderId: newOrderId })
    .where(eq(orderItems.id, itemId))
    .returning();
  await db.update(salesLedgerItems)
    .set({ orderId: newOrderId })
    .where(eq(salesLedgerItems.orderItemId, itemId));
  return item;
}

export async function createChildOrder(data: {
  tableId: number;
  status: string;
  responsibleWaiterId: number | null;
  businessDate: string;
  totalAmount: string;
  parentOrderId: number;
  splitIndex: number;
  dailyNumber: number;
  globalNumber: number | null;
}) {
  const [order] = await db.insert(orders).values({
    tableId: data.tableId,
    status: data.status,
    responsibleWaiterId: data.responsibleWaiterId,
    businessDate: data.businessDate,
    totalAmount: data.totalAmount,
    parentOrderId: data.parentOrderId,
    splitIndex: data.splitIndex,
    dailyNumber: data.dailyNumber,
    globalNumber: data.globalNumber,
  }).returning();
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

  if (items.length === 0) {
    const order = await getOrder(orderId);
    const paidAmount = Number(order?.paidAmount || 0);
    const balanceDue = Math.max(0, 0 - paidAmount);
    await db.update(orders).set({ totalAmount: "0.00", balanceDue: balanceDue.toFixed(2) }).where(eq(orders.id, orderId));
    return 0;
  }

  const itemIds = items.map(i => i.id);

  const [allMods, allDiscounts] = await Promise.all([
    getOrderItemModifiersByItemIds(itemIds),
    getOrderItemDiscountsByItemIds(itemIds),
  ]);

  const modsMap = new Map<number, typeof allMods>();
  for (const m of allMods) {
    if (!modsMap.has(m.orderItemId)) modsMap.set(m.orderItemId, []);
    modsMap.get(m.orderItemId)!.push(m);
  }
  const discountsMap = new Map<number, typeof allDiscounts>();
  for (const d of allDiscounts) {
    if (!discountsMap.has(d.orderItemId)) discountsMap.set(d.orderItemId, []);
    discountsMap.get(d.orderItemId)!.push(d);
  }

  await db.delete(orderItemTaxes).where(inArray(orderItemTaxes.orderItemId, itemIds));

  const uniqueProductIds = Array.from(new Set(items.filter(i => !i.taxSnapshotJson || !Array.isArray(i.taxSnapshotJson) || (i.taxSnapshotJson as any[]).length === 0).map(i => i.productId)));
  const [allTaxCats, allProdTaxCats] = await Promise.all([
    uniqueProductIds.length > 0 ? getAllTaxCategories() : Promise.resolve([]),
    uniqueProductIds.length > 0 ? getProductTaxCategoriesByProductIds(uniqueProductIds) : Promise.resolve([]),
  ]);
  const productTaxMap = new Map<number, typeof allProdTaxCats>();
  for (const ptc of allProdTaxCats) {
    if (!productTaxMap.has(ptc.productId)) productTaxMap.set(ptc.productId, []);
    productTaxMap.get(ptc.productId)!.push(ptc);
  }

  let subtotal = 0;
  let totalDiscountsAmt = 0;
  let totalTaxes = 0;
  let totalInclusiveTaxes = 0;

  const taxInserts: any[] = [];

  for (const item of items) {
    const mods = modsMap.get(item.id) || [];
    const modTotal = mods.reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
    const lineSubtotal = (Number(item.productPriceSnapshot) + modTotal) * item.qty;
    subtotal += lineSubtotal;

    const itemDiscounts = discountsMap.get(item.id) || [];
    const discountAmount = itemDiscounts.reduce((s, d) => s + Number(d.amountApplied), 0);
    totalDiscountsAmt += discountAmount;

    const discountedSubtotal = lineSubtotal - discountAmount;

    if (item.taxSnapshotJson && Array.isArray(item.taxSnapshotJson) && (item.taxSnapshotJson as any[]).length > 0) {
      const snapTaxes = item.taxSnapshotJson as { taxCategoryId: number; name: string; rate: number | string; inclusive: boolean }[];
      for (const st of snapTaxes) {
        const rate = Number(st.rate);
        let taxAmount: number;
        if (st.inclusive) {
          taxAmount = Math.round(discountedSubtotal * rate / (100 + rate) * 100) / 100;
          totalInclusiveTaxes += taxAmount;
        } else {
          taxAmount = Math.round(discountedSubtotal * rate / 100 * 100) / 100;
          totalTaxes += taxAmount;
        }
        taxInserts.push({
          orderItemId: item.id,
          taxCategoryId: st.taxCategoryId,
          taxNameSnapshot: st.name,
          taxRateSnapshot: String(st.rate),
          inclusiveSnapshot: st.inclusive,
          taxAmount: taxAmount.toFixed(2),
        });
      }
    } else {
      const taxesForItem = productTaxMap.get(item.productId) || [];
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
          taxInserts.push({
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
  }

  if (taxInserts.length > 0) {
    await db.insert(orderItemTaxes).values(taxInserts);
  }

  const total = subtotal - totalDiscountsAmt + totalTaxes;
  const order = await getOrder(orderId);
  const paidAmount = Number(order?.paidAmount || 0);
  const balanceDue = total - paidAmount;
  await db.update(orders).set({
    totalAmount: total.toFixed(2),
    balanceDue: balanceDue.toFixed(2),
  }).where(eq(orders.id, orderId));
  return total;
}

export async function updateOrderPaymentTotals(orderId: number) {
  const orderPayments = await db.select().from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.status, "PAID")));
  const paidAmount = orderPayments.reduce((s, p) => s + Number(p.amount), 0);
  const order = await getOrder(orderId);
  const totalAmount = Number(order?.totalAmount || 0);
  const balanceDue = Math.max(0, totalAmount - paidAmount);
  await db.update(orders).set({
    paidAmount: paidAmount.toFixed(2),
    balanceDue: balanceDue.toFixed(2),
  }).where(eq(orders.id, orderId));
  return { paidAmount, balanceDue, totalAmount };
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
    .where(and(eq(qrSubmissions.orderId, orderId), eq(qrSubmissions.status, "SUBMITTED")));
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

export async function getActiveKitchenTickets(destination?: string) {
  const conditions = [ne(kitchenTickets.status, "READY"), isNull(kitchenTickets.clearedAt)];
  if (destination) conditions.push(eq(kitchenTickets.kdsDestination, destination));
  return db.select().from(kitchenTickets)
    .where(and(...conditions))
    .orderBy(asc(kitchenTickets.createdAt));
}

export async function getHistoryKitchenTickets(destination?: string) {
  const conditions = [eq(kitchenTickets.status, "READY"), isNull(kitchenTickets.clearedAt)];
  if (destination) conditions.push(eq(kitchenTickets.kdsDestination, destination));
  return db.select().from(kitchenTickets)
    .where(and(...conditions))
    .orderBy(desc(kitchenTickets.createdAt));
}

export async function updateKitchenTicket(id: number, data: any) {
  const [ticket] = await db.update(kitchenTickets).set(data).where(eq(kitchenTickets.id, id)).returning();
  return ticket;
}

export async function clearKitchenHistory(destination?: string) {
  const conditions = [eq(kitchenTickets.status, "READY"), isNull(kitchenTickets.clearedAt)];
  if (destination) conditions.push(eq(kitchenTickets.kdsDestination, destination));
  await db.update(kitchenTickets)
    .set({ clearedAt: new Date() })
    .where(and(...conditions));
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

export async function getKitchenTicketItemsByTicketIds(ticketIds: number[]) {
  if (ticketIds.length === 0) return [];
  return db.select({
    id: kitchenTicketItems.id,
    kitchenTicketId: kitchenTicketItems.kitchenTicketId,
    orderItemId: kitchenTicketItems.orderItemId,
    productNameSnapshot: kitchenTicketItems.productNameSnapshot,
    qty: kitchenTicketItems.qty,
    notes: kitchenTicketItems.notes,
    status: kitchenTicketItems.status,
    prepStartedAt: kitchenTicketItems.prepStartedAt,
    readyAt: kitchenTicketItems.readyAt,
    kitchenItemGroupId: kitchenTicketItems.kitchenItemGroupId,
    seqInGroup: kitchenTicketItems.seqInGroup,
    customerNameSnapshot: orderItems.customerNameSnapshot,
  })
    .from(kitchenTicketItems)
    .leftJoin(orderItems, eq(kitchenTicketItems.orderItemId, orderItems.id))
    .where(inArray(kitchenTicketItems.kitchenTicketId, ticketIds));
}

export async function getKitchenTicketItemsByGroupId(groupId: string) {
  return db.select().from(kitchenTicketItems)
    .where(eq(kitchenTicketItems.kitchenItemGroupId, groupId));
}

export async function updateKitchenTicketItem(id: number, data: any) {
  const [item] = await db.update(kitchenTicketItems).set(data).where(eq(kitchenTicketItems.id, id)).returning();
  return item;
}

export async function getKitchenTicketByItemId(kitchenTicketItemId: number) {
  const [item] = await db.select().from(kitchenTicketItems).where(eq(kitchenTicketItems.id, kitchenTicketItemId));
  if (!item) return null;
  const [ticket] = await db.select().from(kitchenTickets).where(eq(kitchenTickets.id, item.kitchenTicketId));
  return ticket || null;
}

export async function voidKitchenTicketItemsByOrderItem(orderItemId: number, qtyToVoid: number, isFullVoid: boolean) {
  if (isFullVoid) {
    await db.update(kitchenTicketItems)
      .set({ status: "VOIDED" })
      .where(eq(kitchenTicketItems.orderItemId, orderItemId));
  } else {
    const items = await db.select().from(kitchenTicketItems)
      .where(and(eq(kitchenTicketItems.orderItemId, orderItemId), ne(kitchenTicketItems.status, "VOIDED")));
    let remaining = qtyToVoid;
    for (const kti of items) {
      if (remaining <= 0) break;
      const deduct = Math.min(kti.qty, remaining);
      remaining -= deduct;
      const newQty = kti.qty - deduct;
      if (newQty <= 0) {
        await db.update(kitchenTicketItems).set({ status: "VOIDED", qty: 0 }).where(eq(kitchenTicketItems.id, kti.id));
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

export async function bulkMoveSplitItems(orderItemIds: number[], fromSplitId: number | null, toSplitId: number | null) {
  if (orderItemIds.length === 0) return;
  await db.transaction(async (tx) => {
    if (fromSplitId) {
      await tx.delete(splitItems).where(
        and(
          eq(splitItems.splitId, fromSplitId),
          inArray(splitItems.orderItemId, orderItemIds)
        )
      );
    }
    if (toSplitId) {
      await tx.insert(splitItems).values(
        orderItemIds.map(orderItemId => ({ splitId: toSplitId, orderItemId }))
      ).onConflictDoNothing();
    }
  });
}

export async function getPaymentsForOrder(orderId: number) {
  return db.select().from(payments).where(eq(payments.orderId, orderId));
}

export async function voidPayment(id: number, voidedByUserId: number, voidReason?: string) {
  const [payment] = await db.update(payments).set({
    status: "VOIDED",
    voidedByUserId,
    voidedAt: new Date(),
    voidReason,
  }).where(eq(payments.id, id)).returning();
  return payment;
}

export async function getPaymentsByDateGrouped(date: string) {
  const allPayments = await db.select().from(payments)
    .where(and(eq(payments.businessDate, date), eq(payments.status, "PAID")));
  const allMethods = await db.select().from(paymentMethods).where(eq(paymentMethods.active, true)).orderBy(paymentMethods.sortOrder);
  const methodMap = new Map(allMethods.map(m => [m.id, m.paymentName]));

  const grouped: Record<string, number> = {};
  for (const m of allMethods) {
    grouped[m.paymentName] = 0;
  }
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
  await db.delete(orderItemModifiers).where(eq(orderItemModifiers.orderItemId, id));
  await db.delete(orderItemTaxes).where(eq(orderItemTaxes.orderItemId, id));
  await db.delete(orderItemDiscounts).where(eq(orderItemDiscounts.orderItemId, id));
  await db.delete(salesLedgerItems).where(eq(salesLedgerItems.orderItemId, id));
  await db.delete(splitItems).where(eq(splitItems.orderItemId, id));
  await db.delete(kitchenTicketItems).where(eq(kitchenTicketItems.orderItemId, id));
  await db.delete(voidedItems).where(eq(voidedItems.orderItemId, id));
  await db.delete(orderItems).where(eq(orderItems.id, id));
}

export async function getOrderItem(id: number) {
  const [item] = await db.select().from(orderItems).where(eq(orderItems.id, id));
  return item;
}

export async function incrementPortions(productId: number, qty: number, orderItemId?: number, actorUserId?: number) {
  if (orderItemId) {
    const [existing] = await db.select({ id: auditEvents.id }).from(auditEvents)
      .where(and(
        eq(auditEvents.action, "BASIC_STOCK_RESTORE"),
        eq(auditEvents.entityType, "order_item"),
        eq(auditEvents.entityId, orderItemId),
      ))
      .limit(1);
    if (existing) return;
  }

  const product = await getProduct(productId);
  if (!product || product.availablePortions === null) return;
  const newPortions = product.availablePortions + qty;
  await db.update(products).set({ availablePortions: newPortions, active: true }).where(eq(products.id, productId));

  if (orderItemId) {
    await db.insert(auditEvents).values({
      actorType: actorUserId ? "USER" : "SYSTEM",
      actorUserId: actorUserId || null,
      action: "BASIC_STOCK_RESTORE",
      entityType: "order_item",
      entityId: orderItemId,
      metadata: { productId, productName: product.name, qty, previousPortions: product.availablePortions, newPortions },
    });
  }
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

export async function getPaidOrdersForDate(date?: string, schema?: string) {
  const targetDate = date || await getBusinessDate(schema);
  return db.select().from(orders)
    .where(and(eq(orders.status, "PAID"), eq(orders.businessDate, targetDate)))
    .orderBy(desc(orders.closedAt));
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
  const allMethods = await db.select().from(paymentMethods).where(eq(paymentMethods.active, true)).orderBy(paymentMethods.sortOrder);
  const methodMap = new Map(allMethods.map(m => [m.id, m.paymentName]));

  const grouped: Record<string, number> = {};
  for (const m of allMethods) {
    grouped[m.paymentName] = 0;
  }
  for (const p of allPayments) {
    const methodName = methodMap.get(p.paymentMethodId) || "Otro";
    grouped[methodName] = (grouped[methodName] || 0) + Number(p.amount);
  }
  return grouped;
}

// Dashboard queries
export async function getDashboardData(dateFrom?: string, dateTo?: string, hourFrom?: number, hourTo?: number, schema?: string, tz?: string) {
  const today = await getBusinessDate(schema);
  const fromDate = dateFrom || today;
  const toDate = dateTo || fromDate;

  let allOrders = fromDate === toDate
    ? await db.select().from(orders).where(eq(orders.businessDate, fromDate))
    : await db.select().from(orders).where(
        and(gte(orders.businessDate, fromDate), lte(orders.businessDate, toDate))
      );

  const validHourFilter = hourFrom !== undefined && hourTo !== undefined
    && !isNaN(hourFrom) && !isNaN(hourTo) && hourFrom >= 0 && hourTo <= 23 && hourFrom <= hourTo;

  const dashTz = tz || "America/Costa_Rica";
  const getCRHour = (dateVal: any): number => {
    const d = new Date(dateVal);
    const crTime = new Date(d.toLocaleString("en-US", { timeZone: dashTz }));
    return crTime.getHours();
  };

  const filterByHour = <T extends { [key: string]: any }>(items: T[], dateField: string): T[] => {
    if (!validHourFilter) return items;
    return items.filter(item => {
      const dateVal = item[dateField];
      if (!dateVal) return false;
      const h = getCRHour(dateVal);
      return h >= hourFrom! && h <= hourTo!;
    });
  };

  if (validHourFilter) {
    allOrders = allOrders.filter(o => {
      if (!o.openedAt) return false;
      const h = getCRHour(o.openedAt);
      return h >= hourFrom! && h <= hourTo!;
    });
  }

  const openOrders = allOrders.filter(o => o.status === "OPEN" || o.status === "IN_KITCHEN" || o.status === "PREPARING" || o.status === "READY");
  const cancelledOrders = allOrders.filter(o => o.status === "CANCELLED" || o.status === "VOID");

  const paidOrdersFromAllOrders = allOrders.filter(o => o.status === "PAID");
  const paidOrderIds = new Set(paidOrdersFromAllOrders.map(o => o.id));

  let crossDayPaidPayments = fromDate === toDate
    ? await db.select().from(payments).where(and(eq(payments.businessDate, fromDate), eq(payments.status, "PAID")))
    : await db.select().from(payments).where(and(gte(payments.businessDate, fromDate), lte(payments.businessDate, toDate), eq(payments.status, "PAID")));
  crossDayPaidPayments = filterByHour(crossDayPaidPayments, "paidAt");

  const crossDayOrderIds = Array.from(new Set(crossDayPaidPayments.map(p => p.orderId).filter(id => id && !paidOrderIds.has(id))));
  let crossDayOrders: typeof allOrders = [];
  if (crossDayOrderIds.length > 0) {
    crossDayOrders = await db.select().from(orders).where(and(inArray(orders.id, crossDayOrderIds as number[]), eq(orders.status, "PAID")));
  }

  const paidOrders = [...paidOrdersFromAllOrders, ...crossDayOrders];

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

  const allRelevantOrderIds = [...openOrders, ...paidOrders].map(o => o.id);
  const paidOrderIds_forTax = paidOrders.map(o => o.id);
  let totalDiscounts = 0;
  let totalTaxes = 0;
  const taxBreakdown: { taxName: string; taxRate: number; inclusive: boolean; totalAmount: number }[] = [];
  if (allRelevantOrderIds.length > 0) {
    const discountRows = await db.select({ amountApplied: orderItemDiscounts.amountApplied })
      .from(orderItemDiscounts)
      .where(inArray(orderItemDiscounts.orderId, allRelevantOrderIds));
    totalDiscounts = discountRows.reduce((s, d) => s + Number(d.amountApplied || 0), 0);
  }
  if (paidOrderIds_forTax.length > 0) {
    const taxRows = await db.select({
      taxNameSnapshot: orderItemTaxes.taxNameSnapshot,
      taxRateSnapshot: orderItemTaxes.taxRateSnapshot,
      inclusiveSnapshot: orderItemTaxes.inclusiveSnapshot,
      taxAmount: orderItemTaxes.taxAmount,
    })
      .from(orderItemTaxes)
      .innerJoin(orderItems, eq(orderItemTaxes.orderItemId, orderItems.id))
      .where(inArray(orderItems.orderId, paidOrderIds_forTax));

    const taxMap = new Map<string, { taxName: string; taxRate: number; inclusive: boolean; totalAmount: number }>();
    for (const row of taxRows) {
      const key = `${row.taxNameSnapshot}|${row.taxRateSnapshot}|${row.inclusiveSnapshot}`;
      const existing = taxMap.get(key);
      if (existing) {
        existing.totalAmount += Number(row.taxAmount);
      } else {
        taxMap.set(key, {
          taxName: row.taxNameSnapshot,
          taxRate: Number(row.taxRateSnapshot),
          inclusive: row.inclusiveSnapshot,
          totalAmount: Number(row.taxAmount),
        });
      }
    }
    Array.from(taxMap.values()).forEach(v => {
      v.totalAmount = Number(v.totalAmount.toFixed(2));
      taxBreakdown.push(v);
      totalTaxes += v.totalAmount;
    });
    totalTaxes = Number(totalTaxes.toFixed(2));
  }

  return {
    openOrders: { count: openOrders.length, amount: sumAmount(openOrders), orders: mapOrders(openOrders) },
    paidOrders: { count: paidOrders.length, amount: sumAmount(paidOrders), orders: mapOrders(paidOrders) },
    cancelledOrders: { count: cancelledOrders.length, amount: sumAmount(cancelledOrders), orders: mapOrders(cancelledOrders) },
    totalDiscounts,
    totalTaxes,
    taxBreakdown,
    voidedItemsSummary: await (async () => {
      const voidedUserIds = Array.from(new Set(todayVoidedItems.map(v => v.voidedByUserId).filter(Boolean))) as number[];
      const voidedUsersMap = new Map<number, string>();
      if (voidedUserIds.length > 0) {
        const vUsers = await db.select().from(users).where(inArray(users.id, voidedUserIds));
        for (const u of vUsers) voidedUsersMap.set(u.id, u.displayName || u.username);
      }
      return {
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
          voidedBy: voidedUsersMap.get(v.voidedByUserId) || "—",
        })),
      };
    })(),
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
    paidAmount: Number(order.paidAmount || 0),
    balanceDue: Number(order.balanceDue || 0),
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

  const splitItemIds = toSplit.map(i => i.id);

  const [allMods, allLedger, allKti, allTaxes, allDiscounts] = await Promise.all([
    db.select().from(orderItemModifiers).where(inArray(orderItemModifiers.orderItemId, splitItemIds)),
    db.select().from(salesLedgerItems).where(inArray(salesLedgerItems.orderItemId, splitItemIds)),
    db.select().from(kitchenTicketItems).where(inArray(kitchenTicketItems.orderItemId, splitItemIds)),
    db.select().from(orderItemTaxes).where(inArray(orderItemTaxes.orderItemId, splitItemIds)),
    db.select().from(orderItemDiscounts).where(inArray(orderItemDiscounts.orderItemId, splitItemIds)),
  ]);

  const modsMap = new Map<number, typeof allMods>();
  for (const m of allMods) { if (!modsMap.has(m.orderItemId)) modsMap.set(m.orderItemId, []); modsMap.get(m.orderItemId)!.push(m); }
  const ledgerMap = new Map<number, typeof allLedger[0]>();
  for (const l of allLedger) { if (!ledgerMap.has(l.orderItemId)) ledgerMap.set(l.orderItemId, l); }
  const ktiMap = new Map<number, typeof allKti>();
  for (const k of allKti) { if (!ktiMap.has(k.orderItemId)) ktiMap.set(k.orderItemId, []); ktiMap.get(k.orderItemId)!.push(k); }
  const taxesMap = new Map<number, typeof allTaxes>();
  for (const t of allTaxes) { if (!taxesMap.has(t.orderItemId)) taxesMap.set(t.orderItemId, []); taxesMap.get(t.orderItemId)!.push(t); }
  const discountsMap = new Map<number, typeof allDiscounts>();
  for (const d of allDiscounts) { if (!discountsMap.has(d.orderItemId)) discountsMap.set(d.orderItemId, []); discountsMap.get(d.orderItemId)!.push(d); }

  let newCount = 0;

  await db.transaction(async (tx) => {
    for (const item of toSplit) {
      const originalQty = item.qty;
      const existingModifiers = modsMap.get(item.id) || [];
      const existingLedger = ledgerMap.get(item.id) || null;
      const existingKitchenItems = ktiMap.get(item.id) || [];
      const existingTaxes = taxesMap.get(item.id) || [];
      const existingItemDiscounts = discountsMap.get(item.id) || [];

      await tx.update(orderItems).set({ qty: 1 }).where(eq(orderItems.id, item.id));

      if (existingLedger) {
        await tx.update(salesLedgerItems).set({
          qty: 1,
          lineSubtotal: existingLedger.unitPrice,
        }).where(eq(salesLedgerItems.id, existingLedger.id));
      }

      if (existingKitchenItems.length > 0) {
        const ktiIds = existingKitchenItems.map(k => k.id);
        await tx.update(kitchenTicketItems).set({ qty: 1 }).where(inArray(kitchenTicketItems.id, ktiIds));
      }

      const newModInserts: any[] = [];
      const newLedgerInserts: any[] = [];
      const newKtiInserts: any[] = [];
      const newTaxInserts: any[] = [];
      const newDiscountInserts: any[] = [];

      for (let i = 1; i < originalQty; i++) {
        const [newItem] = await tx.insert(orderItems).values({
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
          newModInserts.push({
            orderItemId: newItem.id,
            modifierOptionId: mod.modifierOptionId,
            nameSnapshot: mod.nameSnapshot,
            priceDeltaSnapshot: mod.priceDeltaSnapshot,
            qty: mod.qty,
          });
        }

        if (existingLedger) {
          newLedgerInserts.push({
            businessDate: existingLedger.businessDate,
            tableId: existingLedger.tableId,
            tableNameSnapshot: existingLedger.tableNameSnapshot,
            orderId: existingLedger.orderId,
            orderItemId: newItem.id,
            productId: existingLedger.productId,
            productCodeSnapshot: existingLedger.productCodeSnapshot,
            productNameSnapshot: existingLedger.productNameSnapshot,
            categoryId: existingLedger.categoryId,
            categoryCodeSnapshot: existingLedger.categoryCodeSnapshot,
            categoryNameSnapshot: existingLedger.categoryNameSnapshot,
            qty: 1,
            unitPrice: existingLedger.unitPrice,
            lineSubtotal: existingLedger.unitPrice,
            origin: existingLedger.origin,
            createdByUserId: existingLedger.createdByUserId,
            responsibleWaiterId: existingLedger.responsibleWaiterId,
            status: existingLedger.status,
            sentToKitchenAt: existingLedger.sentToKitchenAt,
            kdsReadyAt: existingLedger.kdsReadyAt,
            paidAt: existingLedger.paidAt,
          });
        }

        if (existingKitchenItems.length > 0) {
          const kti = existingKitchenItems[0];
          newKtiInserts.push({
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

        for (const tax of existingTaxes) {
          const perUnitTax = Number(tax.taxAmount) / originalQty;
          newTaxInserts.push({
            orderItemId: newItem.id,
            taxCategoryId: tax.taxCategoryId,
            taxNameSnapshot: tax.taxNameSnapshot,
            taxRateSnapshot: tax.taxRateSnapshot,
            inclusiveSnapshot: tax.inclusiveSnapshot,
            taxAmount: perUnitTax.toFixed(2),
          });
        }

        for (const disc of existingItemDiscounts) {
          const perUnitDiscount = Number(disc.amountApplied) / originalQty;
          newDiscountInserts.push({
            orderItemId: newItem.id,
            orderId: disc.orderId,
            discountName: disc.discountName,
            discountType: disc.discountType,
            discountValue: disc.discountValue,
            amountApplied: perUnitDiscount.toFixed(2),
            appliedByUserId: disc.appliedByUserId,
          });
        }

        newCount++;
      }

      if (newModInserts.length > 0) await tx.insert(orderItemModifiers).values(newModInserts);
      if (newLedgerInserts.length > 0) await tx.insert(salesLedgerItems).values(newLedgerInserts);
      if (newKtiInserts.length > 0) await tx.insert(kitchenTicketItems).values(newKtiInserts);
      if (newTaxInserts.length > 0) await tx.insert(orderItemTaxes).values(newTaxInserts);
      if (newDiscountInserts.length > 0) await tx.insert(orderItemDiscounts).values(newDiscountInserts);
    }
  });

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

export async function getProductTaxCategoriesByProductIds(productIds: number[]) {
  if (productIds.length === 0) return [];
  return db.select().from(productTaxCategories).where(inArray(productTaxCategories.productId, productIds));
}

export async function setProductTaxCategories(productId: number, taxCategoryIds: number[]) {
  await db.delete(productTaxCategories).where(eq(productTaxCategories.productId, productId));
  if (taxCategoryIds.length > 0) {
    await db.insert(productTaxCategories).values(
      taxCategoryIds.map(tcId => ({ productId, taxCategoryId: tcId }))
    );
  }
}

export async function applyTaxToAllProducts(taxCategoryId: number) {
  const allProds = await db.select({ id: products.id }).from(products);
  const productIdSet = new Set(allProds.map(p => p.id));

  const allPtc = await db.select().from(productTaxCategories);
  const orphaned = allPtc.filter(ptc => !productIdSet.has(ptc.productId));
  if (orphaned.length > 0) {
    for (const o of orphaned) {
      await db.delete(productTaxCategories).where(
        and(eq(productTaxCategories.productId, o.productId), eq(productTaxCategories.taxCategoryId, o.taxCategoryId))
      );
    }
  }

  const existing = await db.select().from(productTaxCategories)
    .where(eq(productTaxCategories.taxCategoryId, taxCategoryId));
  const existingSet = new Set(existing.map(e => e.productId));
  const toInsert = allProds.filter(p => !existingSet.has(p.id));
  if (toInsert.length > 0) {
    await db.insert(productTaxCategories).values(
      toInsert.map(p => ({ productId: p.id, taxCategoryId }))
    );
  }
  return {
    message: `Impuesto aplicado a ${toInsert.length} productos nuevos (${existingSet.size} ya lo tenían). ${orphaned.length} asignaciones huérfanas eliminadas.`,
    added: toInsert.length,
    skipped: existingSet.size,
    orphansRemoved: orphaned.length,
  };
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

export async function getAllOpenOrders() {
  return db.select().from(orders)
    .where(inArray(orders.status, ["OPEN", "IN_KITCHEN", "PREPARING", "READY"]));
}

export async function getActiveItemCountsByOrderIds(orderIds: number[]): Promise<Map<number, number>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select({ orderId: orderItems.orderId, cnt: count() })
    .from(orderItems)
    .where(and(
      inArray(orderItems.orderId, orderIds),
      sql`${orderItems.status} NOT IN ('VOIDED','PAID','PENDING')`
    ))
    .groupBy(orderItems.orderId);
  return new Map(rows.map(r => [r.orderId, Number(r.cnt)]));
}

export async function getOrderItemsByOrderIds(orderIds: number[]) {
  if (orderIds.length === 0) return [];
  return db.select().from(orderItems)
    .where(inArray(orderItems.orderId, orderIds))
    .orderBy(asc(orderItems.roundNumber), asc(orderItems.id));
}

export async function getOrderItemModifiersByItemIds(itemIds: number[]) {
  if (itemIds.length === 0) return [];
  return db.select().from(orderItemModifiers).where(inArray(orderItemModifiers.orderItemId, itemIds));
}

export async function getOrderItemDiscountsByItemIds(itemIds: number[]) {
  if (itemIds.length === 0) return [];
  return db.select().from(orderItemDiscounts).where(inArray(orderItemDiscounts.orderItemId, itemIds));
}

export async function getOrderItemTaxesByItemIds(itemIds: number[]) {
  if (itemIds.length === 0) return [];
  return db.select().from(orderItemTaxes).where(inArray(orderItemTaxes.orderItemId, itemIds));
}

export async function getOrderItemModifiersByOrderIds(orderIds: number[]) {
  if (orderIds.length === 0) return [];
  return db.select({ mod: orderItemModifiers }).from(orderItemModifiers)
    .innerJoin(orderItems, eq(orderItemModifiers.orderItemId, orderItems.id))
    .where(inArray(orderItems.orderId, orderIds))
    .then(rows => rows.map(r => r.mod));
}

export async function getOrderItemTaxesByOrderIds(orderIds: number[]) {
  if (orderIds.length === 0) return [];
  return db.select({ tax: orderItemTaxes }).from(orderItemTaxes)
    .innerJoin(orderItems, eq(orderItemTaxes.orderItemId, orderItems.id))
    .where(inArray(orderItems.orderId, orderIds))
    .then(rows => rows.map(r => r.tax));
}

export async function getOrderItemDiscountsByOrderIds(orderIds: number[]) {
  if (orderIds.length === 0) return [];
  return db.select().from(orderItemDiscounts).where(inArray(orderItemDiscounts.orderId, orderIds));
}

export async function getSplitItemsByAccountIds(splitIds: number[]) {
  if (splitIds.length === 0) return [];
  return db.select().from(splitItems).where(inArray(splitItems.splitId, splitIds));
}

export async function getVoidedItemsByOrderIds(orderIds: number[]) {
  if (orderIds.length === 0) return [];
  return db.select().from(voidedItems).where(inArray(voidedItems.orderId, orderIds));
}

export async function getPendingSubmissionsByOrderIds(orderIds: number[]) {
  if (orderIds.length === 0) return [];
  return db.select().from(qrSubmissions)
    .where(and(inArray(qrSubmissions.orderId, orderIds), eq(qrSubmissions.status, "SUBMITTED")));
}

export async function getUsersByIds(userIds: number[]) {
  if (userIds.length === 0) return [];
  return db.select().from(users).where(inArray(users.id, userIds));
}

export async function getPaymentsByOrderIds(orderIds: number[]) {
  if (orderIds.length === 0) return [];
  return db.select().from(payments).where(inArray(payments.orderId, orderIds));
}

export async function createPortionReservation(data: InsertPortionReservation) {
  const [row] = await db.insert(portionReservations).values(data).returning();
  return row;
}

export async function expirePortionReservations() {
  const now = new Date();
  const expired = await db.select().from(portionReservations)
    .where(and(eq(portionReservations.status, "RESERVED"), lte(portionReservations.expiresAt, now)));
  for (const res of expired) {
    await db.update(portionReservations)
      .set({ status: "EXPIRED" })
      .where(eq(portionReservations.id, res.id));
    await incrementPortions(res.productId, res.qty);
  }
  return expired.length;
}

export async function consumePortionReservation(orderItemId: number) {
  await db.update(portionReservations)
    .set({ status: "CONSUMED" })
    .where(and(eq(portionReservations.orderItemId, orderItemId), eq(portionReservations.status, "RESERVED")));
}

export async function cancelPortionReservation(orderItemId: number) {
  const reservations = await db.select().from(portionReservations)
    .where(and(eq(portionReservations.orderItemId, orderItemId), eq(portionReservations.status, "RESERVED")));
  for (const res of reservations) {
    await db.update(portionReservations)
      .set({ status: "CANCELLED" })
      .where(eq(portionReservations.id, res.id));
    await incrementPortions(res.productId, res.qty);
  }
}

export async function getQrRateLimit(tableCode: string) {
  const [row] = await db.select().from(qrRateLimits).where(eq(qrRateLimits.tableCode, tableCode));
  return row;
}

export async function upsertQrRateLimit(tableCode: string) {
  const existing = await getQrRateLimit(tableCode);
  if (existing) {
    await db.update(qrRateLimits)
      .set({ lastSubmissionAt: new Date() })
      .where(eq(qrRateLimits.id, existing.id));
  } else {
    await db.insert(qrRateLimits).values({ tableCode, lastSubmissionAt: new Date() });
  }
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
  await db.delete(portionReservations);
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

// ==================== HR MODULE ====================

// -- HR Settings (singleton like businessConfig) --
export async function getHrSettings(): Promise<HrSettings | undefined> {
  const [s] = await db.select().from(hrSettings).limit(1);
  return s;
}

export async function upsertHrSettings(data: Partial<InsertHrSettings>): Promise<HrSettings> {
  const existing = await getHrSettings();
  if (existing) {
    const [updated] = await db.update(hrSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(hrSettings.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db.insert(hrSettings).values(data as InsertHrSettings).returning();
  return created;
}

// -- Weekly Schedules --
export async function getWeeklySchedule(employeeId: number, weekStartDate: string): Promise<HrWeeklySchedule | undefined> {
  const [s] = await db.select().from(hrWeeklySchedules)
    .where(and(eq(hrWeeklySchedules.employeeId, employeeId), eq(hrWeeklySchedules.weekStartDate, weekStartDate)));
  return s;
}

export async function getWeeklySchedulesByWeek(weekStartDate: string): Promise<HrWeeklySchedule[]> {
  return db.select().from(hrWeeklySchedules)
    .where(eq(hrWeeklySchedules.weekStartDate, weekStartDate));
}

export async function createWeeklySchedule(data: InsertHrWeeklySchedule): Promise<HrWeeklySchedule> {
  const [s] = await db.insert(hrWeeklySchedules).values(data).returning();
  return s;
}

export async function updateWeeklySchedule(id: number, data: Partial<InsertHrWeeklySchedule>): Promise<HrWeeklySchedule> {
  const [s] = await db.update(hrWeeklySchedules)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(hrWeeklySchedules.id, id))
    .returning();
  return s;
}

export async function deleteWeeklySchedule(id: number): Promise<void> {
  await db.delete(hrScheduleDays).where(eq(hrScheduleDays.scheduleId, id));
  await db.delete(hrWeeklySchedules).where(eq(hrWeeklySchedules.id, id));
}

// -- Schedule Days --
export async function getScheduleDays(scheduleId: number): Promise<HrScheduleDay[]> {
  return db.select().from(hrScheduleDays)
    .where(eq(hrScheduleDays.scheduleId, scheduleId))
    .orderBy(asc(hrScheduleDays.dayOfWeek));
}

export async function upsertScheduleDays(scheduleId: number, days: InsertHrScheduleDay[]): Promise<HrScheduleDay[]> {
  await db.delete(hrScheduleDays).where(eq(hrScheduleDays.scheduleId, scheduleId));
  if (days.length === 0) return [];
  const toInsert = days.map(d => ({ ...d, scheduleId }));
  return db.insert(hrScheduleDays).values(toInsert).returning();
}

// -- Time Punches --
export async function getTimePunch(id: number): Promise<HrTimePunch | undefined> {
  const [p] = await db.select().from(hrTimePunches).where(eq(hrTimePunches.id, id));
  return p;
}

export async function getOpenPunchForEmployee(employeeId: number): Promise<HrTimePunch | undefined> {
  const [p] = await db.select().from(hrTimePunches)
    .where(and(eq(hrTimePunches.employeeId, employeeId), isNull(hrTimePunches.clockOutAt)))
    .orderBy(desc(hrTimePunches.clockInAt))
    .limit(1);
  return p;
}

export async function deleteTimePunch(id: number): Promise<void> {
  await db.delete(hrTimePunches).where(eq(hrTimePunches.id, id));
}

export async function getTimePunchesByDate(businessDate: string): Promise<HrTimePunch[]> {
  return db.select().from(hrTimePunches)
    .where(eq(hrTimePunches.businessDate, businessDate))
    .orderBy(asc(hrTimePunches.clockInAt));
}

export async function getTimePunchesByEmployee(employeeId: number, dateFrom?: string, dateTo?: string): Promise<HrTimePunch[]> {
  const conditions = [eq(hrTimePunches.employeeId, employeeId)];
  if (dateFrom) conditions.push(gte(hrTimePunches.businessDate, dateFrom));
  if (dateTo) conditions.push(lte(hrTimePunches.businessDate, dateTo));
  return db.select().from(hrTimePunches)
    .where(and(...conditions))
    .orderBy(asc(hrTimePunches.clockInAt));
}

export async function getTimePunchesByDateRange(dateFrom: string, dateTo: string): Promise<HrTimePunch[]> {
  return db.select().from(hrTimePunches)
    .where(and(gte(hrTimePunches.businessDate, dateFrom), lte(hrTimePunches.businessDate, dateTo)))
    .orderBy(asc(hrTimePunches.employeeId), asc(hrTimePunches.clockInAt));
}

export async function getAllOpenPunches(): Promise<HrTimePunch[]> {
  return db.select().from(hrTimePunches)
    .where(isNull(hrTimePunches.clockOutAt));
}

export async function createTimePunch(data: InsertHrTimePunch): Promise<HrTimePunch> {
  const [p] = await db.insert(hrTimePunches).values(data).returning();
  return p;
}

export async function updateTimePunch(id: number, data: Partial<HrTimePunch>): Promise<HrTimePunch> {
  const { id: _id, ...rest } = data as any;
  const [p] = await db.update(hrTimePunches)
    .set({ ...rest, updatedAt: new Date() })
    .where(eq(hrTimePunches.id, id))
    .returning();
  return p;
}

// -- Service Charge Ledger --
export async function getServiceChargeByOrder(orderId: number): Promise<ServiceChargeLedgerEntry[]> {
  return db.select().from(serviceChargeLedger)
    .where(eq(serviceChargeLedger.orderId, orderId));
}

export async function getServiceChargeLedgerByDateRange(dateFrom: string, dateTo: string): Promise<ServiceChargeLedgerEntry[]> {
  return db.select().from(serviceChargeLedger)
    .where(and(
      gte(serviceChargeLedger.businessDate, dateFrom),
      lte(serviceChargeLedger.businessDate, dateTo),
      eq(serviceChargeLedger.status, "PAID")
    ))
    .orderBy(asc(serviceChargeLedger.businessDate));
}

export async function createServiceChargeLedgerEntry(data: InsertServiceChargeLedgerEntry): Promise<ServiceChargeLedgerEntry> {
  const [e] = await db.insert(serviceChargeLedger).values(data).returning();
  return e;
}

export async function voidServiceChargeByOrderItem(orderItemId: number): Promise<void> {
  await db.update(serviceChargeLedger)
    .set({ status: "VOIDED" })
    .where(eq(serviceChargeLedger.orderItemId, orderItemId));
}

export async function voidServiceChargeByOrder(orderId: number): Promise<void> {
  await db.update(serviceChargeLedger)
    .set({ status: "VOIDED" })
    .where(eq(serviceChargeLedger.orderId, orderId));
}

// -- Service Charge Payouts --
export async function getServiceChargePayouts(periodStart: string, periodEnd: string): Promise<ServiceChargePayout[]> {
  return db.select().from(serviceChargePayouts)
    .where(and(
      eq(serviceChargePayouts.periodStart, periodStart),
      eq(serviceChargePayouts.periodEnd, periodEnd)
    ))
    .orderBy(asc(serviceChargePayouts.employeeId));
}

export async function createServiceChargePayout(data: InsertServiceChargePayout): Promise<ServiceChargePayout> {
  const [p] = await db.insert(serviceChargePayouts).values(data).returning();
  return p;
}

export async function updateServiceChargePayoutStatus(id: number, status: string): Promise<ServiceChargePayout> {
  const [p] = await db.update(serviceChargePayouts)
    .set({ status })
    .where(eq(serviceChargePayouts.id, id))
    .returning();
  return p;
}

export async function deleteServiceChargePayoutsByPeriod(periodStart: string, periodEnd: string, status: string): Promise<void> {
  await db.delete(serviceChargePayouts)
    .where(and(
      eq(serviceChargePayouts.periodStart, periodStart),
      eq(serviceChargePayouts.periodEnd, periodEnd),
      eq(serviceChargePayouts.status, status)
    ));
}

export async function hasProductRelations(id: number): Promise<boolean> {
  const checks = await Promise.all([
    db.select({ c: sql<number>`count(*)` }).from(orderItems).where(eq(orderItems.productId, id)),
    db.select({ c: sql<number>`count(*)` }).from(salesLedgerItems).where(eq(salesLedgerItems.productId, id)),
    db.select({ c: sql<number>`count(*)` }).from(voidedItems).where(eq(voidedItems.productId, id)),
    db.select({ c: sql<number>`count(*)` }).from(invRecipes).where(eq(invRecipes.menuProductId, id)),
    db.select({ c: sql<number>`count(*)` }).from(invShortages).where(eq(invShortages.menuProductId, id)),
  ]);
  return checks.some(r => Number(r[0].c) > 0);
}

export async function hardDeleteProduct(id: number) {
  await db.delete(itemModifierGroups).where(eq(itemModifierGroups.productId, id));
  await db.delete(productTaxCategories).where(eq(productTaxCategories.productId, id));
  await db.delete(portionReservations).where(eq(portionReservations.productId, id));
  const [product] = await db.delete(products).where(eq(products.id, id)).returning();
  return product;
}

export async function smartDeleteProduct(id: number): Promise<{ product: any; hardDeleted: boolean }> {
  const hasRelations = await hasProductRelations(id);
  if (hasRelations) {
    const [product] = await db.update(products).set({ active: false }).where(eq(products.id, id)).returning();
    return { product, hardDeleted: false };
  }
  const product = await hardDeleteProduct(id);
  return { product, hardDeleted: true };
}

export async function getExtraTypes() {
  return db.select().from(hrExtraTypes).where(eq(hrExtraTypes.isActive, true));
}

export async function getPayrollExtrasByRange(dateFrom: string, dateTo: string, employeeId?: number) {
  const conditions = [
    eq(hrPayrollExtras.isDeleted, false),
    gte(hrPayrollExtras.appliesToDate, dateFrom),
    lte(hrPayrollExtras.appliesToDate, dateTo),
  ];
  if (employeeId) conditions.push(eq(hrPayrollExtras.employeeId, employeeId));
  return db.select().from(hrPayrollExtras).where(and(...conditions));
}

export async function createPayrollExtra(data: {
  employeeId: number; appliesToDate: string; typeCode: string;
  amount: string; note?: string; createdBy?: number;
}) {
  const [extra] = await db.insert(hrPayrollExtras).values({
    ...data,
    createdAt: new Date(),
  }).returning();
  return extra;
}

export async function updatePayrollExtra(id: number, data: {
  typeCode?: string; amount?: string; note?: string; updatedBy?: number;
}) {
  const [extra] = await db.update(hrPayrollExtras).set({
    ...data,
    updatedAt: new Date(),
  }).where(eq(hrPayrollExtras.id, id)).returning();
  return extra;
}

export async function softDeletePayrollExtra(id: number) {
  const [extra] = await db.update(hrPayrollExtras).set({
    isDeleted: true,
    updatedAt: new Date(),
  }).where(eq(hrPayrollExtras.id, id)).returning();
  return extra;
}

export async function getPayrollExtraById(id: number) {
  const [extra] = await db.select().from(hrPayrollExtras).where(eq(hrPayrollExtras.id, id));
  return extra;
}

export async function getServiceChargeLedgerByDates(dateFrom: string, dateTo: string) {
  return db.select().from(serviceChargeLedger)
    .where(and(
      gte(serviceChargeLedger.businessDate, dateFrom),
      lte(serviceChargeLedger.businessDate, dateTo),
    ));
}

export async function getAllSchedulesForDateRange(dateFrom: string, dateTo: string) {
  const mondayFrom = getWeekMondayForDate(dateFrom);
  const mondayTo = getWeekMondayForDate(dateTo);
  const schedules = await db.select().from(hrWeeklySchedules)
    .where(and(
      gte(hrWeeklySchedules.weekStartDate, mondayFrom),
      lte(hrWeeklySchedules.weekStartDate, mondayTo),
    ));
  const allDays = [];
  for (const s of schedules) {
    const days = await db.select().from(hrScheduleDays)
      .where(eq(hrScheduleDays.scheduleId, s.id));
    for (const d of days) {
      allDays.push({ ...d, employeeId: s.employeeId, weekStartDate: s.weekStartDate });
    }
  }
  return allDays;
}

function getWeekMondayForDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

export async function getPunchesForDateRange(dateFrom: string, dateTo: string) {
  return db.select().from(hrTimePunches)
    .where(and(
      gte(hrTimePunches.businessDate, dateFrom),
      lte(hrTimePunches.businessDate, dateTo),
    ));
}

export async function seedExtraTypes() {
  const defaults = [
    { typeCode: "BONO", name: "Bono", kind: "EARNING" },
    { typeCode: "VIATICO", name: "Viático", kind: "EARNING" },
    { typeCode: "REEMBOLSO", name: "Reembolso", kind: "EARNING" },
    { typeCode: "PRESTAMO_DEDUCCION", name: "Préstamo / Deducción", kind: "DEDUCTION" },
    { typeCode: "AJUSTE_POSITIVO", name: "Ajuste Positivo", kind: "EARNING" },
    { typeCode: "AJUSTE_NEGATIVO", name: "Ajuste Negativo", kind: "DEDUCTION" },
  ];
  for (const d of defaults) {
    await db.insert(hrExtraTypes).values(d).onConflictDoNothing();
  }
}

export async function seedTenantSchema(
  pool: import("pg").Pool,
  schemaName: string,
  businessName: string,
  sequences?: {
    orderDailyStart?: number;
    orderGlobalStart?: number;
    invoiceStart?: number;
  }
): Promise<void> {
  const s = schemaName;
  const dailyStart = sequences?.orderDailyStart ?? 1;
  const globalStart = sequences?.orderGlobalStart ?? 1;
  const invStart = sequences?.invoiceStart ?? 1;

  await pool.query(
    `INSERT INTO "${s}".business_config
       (business_name, legal_note, order_daily_start, order_global_start, invoice_start)
     VALUES ($1, 'Gracias por su preferencia', $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [businessName, dailyStart, globalStart, invStart]
  );

  const pmData = [
    { payment_code: "CASH", payment_name: "Efectivo", active: true, sort_order: 0 },
    { payment_code: "CARD", payment_name: "Tarjeta", active: true, sort_order: 1 },
    { payment_code: "SINPE", payment_name: "SINPE Móvil", active: true, sort_order: 2 },
  ];
  for (const pm of pmData) {
    await pool.query(
      `INSERT INTO "${s}".payment_methods (payment_code, payment_name, active, sort_order)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [pm.payment_code, pm.payment_name, pm.active, pm.sort_order]
    );
  }

  const catData = [
    { category_code: "TOP-COMIDAS", name: "Comidas", sort_order: 1 },
    { category_code: "TOP-BEBIDAS", name: "Bebidas", sort_order: 2 },
    { category_code: "TOP-POSTRES", name: "Postres", sort_order: 3 },
    { category_code: "TOP-ALCOHOL", name: "Alcohol", sort_order: 4 },
  ];
  for (const cat of catData) {
    await pool.query(
      `INSERT INTO "${s}".categories (category_code, name, active, sort_order)
       VALUES ($1, $2, true, $3) ON CONFLICT DO NOTHING`,
      [cat.category_code, cat.name, cat.sort_order]
    );
  }

  await pool.query(
    `INSERT INTO "${s}".hr_settings
       (lateness_grace_minutes, overtime_daily_threshold_hours)
     VALUES (10, 8) ON CONFLICT DO NOTHING`
  );

  for (const perm of SYSTEM_PERMISSIONS) {
    await pool.query(
      `INSERT INTO "${s}".permissions (key, description)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [perm.key, perm.description]
    );
  }

  for (const [role, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    for (const key of keys) {
      await pool.query(
        `INSERT INTO "${s}".role_permissions (role, permission_key)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [role, key]
      );
    }
  }

  const extraTypes = [
    { typeCode: "BONO", name: "Bono", kind: "EARNING" },
    { typeCode: "VIATICO", name: "Viático", kind: "EARNING" },
    { typeCode: "REEMBOLSO", name: "Reembolso", kind: "EARNING" },
    { typeCode: "PRESTAMO_DEDUCCION", name: "Préstamo / Deducción", kind: "DEDUCTION" },
    { typeCode: "AJUSTE_POSITIVO", name: "Ajuste Positivo", kind: "EARNING" },
    { typeCode: "AJUSTE_NEGATIVO", name: "Ajuste Negativo", kind: "DEDUCTION" },
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

