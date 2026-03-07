const { Pool } = require("pg");

const devPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

const TABLES_ORDERED = [
  'tenants', 'tenant_modules', 'provision_log', 'schema_migrations',
  'business_config', 'tax_categories', 'payment_methods', 'permissions', 'role_permissions',
  'hr_settings', 'hr_extra_types', 'printers', 'reservation_settings', 'reservation_duration_config',
  'qbo_config',
  'users',
  'categories', 'products', 'product_tax_categories',
  'modifier_groups', 'modifier_options', 'item_modifier_groups',
  'discounts',
  'tables',
  'hr_weekly_schedules', 'hr_schedule_days', 'hr_time_punches', 'hr_overtime_approvals',
  'inv_suppliers', 'inv_items',
  'inv_conversions', 'inv_conversion_outputs',
  'inv_stock_ap', 'inv_movements',
  'inv_physical_counts', 'inv_physical_count_lines',
  'inv_purchase_orders', 'inv_purchase_order_lines',
  'inv_shortages', 'inv_shortage_events',
  'orders', 'order_subaccounts', 'order_items', 'order_item_modifiers', 'order_item_taxes', 'order_item_discounts',
  'inventory_deductions',
  'kitchen_tickets', 'kitchen_ticket_items',
  'cash_sessions', 'payments',
  'split_accounts', 'split_items',
  'sales_ledger_items', 'service_charge_ledger', 'service_charge_payouts',
  'voided_items',
  'qr_submissions',
  'qbo_category_mapping', 'qbo_export_jobs', 'qbo_sync_log',
  'reservations',
  'audit_events',
];

async function main() {
  console.log("This script inserts data from a SQL dump generated from production.");
  console.log("Run the code_execution cells to generate the INSERT SQL first.");
  await devPool.end();
}

main().catch(console.error);
