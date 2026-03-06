CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"actor_type" text NOT NULL,
	"actor_user_id" integer,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" integer,
	"table_id" integer,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "business_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_name" text DEFAULT '' NOT NULL,
	"legal_name" text DEFAULT '' NOT NULL,
	"tax_id" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"legal_note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"max_subaccounts" integer DEFAULT 15 NOT NULL,
	"service_tax_category_id" integer
);
--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"opened_at" timestamp DEFAULT now(),
	"closed_at" timestamp,
	"opened_by_user_id" integer NOT NULL,
	"closed_by_user_id" integer,
	"opening_cash" numeric(10, 2) NOT NULL,
	"expected_cash" numeric(10, 2),
	"counted_cash" numeric(10, 2),
	"difference" numeric(10, 2),
	"totals_by_method" jsonb,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_code" text NOT NULL,
	"name" text NOT NULL,
	"parent_category_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"kds_destination" text DEFAULT 'cocina' NOT NULL,
	"easy_mode" boolean DEFAULT false NOT NULL,
	"food_type" text DEFAULT 'comidas' NOT NULL,
	CONSTRAINT "categories_category_code_unique" UNIQUE("category_code")
);
--> statement-breakpoint
CREATE TABLE "discounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'percentage' NOT NULL,
	"value" numeric(10, 2) NOT NULL,
	"restricted" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"valid_until" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hr_extra_types" (
	"type_code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_overtime_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"business_date" text NOT NULL,
	"overtime_minutes" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "hr_overtime_approvals_employee_id_business_date_unique" UNIQUE("employee_id","business_date")
);
--> statement-breakpoint
CREATE TABLE "hr_payroll_extras" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"applies_to_date" text NOT NULL,
	"type_code" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_by" integer,
	"updated_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_schedule_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" text,
	"end_time" text,
	"is_day_off" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"lateness_grace_minutes" integer DEFAULT 0 NOT NULL,
	"week_start_day" text DEFAULT 'MONDAY' NOT NULL,
	"overtime_daily_threshold_hours" numeric(5, 2) DEFAULT '8' NOT NULL,
	"overtime_weekly_threshold_hours" numeric(5, 2) DEFAULT '48' NOT NULL,
	"overtime_multiplier" numeric(4, 2) DEFAULT '1.5' NOT NULL,
	"auto_logout_after_shift_hours" integer DEFAULT 4 NOT NULL,
	"late_alert_email_to" text DEFAULT 'marbonilla@gmail.com' NOT NULL,
	"service_charge_rate" numeric(5, 4) DEFAULT '0.10' NOT NULL,
	"service_rounding_mode" text DEFAULT 'HALF_UP' NOT NULL,
	"service_distribution_method" text DEFAULT 'BY_ITEM_RESPONSIBLE' NOT NULL,
	"geo_enforcement_enabled" boolean DEFAULT true NOT NULL,
	"business_lat" numeric(10, 7),
	"business_lng" numeric(10, 7),
	"geo_radius_meters" integer DEFAULT 120 NOT NULL,
	"geo_accuracy_max_meters" integer DEFAULT 100 NOT NULL,
	"geo_grace_attempts" integer DEFAULT 2 NOT NULL,
	"geo_override_role_code" text DEFAULT 'GERENTE' NOT NULL,
	"geo_required_for_clockin" boolean DEFAULT true NOT NULL,
	"geo_required_for_clockout" boolean DEFAULT true NOT NULL,
	"paid_start_policy" text DEFAULT 'SCHEDULE_START_CAP' NOT NULL,
	"overtime_requires_approval" boolean DEFAULT true NOT NULL,
	"ignore_zero_duration_punches" boolean DEFAULT true NOT NULL,
	"merge_overlapping_punches" boolean DEFAULT true NOT NULL,
	"break_deduct_enabled" boolean DEFAULT true NOT NULL,
	"break_threshold_minutes" integer DEFAULT 540 NOT NULL,
	"break_deduct_minutes" integer DEFAULT 60 NOT NULL,
	"social_charges_enabled" boolean DEFAULT false NOT NULL,
	"ccss_employee_rate" numeric(5, 2) DEFAULT '10.67' NOT NULL,
	"ccss_employer_rate" numeric(5, 2) DEFAULT '26.33' NOT NULL,
	"ccss_include_service" boolean DEFAULT false NOT NULL,
	"auto_clockout_grace_by_day" jsonb DEFAULT '{"mon":30,"tue":30,"wed":30,"thu":30,"fri":30,"sat":30,"sun":30}'::jsonb,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hr_time_punches" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"business_date" text NOT NULL,
	"clock_in_at" timestamp NOT NULL,
	"clock_out_at" timestamp,
	"clock_out_type" text,
	"scheduled_start_at" timestamp,
	"scheduled_end_at" timestamp,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes_daily" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"edited_by_employee_id" integer,
	"edited_at" timestamp,
	"edit_reason" text,
	"clockin_geo_lat" numeric(10, 7),
	"clockin_geo_lng" numeric(10, 7),
	"clockin_geo_accuracy_m" numeric(8, 2),
	"clockin_geo_verified" boolean DEFAULT false NOT NULL,
	"clockout_geo_lat" numeric(10, 7),
	"clockout_geo_lng" numeric(10, 7),
	"clockout_geo_accuracy_m" numeric(8, 2),
	"clockout_geo_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hr_weekly_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"week_start_date" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_audit_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_type" text NOT NULL,
	"severity" text DEFAULT 'HIGH' NOT NULL,
	"inv_item_id" integer,
	"shortage_id" integer,
	"message" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"created_by_employee_id" integer,
	"ack_by_employee_id" integer,
	"ack_at" timestamp,
	"closed_by_employee_id" integer,
	"closed_at" timestamp,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "inv_conversion_outputs" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversion_id" integer NOT NULL,
	"ep_item_id" integer NOT NULL,
	"output_pct" numeric(5, 2) DEFAULT '100' NOT NULL,
	"portion_size" numeric(10, 2),
	"label" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_conversions" (
	"id" serial PRIMARY KEY NOT NULL,
	"ap_item_id" integer NOT NULL,
	"name" text NOT NULL,
	"merma_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"cook_factor" numeric(5, 3) DEFAULT '1' NOT NULL,
	"extra_loss_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"organization_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"item_type" text DEFAULT 'AP' NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"base_uom" text DEFAULT 'UNIT' NOT NULL,
	"on_hand_qty_base" numeric(12, 4) DEFAULT '0' NOT NULL,
	"reorder_point_qty_base" numeric(12, 4) DEFAULT '0' NOT NULL,
	"par_level_qty_base" numeric(12, 4) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_perishable" boolean DEFAULT false NOT NULL,
	"notes" text,
	"default_supplier_id" integer,
	"avg_cost_per_base_uom" numeric(12, 6) DEFAULT '0' NOT NULL,
	"last_cost_per_base_uom" numeric(12, 6) DEFAULT '0' NOT NULL,
	"purchase_presentation" text,
	"purchase_qty_per_base_uom" numeric(12, 4),
	"last_cost_per_presentation" numeric(12, 2),
	"unit_weight_g" numeric(12, 4),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "inv_items_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "inv_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_date" text NOT NULL,
	"movement_type" text NOT NULL,
	"inv_item_id" integer NOT NULL,
	"item_type" text DEFAULT 'AP' NOT NULL,
	"qty_delta_base" numeric(12, 4) NOT NULL,
	"unit_cost_per_base_uom" numeric(12, 6),
	"value_delta" numeric(12, 2),
	"reference_type" text,
	"reference_id" text,
	"note" text,
	"created_by_employee_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_order_item_consumptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_item_id" integer NOT NULL,
	"recipe_id" integer NOT NULL,
	"status" text DEFAULT 'CONSUMED' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"reversed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "inv_physical_count_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"physical_count_id" integer NOT NULL,
	"inv_item_id" integer NOT NULL,
	"system_qty_base" numeric(12, 4) DEFAULT '0' NOT NULL,
	"counted_qty_base" numeric(12, 4),
	"delta_qty_base" numeric(12, 4),
	"adjustment_reason" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_physical_counts" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"scope" text DEFAULT 'ALL' NOT NULL,
	"category_filter" text,
	"created_by_employee_id" integer NOT NULL,
	"finalized_by_employee_id" integer,
	"created_at" timestamp DEFAULT now(),
	"finalized_at" timestamp,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "inv_po_receipt_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_id" integer NOT NULL,
	"po_line_id" integer NOT NULL,
	"qty_purchase_uom_received" numeric(12, 4) NOT NULL,
	"qty_base_received" numeric(12, 4) NOT NULL,
	"unit_price_per_purchase_uom" numeric(12, 2) NOT NULL,
	"unit_cost_per_base_uom" numeric(12, 6) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_po_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchase_order_id" integer NOT NULL,
	"received_at" timestamp DEFAULT now(),
	"received_by_employee_id" integer NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "inv_purchase_order_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchase_order_id" integer NOT NULL,
	"inv_item_id" integer NOT NULL,
	"qty_purchase_uom" numeric(12, 4) NOT NULL,
	"purchase_uom" text NOT NULL,
	"unit_price_per_purchase_uom" numeric(12, 2) NOT NULL,
	"to_base_multiplier_snapshot" numeric(12, 4) NOT NULL,
	"qty_base_expected" numeric(12, 4) NOT NULL,
	"qty_base_received" numeric(12, 4) DEFAULT '0' NOT NULL,
	"line_status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_id" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by_employee_id" integer NOT NULL,
	"sent_at" timestamp,
	"expected_delivery_date" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_recipe_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"inv_item_id" integer NOT NULL,
	"item_type" text DEFAULT 'AP' NOT NULL,
	"qty_base_per_menu_unit" numeric(12, 4) NOT NULL,
	"waste_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"menu_product_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"yield_qty" numeric(10, 2) DEFAULT '1' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_shortage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"shortage_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"employee_id" integer NOT NULL,
	"event_at" timestamp DEFAULT now(),
	"message" text,
	"meta_json" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_shortages" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"inv_item_id" integer,
	"menu_product_id" integer,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"priority" text DEFAULT 'HIGH' NOT NULL,
	"severity_report" text DEFAULT 'NO_STOCK' NOT NULL,
	"reported_by_employee_id" integer NOT NULL,
	"reported_at" timestamp DEFAULT now(),
	"notes" text,
	"report_count" integer DEFAULT 1 NOT NULL,
	"last_reported_at" timestamp DEFAULT now(),
	"suggested_purchase_qty_base" numeric(12, 4),
	"system_on_hand_qty_base_snapshot" numeric(12, 4),
	"system_avg_cost_snapshot" numeric(12, 6),
	"audit_flag" boolean DEFAULT false NOT NULL,
	"audit_reason" text,
	"audit_status" text DEFAULT 'NONE' NOT NULL,
	"audit_owner_employee_id" integer,
	"audit_notes" text,
	"acknowledged_by_employee_id" integer,
	"acknowledged_at" timestamp,
	"resolved_by_employee_id" integer,
	"resolved_at" timestamp,
	"closed_by_employee_id" integer,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_stock_ap" (
	"id" serial PRIMARY KEY NOT NULL,
	"inv_item_id" integer NOT NULL,
	"location_id" integer DEFAULT 1 NOT NULL,
	"organization_id" integer DEFAULT 1 NOT NULL,
	"qty_on_hand" numeric(12, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_stock_ep" (
	"id" serial PRIMARY KEY NOT NULL,
	"inv_item_id" integer NOT NULL,
	"location_id" integer DEFAULT 1 NOT NULL,
	"organization_id" integer DEFAULT 1 NOT NULL,
	"qty_on_hand" numeric(12, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_supplier_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_id" integer NOT NULL,
	"inv_item_id" integer NOT NULL,
	"purchase_uom" text NOT NULL,
	"last_price_per_purchase_uom" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"lead_time_days" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inv_uom_conversions" (
	"id" serial PRIMARY KEY NOT NULL,
	"inv_item_id" integer NOT NULL,
	"from_uom" text NOT NULL,
	"to_base_multiplier" numeric(12, 4) NOT NULL,
	"is_default_purchase_uom" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inventory_deductions" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_item_id" integer NOT NULL,
	"order_id" integer NOT NULL,
	"recipe_id" integer,
	"product_id" integer NOT NULL,
	"order_item_qty" numeric(12, 4) NOT NULL,
	"status" text DEFAULT 'CONSUMED' NOT NULL,
	"consumption_payload" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"basic_deducted_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now(),
	"reversed_at" timestamp,
	CONSTRAINT "inventory_deductions_order_item_id_unique" UNIQUE("order_item_id")
);
--> statement-breakpoint
CREATE TABLE "item_modifier_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"modifier_group_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kitchen_ticket_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"kitchen_ticket_id" integer NOT NULL,
	"order_item_id" integer NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"qty" integer NOT NULL,
	"notes" text,
	"status" text DEFAULT 'NEW' NOT NULL,
	"prep_started_at" timestamp,
	"ready_at" timestamp,
	"kitchen_item_group_id" text,
	"seq_in_group" integer
);
--> statement-breakpoint
CREATE TABLE "kitchen_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"table_id" integer NOT NULL,
	"table_name_snapshot" text NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"kds_destination" text DEFAULT 'cocina' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"cleared_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "modifier_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"multi_select" boolean DEFAULT true NOT NULL,
	"min_selections" integer DEFAULT 0 NOT NULL,
	"max_selections" integer,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "modifier_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "modifier_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"name" text NOT NULL,
	"price_delta" numeric(10, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_discounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"discount_id" integer NOT NULL,
	"discount_name_snapshot" text NOT NULL,
	"discount_type_snapshot" text NOT NULL,
	"discount_value_snapshot" numeric(10, 2) NOT NULL,
	"amount_applied" numeric(10, 2) NOT NULL,
	"applied_by_user_id" integer NOT NULL,
	"applied_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "order_item_discounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_item_id" integer NOT NULL,
	"order_id" integer NOT NULL,
	"discount_name" text NOT NULL,
	"discount_type" text DEFAULT 'percentage' NOT NULL,
	"discount_value" numeric(10, 2) NOT NULL,
	"amount_applied" numeric(10, 2) NOT NULL,
	"applied_by_user_id" integer NOT NULL,
	"applied_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "order_item_modifiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_item_id" integer NOT NULL,
	"modifier_option_id" integer NOT NULL,
	"name_snapshot" text NOT NULL,
	"price_delta_snapshot" numeric(10, 2) DEFAULT '0' NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_item_taxes" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_item_id" integer NOT NULL,
	"tax_category_id" integer NOT NULL,
	"tax_name_snapshot" text NOT NULL,
	"tax_rate_snapshot" numeric(5, 2) NOT NULL,
	"inclusive_snapshot" boolean DEFAULT false NOT NULL,
	"tax_amount" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"product_price_snapshot" numeric(10, 2) NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"origin" text DEFAULT 'WAITER' NOT NULL,
	"created_by_user_id" integer,
	"responsible_waiter_id" integer,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"round_number" integer DEFAULT 1 NOT NULL,
	"qr_submission_id" integer,
	"sent_to_kitchen_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"voided_at" timestamp,
	"voided_by_user_id" integer,
	"tax_snapshot_json" jsonb,
	"subaccount_id" integer,
	"subaccount_code_snapshot" text,
	"customer_name_snapshot" text
);
--> statement-breakpoint
CREATE TABLE "order_subaccounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"table_id" integer NOT NULL,
	"slot_number" integer NOT NULL,
	"code" text NOT NULL,
	"label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_id" integer NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"responsible_waiter_id" integer,
	"opened_at" timestamp DEFAULT now(),
	"closed_at" timestamp,
	"business_date" text NOT NULL,
	"total_amount" numeric(10, 2) DEFAULT '0',
	"paid_amount" numeric(10, 2) DEFAULT '0',
	"balance_due" numeric(10, 2) DEFAULT '0',
	"daily_number" integer,
	"global_number" integer,
	"parent_order_id" integer,
	"split_index" integer,
	"guest_count" integer
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_code" text NOT NULL,
	"payment_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "payment_methods_payment_code_unique" UNIQUE("payment_code")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"split_id" integer,
	"amount" numeric(10, 2) NOT NULL,
	"payment_method_id" integer NOT NULL,
	"paid_at" timestamp DEFAULT now(),
	"cashier_user_id" integer NOT NULL,
	"status" text DEFAULT 'PAID' NOT NULL,
	"client_name_snapshot" text,
	"client_email_snapshot" text,
	"business_date" text NOT NULL,
	"voided_by_user_id" integer,
	"voided_at" timestamp,
	"void_reason" text
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "portion_reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_item_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"qty" integer NOT NULL,
	"status" text DEFAULT 'RESERVED' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "printers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'caja' NOT NULL,
	"ip_address" text DEFAULT '' NOT NULL,
	"port" integer DEFAULT 9100 NOT NULL,
	"paper_width" integer DEFAULT 80 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_tax_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"tax_category_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_batch_outputs" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"ep_item_id" integer NOT NULL,
	"qty_ep_generated" numeric(12, 4) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "production_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversion_id" integer NOT NULL,
	"ap_item_id" integer NOT NULL,
	"ap_qty_used" numeric(12, 4) NOT NULL,
	"location_id" integer DEFAULT 1 NOT NULL,
	"organization_id" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'COMPLETED' NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category_id" integer,
	"price" numeric(10, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"visible_qr" boolean DEFAULT true NOT NULL,
	"easy_mode" boolean DEFAULT false NOT NULL,
	"available_portions" integer,
	"reorder_point" integer,
	"service_tax_applicable" boolean DEFAULT true NOT NULL,
	"inventory_control_enabled" boolean DEFAULT false NOT NULL,
	"recipe_yield" numeric(10, 2),
	"recipe_version" integer DEFAULT 1 NOT NULL,
	"image_url" text,
	CONSTRAINT "products_product_code_unique" UNIQUE("product_code")
);
--> statement-breakpoint
CREATE TABLE "qbo_category_mapping" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"qbo_item_id" varchar(50) NOT NULL,
	"qbo_item_name" varchar(200),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "qbo_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"realm_id" varchar(100),
	"token_expires_at" timestamp,
	"deposit_account_cash" varchar(50),
	"deposit_account_card" varchar(50),
	"deposit_account_sinpe" varchar(50),
	"tax_code_ref" varchar(50),
	"is_connected" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp,
	"last_token_refresh" timestamp,
	"sync_from_date" date,
	"db_client_id" text,
	"db_client_secret" text,
	"db_redirect_uri" text,
	"db_environment" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "qbo_export_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_date" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"error_message" text,
	"qbo_refs" jsonb,
	"retry_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qbo_sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_id" integer NOT NULL,
	"order_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"qbo_receipt_id" varchar(100),
	"qbo_receipt_number" varchar(50),
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"synced_at" timestamp,
	"next_retry_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "qr_rate_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_code" text NOT NULL,
	"last_submission_at" timestamp NOT NULL,
	CONSTRAINT "qr_rate_limits_table_code_unique" UNIQUE("table_code")
);
--> statement-breakpoint
CREATE TABLE "qr_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"table_id" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"accepted_by_user_id" integer,
	"accepted_at" timestamp,
	"payload_snapshot" jsonb
);
--> statement-breakpoint
CREATE TABLE "reservation_duration_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"min_party_size" integer NOT NULL,
	"max_party_size" integer NOT NULL,
	"duration_minutes" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"open_time" text DEFAULT '11:00' NOT NULL,
	"close_time" text DEFAULT '22:00' NOT NULL,
	"slot_interval_minutes" integer DEFAULT 30 NOT NULL,
	"max_occupancy_percent" integer DEFAULT 50 NOT NULL,
	"turnover_buffer_minutes" integer DEFAULT 15 NOT NULL,
	"max_party_size" integer DEFAULT 20 NOT NULL,
	"occupancy_threshold_percent" integer DEFAULT 10 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"reservation_code" varchar(20) NOT NULL,
	"guest_name" varchar(200) NOT NULL,
	"guest_phone" varchar(50) NOT NULL,
	"guest_email" varchar(200),
	"party_size" integer NOT NULL,
	"reserved_date" date NOT NULL,
	"reserved_time" time NOT NULL,
	"duration_minutes" integer DEFAULT 90 NOT NULL,
	"table_id" integer,
	"table_ids" integer[],
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"seated_at" timestamp,
	"cancelled_at" timestamp,
	"cancellation_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"created_by" integer,
	"confirmation_sent_at" timestamp,
	"reminder_sent_at" timestamp,
	CONSTRAINT "reservations_reservation_code_unique" UNIQUE("reservation_code")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"permission_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_ledger_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_date" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"table_id" integer,
	"table_name_snapshot" text,
	"order_id" integer,
	"order_item_id" integer,
	"product_id" integer,
	"product_code_snapshot" text,
	"product_name_snapshot" text,
	"category_id" integer,
	"category_code_snapshot" text,
	"category_name_snapshot" text,
	"qty" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"line_subtotal" numeric(10, 2) NOT NULL,
	"origin" text NOT NULL,
	"created_by_user_id" integer,
	"responsible_waiter_id" integer,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"sent_to_kitchen_at" timestamp,
	"kds_ready_at" timestamp,
	"paid_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "service_charge_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_date" text NOT NULL,
	"order_id" integer NOT NULL,
	"order_item_id" integer NOT NULL,
	"table_id" integer,
	"table_name_snapshot" text,
	"responsible_waiter_employee_id" integer,
	"rate_snapshot" numeric(5, 4) NOT NULL,
	"base_amount_snapshot" numeric(10, 2) NOT NULL,
	"service_amount" numeric(10, 2) NOT NULL,
	"includes_service_snapshot" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'PAID' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "service_charge_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"employee_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"generated_by_employee_id" integer NOT NULL,
	"status" text DEFAULT 'PREVIEW' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "split_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "split_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"split_id" integer NOT NULL,
	"order_item_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_code" text NOT NULL,
	"table_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"capacity" integer DEFAULT 4 NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "tables_table_code_unique" UNIQUE("table_code")
);
--> statement-breakpoint
CREATE TABLE "tax_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"inclusive" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'WAITER' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"email" text,
	"pin" text,
	"pin_failed_attempts" integer DEFAULT 0 NOT NULL,
	"pin_locked_until" timestamp,
	"daily_rate" numeric(10, 2),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "voided_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_date" text NOT NULL,
	"table_id" integer,
	"table_name_snapshot" text,
	"order_id" integer NOT NULL,
	"order_item_id" integer NOT NULL,
	"product_id" integer,
	"product_name_snapshot" text,
	"category_snapshot" text,
	"qty_voided" integer NOT NULL,
	"unit_price_snapshot" numeric(10, 2),
	"void_reason" text,
	"voided_by_user_id" integer NOT NULL,
	"voided_by_role" text NOT NULL,
	"voided_at" timestamp DEFAULT now(),
	"status" text DEFAULT 'VOIDED' NOT NULL,
	"notes" text
);
