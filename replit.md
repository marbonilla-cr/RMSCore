# Sistema Restaurante - MVP v1

## Overview
This project is a Progressive Web Application (PWA) designed as a comprehensive restaurant management system. It targets small to medium-sized restaurants, capable of handling 20-30 concurrent orders. The system integrates various functionalities crucial for restaurant operations, including order management for waiters, a QR-code based client ordering system, a Kitchen Display System (KDS), a Point of Sale (POS) / cash register, and a manager dashboard. The core vision is to streamline restaurant workflows, enhance customer experience through self-ordering, and provide management with real-time insights and control.

## User Preferences
I prefer simple language. I want iterative development. Ask before making major changes.

## System Architecture
The system is built as a PWA, ensuring accessibility across various devices.
- **Frontend**: Developed using React, Vite for fast development, Tailwind CSS and shadcn/ui for a modern and responsive user interface, and wouter for routing. The UI/UX emphasizes a mobile-first approach with responsive layouts, accessible touch targets, and intuitive navigation patterns (e.g., accordion menus, card-based lists instead of HTML tables on mobile).
- **Backend**: Implemented with Express.js and TypeScript, providing a robust and type-safe API layer.
- **Database**: PostgreSQL is used for data persistence, managed with Drizzle ORM.
- **Real-time Communication**: WebSocket (using the `ws` library) facilitates real-time updates across different modules (e.g., new QR orders, kitchen ticket updates, payment processing).
- **Authentication**: Session-based authentication is handled using `express-session` with `memorystore`. A PIN-based login system is the primary entry method, with a password login as a fallback. Role-Based Access Control (RBAC) is implemented, where module access is determined by specific permissions (e.g., `MODULE_TABLES_VIEW`, `MODULE_POS_VIEW`), not solely by role. Permissions are configurable by the manager.
- **Key Features**:
    - **Order Management**: Waiter interface for table management, order taking, and QR order acceptance.
    - **QR Client Ordering**: Subaccount-based QR ordering with dual-mode interface (Easy Mode interview flow / Standard Mode card grid). Supports up to 6 subaccounts per table, customer name tracking, modifier selection, and rate limiting. v2 API endpoints handle submission/acceptance with payload snapshots.
    - **Kitchen Display System (KDS)**: Real-time display for kitchen staff to manage food preparation, update item statuses, and receive new orders with audio alerts.
    - **Point of Sale (POS)**: Cash register functionality including payment processing, order splitting, voiding items/orders/payments, cash session management, and thermal/email receipt generation. Supports item-level discounts and configurable tax categories (inclusive/additive).
    - **Manager Dashboard**: Provides a comprehensive overview of restaurant performance, including real-time metrics, historical data with period filters, and drill-down capabilities into specific orders.
    - **Admin Panel**: For managing users, roles, permissions, tables, categories, products, payment methods, tax categories, business configurations, and printers.
    - **PWA Support**: Includes `manifest.json`, service worker, and meta tags for installability on Android/iOS.
    - **Item Voiding System**: Allows waiters to soft-void items with reasons, and managers to hard-delete, with full audit trails.
    - **POS Cash Report Permission**: `POS_VIEW_CASH_REPORT` controls visibility of expected cash, difference, and payment method breakdowns. Backend enforces data filtering at API level (not just UI hiding).
    - **Order Consecutives**: Daily and global order numbering for traceability.
    - **Multi-Printer Support**: Configuration for different printer types (cash register, kitchen, bar) with auto-printing on POS payment.

## Recent Changes (Feb 17, 2026)

### QR Subaccounts Module - Complete Implementation
- **Database**: `order_subaccounts` table (id, tableId, code, label, createdAt), new columns on `order_items` (subaccountId, subaccountCodeSnapshot, customerNameSnapshot), `payloadSnapshot` on `qr_submissions`, `maxSubaccounts` business config (default 6)
- **Backend Routes**: `server/qr-subaccount-routes.ts` with 7 endpoints: subaccount CRUD, submit-v2 (with payload snapshot + rate limiting), accept-v2 (creates order items with snapshots + sends to KDS), reject, qr-pending, by-subaccount grouping, splits-from-subaccounts (auto-creates POS split accounts from subaccounts)
- **QR Client Page**: Dual-mode interface (1031 lines). Easy Mode: 7-screen interview flow (category → products → modifiers → review). Standard Mode: card grid per diner with food/drink separation. Both support subaccount selection, customer name input ("Como te llamas?"), modifier selection, and quantity adjustment. Spanish microcopy: "Tranqui: un salonero confirma tu pedido antes de mandarlo a cocina"
- **Waiter Integration**: table-detail.tsx shows pending QR requests with time/name/items display, "Aceptar todas" bulk button, subaccount filter dropdown, accordion view by subaccount showing "{Nombre} pidió: {Producto}"
- **POS Integration**: "Por Subcuenta" button auto-generates split tickets from subaccounts for individual billing
- **WebSocket**: `qr_submission` event broadcasts to waiters with tableId, triggers notification sound and toast
- **Rate Limiting**: MAX_PENDING_QR_REQUESTS default 8, enforced at submit-v2 endpoint via database-backed qr_rate_limits table
- **Security**: All queries parameterized via Drizzle, role-based access with requireRole("WAITER","MANAGER"), no auth required for QR client endpoints

### Previous Changes (Feb 15, 2026)

### Inventory Module - Complete Implementation
- **14 Database Tables**: `inv_items`, `inv_uom_conversions`, `inv_movements`, `inv_suppliers`, `inv_supplier_items`, `inv_purchase_orders`, `inv_po_lines`, `inv_receipts`, `inv_receipt_lines`, `inv_physical_counts`, `inv_count_lines`, `inv_recipes`, `inv_recipe_lines`, `inv_order_item_consumptions`
- **Products Integration**: Added `inventoryControlEnabled`, `invItemId`, `portionQty` fields to products table for linking menu items to inventory
- **WAC Costing**: Weighted Average Cost recalculated on every receipt via `updateWACOnReceipt()`. Formula: `newWAC = (oldQty * oldWAC + receiptQty * receiptCost) / (oldQty + receiptQty)`
- **Consumption Hooks**: Automatic inventory consumption on send-to-kitchen (POS, waiter, QR flows). Uses recipe BOM with `wastePct` and `yieldQty` for accurate deductions. Wrapped in try-catch to prevent POS failures.
- **Reversal Hooks**: Automatic reversal on item void. Idempotent via `inv_order_item_consumptions` tracking table. Only triggers for full voids.
- **Purchase Orders**: Support partial receiving (multiple receipts per PO). Line status tracking (OPEN/PARTIAL/RECEIVED). PO status auto-updates (DRAFT/SENT/PARTIAL/RECEIVED/CANCELLED).
- **Physical Counts**: DRAFT→FINALIZED workflow. Creates ADJUSTMENT movements on finalization. Adjustments update WAC and quantity.
- **UOM Conversions**: `toBaseMultiplier` stored per item for consistent unit management.
- **9 Permissions**: `MODULE_INV_VIEW`, `INV_ITEMS_CREATE`, `INV_ITEMS_EDIT`, `INV_SUPPLIERS_MANAGE`, `INV_PO_CREATE`, `INV_PO_RECEIVE`, `INV_COUNT_CREATE`, `INV_COUNT_FINALIZE`, `INV_RECIPES_MANAGE`
- **7 Frontend Pages**: Items list/detail (with kardex), suppliers CRUD, purchase orders (create/receive), physical counts, recipes/BOM, reports (valuation + low stock)
- **Stock Semaphore**: RED (qty ≤ 0), YELLOW (qty ≤ reorder point), GREEN (otherwise)
- **Backend**: 40+ storage functions in `server/inventory-storage.ts`, 39 API routes in `server/inventory-routes.ts`

### Shortages (Faltantes) Module - Complete Implementation
- **3 Database Tables**: `shortages` (main tracking), `shortage_events` (audit log), `shortage_audit_alerts` (manager alerts)
- **Shortage Lifecycle**: OPEN → ACKNOWLEDGED → RESOLVED → CLOSED with full event logging at each transition
- **Severity Levels**: LOW_STOCK (poco stock) and OUT_OF_STOCK (stock inexistente) with visual priority badges
- **Anti-Spam**: Duplicate detection prevents re-reporting same item within configurable window
- **Snapshot Data**: Item name, current quantity, reorder point, and WAC captured at report time for audit integrity
- **8 Permissions**: `SHORTAGES_VIEW`, `SHORTAGES_REPORT`, `SHORTAGES_ACK`, `SHORTAGES_RESOLVE`, `SHORTAGES_CLOSE`, `SHORTAGES_AUDIT`, `SHORTAGES_REPORT_AUDIT`, `MENU_TOGGLE_AVAILABILITY`
- **3 Frontend Pages**: Report (search with auto-expand categories, tabs for Insumos/Productos), Active (status badges, ACK/RESOLVE/CLOSE actions, event history), Audit (manager-only audit alerts with notes)
- **Product Availability Toggle**: "Marcar NO disponible" sets `products.active = false`, removing from QR menu and waiter ordering
- **WebSocket Alerts**: Real-time shortage notifications with audio alerts via `useShortageAlerts` hook integrated into AuthenticatedLayout
- **Dedicated API Endpoints**: `/api/shortages/products`, `/api/shortages/inv-items`, `/api/shortages/categories` with SHORTAGES_REPORT permission (separate from admin endpoints)
- **Backend**: 13 storage functions in `server/shortage-storage.ts`, 11 API routes in `server/shortage-routes.ts`

### Business Logic Fixes - 21 Issues Resolved
- **Payment Integrity**: Void-payment now reverses cash session without changing item statuses. Reopen voids all payments first. Payment validation prevents overpayment (amount ≤ balance_due). Cash payments blocked without active session.
- **Financial Tracking**: Orders now track `paidAmount` and `balanceDue` separately. Updated via `updateOrderPaymentTotals()` on every payment/void.
- **Tax Snapshots**: Taxes are snapshotted on order items at creation (`taxSnapshotJson`). `recalcOrderTotal` uses snapshots instead of live product tax lookups. Removed fragile tax fallback by product name.
- **Split Payments**: `pay-split` now includes modifiers, taxes, and discounts in total. `normalizeOrderItemsForSplit` copies taxes/discounts per-unit. `moveOrderItem` also updates `salesLedgerItems.orderId`.
- **Ledger Accuracy**: `lineSubtotal` now includes modifier price deltas for all origins (POS/WAITER/QR).
- **Permissions**: `PAYMENT_CORRECT` required for void-payment and reopen. `ORDERITEM_VOID_POST_KDS` required for voiding items already sent to kitchen.
- **Portion Reservations**: `portion_reservations` table with TTL for QR atomic inventory. Cancelled on void.
- **Status Regression Prevention**: `recalcOrderStatusFromItems` uses rank-based ordering to prevent status going backwards.
- **Parent Order Recalc**: Parent order status recalculates when child orders are voided or paid.
- **QR Rate Limiting**: Moved from in-memory Map to database (`qr_rate_limits` table) for persistence across restarts.
- **Hard Delete Cleanup**: `deleteOrderItem` now cleans all dependent records (modifiers, taxes, discounts, ledger, split items, kitchen ticket items).
- **QR Audio Alert**: Waiter tables page plays audio notification on new QR submissions.

## Critical Business Logic Rules
- **Timezone**: All business date calculations use `America/Costa_Rica` (UTC-6) via `getBusinessDate()` in `server/storage.ts`. This function uses `toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" })` to ensure orders and payments after 6pm local time are correctly assigned to the current day.
- **Payment business_date**: Payments use `getBusinessDate()` at the moment of payment (not the order's business_date). This correctly handles orders that span midnight (opened one day, paid the next).
- **Dashboard cross-day logic**: The dashboard "Órdenes Pagadas" section includes orders paid on the selected date even if the order was opened on a different day. This ensures totals match the payment method breakdown.
- **Payment method totals**: Both dashboard and cash closing always display ALL active payment methods, showing ₡0 for methods with no transactions that day.

## External Dependencies
- **PostgreSQL**: Primary database for data storage.
- **Vite**: Frontend build tool.
- **Tailwind CSS**: Utility-first CSS framework for styling.
- **shadcn/ui**: UI component library.
- **wouter**: Small routing library for React.
- **Express.js**: Backend web framework.
- **TypeScript**: Superset of JavaScript for type safety.
- **Drizzle ORM**: TypeScript ORM for PostgreSQL.
- **ws**: WebSocket library for real-time communication.
- **express-session**: Middleware for session management.
- **memorystore**: Session store for `express-session`.
- **Nodemailer**: For sending email receipts (requires SMTP configuration).