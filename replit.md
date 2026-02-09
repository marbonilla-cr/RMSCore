# Sistema Restaurante - MVP v1

## Overview
Restaurant management system (PWA) for a small restaurant (20-30 concurrent orders). Includes order management by waiters, QR client ordering, KDS (kitchen display), POS/cash register, and manager dashboard.

## Architecture
- **Frontend**: React + Vite + Tailwind + shadcn/ui, wouter for routing
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Real-time**: WebSocket (ws library)
- **Auth**: Session-based (express-session + memorystore)

## User Roles
- **MANAGER**: Full access to all modules + admin panel + void/reopen
- **WAITER**: Table management, order taking, QR acceptance
- **KITCHEN**: KDS (Kitchen Display System)
- **CASHIER**: POS / Cash register

## Default Login Credentials (All use password: 1234)
- gerente / 1234 (MANAGER)
- salonero / 1234 (WAITER)
- salonero1 / 1234 (WAITER)
- salonero2 / 1234 (WAITER)
- cocina / 1234 (KITCHEN)
- cajero / 1234 (CASHIER)
- caja / 1234 (CASHIER)

## Key Routes
- `/` - Tables view (waiters)
- `/tables/:id` - Table detail / order management
- `/kds` - Kitchen Display System
- `/pos` - POS / Cash register
- `/dashboard` - Manager dashboard
- `/admin/*` - Admin panel (tables, categories, products, payment methods, users)
- `/qr/:tableCode` - QR client ordering (no auth required)

## API Endpoints
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Current user
- `GET/POST/PATCH /api/admin/tables` - Table CRUD
- `GET/POST/PATCH /api/admin/categories` - Category CRUD
- `GET/POST/PATCH /api/admin/products` - Product CRUD
- `GET/POST/PATCH /api/admin/payment-methods` - Payment method CRUD
- `GET/POST/PATCH /api/admin/users` - User CRUD
- `GET /api/waiter/tables` - Tables with order status (includes lastSentToKitchenAt)
- `POST /api/waiter/tables/:id/send-round` - Send items to kitchen
- `POST /api/waiter/qr-submissions/:id/accept` - Accept QR order
- `GET /api/qr/:tableCode/menu` - QR menu
- `POST /api/qr/:tableCode/submit` - QR order submission (30s rate limit per table)
- `GET /api/kds/tickets/:type` - KDS tickets (active/history)
- `PATCH /api/kds/items/:id` - Update kitchen item status
- `GET /api/pos/tables` - Tables ready for payment
- `POST /api/pos/pay` - Process full payment
- `GET /api/pos/orders/:orderId/payments` - Get payments for an order
- `GET /api/pos/orders/:orderId/splits` - Get split accounts for order
- `POST /api/pos/orders/:orderId/splits` - Create split account
- `DELETE /api/pos/splits/:id` - Delete split account
- `POST /api/pos/pay-split` - Pay a split account
- `POST /api/pos/void-payment/:id` - Void payment (MANAGER only)
- `POST /api/pos/reopen/:orderId` - Reopen paid order (MANAGER only)
- `GET/POST /api/pos/cash-session/*` - Cash session management (close includes totalsByMethod)
- `GET/POST /api/qbo/export` - QBO export job (MANAGER only)
- `GET /api/dashboard` - Dashboard metrics (includes ledgerDetails, paymentMethodTotals)

## WebSocket Events
- `qr_submission_created` - New QR order
- `order_updated` - Order changes
- `kitchen_ticket_created` - New kitchen ticket
- `kitchen_item_status_changed` - Item status update
- `payment_completed` - Payment processed
- `payment_voided` - Payment voided
- `table_status_changed` - Table status change

## Database Schema
All tables defined in `shared/schema.ts` using Drizzle ORM:
users, tables, categories, products, payment_methods, orders, order_items, qr_submissions, kitchen_tickets, kitchen_ticket_items, payments, cash_sessions, split_accounts, split_items, sales_ledger_items, audit_events, qbo_export_jobs

## API Endpoints (New)
- `GET /api/tables/:id/current` - Single source of truth: table + activeOrder + orderItems + pendingQrSubmissions

## Role-Based Access Control
- Frontend: RoleGuard component redirects unauthorized users to their default route
- Backend: requireRole middleware on all sensitive endpoints
  - WAITER: /api/waiter/*, /api/tables/:id/current
  - KITCHEN: /api/kds/*
  - CASHIER: /api/pos/*
  - MANAGER: all routes + /api/admin/* + /api/dashboard

## Recent Changes
- Added QR swipe-to-confirm gesture (drag 85% threshold)
- Added split accounts (division de cuenta) with full POS UI
- Added void payment and reopen order (manager only)
- Added cash closing totals by payment method
- Added QBO export validation stub
- Added QR rate limiting (30s cooldown per table)
- Added dashboard drill-down with expandable rows
- Added tables page time columns and column selector
- Added payment method totals to dashboard from backend
- Added GET /api/tables/:id/current (single source of truth endpoint)
- Fixed table-detail to use /current endpoint with loading skeleton (no more blank screen)
- Added toast notification in tables page for new QR orders (with table name)
- Improved QR acceptance: returns full payload, audit WAITER_ACCEPTED_QR
- Added frontend role-based route protection (RoleGuard component)
- Added backend requireRole middleware to KDS/POS/Dashboard/Waiter endpoints
- Added "Open QR Client UI" button in Admin Tables
- Added salonero/caja seed users
