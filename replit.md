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
- **MANAGER**: Full access to all modules + admin panel
- **WAITER**: Table management, order taking, QR acceptance
- **KITCHEN**: KDS (Kitchen Display System)
- **CASHIER**: POS / Cash register

## Default Login Credentials (All use password: 1234)
- gerente / 1234 (MANAGER)
- salonero1 / 1234 (WAITER)
- salonero2 / 1234 (WAITER)
- cocina / 1234 (KITCHEN)
- cajero / 1234 (CASHIER)

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
- `GET /api/waiter/tables` - Tables with order status
- `POST /api/waiter/tables/:id/send-round` - Send items to kitchen
- `POST /api/waiter/qr-submissions/:id/accept` - Accept QR order
- `GET /api/qr/:tableCode/menu` - QR menu
- `POST /api/qr/:tableCode/submit` - QR order submission
- `GET /api/kds/tickets/:type` - KDS tickets (active/history)
- `PATCH /api/kds/items/:id` - Update kitchen item status
- `GET /api/pos/tables` - Tables ready for payment
- `POST /api/pos/pay` - Process payment
- `GET/POST /api/pos/cash-session/*` - Cash session management
- `GET /api/dashboard` - Dashboard metrics

## WebSocket Events
- `qr_submission_created` - New QR order
- `order_updated` - Order changes
- `kitchen_ticket_created` - New kitchen ticket
- `kitchen_item_status_changed` - Item status update
- `payment_completed` - Payment processed
- `table_status_changed` - Table status change

## Database Schema
All tables defined in `shared/schema.ts` using Drizzle ORM:
users, tables, categories, products, payment_methods, orders, order_items, qr_submissions, kitchen_tickets, kitchen_ticket_items, payments, cash_sessions, split_accounts, split_items, sales_ledger_items, audit_events
