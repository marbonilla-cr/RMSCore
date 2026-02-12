import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
  serial,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("WAITER"),
  active: boolean("active").notNull().default(true),
  email: text("email"),
  pin: text("pin"),
  pinPlain: text("pin_plain"),
  pinFailedAttempts: integer("pin_failed_attempts").notNull().default(0),
  pinLockedUntil: timestamp("pin_locked_until"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const tables = pgTable("tables", {
  id: serial("id").primaryKey(),
  tableCode: text("table_code").notNull().unique(),
  tableName: text("table_name").notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  categoryCode: text("category_code").notNull().unique(),
  name: text("name").notNull(),
  parentCategoryCode: text("parent_category_code"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  productCode: text("product_code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  categoryId: integer("category_id"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  active: boolean("active").notNull().default(true),
  visibleQr: boolean("visible_qr").notNull().default(true),
  availablePortions: integer("available_portions"),
});

export const paymentMethods = pgTable("payment_methods", {
  id: serial("id").primaryKey(),
  paymentCode: text("payment_code").notNull().unique(),
  paymentName: text("payment_name").notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  tableId: integer("table_id").notNull(),
  status: text("status").notNull().default("OPEN"),
  responsibleWaiterId: integer("responsible_waiter_id"),
  openedAt: timestamp("opened_at").defaultNow(),
  closedAt: timestamp("closed_at"),
  businessDate: text("business_date").notNull(),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).default("0"),
  dailyNumber: integer("daily_number"),
  globalNumber: integer("global_number"),
  parentOrderId: integer("parent_order_id"),
  splitIndex: integer("split_index"),
});

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  productId: integer("product_id").notNull(),
  productNameSnapshot: text("product_name_snapshot").notNull(),
  productPriceSnapshot: numeric("product_price_snapshot", { precision: 10, scale: 2 }).notNull(),
  qty: integer("qty").notNull().default(1),
  notes: text("notes"),
  origin: text("origin").notNull().default("WAITER"),
  createdByUserId: integer("created_by_user_id"),
  responsibleWaiterId: integer("responsible_waiter_id"),
  status: text("status").notNull().default("PENDING"),
  roundNumber: integer("round_number").notNull().default(1),
  qrSubmissionId: integer("qr_submission_id"),
  sentToKitchenAt: timestamp("sent_to_kitchen_at"),
  createdAt: timestamp("created_at").defaultNow(),
  voidedAt: timestamp("voided_at"),
  voidedByUserId: integer("voided_by_user_id"),
});

export const qrSubmissions = pgTable("qr_submissions", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  tableId: integer("table_id").notNull(),
  status: text("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at").defaultNow(),
  acceptedByUserId: integer("accepted_by_user_id"),
  acceptedAt: timestamp("accepted_at"),
});

export const kitchenTickets = pgTable("kitchen_tickets", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  tableId: integer("table_id").notNull(),
  tableNameSnapshot: text("table_name_snapshot").notNull(),
  status: text("status").notNull().default("NEW"),
  createdAt: timestamp("created_at").defaultNow(),
  clearedAt: timestamp("cleared_at"),
});

export const kitchenTicketItems = pgTable("kitchen_ticket_items", {
  id: serial("id").primaryKey(),
  kitchenTicketId: integer("kitchen_ticket_id").notNull(),
  orderItemId: integer("order_item_id").notNull(),
  productNameSnapshot: text("product_name_snapshot").notNull(),
  qty: integer("qty").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("NEW"),
  prepStartedAt: timestamp("prep_started_at"),
  readyAt: timestamp("ready_at"),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  splitId: integer("split_id"),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethodId: integer("payment_method_id").notNull(),
  paidAt: timestamp("paid_at").defaultNow(),
  cashierUserId: integer("cashier_user_id").notNull(),
  status: text("status").notNull().default("PAID"),
  clientNameSnapshot: text("client_name_snapshot"),
  clientEmailSnapshot: text("client_email_snapshot"),
  businessDate: text("business_date").notNull(),
});

export const cashSessions = pgTable("cash_sessions", {
  id: serial("id").primaryKey(),
  openedAt: timestamp("opened_at").defaultNow(),
  closedAt: timestamp("closed_at"),
  openedByUserId: integer("opened_by_user_id").notNull(),
  closedByUserId: integer("closed_by_user_id"),
  openingCash: numeric("opening_cash", { precision: 10, scale: 2 }).notNull(),
  expectedCash: numeric("expected_cash", { precision: 10, scale: 2 }),
  countedCash: numeric("counted_cash", { precision: 10, scale: 2 }),
  difference: numeric("difference", { precision: 10, scale: 2 }),
  totalsByMethod: jsonb("totals_by_method"),
  notes: text("notes"),
});

export const splitAccounts = pgTable("split_accounts", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  label: text("label").notNull(),
});

export const splitItems = pgTable("split_items", {
  id: serial("id").primaryKey(),
  splitId: integer("split_id").notNull(),
  orderItemId: integer("order_item_id").notNull(),
});

export const salesLedgerItems = pgTable("sales_ledger_items", {
  id: serial("id").primaryKey(),
  businessDate: text("business_date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  tableId: integer("table_id"),
  tableNameSnapshot: text("table_name_snapshot"),
  orderId: integer("order_id"),
  orderItemId: integer("order_item_id"),
  productId: integer("product_id"),
  productCodeSnapshot: text("product_code_snapshot"),
  productNameSnapshot: text("product_name_snapshot"),
  categoryId: integer("category_id"),
  categoryCodeSnapshot: text("category_code_snapshot"),
  categoryNameSnapshot: text("category_name_snapshot"),
  qty: integer("qty").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  lineSubtotal: numeric("line_subtotal", { precision: 10, scale: 2 }).notNull(),
  origin: text("origin").notNull(),
  createdByUserId: integer("created_by_user_id"),
  responsibleWaiterId: integer("responsible_waiter_id"),
  status: text("status").notNull().default("OPEN"),
  sentToKitchenAt: timestamp("sent_to_kitchen_at"),
  kdsReadyAt: timestamp("kds_ready_at"),
  paidAt: timestamp("paid_at"),
});

export const auditEvents = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow(),
  actorType: text("actor_type").notNull(),
  actorUserId: integer("actor_user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  tableId: integer("table_id"),
  metadata: jsonb("metadata"),
});

export const voidedItems = pgTable("voided_items", {
  id: serial("id").primaryKey(),
  businessDate: text("business_date").notNull(),
  tableId: integer("table_id"),
  tableNameSnapshot: text("table_name_snapshot"),
  orderId: integer("order_id").notNull(),
  orderItemId: integer("order_item_id").notNull(),
  productId: integer("product_id"),
  productNameSnapshot: text("product_name_snapshot"),
  categorySnapshot: text("category_snapshot"),
  qtyVoided: integer("qty_voided").notNull(),
  unitPriceSnapshot: numeric("unit_price_snapshot", { precision: 10, scale: 2 }),
  voidReason: text("void_reason"),
  voidedByUserId: integer("voided_by_user_id").notNull(),
  voidedByRole: text("voided_by_role").notNull(),
  voidedAt: timestamp("voided_at").defaultNow(),
  status: text("status").notNull().default("VOIDED"),
  notes: text("notes"),
});

export const qboExportJobs = pgTable("qbo_export_jobs", {
  id: serial("id").primaryKey(),
  businessDate: text("business_date").notNull(),
  status: text("status").notNull().default("PENDING"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  errorMessage: text("error_message"),
  qboRefs: jsonb("qbo_refs"),
  retryCount: integer("retry_count").notNull().default(0),
});

// Modifier Groups
export const modifierGroups = pgTable("modifier_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  required: boolean("required").notNull().default(false),
  multiSelect: boolean("multi_select").notNull().default(true),
  minSelections: integer("min_selections").notNull().default(0),
  maxSelections: integer("max_selections"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const modifierOptions = pgTable("modifier_options", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  name: text("name").notNull(),
  priceDelta: numeric("price_delta", { precision: 10, scale: 2 }).notNull().default("0"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const itemModifierGroups = pgTable("item_modifier_groups", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  modifierGroupId: integer("modifier_group_id").notNull(),
});

export const orderItemModifiers = pgTable("order_item_modifiers", {
  id: serial("id").primaryKey(),
  orderItemId: integer("order_item_id").notNull(),
  modifierOptionId: integer("modifier_option_id").notNull(),
  nameSnapshot: text("name_snapshot").notNull(),
  priceDeltaSnapshot: numeric("price_delta_snapshot", { precision: 10, scale: 2 }).notNull().default("0"),
  qty: integer("qty").notNull().default(1),
});

// Discounts
export const discounts = pgTable("discounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("percentage"),
  value: numeric("value", { precision: 10, scale: 2 }).notNull(),
  restricted: boolean("restricted").notNull().default(false),
  active: boolean("active").notNull().default(true),
  validUntil: timestamp("valid_until"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orderDiscounts = pgTable("order_discounts", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  discountId: integer("discount_id").notNull(),
  discountNameSnapshot: text("discount_name_snapshot").notNull(),
  discountTypeSnapshot: text("discount_type_snapshot").notNull(),
  discountValueSnapshot: numeric("discount_value_snapshot", { precision: 10, scale: 2 }).notNull(),
  amountApplied: numeric("amount_applied", { precision: 10, scale: 2 }).notNull(),
  appliedByUserId: integer("applied_by_user_id").notNull(),
  appliedAt: timestamp("applied_at").defaultNow(),
});

// Tax Categories
export const taxCategories = pgTable("tax_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  rate: numeric("rate", { precision: 5, scale: 2 }).notNull(),
  inclusive: boolean("inclusive").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const productTaxCategories = pgTable("product_tax_categories", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  taxCategoryId: integer("tax_category_id").notNull(),
});

export const orderItemTaxes = pgTable("order_item_taxes", {
  id: serial("id").primaryKey(),
  orderItemId: integer("order_item_id").notNull(),
  taxCategoryId: integer("tax_category_id").notNull(),
  taxNameSnapshot: text("tax_name_snapshot").notNull(),
  taxRateSnapshot: numeric("tax_rate_snapshot", { precision: 5, scale: 2 }).notNull(),
  inclusiveSnapshot: boolean("inclusive_snapshot").notNull().default(false),
  taxAmount: numeric("tax_amount", { precision: 10, scale: 2 }).notNull(),
});

export const orderItemDiscounts = pgTable("order_item_discounts", {
  id: serial("id").primaryKey(),
  orderItemId: integer("order_item_id").notNull(),
  orderId: integer("order_id").notNull(),
  discountName: text("discount_name").notNull(),
  discountType: text("discount_type").notNull().default("percentage"),
  discountValue: numeric("discount_value", { precision: 10, scale: 2 }).notNull(),
  amountApplied: numeric("amount_applied", { precision: 10, scale: 2 }).notNull(),
  appliedByUserId: integer("applied_by_user_id").notNull(),
  appliedAt: timestamp("applied_at").defaultNow(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertTableSchema = createInsertSchema(tables).omit({ id: true });
export const insertCategorySchema = createInsertSchema(categories).omit({ id: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true });
export const insertPaymentMethodSchema = createInsertSchema(paymentMethods).omit({ id: true });
export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, openedAt: true, closedAt: true, totalAmount: true });
export const insertOrderItemSchema = createInsertSchema(orderItems).omit({ id: true, createdAt: true, sentToKitchenAt: true, voidedAt: true, voidedByUserId: true });
export const insertQrSubmissionSchema = createInsertSchema(qrSubmissions).omit({ id: true, createdAt: true, acceptedAt: true });
export const insertKitchenTicketSchema = createInsertSchema(kitchenTickets).omit({ id: true, createdAt: true, clearedAt: true });
export const insertKitchenTicketItemSchema = createInsertSchema(kitchenTicketItems).omit({ id: true, prepStartedAt: true, readyAt: true });
export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true, paidAt: true });
export const insertCashSessionSchema = createInsertSchema(cashSessions).omit({ id: true, openedAt: true, closedAt: true });
export const insertSplitAccountSchema = createInsertSchema(splitAccounts).omit({ id: true });
export const insertSplitItemSchema = createInsertSchema(splitItems).omit({ id: true });
export const insertVoidedItemSchema = createInsertSchema(voidedItems).omit({ id: true, voidedAt: true });
export const insertAuditEventSchema = createInsertSchema(auditEvents).omit({ id: true, createdAt: true });
export const insertQboExportJobSchema = createInsertSchema(qboExportJobs).omit({ id: true });
export const insertModifierGroupSchema = createInsertSchema(modifierGroups).omit({ id: true });
export const insertModifierOptionSchema = createInsertSchema(modifierOptions).omit({ id: true });
export const insertItemModifierGroupSchema = createInsertSchema(itemModifierGroups).omit({ id: true });
export const insertOrderItemModifierSchema = createInsertSchema(orderItemModifiers).omit({ id: true });
export const insertDiscountSchema = createInsertSchema(discounts).omit({ id: true, createdAt: true });
export const insertOrderDiscountSchema = createInsertSchema(orderDiscounts).omit({ id: true, appliedAt: true });
export const insertTaxCategorySchema = createInsertSchema(taxCategories).omit({ id: true });
export const insertProductTaxCategorySchema = createInsertSchema(productTaxCategories).omit({ id: true });
export const insertOrderItemTaxSchema = createInsertSchema(orderItemTaxes).omit({ id: true });
export const insertOrderItemDiscountSchema = createInsertSchema(orderItemDiscounts).omit({ id: true, appliedAt: true });

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertTable = z.infer<typeof insertTableSchema>;
export type Table = typeof tables.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;
export type InsertPaymentMethod = z.infer<typeof insertPaymentMethodSchema>;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type OrderItem = typeof orderItems.$inferSelect;
export type InsertQrSubmission = z.infer<typeof insertQrSubmissionSchema>;
export type QrSubmission = typeof qrSubmissions.$inferSelect;
export type InsertKitchenTicket = z.infer<typeof insertKitchenTicketSchema>;
export type KitchenTicket = typeof kitchenTickets.$inferSelect;
export type InsertKitchenTicketItem = z.infer<typeof insertKitchenTicketItemSchema>;
export type KitchenTicketItem = typeof kitchenTicketItems.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof payments.$inferSelect;
export type InsertCashSession = z.infer<typeof insertCashSessionSchema>;
export type CashSession = typeof cashSessions.$inferSelect;
export type InsertSplitAccount = z.infer<typeof insertSplitAccountSchema>;
export type SplitAccount = typeof splitAccounts.$inferSelect;
export type InsertSplitItem = z.infer<typeof insertSplitItemSchema>;
export type SplitItem = typeof splitItems.$inferSelect;
export type InsertSalesLedgerItem = typeof salesLedgerItems.$inferInsert;
export type SalesLedgerItem = typeof salesLedgerItems.$inferSelect;
export type InsertVoidedItem = z.infer<typeof insertVoidedItemSchema>;
export type VoidedItem = typeof voidedItems.$inferSelect;
export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type InsertQboExportJob = z.infer<typeof insertQboExportJobSchema>;
export type QboExportJob = typeof qboExportJobs.$inferSelect;
export type ModifierGroup = typeof modifierGroups.$inferSelect;
export type InsertModifierGroup = z.infer<typeof insertModifierGroupSchema>;
export type ModifierOption = typeof modifierOptions.$inferSelect;
export type InsertModifierOption = z.infer<typeof insertModifierOptionSchema>;
export type ItemModifierGroup = typeof itemModifierGroups.$inferSelect;
export type InsertItemModifierGroup = z.infer<typeof insertItemModifierGroupSchema>;
export type OrderItemModifier = typeof orderItemModifiers.$inferSelect;
export type InsertOrderItemModifier = z.infer<typeof insertOrderItemModifierSchema>;
export type Discount = typeof discounts.$inferSelect;
export type InsertDiscount = z.infer<typeof insertDiscountSchema>;
export type OrderDiscount = typeof orderDiscounts.$inferSelect;
export type InsertOrderDiscount = z.infer<typeof insertOrderDiscountSchema>;
export type TaxCategory = typeof taxCategories.$inferSelect;
export type InsertTaxCategory = z.infer<typeof insertTaxCategorySchema>;
export type ProductTaxCategory = typeof productTaxCategories.$inferSelect;
export type InsertProductTaxCategory = z.infer<typeof insertProductTaxCategorySchema>;
export type OrderItemTax = typeof orderItemTaxes.$inferSelect;
export type InsertOrderItemTax = z.infer<typeof insertOrderItemTaxSchema>;
export type OrderItemDiscount = typeof orderItemDiscounts.$inferSelect;
export type InsertOrderItemDiscount = z.infer<typeof insertOrderItemDiscountSchema>;

// Business config (singleton row)
export const businessConfig = pgTable("business_config", {
  id: serial("id").primaryKey(),
  businessName: text("business_name").notNull().default(""),
  legalName: text("legal_name").notNull().default(""),
  taxId: text("tax_id").notNull().default(""),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  legalNote: text("legal_note").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const printers = pgTable("printers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("caja"),
  ipAddress: text("ip_address").notNull().default(""),
  port: integer("port").notNull().default(9100),
  paperWidth: integer("paper_width").notNull().default(80),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBusinessConfigSchema = createInsertSchema(businessConfig).omit({ id: true, updatedAt: true });
export const insertPrinterSchema = createInsertSchema(printers).omit({ id: true, createdAt: true });

export type InsertBusinessConfig = z.infer<typeof insertBusinessConfigSchema>;
export type BusinessConfig = typeof businessConfig.$inferSelect;
export type InsertPrinter = z.infer<typeof insertPrinterSchema>;
export type Printer = typeof printers.$inferSelect;

// Permissions & RBAC
export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  description: text("description").notNull().default(""),
});

export const rolePermissions = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(),
  permissionKey: text("permission_key").notNull(),
});

export const insertPermissionSchema = createInsertSchema(permissions).omit({ id: true });
export const insertRolePermissionSchema = createInsertSchema(rolePermissions).omit({ id: true });

export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;

// Login schema
export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// PIN login schema
export const pinLoginSchema = z.object({
  pin: z.string().length(4).regex(/^\d{4}$/),
});
export type PinLoginInput = z.infer<typeof pinLoginSchema>;

// PIN enrollment schema
const TRIVIAL_PINS = ["0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999", "1234"];
export const enrollPinSchema = z.object({
  pin: z.string().length(4).regex(/^\d{4}$/).refine(val => !TRIVIAL_PINS.includes(val), { message: "PIN demasiado simple" }),
});
export type EnrollPinInput = z.infer<typeof enrollPinSchema>;
