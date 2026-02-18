# Sistema Restaurante - MVP v1

## Overview
This project is a Progressive Web Application (PWA) designed as a comprehensive restaurant management system for small to medium-sized restaurants, capable of handling 20-30 concurrent orders. It aims to streamline restaurant workflows, enhance customer experience through self-ordering, and provide management with real-time insights and control. Key capabilities include order management for waiters, a QR-code based client ordering system, a Kitchen Display System (KDS), a Point of Sale (POS) / cash register, an inventory management system, a shortages tracking module, and a manager dashboard.

## User Preferences
I prefer simple language. I want iterative development. Ask before making major changes.

## System Architecture
The system is built as a PWA, ensuring accessibility across various devices, and utilizes a mobile-first approach for its UI/UX.

**Frontend:**
-   **Framework:** React with Vite.
-   **Styling:** Tailwind CSS and shadcn/ui for a modern, responsive interface.
-   **Routing:** wouter.
-   **UI/UX Decisions:** Responsive layouts, accessible touch targets, and intuitive navigation patterns (e.g., accordion menus, card-based lists on mobile). Includes a global dark mode toggle.

**Backend:**
-   **Framework:** Express.js with TypeScript for a robust and type-safe API.
-   **Database:** PostgreSQL managed with Drizzle ORM.
-   **Real-time Communication:** WebSocket (`ws` library) for live updates across modules.
-   **Authentication:** Session-based with `express-session` and `memorystore`. Features a PIN-based login and Role-Based Access Control (RBAC) with configurable, permission-based module access.
-   **Core Business Logic:**
    -   **Timezone Management:** All business date calculations use `America/Costa_Rica` (UTC-6) to accurately assign orders and payments, especially across midnight.
    -   **Payment Integrity:** Robust payment validation, voiding, and cash session management ensuring financial accuracy.
    -   **Tax Snapshots:** Taxes are snapshotted on order items at creation for consistent order totals.
    -   **Order Consecutives:** Daily and global order numbering for traceability.
    -   **Multi-Printer Support:** Configuration for different printer types with auto-printing on POS payment.

**Key Features:**
-   **Order Management:** Waiter interface for table management, order taking, and QR order acceptance.
-   **QR Client Ordering:** Subaccount-based ordering with dual-mode interface (Easy Mode interview flow / Standard Mode card grid), supporting up to 6 subaccounts per table, customer name tracking, modifier selection, and rate limiting.
-   **Kitchen Display System (KDS):** Real-time display for kitchen staff to manage food preparation and update item statuses.
-   **Point of Sale (POS):** Cash register functionality, including payment processing, order splitting, voiding, cash session management, and thermal/email receipt generation. Supports item-level discounts and configurable tax categories.
-   **Manager Dashboard:** Comprehensive overview of restaurant performance with real-time metrics, historical data, and drill-down capabilities.
-   **Admin Panel:** Management of users, roles, permissions, tables, categories, products, payment methods, tax categories, business configurations, and printers. Includes 2-level category system (TOP → Subcategory) with idempotent seed for base TOPs (Comidas, Bebidas, Alcohol, Postres).
-   **2-Level Category System:** Categories support `parentCategoryCode` for hierarchical organization. TOP categories (prefixed `TOP-`) act as high-level groups shown as colored segmented controls. Subcategories are child categories assigned to a TOP via `parentCategoryCode`. Falls back to flat category list when no TOPs exist. Default TOPs: Comidas (emerald), Bebidas (blue), Postres (rose). Subcategories displayed in fixed grid (2x2 for 4 items, Nx1 for ≤3 items). All buttons same height (48px) per level.
-   **Inventory Module:** Tracks inventory items, suppliers, purchase orders, physical counts, recipes, and consumption. Features Weighted Average Cost (WAC) calculation and automatic inventory consumption/reversal based on order actions.
-   **Shortages Module:** Tracks and manages item shortages with lifecycle (OPEN, ACKNOWLEDGED, RESOLVED, CLOSED), severity levels, audit logging, and real-time alerts. Integrates with product availability toggling.
-   **PWA Support:** `manifest.json`, service worker, and meta tags for installability.
-   **Item Voiding System:** Soft-voids for waiters, hard-deletes for managers, with full audit trails.
-   **POS Cash Report Permission:** Granular control over cash report visibility and data filtering.

## Data Milestones

### Loyverse Historical Data Import (February 18, 2026)
-   **Status:** COMPLETED - One-time import, script deleted to prevent re-execution.
-   **Checkpoint de referencia (pre-importación):** Commit `69014ab4d603be6087acf688abfc19761613889c` — Estado del sistema antes de la carga histórica. Punto de rollback si fuera necesario.
-   **Data imported:**
    -   58,344 sales ledger items (`sales_ledger_items` table)
    -   11,269 payments (`payments` table)
    -   Spanning: April 2024 to February 2026 (573 unique business days)
    -   254 unique products, 11,269 unique orders
    -   Total paid sales: ~₡210.5M (CARD ₡174.8M, CASH ₡33.7M, SINPE ₡3.4M)
-   **Data integrity verified:**
    -   Ledger vs Payments discrepancy: <0.01% (1 order / ₡11,000 of ₡210.5M)
    -   0 orphaned payment records (all payments have matching ledger entries)
    -   0 NULL business_date, product_name, unit_price, origin, or status values
    -   189 items without category (generic Loyverse items) — acceptable
    -   2 items with qty=0 (adjustments/courtesies) — acceptable
    -   Hour distribution consistent with restaurant hours (peak 7pm-10pm CR time)
-   **Timezone handling:** All timestamps stored as UTC in `timestamp without time zone` columns. Business date/hour extraction uses double `AT TIME ZONE` conversion: `(ts AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica'`.
-   **Safety:** Import script (`scripts/import-historical-data.ts`) was deleted after successful import. No mechanism exists to re-run the import. The script had an idempotency check (abort if >50,000 rows exist) as an additional safeguard.
-   **Origin marker:** All imported records have `origin = 'LOYVERSE'` to distinguish from system-generated records (`origin = 'SYSTEM'`).

## External Dependencies
-   **PostgreSQL:** Primary database.
-   **Vite:** Frontend build tool.
-   **Tailwind CSS:** Utility-first CSS framework.
-   **shadcn/ui:** UI component library.
-   **wouter:** React routing library.
-   **Express.js:** Backend framework.
-   **TypeScript:** Language for type safety.
-   **Drizzle ORM:** PostgreSQL ORM.
-   **ws:** WebSocket library.
-   **express-session:** Session management middleware.
-   **memorystore:** Session store.
-   **Nodemailer:** For email receipts (requires SMTP setup).