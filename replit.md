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
-   **Inventory Module:** Tracks items, suppliers, purchase orders, physical counts, recipes, and consumption with Weighted Average Cost (WAC) calculation.
-   **Shortages Module:** Manages item shortages with lifecycle tracking, severity levels, and real-time alerts.
-   **Reservations Module:** Complete table reservation system with public booking, staff management, conflict detection, duration configuration, email confirmations, and capacity-based availability. Supports multi-table assignment.
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