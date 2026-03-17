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
  date,
  time,
  unique,
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
  pinFailedAttempts: integer("pin_failed_attempts").notNull().default(0),
  pinLockedUntil: timestamp("pin_locked_until"),
  dailyRate: numeric("daily_rate", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
  resetToken: text("reset_token"),
  resetTokenExpires: timestamp("reset_token_expires"),
});

export const tables = pgTable("tables", {
  id: serial("id").primaryKey(),
  tableCode: text("table_code").notNull().unique(),
  tableName: text("table_name").notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  capacity: integer("capacity").notNull().default(4),
  deletedAt: timestamp("deleted_at"),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  categoryCode: text("category_code").notNull().unique(),
  name: text("name").notNull(),
  parentCategoryCode: text("parent_category_code"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  kdsDestination: text("kds_destination").notNull().default("cocina"),
  easyMode: boolean("easy_mode").notNull().default(false),
  foodType: text("food_type").notNull().default("comidas"),
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
  easyMode: boolean("easy_mode").notNull().default(false),
  availablePortions: integer("available_portions"),
  reorderPoint: integer("reorder_point"),
  serviceTaxApplicable: boolean("service_tax_applicable").notNull().default(true),
  inventoryControlEnabled: boolean("inventory_control_enabled").notNull().default(false),
  recipeYield: numeric("recipe_yield", { precision: 10, scale: 2 }),
  recipeVersion: integer("recipe_version").notNull().default(1),
  imageUrl: text("image_url"),
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
  tableId: integer("table_id"),
  status: text("status").notNull().default("OPEN"),
  responsibleWaiterId: integer("responsible_waiter_id"),
  openedAt: timestamp("opened_at").defaultNow(),
  closedAt: timestamp("closed_at"),
  businessDate: text("business_date").notNull(),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).default("0"),
  paidAmount: numeric("paid_amount", { precision: 10, scale: 2 }).default("0"),
  balanceDue: numeric("balance_due", { precision: 10, scale: 2 }).default("0"),
  dailyNumber: integer("daily_number"),
  globalNumber: integer("global_number"),
  parentOrderId: integer("parent_order_id"),
  splitIndex: integer("split_index"),
  guestCount: integer("guest_count"),
  isQuickSale: boolean("is_quick_sale").notNull().default(false),
  quickSaleName: varchar("quick_sale_name", { length: 100 }),
  transactionCode: varchar("transaction_code", { length: 3 }),
  orderMode: varchar("order_mode", { length: 20 }).notNull().default("TABLE"),
  dispatchStatus: varchar("dispatch_status", { length: 30 }),
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
  taxSnapshotJson: jsonb("tax_snapshot_json"),
  subaccountId: integer("subaccount_id"),
  subaccountCodeSnapshot: text("subaccount_code_snapshot"),
  customerNameSnapshot: text("customer_name_snapshot"),
});

export const qrSubmissions = pgTable("qr_submissions", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  tableId: integer("table_id").notNull(),
  status: text("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at").defaultNow(),
  acceptedByUserId: integer("accepted_by_user_id"),
  acceptedAt: timestamp("accepted_at"),
  payloadSnapshot: jsonb("payload_snapshot"),
});

export const kitchenTickets = pgTable("kitchen_tickets", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  tableId: integer("table_id"),
  tableNameSnapshot: text("table_name_snapshot").notNull(),
  status: text("status").notNull().default("NEW"),
  kdsDestination: text("kds_destination").notNull().default("cocina"),
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
  kitchenItemGroupId: text("kitchen_item_group_id"),
  seqInGroup: integer("seq_in_group"),
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
  voidedByUserId: integer("voided_by_user_id"),
  voidedAt: timestamp("voided_at"),
  voidReason: text("void_reason"),
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

// Portion Reservations (for QR orders)
export const portionReservations = pgTable("portion_reservations", {
  id: serial("id").primaryKey(),
  orderItemId: integer("order_item_id").notNull(),
  productId: integer("product_id").notNull(),
  qty: integer("qty").notNull(),
  status: text("status").notNull().default("RESERVED"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

// QR Rate Limits (persistent)
export const qrRateLimits = pgTable("qr_rate_limits", {
  id: serial("id").primaryKey(),
  tableCode: text("table_code").notNull().unique(),
  lastSubmissionAt: timestamp("last_submission_at").notNull(),
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

// ==================== HR MODULE ====================

export const hrSettings = pgTable("hr_settings", {
  id: serial("id").primaryKey(),
  latenessGraceMinutes: integer("lateness_grace_minutes").notNull().default(0),
  weekStartDay: text("week_start_day").notNull().default("MONDAY"),
  overtimeDailyThresholdHours: numeric("overtime_daily_threshold_hours", { precision: 5, scale: 2 }).notNull().default("8"),
  overtimeWeeklyThresholdHours: numeric("overtime_weekly_threshold_hours", { precision: 5, scale: 2 }).notNull().default("48"),
  overtimeMultiplier: numeric("overtime_multiplier", { precision: 4, scale: 2 }).notNull().default("1.5"),
  autoLogoutAfterShiftHours: integer("auto_logout_after_shift_hours").notNull().default(4),
  lateAlertEmailTo: text("late_alert_email_to").notNull().default("marbonilla@gmail.com"),
  serviceChargeRate: numeric("service_charge_rate", { precision: 5, scale: 4 }).notNull().default("0.10"),
  serviceRoundingMode: text("service_rounding_mode").notNull().default("HALF_UP"),
  serviceDistributionMethod: text("service_distribution_method").notNull().default("BY_ITEM_RESPONSIBLE"),
  geoEnforcementEnabled: boolean("geo_enforcement_enabled").notNull().default(true),
  businessLat: numeric("business_lat", { precision: 10, scale: 7 }),
  businessLng: numeric("business_lng", { precision: 10, scale: 7 }),
  geoRadiusMeters: integer("geo_radius_meters").notNull().default(120),
  geoAccuracyMaxMeters: integer("geo_accuracy_max_meters").notNull().default(100),
  geoGraceAttempts: integer("geo_grace_attempts").notNull().default(2),
  geoOverrideRoleCode: text("geo_override_role_code").notNull().default("GERENTE"),
  geoRequiredForClockin: boolean("geo_required_for_clockin").notNull().default(true),
  geoRequiredForClockout: boolean("geo_required_for_clockout").notNull().default(true),
  paidStartPolicy: text("paid_start_policy").notNull().default("SCHEDULE_START_CAP"),
  overtimeRequiresApproval: boolean("overtime_requires_approval").notNull().default(true),
  ignoreZeroDurationPunches: boolean("ignore_zero_duration_punches").notNull().default(true),
  mergeOverlappingPunches: boolean("merge_overlapping_punches").notNull().default(true),
  breakDeductEnabled: boolean("break_deduct_enabled").notNull().default(true),
  breakThresholdMinutes: integer("break_threshold_minutes").notNull().default(540),
  breakDeductMinutes: integer("break_deduct_minutes").notNull().default(60),
  socialChargesEnabled: boolean("social_charges_enabled").notNull().default(false),
  ccssEmployeeRate: numeric("ccss_employee_rate", { precision: 5, scale: 2 }).notNull().default("10.67"),
  ccssEmployerRate: numeric("ccss_employer_rate", { precision: 5, scale: 2 }).notNull().default("26.33"),
  ccssIncludeService: boolean("ccss_include_service").notNull().default(false),
  autoClockoutGraceByDay: jsonb("auto_clockout_grace_by_day")
    .$type<{ mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number }>()
    .default({ mon: 30, tue: 30, wed: 30, thu: 30, fri: 30, sat: 30, sun: 30 }),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const hrWeeklySchedules = pgTable("hr_weekly_schedules", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  weekStartDate: text("week_start_date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const hrScheduleDays = pgTable("hr_schedule_days", {
  id: serial("id").primaryKey(),
  scheduleId: integer("schedule_id").notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
  isDayOff: boolean("is_day_off").notNull().default(false),
});

export const hrTimePunches = pgTable("hr_time_punches", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  businessDate: text("business_date").notNull(),
  clockInAt: timestamp("clock_in_at").notNull(),
  clockOutAt: timestamp("clock_out_at"),
  clockOutType: text("clock_out_type"),
  scheduledStartAt: timestamp("scheduled_start_at"),
  scheduledEndAt: timestamp("scheduled_end_at"),
  lateMinutes: integer("late_minutes").notNull().default(0),
  workedMinutes: integer("worked_minutes").notNull().default(0),
  overtimeMinutesDaily: integer("overtime_minutes_daily").notNull().default(0),
  notes: text("notes"),
  editedByEmployeeId: integer("edited_by_employee_id"),
  editedAt: timestamp("edited_at"),
  editReason: text("edit_reason"),
  clockinGeoLat: numeric("clockin_geo_lat", { precision: 10, scale: 7 }),
  clockinGeoLng: numeric("clockin_geo_lng", { precision: 10, scale: 7 }),
  clockinGeoAccuracyM: numeric("clockin_geo_accuracy_m", { precision: 8, scale: 2 }),
  clockinGeoVerified: boolean("clockin_geo_verified").notNull().default(false),
  clockoutGeoLat: numeric("clockout_geo_lat", { precision: 10, scale: 7 }),
  clockoutGeoLng: numeric("clockout_geo_lng", { precision: 10, scale: 7 }),
  clockoutGeoAccuracyM: numeric("clockout_geo_accuracy_m", { precision: 8, scale: 2 }),
  clockoutGeoVerified: boolean("clockout_geo_verified").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const hrExtraTypes = pgTable("hr_extra_types", {
  typeCode: text("type_code").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const hrPayrollExtras = pgTable("hr_payroll_extras", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  appliesToDate: text("applies_to_date").notNull(),
  typeCode: text("type_code").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  note: text("note"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at"),
  isDeleted: boolean("is_deleted").notNull().default(false),
});

export const serviceChargeLedger = pgTable("service_charge_ledger", {
  id: serial("id").primaryKey(),
  businessDate: text("business_date").notNull(),
  orderId: integer("order_id").notNull(),
  orderItemId: integer("order_item_id").notNull(),
  tableId: integer("table_id"),
  tableNameSnapshot: text("table_name_snapshot"),
  responsibleWaiterEmployeeId: integer("responsible_waiter_employee_id"),
  rateSnapshot: numeric("rate_snapshot", { precision: 5, scale: 4 }).notNull(),
  baseAmountSnapshot: numeric("base_amount_snapshot", { precision: 10, scale: 2 }).notNull(),
  serviceAmount: numeric("service_amount", { precision: 10, scale: 2 }).notNull(),
  includesServiceSnapshot: boolean("includes_service_snapshot").notNull().default(true),
  status: text("status").notNull().default("PAID"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const serviceChargePayouts = pgTable("service_charge_payouts", {
  id: serial("id").primaryKey(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  employeeId: integer("employee_id").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  generatedByEmployeeId: integer("generated_by_employee_id").notNull(),
  status: text("status").notNull().default("PREVIEW"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const hrOvertimeApprovals = pgTable("hr_overtime_approvals", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  businessDate: text("business_date").notNull(),
  overtimeMinutes: integer("overtime_minutes").notNull(),
  status: text("status").notNull().default("PENDING"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uniqueEmployeeDate: unique().on(t.employeeId, t.businessDate),
}));

// ==================== INVENTORY MODULE ====================

export const invItems = pgTable("inv_items", {
  id: serial("id").primaryKey(),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  itemType: text("item_type").notNull().default("AP"),
  category: text("category").notNull().default("General"),
  baseUom: text("base_uom").notNull().default("UNIT"),
  onHandQtyBase: numeric("on_hand_qty_base", { precision: 12, scale: 4 }).notNull().default("0"),
  reorderPointQtyBase: numeric("reorder_point_qty_base", { precision: 12, scale: 4 }).notNull().default("0"),
  parLevelQtyBase: numeric("par_level_qty_base", { precision: 12, scale: 4 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  isPerishable: boolean("is_perishable").notNull().default(false),
  notes: text("notes"),
  defaultSupplierId: integer("default_supplier_id"),
  avgCostPerBaseUom: numeric("avg_cost_per_base_uom", { precision: 12, scale: 6 }).notNull().default("0"),
  lastCostPerBaseUom: numeric("last_cost_per_base_uom", { precision: 12, scale: 6 }).notNull().default("0"),
  purchasePresentation: text("purchase_presentation"),
  purchaseQtyPerBaseUom: numeric("purchase_qty_per_base_uom", { precision: 12, scale: 4 }),
  lastCostPerPresentation: numeric("last_cost_per_presentation", { precision: 12, scale: 2 }),
  unitWeightG: numeric("unit_weight_g", { precision: 12, scale: 4 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const invUomConversions = pgTable("inv_uom_conversions", {
  id: serial("id").primaryKey(),
  invItemId: integer("inv_item_id").notNull(),
  fromUom: text("from_uom").notNull(),
  toBaseMultiplier: numeric("to_base_multiplier", { precision: 12, scale: 4 }).notNull(),
  isDefaultPurchaseUom: boolean("is_default_purchase_uom").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invMovements = pgTable("inv_movements", {
  id: serial("id").primaryKey(),
  businessDate: text("business_date").notNull(),
  movementType: text("movement_type").notNull(),
  invItemId: integer("inv_item_id").notNull(),
  itemType: text("item_type").notNull().default("AP"),
  qtyDeltaBase: numeric("qty_delta_base", { precision: 12, scale: 4 }).notNull(),
  unitCostPerBaseUom: numeric("unit_cost_per_base_uom", { precision: 12, scale: 6 }),
  valueDelta: numeric("value_delta", { precision: 12, scale: 2 }),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  note: text("note"),
  createdByEmployeeId: integer("created_by_employee_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invSuppliers = pgTable("inv_suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  leadTimeDays: integer("lead_time_days").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invSupplierItems = pgTable("inv_supplier_items", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull(),
  invItemId: integer("inv_item_id").notNull(),
  purchaseUom: text("purchase_uom").notNull(),
  lastPricePerPurchaseUom: numeric("last_price_per_purchase_uom", { precision: 12, scale: 2 }).notNull().default("0"),
  isPreferred: boolean("is_preferred").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invPurchaseOrders = pgTable("inv_purchase_orders", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull(),
  status: text("status").notNull().default("DRAFT"),
  createdByEmployeeId: integer("created_by_employee_id").notNull(),
  sentAt: timestamp("sent_at"),
  expectedDeliveryDate: text("expected_delivery_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const invPurchaseOrderLines = pgTable("inv_purchase_order_lines", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").notNull(),
  invItemId: integer("inv_item_id").notNull(),
  qtyPurchaseUom: numeric("qty_purchase_uom", { precision: 12, scale: 4 }).notNull(),
  purchaseUom: text("purchase_uom").notNull(),
  unitPricePerPurchaseUom: numeric("unit_price_per_purchase_uom", { precision: 12, scale: 2 }).notNull(),
  toBaseMultiplierSnapshot: numeric("to_base_multiplier_snapshot", { precision: 12, scale: 4 }).notNull(),
  qtyBaseExpected: numeric("qty_base_expected", { precision: 12, scale: 4 }).notNull(),
  qtyBaseReceived: numeric("qty_base_received", { precision: 12, scale: 4 }).notNull().default("0"),
  lineStatus: text("line_status").notNull().default("OPEN"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invPoReceipts = pgTable("inv_po_receipts", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").notNull(),
  receivedAt: timestamp("received_at").defaultNow(),
  receivedByEmployeeId: integer("received_by_employee_id").notNull(),
  note: text("note"),
});

export const invPoReceiptLines = pgTable("inv_po_receipt_lines", {
  id: serial("id").primaryKey(),
  receiptId: integer("receipt_id").notNull(),
  poLineId: integer("po_line_id").notNull(),
  qtyPurchaseUomReceived: numeric("qty_purchase_uom_received", { precision: 12, scale: 4 }).notNull(),
  qtyBaseReceived: numeric("qty_base_received", { precision: 12, scale: 4 }).notNull(),
  unitPricePerPurchaseUom: numeric("unit_price_per_purchase_uom", { precision: 12, scale: 2 }).notNull(),
  unitCostPerBaseUom: numeric("unit_cost_per_base_uom", { precision: 12, scale: 6 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invPhysicalCounts = pgTable("inv_physical_counts", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("DRAFT"),
  scope: text("scope").notNull().default("ALL"),
  categoryFilter: text("category_filter"),
  createdByEmployeeId: integer("created_by_employee_id").notNull(),
  finalizedByEmployeeId: integer("finalized_by_employee_id"),
  createdAt: timestamp("created_at").defaultNow(),
  finalizedAt: timestamp("finalized_at"),
  note: text("note"),
});

export const invPhysicalCountLines = pgTable("inv_physical_count_lines", {
  id: serial("id").primaryKey(),
  physicalCountId: integer("physical_count_id").notNull(),
  invItemId: integer("inv_item_id").notNull(),
  systemQtyBase: numeric("system_qty_base", { precision: 12, scale: 4 }).notNull().default("0"),
  countedQtyBase: numeric("counted_qty_base", { precision: 12, scale: 4 }),
  deltaQtyBase: numeric("delta_qty_base", { precision: 12, scale: 4 }),
  adjustmentReason: text("adjustment_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invRecipes = pgTable("inv_recipes", {
  id: serial("id").primaryKey(),
  menuProductId: integer("menu_product_id").notNull(),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  yieldQty: numeric("yield_qty", { precision: 10, scale: 2 }).notNull().default("1"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invRecipeLines = pgTable("inv_recipe_lines", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull(),
  invItemId: integer("inv_item_id").notNull(),
  itemType: text("item_type").notNull().default("AP"),
  qtyBasePerMenuUnit: numeric("qty_base_per_menu_unit", { precision: 12, scale: 4 }).notNull(),
  wastePct: numeric("waste_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invOrderItemConsumptions = pgTable("inv_order_item_consumptions", {
  id: serial("id").primaryKey(),
  orderItemId: integer("order_item_id").notNull(),
  recipeId: integer("recipe_id").notNull(),
  status: text("status").notNull().default("CONSUMED"),
  createdAt: timestamp("created_at").defaultNow(),
  reversedAt: timestamp("reversed_at"),
});

export const invConversions = pgTable("inv_conversions", {
  id: serial("id").primaryKey(),
  apItemId: integer("ap_item_id").notNull(),
  name: text("name").notNull(),
  mermaPct: numeric("merma_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  cookFactor: numeric("cook_factor", { precision: 5, scale: 3 }).notNull().default("1"),
  extraLossPct: numeric("extra_loss_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  organizationId: integer("organization_id").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invConversionOutputs = pgTable("inv_conversion_outputs", {
  id: serial("id").primaryKey(),
  conversionId: integer("conversion_id").notNull(),
  epItemId: integer("ep_item_id").notNull(),
  outputPct: numeric("output_pct", { precision: 5, scale: 2 }).notNull().default("100"),
  portionSize: numeric("portion_size", { precision: 10, scale: 2 }),
  label: text("label"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invStockAp = pgTable("inv_stock_ap", {
  id: serial("id").primaryKey(),
  invItemId: integer("inv_item_id").notNull(),
  locationId: integer("location_id").notNull().default(1),
  organizationId: integer("organization_id").notNull().default(1),
  qtyOnHand: numeric("qty_on_hand", { precision: 12, scale: 4 }).notNull().default("0"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const invStockEp = pgTable("inv_stock_ep", {
  id: serial("id").primaryKey(),
  invItemId: integer("inv_item_id").notNull(),
  locationId: integer("location_id").notNull().default(1),
  organizationId: integer("organization_id").notNull().default(1),
  qtyOnHand: numeric("qty_on_hand", { precision: 12, scale: 4 }).notNull().default("0"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const productionBatches = pgTable("production_batches", {
  id: serial("id").primaryKey(),
  conversionId: integer("conversion_id").notNull(),
  apItemId: integer("ap_item_id").notNull(),
  apQtyUsed: numeric("ap_qty_used", { precision: 12, scale: 4 }).notNull(),
  locationId: integer("location_id").notNull().default(1),
  organizationId: integer("organization_id").notNull().default(1),
  status: text("status").notNull().default("COMPLETED"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const productionBatchOutputs = pgTable("production_batch_outputs", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  epItemId: integer("ep_item_id").notNull(),
  qtyEpGenerated: numeric("qty_ep_generated", { precision: 12, scale: 4 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const inventoryDeductions = pgTable("inventory_deductions", {
  id: serial("id").primaryKey(),
  orderItemId: integer("order_item_id").notNull().unique(),
  orderId: integer("order_id").notNull(),
  recipeId: integer("recipe_id"),
  productId: integer("product_id").notNull(),
  orderItemQty: numeric("order_item_qty", { precision: 12, scale: 4 }).notNull(),
  status: text("status").notNull().default("CONSUMED"),
  consumptionPayload: jsonb("consumption_payload").notNull().default([]),
  basicDeductedAt: timestamp("basic_deducted_at"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
  reversedAt: timestamp("reversed_at"),
});

// Shortages Module
export const invShortages = pgTable("inv_shortages", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  invItemId: integer("inv_item_id"),
  menuProductId: integer("menu_product_id"),
  status: text("status").notNull().default("OPEN"),
  priority: text("priority").notNull().default("HIGH"),
  severityReport: text("severity_report").notNull().default("NO_STOCK"),
  reportedByEmployeeId: integer("reported_by_employee_id").notNull(),
  reportedAt: timestamp("reported_at").defaultNow(),
  notes: text("notes"),
  reportCount: integer("report_count").notNull().default(1),
  lastReportedAt: timestamp("last_reported_at").defaultNow(),
  suggestedPurchaseQtyBase: numeric("suggested_purchase_qty_base", { precision: 12, scale: 4 }),
  systemOnHandQtyBaseSnapshot: numeric("system_on_hand_qty_base_snapshot", { precision: 12, scale: 4 }),
  systemAvgCostSnapshot: numeric("system_avg_cost_snapshot", { precision: 12, scale: 6 }),
  auditFlag: boolean("audit_flag").notNull().default(false),
  auditReason: text("audit_reason"),
  auditStatus: text("audit_status").notNull().default("NONE"),
  auditOwnerEmployeeId: integer("audit_owner_employee_id"),
  auditNotes: text("audit_notes"),
  acknowledgedByEmployeeId: integer("acknowledged_by_employee_id"),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedByEmployeeId: integer("resolved_by_employee_id"),
  resolvedAt: timestamp("resolved_at"),
  closedByEmployeeId: integer("closed_by_employee_id"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const invShortageEvents = pgTable("inv_shortage_events", {
  id: serial("id").primaryKey(),
  shortageId: integer("shortage_id").notNull(),
  eventType: text("event_type").notNull(),
  employeeId: integer("employee_id").notNull(),
  eventAt: timestamp("event_at").defaultNow(),
  message: text("message"),
  metaJson: jsonb("meta_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invAuditAlerts = pgTable("inv_audit_alerts", {
  id: serial("id").primaryKey(),
  alertType: text("alert_type").notNull(),
  severity: text("severity").notNull().default("HIGH"),
  invItemId: integer("inv_item_id"),
  shortageId: integer("shortage_id"),
  message: text("message").notNull(),
  status: text("status").notNull().default("OPEN"),
  createdAt: timestamp("created_at").defaultNow(),
  createdByEmployeeId: integer("created_by_employee_id"),
  ackByEmployeeId: integer("ack_by_employee_id"),
  ackAt: timestamp("ack_at"),
  closedByEmployeeId: integer("closed_by_employee_id"),
  closedAt: timestamp("closed_at"),
  notes: text("notes"),
});

// Order Subaccounts (QR payment groups per table)
export const orderSubaccounts = pgTable("order_subaccounts", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  tableId: integer("table_id").notNull(),
  slotNumber: integer("slot_number").notNull(),
  code: text("code").notNull(),
  label: text("label"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas
export const insertHrSettingsSchema = createInsertSchema(hrSettings).omit({ id: true, updatedAt: true });
export const insertHrWeeklyScheduleSchema = createInsertSchema(hrWeeklySchedules).omit({ id: true, createdAt: true, updatedAt: true });
export const insertHrScheduleDaySchema = createInsertSchema(hrScheduleDays).omit({ id: true });
export const insertHrTimePunchSchema = createInsertSchema(hrTimePunches).omit({ id: true, createdAt: true, updatedAt: true });
export const insertServiceChargeLedgerSchema = createInsertSchema(serviceChargeLedger).omit({ id: true, createdAt: true });
export const insertServiceChargePayoutSchema = createInsertSchema(serviceChargePayouts).omit({ id: true, createdAt: true });

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertTableSchema = createInsertSchema(tables).omit({ id: true });
export const insertCategorySchema = createInsertSchema(categories).omit({ id: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true });
export const insertPaymentMethodSchema = createInsertSchema(paymentMethods).omit({ id: true });
export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, openedAt: true, closedAt: true, totalAmount: true, paidAmount: true, balanceDue: true });
export const insertOrderItemSchema = createInsertSchema(orderItems).omit({ id: true, createdAt: true, sentToKitchenAt: true, voidedAt: true, voidedByUserId: true, taxSnapshotJson: true, subaccountId: true, subaccountCodeSnapshot: true, customerNameSnapshot: true });
export const insertQrSubmissionSchema = createInsertSchema(qrSubmissions).omit({ id: true, createdAt: true, acceptedAt: true, payloadSnapshot: true });
export const insertKitchenTicketSchema = createInsertSchema(kitchenTickets).omit({ id: true, createdAt: true, clearedAt: true });
export const insertKitchenTicketItemSchema = createInsertSchema(kitchenTicketItems).omit({ id: true, prepStartedAt: true, readyAt: true });
export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true, paidAt: true, voidedByUserId: true, voidedAt: true, voidReason: true });
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
export const insertPortionReservationSchema = createInsertSchema(portionReservations).omit({ id: true, createdAt: true });
export const insertQrRateLimitSchema = createInsertSchema(qrRateLimits).omit({ id: true });
export const insertOrderSubaccountSchema = createInsertSchema(orderSubaccounts).omit({ id: true, createdAt: true });

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
export type PortionReservation = typeof portionReservations.$inferSelect;
export type InsertPortionReservation = z.infer<typeof insertPortionReservationSchema>;
export type QrRateLimit = typeof qrRateLimits.$inferSelect;
export type InsertQrRateLimit = z.infer<typeof insertQrRateLimitSchema>;
export type OrderSubaccount = typeof orderSubaccounts.$inferSelect;
export type InsertOrderSubaccount = z.infer<typeof insertOrderSubaccountSchema>;

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
  maxSubaccounts: integer("max_subaccounts").notNull().default(15),
  serviceTaxCategoryId: integer("service_tax_category_id"),
  orderDailyStart: integer("order_daily_start").default(1).notNull(),
  orderGlobalStart: integer("order_global_start").default(1).notNull(),
  invoiceStart: integer("invoice_start").default(1).notNull(),
  timezone: varchar("timezone", { length: 100 }).notNull().default("America/Costa_Rica"),
  operationModeTable: boolean("operation_mode_table").notNull().default(true),
  operationModeQr: boolean("operation_mode_qr").notNull().default(true),
  operationModeDispatch: boolean("operation_mode_dispatch").notNull().default(false),
  dispatchOrderTimeoutMinutes: integer("dispatch_order_timeout_minutes").notNull().default(15),
  reviewPoints: integer("review_points").notNull().default(0),
  reviewEmail: text("review_email").notNull().default(""),
  googlePlaceId: text("google_place_id").notNull().default(""),
});

export const printers = pgTable("printers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("caja"),
  ipAddress: text("ip_address").notNull().default(""),
  port: integer("port").notNull().default(9100),
  paperWidth: integer("paper_width").notNull().default(80),
  enabled: boolean("enabled").notNull().default(true),
  bridgeId: varchar("bridge_id", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const printBridges = pgTable("print_bridges", {
  id: serial("id").primaryKey(),
  bridgeId: varchar("bridge_id", { length: 100 }).notNull().unique(),
  displayName: varchar("display_name", { length: 200 }).notNull(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PrintBridge = typeof printBridges.$inferSelect;
export type InsertPrintBridge = typeof printBridges.$inferInsert;

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

// HR Module types
export type HrSettings = typeof hrSettings.$inferSelect;
export type InsertHrSettings = z.infer<typeof insertHrSettingsSchema>;
export type HrWeeklySchedule = typeof hrWeeklySchedules.$inferSelect;
export type InsertHrWeeklySchedule = z.infer<typeof insertHrWeeklyScheduleSchema>;
export type HrScheduleDay = typeof hrScheduleDays.$inferSelect;
export type InsertHrScheduleDay = z.infer<typeof insertHrScheduleDaySchema>;
export type HrTimePunch = typeof hrTimePunches.$inferSelect;
export type InsertHrTimePunch = z.infer<typeof insertHrTimePunchSchema>;
export type HrOvertimeApproval = typeof hrOvertimeApprovals.$inferSelect;
export type ServiceChargeLedgerEntry = typeof serviceChargeLedger.$inferSelect;
export type InsertServiceChargeLedgerEntry = z.infer<typeof insertServiceChargeLedgerSchema>;
export type ServiceChargePayout = typeof serviceChargePayouts.$inferSelect;
export type InsertServiceChargePayout = z.infer<typeof insertServiceChargePayoutSchema>;

// Inventory Module types
export const insertInvItemSchema = createInsertSchema(invItems).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInvUomConversionSchema = createInsertSchema(invUomConversions).omit({ id: true, createdAt: true });
export const insertInvMovementSchema = createInsertSchema(invMovements).omit({ id: true, createdAt: true });
export const insertInvSupplierSchema = createInsertSchema(invSuppliers).omit({ id: true, createdAt: true });
export const insertInvSupplierItemSchema = createInsertSchema(invSupplierItems).omit({ id: true, createdAt: true });
export const insertInvPurchaseOrderSchema = createInsertSchema(invPurchaseOrders).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInvPurchaseOrderLineSchema = createInsertSchema(invPurchaseOrderLines).omit({ id: true, createdAt: true });
export const insertInvPoReceiptSchema = createInsertSchema(invPoReceipts).omit({ id: true, receivedAt: true });
export const insertInvPoReceiptLineSchema = createInsertSchema(invPoReceiptLines).omit({ id: true, createdAt: true });
export const insertInvPhysicalCountSchema = createInsertSchema(invPhysicalCounts).omit({ id: true, createdAt: true, finalizedAt: true });
export const insertInvPhysicalCountLineSchema = createInsertSchema(invPhysicalCountLines).omit({ id: true, createdAt: true });
export const insertInvRecipeSchema = createInsertSchema(invRecipes).omit({ id: true, createdAt: true });
export const insertInvRecipeLineSchema = createInsertSchema(invRecipeLines).omit({ id: true, createdAt: true });
export const insertInvOrderItemConsumptionSchema = createInsertSchema(invOrderItemConsumptions).omit({ id: true, createdAt: true, reversedAt: true });

export type InvItem = typeof invItems.$inferSelect;
export type InsertInvItem = z.infer<typeof insertInvItemSchema>;
export type InvUomConversion = typeof invUomConversions.$inferSelect;
export type InsertInvUomConversion = z.infer<typeof insertInvUomConversionSchema>;
export type InvMovement = typeof invMovements.$inferSelect;
export type InsertInvMovement = z.infer<typeof insertInvMovementSchema>;
export type InvSupplier = typeof invSuppliers.$inferSelect;
export type InsertInvSupplier = z.infer<typeof insertInvSupplierSchema>;
export type InvSupplierItem = typeof invSupplierItems.$inferSelect;
export type InsertInvSupplierItem = z.infer<typeof insertInvSupplierItemSchema>;
export type InvPurchaseOrder = typeof invPurchaseOrders.$inferSelect;
export type InsertInvPurchaseOrder = z.infer<typeof insertInvPurchaseOrderSchema>;
export type InvPurchaseOrderLine = typeof invPurchaseOrderLines.$inferSelect;
export type InsertInvPurchaseOrderLine = z.infer<typeof insertInvPurchaseOrderLineSchema>;
export type InvPoReceipt = typeof invPoReceipts.$inferSelect;
export type InsertInvPoReceipt = z.infer<typeof insertInvPoReceiptSchema>;
export type InvPoReceiptLine = typeof invPoReceiptLines.$inferSelect;
export type InsertInvPoReceiptLine = z.infer<typeof insertInvPoReceiptLineSchema>;
export type InvPhysicalCount = typeof invPhysicalCounts.$inferSelect;
export type InsertInvPhysicalCount = z.infer<typeof insertInvPhysicalCountSchema>;
export type InvPhysicalCountLine = typeof invPhysicalCountLines.$inferSelect;
export type InsertInvPhysicalCountLine = z.infer<typeof insertInvPhysicalCountLineSchema>;
export type InvRecipe = typeof invRecipes.$inferSelect;
export type InsertInvRecipe = z.infer<typeof insertInvRecipeSchema>;
export type InvRecipeLine = typeof invRecipeLines.$inferSelect;
export type InsertInvRecipeLine = z.infer<typeof insertInvRecipeLineSchema>;
export type InvOrderItemConsumption = typeof invOrderItemConsumptions.$inferSelect;
export type InsertInvOrderItemConsumption = z.infer<typeof insertInvOrderItemConsumptionSchema>;

export const insertInvConversionSchema = createInsertSchema(invConversions).omit({ id: true, createdAt: true });
export const insertInvConversionOutputSchema = createInsertSchema(invConversionOutputs).omit({ id: true, createdAt: true });
export const insertInvStockApSchema = createInsertSchema(invStockAp).omit({ id: true, updatedAt: true });
export const insertInvStockEpSchema = createInsertSchema(invStockEp).omit({ id: true, updatedAt: true });
export const insertProductionBatchSchema = createInsertSchema(productionBatches).omit({ id: true, createdAt: true });
export const insertProductionBatchOutputSchema = createInsertSchema(productionBatchOutputs).omit({ id: true, createdAt: true });
export const insertInventoryDeductionSchema = createInsertSchema(inventoryDeductions).omit({ id: true, createdAt: true, reversedAt: true });

export type InvConversion = typeof invConversions.$inferSelect;
export type InsertInvConversion = z.infer<typeof insertInvConversionSchema>;
export type InvConversionOutput = typeof invConversionOutputs.$inferSelect;
export type InsertInvConversionOutput = z.infer<typeof insertInvConversionOutputSchema>;
export type InvStockAp = typeof invStockAp.$inferSelect;
export type InsertInvStockAp = z.infer<typeof insertInvStockApSchema>;
export type InvStockEp = typeof invStockEp.$inferSelect;
export type InsertInvStockEp = z.infer<typeof insertInvStockEpSchema>;
export type ProductionBatch = typeof productionBatches.$inferSelect;
export type InsertProductionBatch = z.infer<typeof insertProductionBatchSchema>;
export type ProductionBatchOutput = typeof productionBatchOutputs.$inferSelect;
export type InsertProductionBatchOutput = z.infer<typeof insertProductionBatchOutputSchema>;
export type InventoryDeduction = typeof inventoryDeductions.$inferSelect;
export type InsertInventoryDeduction = z.infer<typeof insertInventoryDeductionSchema>;

// Shortages Module types
export const insertInvShortageSchema = createInsertSchema(invShortages).omit({ id: true, createdAt: true, updatedAt: true, reportedAt: true, lastReportedAt: true, acknowledgedAt: true, resolvedAt: true, closedAt: true });
export const insertInvShortageEventSchema = createInsertSchema(invShortageEvents).omit({ id: true, createdAt: true, eventAt: true });
export const insertInvAuditAlertSchema = createInsertSchema(invAuditAlerts).omit({ id: true, createdAt: true, ackAt: true, closedAt: true });

export type InvShortage = typeof invShortages.$inferSelect;
export type InsertInvShortage = z.infer<typeof insertInvShortageSchema>;
export type InvShortageEvent = typeof invShortageEvents.$inferSelect;
export type InsertInvShortageEvent = z.infer<typeof insertInvShortageEventSchema>;
export type InvAuditAlert = typeof invAuditAlerts.$inferSelect;
export type InsertInvAuditAlert = z.infer<typeof insertInvAuditAlertSchema>;

// ==================== RESERVATIONS MODULE ====================
export const reservations = pgTable("reservations", {
  id: serial("id").primaryKey(),
  reservationCode: varchar("reservation_code", { length: 20 }).notNull().unique(),
  guestName: varchar("guest_name", { length: 200 }).notNull(),
  guestPhone: varchar("guest_phone", { length: 50 }).notNull(),
  guestEmail: varchar("guest_email", { length: 200 }),
  partySize: integer("party_size").notNull(),
  reservedDate: date("reserved_date").notNull(),
  reservedTime: time("reserved_time").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(90),
  tableId: integer("table_id"),
  tableIds: integer("table_ids").array(),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  notes: text("notes"),
  seatedAt: timestamp("seated_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdBy: integer("created_by"),
  confirmationSentAt: timestamp("confirmation_sent_at"),
  reminderSentAt: timestamp("reminder_sent_at"),
});

export const reservationDurationConfig = pgTable("reservation_duration_config", {
  id: serial("id").primaryKey(),
  minPartySize: integer("min_party_size").notNull(),
  maxPartySize: integer("max_party_size").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
});

export const reservationSettings = pgTable("reservation_settings", {
  id: serial("id").primaryKey(),
  openTime: text("open_time").notNull().default("11:00"),
  closeTime: text("close_time").notNull().default("22:00"),
  slotIntervalMinutes: integer("slot_interval_minutes").notNull().default(30),
  maxOccupancyPercent: integer("max_occupancy_percent").notNull().default(50),
  turnoverBufferMinutes: integer("turnover_buffer_minutes").notNull().default(15),
  maxPartySize: integer("max_party_size").notNull().default(20),
  occupancyThresholdPercent: integer("occupancy_threshold_percent").notNull().default(10),
  enabled: boolean("enabled").notNull().default(true),
});

export const insertReservationSchema = createInsertSchema(reservations).omit({ id: true, createdAt: true, updatedAt: true, seatedAt: true, cancelledAt: true, confirmationSentAt: true, reminderSentAt: true });
export const insertReservationDurationConfigSchema = createInsertSchema(reservationDurationConfig).omit({ id: true });

export type Reservation = typeof reservations.$inferSelect;
export type InsertReservation = z.infer<typeof insertReservationSchema>;
export type ReservationDurationConfig = typeof reservationDurationConfig.$inferSelect;
export type InsertReservationDurationConfig = z.infer<typeof insertReservationDurationConfigSchema>;
export type ReservationSettings = typeof reservationSettings.$inferSelect;

export const qboConfig = pgTable("qbo_config", {
  id: serial("id").primaryKey(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  realmId: varchar("realm_id", { length: 100 }),
  tokenExpiresAt: timestamp("token_expires_at"),
  depositAccountCash: varchar("deposit_account_cash", { length: 50 }),
  depositAccountCard: varchar("deposit_account_card", { length: 50 }),
  depositAccountSinpe: varchar("deposit_account_sinpe", { length: 50 }),
  taxCodeRef: varchar("tax_code_ref", { length: 50 }),
  isConnected: boolean("is_connected").notNull().default(false),
  connectedAt: timestamp("connected_at"),
  lastTokenRefresh: timestamp("last_token_refresh"),
  syncFromDate: date("sync_from_date"),
  dbClientId: text("db_client_id"),
  dbClientSecret: text("db_client_secret"),
  dbRedirectUri: text("db_redirect_uri"),
  dbEnvironment: varchar("db_environment", { length: 20 }),
});

export const qboCategoryMapping = pgTable("qbo_category_mapping", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull(),
  qboItemId: varchar("qbo_item_id", { length: 50 }).notNull(),
  qboItemName: varchar("qbo_item_name", { length: 200 }),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const qboSyncLog = pgTable("qbo_sync_log", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull(),
  orderId: integer("order_id").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  qboReceiptId: varchar("qbo_receipt_id", { length: 100 }),
  qboReceiptNumber: varchar("qbo_receipt_number", { length: 50 }),
  errorMessage: text("error_message"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  syncedAt: timestamp("synced_at"),
  nextRetryAt: timestamp("next_retry_at"),
});

export const insertQboConfigSchema = createInsertSchema(qboConfig).omit({ id: true });
export const insertQboCategoryMappingSchema = createInsertSchema(qboCategoryMapping).omit({ id: true });
export const insertQboSyncLogSchema = createInsertSchema(qboSyncLog).omit({ id: true, createdAt: true });

export type QboConfig = typeof qboConfig.$inferSelect;
export type InsertQboConfig = z.infer<typeof insertQboConfigSchema>;
export type QboCategoryMapping = typeof qboCategoryMapping.$inferSelect;
export type InsertQboCategoryMapping = z.infer<typeof insertQboCategoryMappingSchema>;
export type QboSyncLog = typeof qboSyncLog.$inferSelect;
export type InsertQboSyncLog = z.infer<typeof insertQboSyncLogSchema>;

// ── Employee Charges ─────────────────────────────────────────────────────────
export const employeeCharges = pgTable("employee_charges", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => users.id),
  orderId: integer("order_id").notNull().references(() => orders.id),
  paymentId: integer("payment_id").references(() => payments.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description"),
  businessDate: date("business_date").notNull(),
  isSettled: boolean("is_settled").notNull().default(false),
  settledAt: timestamp("settled_at"),
  settledBy: integer("settled_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: integer("created_by").references(() => users.id),
});

export const insertEmployeeChargeSchema = createInsertSchema(employeeCharges).omit({ id: true, createdAt: true });
export type EmployeeCharge = typeof employeeCharges.$inferSelect;
export type InsertEmployeeCharge = z.infer<typeof insertEmployeeChargeSchema>;

// ── Loyalty / Customers (schema public) ──────────────────────────────────────

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  googleId: varchar("google_id", { length: 255 }).unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  photoUrl: text("photo_url"),
  phone: varchar("phone", { length: 30 }),
  dailyVisitCode: varchar("daily_visit_code", { length: 10 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
});

export const loyaltyAccounts = pgTable("loyalty_accounts", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  tenantId: integer("tenant_id").notNull(),
  pointsBalance: numeric("points_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  lifetimePoints: numeric("lifetime_points", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const loyaltyEvents = pgTable("loyalty_events", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  tenantId: integer("tenant_id").notNull(),
  eventType: varchar("event_type", { length: 20 }).notNull(),
  points: numeric("points", { precision: 12, scale: 2 }).notNull(),
  amountSpent: numeric("amount_spent", { precision: 12, scale: 2 }),
  orderId: integer("order_id"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const loyaltyConfig = pgTable("loyalty_config", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().unique(),
  isActive: boolean("is_active").notNull().default(false),
  earnRate: numeric("earn_rate", { precision: 5, scale: 2 }).notNull().default("2.00"),
  minRedeemPoints: numeric("min_redeem_points", { precision: 12, scale: 2 }).notNull().default("500"),
  redeemRate: numeric("redeem_rate", { precision: 8, scale: 4 }).notNull().default("1.0000"),
  pointsExpiryDays: integer("points_expiry_days").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Customer = typeof customers.$inferSelect;
export type LoyaltyAccount = typeof loyaltyAccounts.$inferSelect;
export type LoyaltyEvent = typeof loyaltyEvents.$inferSelect;
export type LoyaltyConfig = typeof loyaltyConfig.$inferSelect;

export const orderReviews = pgTable("order_reviews", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  tenantId: integer("tenant_id").notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  customerName: text("customer_name"),
  orderMode: varchar("order_mode", { length: 20 }).notNull().default("TABLE"),
  businessDate: varchar("business_date", { length: 10 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertOrderReviewSchema = createInsertSchema(orderReviews).omit({ id: true, createdAt: true });
export type OrderReview = typeof orderReviews.$inferSelect;
export type InsertOrderReview = z.infer<typeof insertOrderReviewSchema>;
