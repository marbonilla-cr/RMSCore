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
-   **2-Level Category System:** Categories support `parentCategoryCode` for hierarchical organization. TOP categories (prefixed `TOP-`) act as high-level groups shown as colored segmented controls. Subcategories are child categories assigned to a TOP via `parentCategoryCode`. Falls back to flat category list when no TOPs exist.
-   **Inventory Module:** Tracks inventory items, suppliers, purchase orders, physical counts, recipes, and consumption. Features Weighted Average Cost (WAC) calculation and automatic inventory consumption/reversal based on order actions.
-   **Shortages Module:** Tracks and manages item shortages with lifecycle (OPEN, ACKNOWLEDGED, RESOLVED, CLOSED), severity levels, audit logging, and real-time alerts. Integrates with product availability toggling.
-   **PWA Support:** `manifest.json`, service worker, and meta tags for installability.
-   **Item Voiding System:** Soft-voids for waiters, hard-deletes for managers, with full audit trails.
-   **POS Cash Report Permission:** Granular control over cash report visibility and data filtering.

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