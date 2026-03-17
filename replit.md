# Sistema Restaurante - MVP v1

## Overview
This project is a Progressive Web Application (PWA) designed as a comprehensive restaurant management system. It aims to streamline restaurant workflows, enhance customer experience through self-ordering, and provide management with real-time insights and control. Key capabilities include order management, a QR-code based client ordering system, a Kitchen Display System (KDS), a Point of Sale (POS), an inventory management system, a shortages tracking module, a manager dashboard, and a reservation system. The system focuses on robust financial accuracy, real-time updates, and an intuitive user experience across devices for small to medium-sized restaurants.

## User Preferences
I prefer simple language. I want iterative development. Ask before making major changes.

## Loyalty System (Phase 1 — Migration 0023)
- **Tables (public schema):** `customers`, `loyalty_accounts`, `loyalty_events`, `loyalty_config`
- **Schema:** `shared/schema.ts` — loyalty tables + `businessConfig.operationModeTable/Qr/Dispatch`
- **Backend:** `server/loyalty-routes.ts` (earn/redeem/config/customers), `server/loyalty-auth.ts` (Google OAuth verifyIdToken)
- **Google Auth:** POST `/api/loyalty/auth/google` — returns 503 if `GOOGLE_CLIENT_ID` is "pending" or unset
- **TenantId resolution:** Uses `req.tenantId` directly from `tenantMiddleware` (no extra DB query)
- **Admin UI:** `/admin/loyalty` — config panel + customers tab with search + reviews tab; Loyalty link in sidebar
- **Business Config:** 3 Switch toggles for Mesa / QR / Despacho operation modes
- **Dependency:** `google-auth-library` installed

## Customer Reviews System (Migration 0026)
- **Table:** `order_reviews` (id, orderId, tenantId, rating, comment, customerName, orderMode, businessDate, createdAt)
- **businessConfig new fields:** `reviewPoints`, `reviewEmail`, `googlePlaceId`
- **QR Client (`qr-client.tsx`):**
  - Screen types extended: `"review" | "review_thanks"` added
  - `beforeunload` warning active on screens 2, 3, 4, dispatch, review
  - Screen 4 (order sent): sticky amber "No cierres tu pantalla" banner; captures `orderId` from submit response
  - Review timer: 30min after QR order sent → shows review screen; dispatch review triggers on DELIVERED (not READY)
  - Star rating UI (1–5), comment textarea, submit and skip buttons
  - `review_thanks` screen shows confirmation + loyalty points awarded (if any)
- **Backend:** `POST /api/qr/:tableCode/review` (public, no auth) — validates, inserts, emails notification
- **Admin reviews:** `GET /api/admin/reviews` (MANAGER) — returns reviews list + avg rating
- **Admin UI (`/admin/loyalty`):** "Reseñas" tab with avg rating widget + full review list
- **Admin UI (`/admin/business-config`):** Review Settings card — reviewPoints, reviewEmail, googlePlaceId fields

## Dispatch "Entregado" Step (KDS)
- **dispatchStatus flow**: `null` → `PENDING_PAYMENT` → `PAID` → `READY` → `DELIVERED`
- **KDS (`kds.tsx`)**: Dispatch tickets stay visible after READY with "Listo · Esperando entrega" badge + orange "Entregar" button. Non-dispatch tickets disappear as before.
- **Backend**: `PATCH /api/dispatch/orders/:orderId/delivered` (requireRole KITCHEN/MANAGER) — sets `dispatchStatus = "DELIVERED"`, broadcasts `dispatch_order_delivered`
- **Storage**: `getActiveKitchenTickets` includes DISPATCH READY tickets where `dispatchStatus != "DELIVERED"`
- **QR client**: Dispatch flow goes DELIVERED → `loyalty_post` → `review` (loyalty_post is placeholder for task #30)
- **Dispatch status endpoint**: `GET /api/dispatch/order/:orderId/status` returns `isDelivered` + `dispatchStatus` fields

## System Architecture
The system is built as a PWA with a mobile-first approach, ensuring broad accessibility and a responsive user experience.

**Frontend:**
-   **Framework:** React with Vite.
-   **Styling:** Tailwind CSS and shadcn/ui.
-   **Routing:** wouter.
-   **UI/UX Decisions:** Responsive layouts, accessible touch targets, intuitive navigation, and a global dark mode toggle. Custom-designed, responsive POS dialogs using pure CSS.
-   **PWA Support:** `manifest.json`, service worker, and meta tags for installability.

**Backend:**
-   **Framework:** Express.js with TypeScript.
-   **Database:** PostgreSQL managed with Drizzle ORM.
-   **Real-time Communication:** WebSocket (`ws` library) for live updates. WSManager (`client/src/lib/ws.ts`) uses a 4-state machine (DISCONNECTED→CONNECTING→CONNECTED→PAUSED) with exponential backoff (500ms→30s max) + jitter on reconnect. Auth-aware: pauses on logout/401, resumes on login. Server-side WS handshake rate-limited (30/min per IP). Bridge connections reject invalid tokens without logging sensitive data.
-   **Authentication:** Tenant-aware session auth — login routes (`/api/auth/login`, `/api/auth/pin-login`, `/api/auth/me`, `/api/auth/user-info`, `/api/auth/verify-manager-pin`) use `req.db` (tenant-scoped DB) instead of default `db`. Dual-mode (cookie-based primary, token-based fallback for embedded contexts). Unified 3-step login flow (username → PIN/password → session) with localStorage username persistence. Password reset via email (Resend). Includes PIN-based login, RBAC, Helmet for HTTP headers, login rate limiting, and secure session handling.
-   **Email Service:** `server/services/email-service.ts` using Resend SDK with lazy initialization (graceful fallback when `RESEND_API_KEY` not set).
-   **Core Business Logic:**
    -   **Timezone Management:** Tenant-aware timezone system via `server/utils/timezone.ts`. Each tenant stores its timezone in `business_config.timezone` (default: `America/Costa_Rica`). All business date calculations use `getTenantTimezone(schema)`, `getBusinessDateInTZ(tz)`, `getNowInTZ(tz)`. Cache with 5-min TTL, invalidated on business config save. NEVER hardcode `America/Costa_Rica` — always use the utility functions.
    -   **Payment Integrity:** Robust payment validation, voiding, cash session management, and tax snapshotting.
    -   **Order Consecutives:** Daily and global order numbering.
    -   **Multi-Printer Support:** Configurable auto-printing. WiFi Print Bridge system (`server/services/print-service.ts`) supports tablet-based bridges (Android Capacitor + Surface Go Node.js) connecting via WebSocket to relay ESC/POS jobs to TCP/IP printers. Bridge CRUD via `/api/admin/print-bridges`. Each printer can be assigned a `bridgeId`. Dual auth flows: header-based (X-Bridge-Token) and message-based (AUTH type). Migration: `0010_print_bridges.sql`. Schema: `printBridges` table + `printers.bridgeId` field.
    -   **HTML Sanitization:** Global middleware to strip HTML tags from request bodies.
    -   **Performance Optimizations:** Database connection pooling, batch transactions for inventory deduction, parallel queries for hot endpoints, specialized API endpoints for reduced payload sizes (e.g., POS tables snapshot), and optimized payment/item addition flows. Extensive database indexing.
    -   **Dynamic Polling:** Uses WebSocket connectivity to adjust polling frequency for real-time data.

**Key Features:**
-   **Order Management:** Waiter interface for table management and QR order acceptance.
-   **QR Client Ordering:** Subaccount-based ordering with modifier selection and rate limiting, secured with HMAC-SHA256 tokens.
-   **Kitchen Display System (KDS):** Real-time order display for kitchen staff, with individual item tracking and status management.
-   **Point of Sale (POS):** Cash register with payment processing, order splitting, voiding, cash session management, item-level discounts, and receipt generation.
-   **Manager Dashboard & Admin Panel:** Overview, user/role/product management, 2-level category system, and business configuration.
-   **Inventory Module:**
    -   **Inline Editable Grid:** Items list is a spreadsheet-style inline editable grid with sticky header, sortable columns (name, category, supplier, stock, reorder, par, cost, status), supplier filter, and mobile edit dialogs. Edits save inline via PATCH on blur/Enter. UOM is editable. Purchase presentation fields: `purchasePresentation` (text select), `purchaseQtyPerBaseUom` (qty in base UOM per presentation), `lastCostPerPresentation` (₡ per presentation). Auto-calculates `lastCostPerBaseUom = lastCostPerPresentation / purchaseQtyPerBaseUom`. "Recalcular Costos" button sets avgCost=lastCost for all active items.
    -   **Basic Inventory Control:** Manages product portion availability, reorder points, and auto-disabling with idempotent deduction logic.
    -   **Full Inventory (AP/EP):** Supports dual-type items (AP/EP), AP→EP conversions with factors, production batches, recipes, and dedicated stock tables with transactional updates.
    -   **UOM System:** Standardized unit of measurement conversions.
    -   **Auto-Deduction:** FULL-first-then-BASIC strategy on item `SENT` status, with transactional and idempotent stock updates.
    -   **Physical Counts:** Supports AP/EP/ALL/Category scope with finalization creating inventory adjustments.
    -   **Purchase Orders:** Reorder suggestions and PO receipt processing. Inline full-page PO creation flow.
    -   **Supplier Linkage:** `inv_items.default_supplier_id` FK to `inv_suppliers`. CSV import auto-creates suppliers and `inv_supplier_items` relationships. Supplier visible in items list/detail, editable in create/edit dialogs.
-   **Shortages Module:** Manages item shortages with lifecycle tracking and alerts.
-   **Reservations Module:** Comprehensive table reservation system with public booking, staff management, conflict detection, and email confirmations.
-   **Smart Delete System:** Implements soft or hard deletion for inventory items and products based on related records.
-   **Public Menu Page:** Informational, public-facing menu showing product hierarchy, descriptions, prices, and images. Rate-limited and cached.
-   **Item Voiding System:** Soft-voids requiring manager PIN authorization for sent items, with audit trails.
-   **QR Order Editing:** Waiter can directly edit QR submissions, adding/removing products before acceptance.
-   **HR Payroll Engine V2 (Phase A Complete):** Retroactive, deterministic payroll recalculation from raw punches. Features:
    -   `normalizePunches()`: Filters zero-duration/corrupt punches, merges overlapping and adjacent (≤1min gap) intervals.
    -   `computeDailyPayroll()`: Paid-start policy (SCHEDULE_START_CAP or ACTUAL), overtime only on MANUAL clock-out past scheduled end (AUTO/GEO_AUTO → 0), break deduction (configurable threshold/amount), tardiness tracking, flags array.
    -   `overtimeRequiresApproval`: When true, calculated overtime shows as "Pendiente" with `overtimePaidMinutes=0` until manager approves.
    -   **Overtime Approval Flow:** `hr_overtime_approvals` table (unique per employee+date). Manager can approve/reject/revert individual days or bulk. Rejected requires reason. Approved OT pays calculated minutes; rejected/pending pays 0. API: GET/POST `/api/hr/overtime-approvals`, POST `/api/hr/overtime-approvals/bulk`. UI controls in planilla daily breakdown with approve/reject/revert buttons and bulk actions per employee.
    -   **Service Charge Distribution:** Two selectable modes in payroll report UI — **BOLSA** (equal split of daily pool among waiters with sales that day) and **VENTA_MESERO** (each waiter's individual daily service amount). Both multiply by `serviceChargeRate` from HR config. No dependency on punches/schedules. `computeServiceForRange()` in `server/payroll.ts`. Report shows mode, applied percentage, and unassigned total for auditability.
    -   CCSS social charges: Configurable employee/employer rates, optional service charge inclusion.
    -   UI: Planilla report with Extra (Calc) vs Extra (Pag) columns, per-day schedule display, flag badges, CCSS columns (conditional), delete/manual punch management, overtime approval controls, service mode selector (Bolsa/Venta por Mesero).
    -   HR Settings UI: Paid start policy, overtime approval toggle, break config, CCSS config.
-   **QuickBooks Online Integration:** OAuth-based integration for asynchronous payment syncs with retry mechanisms, mapping RMS categories to QBO items, and environment-aware tax code handling.
-   **Multi-Tenant Layer (RMSCore):** Dormant multi-tenant architecture. Tenant resolution via subdomain (production) or `TENANT_SCHEMA` env var (development). Per-tenant DB pool cache (`server/db-tenant.ts`), tenant middleware (`server/middleware/tenant.ts`), `requireModule()` guard. Public schema tables: `tenants`, `tenant_modules`, `superadmin_users`, `provision_log`, `billing_events`. Schema defined in `shared/schema-public.ts`.
-   **Provision Module (Superadmin API):** `/api/superadmin/*` routes secured by `X-Superadmin-Token` header. Full tenant lifecycle: create (with schema cloning, admin user, seed data), suspend, reactivate, re-provision (FAILED tenants), plan change, addon activation. Hourly lifecycle check for trial expiration. Sequence config (orderDailyStart, orderGlobalStart, invoiceStart) settable at create/reprovision. Files: `server/provision/provision-service.ts`, `server/provision/provision-routes.ts`.
-   **Multi-Tenant Migration System:** Versioned SQL migrations in `migrations/` directory. `schema_migrations` table tracks applied migrations per schema. `syncAllTenantsAtStartup()` runs on every server start: backfills Tenant 1's migration log (marks all as applied without re-executing), then propagates pending migrations to all active tenant schemas. Per-statement execution (split at `--> statement-breakpoint`) with clear error reporting. `getMigrationStatus()` provides per-schema dashboard. Tenant search_path is isolated — non-public schemas NEVER include `public` fallback, preventing data leakage. Safety guards: `reprovisionTenant()` blocks on `public` schema, `createTenant()` validates generated schema names against reserved list. Files: `server/provision/migrate-tenants.ts`, `server/provision/run-migrate.ts`. NEVER use `drizzle-kit push` — it will drop multi-tenant tables. Instead: add SQL to `migrations/` and let auto-propagation handle it.
-   **Dispatch Mode (Modelo 3):** QR→kitchen→customer notification flow. Client submits order via `/api/dispatch/:tableCode/submit`, order goes directly to kitchen. WebSocket-based real-time notification when ticket is marked READY in KDS. `dispatch_register` WS message type for client session registration. File: `server/dispatch-routes.ts`.
-   **RBAC Default Permissions:** `seedDefaultRolePermissions()` in `server/storage.ts` runs at startup. MANAGER gets all 57 permissions, WAITER/CASHIER/COOK get appropriate subsets (HR view, shortages view/report, etc.). Idempotent via ON CONFLICT check. Employees do NOT get MODULE_PRODUCTS_VIEW or MODULE_ADMIN_VIEW.
-   **Initial Inventory Import:** `POST /api/admin/import-initial-inventory` reads CSV from `server/data/initial-inventory.csv`, parses 143 items (Abarrotes, Verduras, Carnes, Porciones), maps to inv_items schema. Button in Admin → Config. Negocio. Idempotent — skips existing SKUs.
-   **Tenant Bootstrap Data Loader:** Deterministic Excel import module for rapid tenant setup. Upload Master Excel → parse → alias map → staging ledger → inline editor → validate → transactional import → system check → tenant ready. Files: `server/data-loader/` (column-aliases.ts, excel-parser.ts, validation-engine.ts, import-engine.ts, system-check.ts, data-loader-routes.ts, excel-template.ts). Frontend: `client/src/pages/admin/data-loader.tsx` + `client/src/components/data-loader/`. Migration: `migrations/0004_data_loader_staging.sql`. Staging tables: `data_loader_sessions`, `data_loader_staging`. API base: `/api/admin/data-loader`. Supports 11 sheets: Business, Taxes, PaymentMethods, Employees, Categories, Products, ModifierGroups, Modifiers, ProductModifiers, Tables, HRConfig.

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
-   **connect-pg-simple:** PostgreSQL session store.
-   **helmet:** HTTP security headers middleware.
-   **Nodemailer:** For email receipts.
-   **QuickBooks Online:** Accounting software integration.