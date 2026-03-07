/**
 * shared/schema-public.ts
 * Tablas del schema PUBLIC de PostgreSQL.
 * Estas tablas son globales — no pertenecen a ningún tenant.
 * NO modificar shared/schema.ts — este es un archivo separado.
 */

import {
  pgTable, text, integer, boolean, timestamp, serial, jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const tenants = pgTable("tenants", {
  id:               serial("id").primaryKey(),
  slug:             text("slug").notNull().unique(),
  businessName:     text("business_name").notNull(),
  schemaName:       text("schema_name").notNull().unique(),
  plan:             text("plan").notNull().default("TRIAL"),
  status:           text("status").notNull().default("PROVISIONING"),
  isActive:         boolean("is_active").notNull().default(false),
  trialEndsAt:      timestamp("trial_ends_at"),
  suspendedAt:      timestamp("suspended_at"),
  suspendReason:    text("suspend_reason"),
  billingEmail:     text("billing_email"),
  stripeCustomerId: text("stripe_customer_id"),
  onboardingFileUrl:text("onboarding_file_url"),
  trialBasePlan:    text("trial_base_plan"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;
export const insertTenantSchema = createInsertSchema(tenants);

export const tenantModules = pgTable("tenant_modules", {
  id:           serial("id").primaryKey(),
  tenantId:     integer("tenant_id").notNull().references(() => tenants.id),
  moduleKey:    text("module_key").notNull(),
  isActive:     boolean("is_active").notNull().default(true),
  activatedAt:  timestamp("activated_at").notNull().defaultNow(),
  deactivatedAt:timestamp("deactivated_at"),
  price:        integer("price").notNull().default(0),
  billingType:  text("billing_type").notNull().default("FIXED"),
  unitCount:    integer("unit_count").default(0),
  notes:        text("notes"),
});

export type TenantModule = typeof tenantModules.$inferSelect;

export const superadminUsers = pgTable("superadmin_users", {
  id:           serial("id").primaryKey(),
  email:        text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role:         text("role").notNull().default("SUPPORT"),
  isActive:     boolean("is_active").notNull().default(true),
  lastLoginAt:  timestamp("last_login_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export const provisionLog = pgTable("provision_log", {
  id:           serial("id").primaryKey(),
  tenantId:     integer("tenant_id").references(() => tenants.id),
  action:       text("action").notNull(),
  actorId:      integer("actor_id"),
  status:       text("status").notNull(),
  errorMessage: text("error_message"),
  metadata:     jsonb("metadata"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export const billingEvents = pgTable("billing_events", {
  id:             serial("id").primaryKey(),
  tenantId:       integer("tenant_id").notNull().references(() => tenants.id),
  eventType:      text("event_type").notNull(),
  amount:         integer("amount").notNull(),
  description:    text("description").notNull(),
  billingDate:    timestamp("billing_date").notNull().defaultNow(),
  stripeInvoiceId:text("stripe_invoice_id"),
  status:         text("status").notNull().default("PENDING"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
});

export const PLAN_MODULES: Record<string, string[]> = {
  TRIAL:      ["CORE_TABLES","CORE_POS","CORE_QR","CORE_DASHBOARD"],
  BASIC:      ["CORE_TABLES","CORE_POS","CORE_QR","CORE_DASHBOARD"],
  PRO:        ["CORE_TABLES","CORE_POS","CORE_QR","CORE_DASHBOARD","MOD_INVENTORY","MOD_HR","MOD_RESERVATIONS","MOD_LOYALTY","MOD_ANALYTICS"],
  ENTERPRISE: ["CORE_TABLES","CORE_POS","CORE_QR","CORE_DASHBOARD","MOD_INVENTORY","MOD_HR","MOD_RESERVATIONS","MOD_LOYALTY","MOD_ANALYTICS","MOD_QBO","MOD_MULTI_LOCATION","MOD_API"],
};

export const ADDON_PRICES: Record<string, { price: number; billingType: "FIXED" | "PER_UNIT"; label: string }> = {
  MOD_INVENTORY:     { price: 2500, billingType: "FIXED",    label: "Inventario completo" },
  MOD_HR:            { price: 500,  billingType: "PER_UNIT", label: "RRHH + Marcaciones (por empleado)" },
  MOD_RESERVATIONS:  { price: 1500, billingType: "FIXED",    label: "Reservaciones públicas" },
  MOD_LOYALTY:       { price: 2000, billingType: "FIXED",    label: "Loyalty / Puntos" },
  MOD_ANALYTICS:     { price: 2000, billingType: "FIXED",    label: "Sales Cube analytics" },
  MOD_QBO:           { price: 2000, billingType: "FIXED",    label: "QuickBooks Online" },
  MOD_MULTI_LOCATION:{ price: 0,    billingType: "FIXED",    label: "Multi-ubicación (consultar)" },
};

export const PLAN_PRICES: Record<string, { base: number; includedUsers: number; extraUserPrice: number }> = {
  TRIAL:      { base: 0,     includedUsers: 5,  extraUserPrice: 500 },
  BASIC:      { base: 5000,  includedUsers: 5,  extraUserPrice: 500 },
  PRO:        { base: 12000, includedUsers: 10, extraUserPrice: 500 },
  ENTERPRISE: { base: 25000, includedUsers: -1, extraUserPrice: 0   },
};
