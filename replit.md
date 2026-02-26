# Sistema Restaurante - MVP v1

## Overview
This project is a Progressive Web Application (PWA) designed as a comprehensive restaurant management system for small to medium-sized restaurants, capable of handling 20-30 concurrent orders. It aims to streamline restaurant workflows, enhance customer experience through self-ordering, and provide management with real-time insights and control. Key capabilities include order management, a QR-code based client ordering system, a Kitchen Display System (KDS), a Point of Sale (POS), an inventory management system, a shortages tracking module, and a manager dashboard. The system focuses on robust financial accuracy, real-time updates, and an intuitive user experience across devices.

## User Preferences
I prefer simple language. I want iterative development. Ask before making major changes.

## System Architecture
The system is built as a PWA with a mobile-first approach, ensuring broad accessibility and a responsive user experience.

**Frontend:**
-   **Framework:** React with Vite.
-   **Styling:** Tailwind CSS and shadcn/ui for a modern, responsive interface.
-   **Routing:** wouter.
-   **UI/UX Decisions:** Responsive layouts, accessible touch targets, intuitive navigation (accordion menus, card-based lists), and a global dark mode toggle. Features like the POS dialogs are custom-designed for responsiveness across mobile, tablet, and desktop, using pure CSS for styling and animations.
-   **PWA Support:** `manifest.json`, service worker, and meta tags for installability.

**Backend:**
-   **Framework:** Express.js with TypeScript.
-   **Database:** PostgreSQL managed with Drizzle ORM.
-   **Real-time Communication:** WebSocket (`ws` library) for live updates.
-   **Authentication:** Dual-mode session auth: cookie-based (primary, for PWA/direct browser) + token-based fallback (for iframe/embedded contexts like Replit preview where cookies are blocked). Login endpoints return `sessionToken` + `permissions` in the response. Frontend stores token in memory and injects `X-Session-Token` header via global fetch override (`main.tsx`). Server middleware (`routes.ts`) checks header and loads session from PostgreSQL store when cookies are absent. PIN-based login, RBAC with configurable permissions, Helmet for HTTP headers, login rate limiting, secure session handling, and body limits.
-   **Core Business Logic:**
    -   **Timezone Management:** All business date calculations use `America/Costa_Rica` (UTC-6).
    -   **Payment Integrity:** Robust payment validation, voiding, cash session management, and tax snapshotting for accuracy.
    -   **Order Consecutives:** Daily and global order numbering.
    -   **Multi-Printer Support:** Configurable for different printer types with auto-printing.
    -   **HTML Sanitization:** Global middleware to strip HTML tags from request bodies.

**Key Features:**
-   **Order Management:** Waiter interface for table management and QR order acceptance.
-   **QR Client Ordering:** Subaccount-based ordering with dual-mode interface, modifier selection, and rate limiting. Uses HMAC-SHA256 tokens for security.
-   **Kitchen Display System (KDS):** Real-time display for kitchen staff to manage orders.
-   **Point of Sale (POS):** Cash register with payment processing, order splitting, voiding, cash session management, item-level discounts, and receipt generation.
-   **Manager Dashboard & Admin Panel:** Comprehensive overview, user/role/product management, 2-level category system (TOP → Subcategory), and business configuration.
-   **Inventory Module:** Full inventory management with AP→EP conversions, production batches, recipes, auto-deduction, physical counts, and purchase orders.
    -   **Basic Inventory Control Panel** (`/inventory/basic`): Admin panel to manage product portion availability. Supports Set, +/- Adjust, Clear (→Ilimitado), Enable/Disable, and Set Reorder Point actions. Idempotent deduction system prevents double-counting via `audit_events` guards. Auto-disable broadcasts `product_availability_changed` WebSocket event. **SENT-only deduction rule**: portions only deduct when item status becomes SENT (POS with sendToKds=true, Waiter, QR). POS items with sendToKds=false stay OPEN and do NOT deduct. **Reorder Point**: nullable `reorderPoint` integer on products table; when `availablePortions <= reorderPoint`, API returns `reorderAlert=true` and UI shows amber "Reponer" badge. Status filter includes "Reponer" option. Audit actions: `BASIC_STOCK_SET`, `BASIC_STOCK_CLEAR`, `BASIC_STOCK_ADJUST`, `BASIC_STOCK_DEDUCT`, `BASIC_STOCK_RESTORE`, `BASIC_AUTO_DISABLE`, `BASIC_MANUAL_ENABLE`, `BASIC_MANUAL_DISABLE`, `BASIC_REORDER_SET`.
    -   **Full Inventory (AP/EP):** Dual-type items (`inv_items.itemType` = 'AP'|'EP'), AP→EP conversions with merma/cook/loss factors and server-side cost calculation (Forma A: `epUnitCost = apCostPerBaseUom / epQtySmall`), production batches with transactional stock updates (FOR UPDATE locks), recipes referencing EP/AP items, and dedicated stock tables (`inv_stock_ap`, `inv_stock_ep`). Cost fields (`lastCostPerBaseUom`, `avgCostPerBaseUom`, `unitWeightG`) editable in item create (items.tsx) and item detail edit (item-detail.tsx) forms. Backend coerces numeric JSON values to strings for Drizzle numeric columns via `coerceNumericFields()` in inventory-routes.ts.
    -   **UOM System** (`server/uom-helpers.ts`): Allowed UOMs: KG, G, L, ML, UNIT, PORTION. `normalizeUom()` maps aliases and rejects unknown values. `toSmallUnit()` converts KG→G, L→ML. Cross-UOM UNIT→G uses `unitWeightG` field on `inv_items`. Quick-EP endpoint: `POST /api/inv/items/quick-ep` creates EP items inline from conversions page.
    -   **Auto-Deduction on SENT** (`server/inventory-deduction.ts`): FULL-first-then-BASIC strategy. On SENT: resolves active recipe, deducts EP/AP stock via DB transaction with row locks (ordered by itemType ASC, invItemId ASC), then runs BASIC decrement. If FULL fails (insufficient stock), SENT is blocked. Idempotency via `inventory_deductions` table (unique orderItemId). Void reverses FULL (from consumptionPayload snapshot) then BASIC. REVERSED deductions never reprocessed. Canonical movement types: CONSUME_AP, CONSUME_EP, PRODUCE_EP, ADJUST_AP, ADJUST_EP, RECEIVE_AP, REVERSE_CONSUME_AP, REVERSE_CONSUME_EP.
    -   **Physical Counts (AP/EP):** Scope selector (AP/EP/ALL/Category), system qty from `inv_stock_ap`/`inv_stock_ep`, finalization creates ADJUST_AP/ADJUST_EP movements with refType='PHYSICAL_COUNT'.
    -   **Purchase Orders:** Reorder suggestions for AP items below reorder point, PO receipt updates `inv_stock_ap` via transactional stock increment + RECEIVE_AP movement with refType='PO_RECEIPT'.
-   **Shortages Module:** Manages item shortages with lifecycle tracking, severity levels, and real-time alerts.
-   **Reservations Module:** Complete table reservation system with public booking, staff management, conflict detection, duration configuration, email confirmations, and capacity-based availability. Supports multi-table assignment.
-   **Smart Delete System:** Both inventory items (inv_items) and products support smart deletion: if no related records exist → hard delete (removed from DB); if related records exist (orders, movements, conversions, etc.) → soft delete (marked inactive, hidden from UI). Inventory items: `DELETE /api/inv/items/:id` with `smartDeleteInvItem()`. Products: `DELETE /api/admin/products/:id` with `smartDeleteProduct()`. Both return `{ item/product, hardDeleted }` for appropriate UI feedback.
-   **Public Menu Page** (`/menu`): Public-facing informational menu page showing TOP Category → Subcategory → Products hierarchy. No login required. Products display name, description, price (Colones), and optional image. Rate limited (30 req/min per IP) with 60s cache. API: `GET /api/public/menu`.
    -   **Product Images:** `imageUrl` field on products table. Upload via `POST /api/admin/products/:id/image` (base64, max 2MB, JPG/PNG/WebP). Delete via `DELETE /api/admin/products/:id/image`. Images stored in `client/public/product-images/` and `dist/public/product-images/`.
-   **Item Voiding System:** Soft-voids for waiters, hard-deletes for managers, with audit trails.
-   **QuickBooks Online Integration:** OAuth flow for connection, encrypted token storage, asynchronous fire-and-forget sync strategy for payments, and a retry queue for failed syncs. Mapping of RMS categories to QBO items and deposit accounts per payment method.

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
-   **Nodemailer:** For email receipts (requires SMTP setup).
-   **QuickBooks Online:** Accounting software integration.