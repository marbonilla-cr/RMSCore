# Restaurant Management System - Mobile App Technical Specification

This document contains all the technical information needed to build a native mobile app (Android/iOS) that connects to the existing Restaurant Management System (RMS) web backend.

---

## 1. Database & Models

**Database:** PostgreSQL (Neon-backed)

### Core Tables

**users** - Staff/Employees
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| username | text, unique | Login username |
| password | text | Bcrypt hash |
| displayName | text | Display name |
| role | text | WAITER / CASHIER / KITCHEN / MANAGER |
| active | boolean | Account active |
| email | text | Optional email |
| pin | text | Bcrypt-hashed 4-digit PIN |
| pinFailedAttempts | integer | Failed PIN attempts counter |
| pinLockedUntil | timestamp | PIN lockout expiry |
| dailyRate | numeric(10,2) | Daily pay rate |

**tables** - Restaurant Tables
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| tableCode | text, unique | Used in QR codes |
| tableName | text | Display name (e.g. "Mesa 1") |
| active | boolean | |
| sortOrder | integer | Display order |
| capacity | integer | Seats (default 4) |

**categories** - Menu Categories (2-level: TOP → Subcategory)
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| categoryCode | text, unique | |
| name | text | |
| parentCategoryCode | text | null = top-level |
| active | boolean | |
| sortOrder | integer | |
| kdsDestination | text | "cocina" or "barra" |
| foodType | text | "comidas" or "bebidas" |

**products** - Menu Items
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| productCode | text, unique | |
| name | text | |
| description | text | |
| categoryId | integer FK | |
| price | numeric(10,2) | |
| active | boolean | |
| visibleQr | boolean | Visible in QR menu |
| availablePortions | integer | null = unlimited |
| serviceTaxApplicable | boolean | |

**orders** - Orders/Accounts
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| tableId | integer FK | |
| status | text | OPEN / IN_KITCHEN / READY / PAID / VOIDED / CANCELLED |
| responsibleWaiterId | integer FK | |
| openedAt | timestamp | |
| closedAt | timestamp | |
| businessDate | text | YYYY-MM-DD format |
| totalAmount | numeric(10,2) | |
| paidAmount | numeric(10,2) | |
| balanceDue | numeric(10,2) | |
| dailyNumber | integer | Daily consecutive |
| globalNumber | integer | Global consecutive |
| parentOrderId | integer | For split orders |
| splitIndex | integer | Split sequence |
| guestCount | integer | Number of guests |

**orderItems** - Order Line Items
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| orderId | integer FK | |
| productId | integer FK | |
| productNameSnapshot | text | Name at time of order |
| productPriceSnapshot | numeric(10,2) | Price at time of order |
| qty | integer | |
| notes | text | Special instructions |
| origin | text | WAITER / QR |
| createdByUserId | integer FK | |
| responsibleWaiterId | integer FK | |
| status | text | PENDING / SENT / VOIDED |
| roundNumber | integer | Kitchen round |
| subaccountId | integer FK | QR subaccount |
| customerNameSnapshot | text | Customer name from QR |
| sentToKitchenAt | timestamp | |
| voidedAt | timestamp | |
| voidedByUserId | integer FK | |

**payments** - Payments
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| orderId | integer FK | |
| splitId | integer FK | Optional split account |
| amount | numeric(10,2) | |
| paymentMethodId | integer FK | |
| paidAt | timestamp | |
| cashierUserId | integer FK | |
| status | text | PAID / VOIDED |
| clientNameSnapshot | text | |
| clientEmailSnapshot | text | |
| businessDate | text | |
| voidedByUserId | integer FK | |
| voidedAt | timestamp | |
| voidReason | text | |

**paymentMethods** - Payment Methods
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| paymentCode | text, unique | |
| paymentName | text | e.g. "Efectivo", "Tarjeta", "SINPE" |
| active | boolean | |
| sortOrder | integer | |

**cashSessions** - Cash Register Sessions
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| openedAt | timestamp | |
| closedAt | timestamp | |
| openedByUserId | integer FK | |
| closedByUserId | integer FK | |
| openingCash | numeric(10,2) | |
| expectedCash | numeric(10,2) | |
| countedCash | numeric(10,2) | |
| difference | numeric(10,2) | |
| totalsByMethod | jsonb | Breakdown by payment method |
| notes | text | |

**splitAccounts** - Split Bill Accounts
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| orderId | integer FK | |
| label | text | Account label |

**splitItems** - Items Assigned to Splits
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| splitId | integer FK | |
| orderItemId | integer FK | |

**orderSubaccounts** - QR Subaccounts per Table
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| orderId | integer FK | |
| tableId | integer FK | |
| slotNumber | integer | |
| code | text | Unique subaccount code |
| label | text | Customer name |
| isActive | boolean | |

**modifierGroups** - Product Modifier Groups
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| name | text, unique | |
| required | boolean | Must select? |
| multiSelect | boolean | Multiple selections? |
| minSelections | integer | |
| maxSelections | integer | |
| active | boolean | |

**modifierOptions** - Options within Modifier Groups
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| groupId | integer FK | |
| name | text | |
| priceDelta | numeric(10,2) | Price adjustment |
| active | boolean | |

**orderItemModifiers** - Modifiers Applied to Order Items
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| orderItemId | integer FK | |
| modifierOptionId | integer FK | |
| nameSnapshot | text | |
| priceDeltaSnapshot | numeric(10,2) | |
| qty | integer | |

**discounts** - Available Discounts
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| name | text | |
| type | text | "percentage" or "fixed" |
| value | numeric(10,2) | |
| restricted | boolean | Manager-only |
| active | boolean | |

**orderItemDiscounts** - Discounts Applied to Items
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| orderItemId | integer FK | |
| orderId | integer FK | |
| discountName | text | |
| discountType | text | |
| discountValue | numeric(10,2) | |
| amountApplied | numeric(10,2) | |
| appliedByUserId | integer FK | |

**taxCategories** - Tax Definitions
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| name | text | e.g. "IVA 13%" |
| rate | numeric(5,2) | e.g. 13.00 |
| inclusive | boolean | Tax included in price? |
| active | boolean | |

**orderItemTaxes** - Taxes Applied to Items
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| orderItemId | integer FK | |
| taxCategoryId | integer FK | |
| taxNameSnapshot | text | |
| taxRateSnapshot | numeric(5,2) | |
| inclusiveSnapshot | boolean | |
| taxAmount | numeric(10,2) | |

**kitchenTickets** - Kitchen Display Tickets
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| orderId | integer FK | |
| tableId | integer FK | |
| tableNameSnapshot | text | |
| status | text | NEW / IN_PROGRESS / READY / CLEARED |
| kdsDestination | text | "cocina" or "barra" |

**kitchenTicketItems** - Items in Kitchen Tickets
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| kitchenTicketId | integer FK | |
| orderItemId | integer FK | |
| productNameSnapshot | text | |
| qty | integer | |
| notes | text | |
| status | text | NEW / IN_PROGRESS / READY |

**reservations** - Table Reservations
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| reservationCode | varchar(20), unique | |
| guestName | varchar(200) | |
| guestPhone | varchar(50) | |
| guestEmail | varchar(200) | |
| partySize | integer | |
| reservedDate | date | |
| reservedTime | time | |
| durationMinutes | integer | Default 90 |
| tableId | integer FK | Primary table |
| tableIds | integer[] | Multiple tables |
| status | varchar(20) | PENDING / CONFIRMED / SEATED / COMPLETED / CANCELLED / NO_SHOW |
| notes | text | |

**businessConfig** - Business Settings (singleton)
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| businessName | text | |
| legalName | text | |
| taxId | text | |
| address | text | |
| phone | text | |
| email | text | |
| legalNote | text | |
| maxSubaccounts | integer | Max QR subaccounts per table |

**printers** - Configured Printers
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| name | text | |
| type | text | "caja" or "cocina" |
| ipAddress | text | |
| port | integer | Default 9100 |
| paperWidth | integer | 58 or 80 mm |
| enabled | boolean | |

**permissions** - Permission Definitions
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| key | text, unique | e.g. "POS_PAY" |
| description | text | |

**rolePermissions** - Role-Permission Assignments
| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| role | text | WAITER / CASHIER / KITCHEN / MANAGER |
| permissionKey | text | |

---

## 2. Waiter Features

- **View all tables**: List with status (free/occupied), color-coded, item count, time open, responsible waiter name, pending QR order alerts, reservation indicator
- **Open order**: Tapping a free table auto-creates an order (status: OPEN)
- **Take orders**: Select products by category, add notes, select modifiers, adjust quantity
- **Rounds**: Items grouped in rounds. Sending to kitchen creates a new round
- **Send to kitchen**: "Send round" button creates kitchen tickets with pending items
- **Modify order**: Add more items in subsequent rounds
- **Void items**: Soft-void (marks as voided, keeps record) for waiters. Hard-delete for managers only
- **Accept QR orders**: View pending customer QR orders, accept or reject them
- **View items by subaccount**: See what each person ordered (grouped by QR subaccount)
- **Move table**: Transfer an open account to another table
- **Move subaccount**: Move a subaccount (person) from one table to another
- **Guest count**: Record number of guests at the table
- **Reservations**: View, create, edit and manage reservations

---

## 3. POS (Cashier) Features

- **View open accounts**: Cards with table name, order number, pending balance, time, items
- **Charge**: Simple payment (one method) or multi-payment (multiple methods per account)
- **Split bills**: Create sub-accounts within an order and move items between them
- **Pay sub-account**: Charge an individual sub-account
- **Discounts**: Per item or per entire order
- **Void payments**: Reverse a completed payment
- **Void entire order**: Void the complete order
- **Reopen order**: Reopen a paid order
- **Cash session**: Open register (with initial amount), close register (with count)
- **Print receipt/pre-check**: Via Print Bridge (thermal printer) or browser fallback
- **Email ticket**: Send digital receipt to customer
- **View paid orders**: Today's closed orders history
- **Add items from POS**: Cashier can add additional products

---

## 4. Dashboard (Manager)

- **Daily summary**: Total sales, closed orders, average ticket
- **Payment method breakdown**: Cash, card, SINPE, etc.
- **Product category breakdown**
- **Detail of each day's order**

---

## 5. API Endpoints

**Backend:** Express.js with TypeScript, port 5000

**Base URL:** `https://sistema-restaurante.replit.app` (production)

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | None | Login with username/password |
| POST | `/api/auth/pin-login` | None | Login with 4-digit PIN |
| POST | `/api/auth/logout` | Session | Logout |
| GET | `/api/auth/me` | Session | Get current user + permissions |
| POST | `/api/auth/enroll-pin` | Session | Register/change PIN |
| GET | `/api/auth/my-permissions` | Session | Get role permissions |

**Login Request:**
```json
POST /api/auth/login
{ "username": "mesero1", "password": "password123" }
```

**Login Response:**
```json
{
  "user": {
    "id": 1,
    "username": "mesero1",
    "displayName": "Juan Mesero",
    "role": "WAITER",
    "active": true,
    "email": null,
    "hasPin": true
  },
  "permissions": [
    "MODULE_TABLES_VIEW",
    "MODULE_KDS_VIEW",
    "POS_PAY",
    "POS_SPLIT"
  ],
  "sessionToken": "s%3AaBcDeFgHiJkLmNoPqRsTuVwXyZ..."
}
```

**PIN Login Request:**
```json
POST /api/auth/pin-login
{ "pin": "1234" }
```

### Waiter Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/waiter/tables` | WAITER/MANAGER | List all tables with status |
| GET | `/api/waiter/tables/:id` | WAITER/MANAGER | Table detail |
| GET | `/api/tables/:id/current` | WAITER/MANAGER | Current order for a table |
| GET | `/api/waiter/tables/:id/order` | WAITER/MANAGER | Order items for a table |
| GET | `/api/waiter/menu` | WAITER/MANAGER | Full active menu |
| GET | `/api/waiter/categories` | WAITER/MANAGER | Menu categories |
| GET | `/api/products/:id/modifiers` | Any | Modifiers for a product |
| POST | `/api/waiter/tables/:id/send-round` | WAITER/MANAGER | Send round to kitchen |
| POST | `/api/waiter/qr-submissions/:id/accept` | WAITER/MANAGER | Accept QR order |
| POST | `/api/waiter/qr-submissions/:id/accept-v2` | WAITER/MANAGER | Accept QR with subaccounts |
| POST | `/api/waiter/qr-submissions/:id/reject` | WAITER/MANAGER | Reject QR order |
| DELETE | `/api/waiter/qr-submissions/:id` | WAITER/MANAGER | Delete QR order |
| GET | `/api/waiter/tables/:tableId/qr-pending` | WAITER/MANAGER | Pending QR orders for table |
| GET | `/api/waiter/orders/:orderId/by-subaccount` | WAITER/MANAGER | Items grouped by subaccount |
| POST | `/api/waiter/orders/:orderId/items/:itemId/void` | WAITER/MANAGER | Void item (soft-void) |
| DELETE | `/api/waiter/orders/:orderId/items/:itemId` | MANAGER | Delete item (hard-delete) |
| GET | `/api/waiter/orders/:orderId/voided-items` | WAITER/MANAGER | Voided items for order |
| POST | `/api/tables/move` | WAITER/MANAGER | Move account to another table |
| POST | `/api/tables/move-subaccount` | WAITER/MANAGER | Move subaccount to another table |
| PATCH | `/api/orders/:id/guest-count` | WAITER/MANAGER | Update guest count |

**Send Round Request:**
```json
POST /api/waiter/tables/5/send-round
{
  "items": [
    {
      "productId": 10,
      "qty": 2,
      "notes": "Sin cebolla",
      "modifiers": [
        { "modifierOptionId": 3, "qty": 1 }
      ]
    },
    {
      "productId": 15,
      "qty": 1,
      "notes": null,
      "modifiers": []
    }
  ]
}
```

**Move Table Request:**
```json
POST /api/tables/move
{ "sourceTableId": 5, "destTableId": 8 }
```

**Move Subaccount Request:**
```json
POST /api/tables/move-subaccount
{ "subaccountId": 12, "destTableId": 8 }
```

### POS Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/pos/tables` | POS_VIEW | Open accounts with items, totals, taxes |
| GET | `/api/pos/payment-methods` | POS_VIEW | Active payment methods |
| POST | `/api/pos/pay` | POS_PAY | Simple payment |
| POST | `/api/pos/pay-multi` | POS_PAY | Multi-method payment |
| GET | `/api/pos/cash-session` | POS_VIEW | Current cash session |
| POST | `/api/pos/cash-session/open` | POS_VIEW | Open cash session |
| POST | `/api/pos/cash-session/close` | CASH_CLOSE | Close cash session |
| GET | `/api/pos/orders/:orderId/payments` | POS_VIEW | Payments for an order |
| GET | `/api/pos/orders/:orderId/splits` | POS_VIEW | Split accounts |
| POST | `/api/pos/orders/:orderId/splits` | POS_SPLIT | Create split account |
| DELETE | `/api/pos/splits/:id` | POS_SPLIT | Delete split account |
| POST | `/api/pos/split-items/move` | POS_SPLIT | Move item between splits |
| POST | `/api/pos/split-items/move-bulk` | POS_SPLIT | Move items in bulk |
| POST | `/api/pos/split-order` | POS_SPLIT | Split order into sub-orders |
| POST | `/api/pos/pay-split` | POS_SPLIT | Pay a split account |
| POST | `/api/pos/print-receipt` | POS_PRINT | Print receipt |
| POST | `/api/pos/print-precuenta` | POS_PRINT | Print pre-check |
| POST | `/api/pos/open-drawer` | POS_PAY | Open cash drawer |
| POST | `/api/pos/send-ticket` | POS_EMAIL_TICKET | Send ticket by email |
| POST | `/api/pos/void-order/:orderId` | POS_VOID_ORDER | Void entire order |
| POST | `/api/pos/void-payment/:id` | PAYMENT_CORRECT | Void a payment |
| GET | `/api/pos/receipt-data/:orderId` | POS_PRINT | Receipt data |
| GET | `/api/pos/paid-orders` | MODULE_POS_VIEW | Paid orders for the day |
| POST | `/api/pos/reopen/:orderId` | PAYMENT_CORRECT | Reopen paid order |
| GET | `/api/pos/discounts` | POS_PAY | Available discounts |
| POST | `/api/pos/orders/:orderId/discount-all` | POS_PAY | Apply discount to order |
| POST | `/api/pos/order-items/:id/discount` | POS_PAY | Apply discount to item |
| DELETE | `/api/pos/order-items/:id/discount` | POS_PAY | Remove discount from item |
| POST | `/api/pos/orders/:orderId/add-items` | MODULE_POS_VIEW | Add items from POS |
| POST | `/api/pos/orders/:orderId/normalize-split` | POS_SPLIT | Normalize splits |
| POST | `/api/pos/orders/:orderId/splits-from-subaccounts` | CASHIER/MANAGER | Create splits from QR subaccounts |

**Simple Payment Request:**
```json
POST /api/pos/pay
{
  "orderId": 52,
  "paymentMethodId": 1,
  "amount": 15000,
  "clientName": "Juan",
  "clientEmail": "juan@example.com"
}
```

**Multi-Payment Request:**
```json
POST /api/pos/pay-multi
{
  "orderId": 52,
  "payments": [
    { "paymentMethodId": 1, "amount": 10000 },
    { "paymentMethodId": 2, "amount": 5000 }
  ],
  "clientName": "Juan"
}
```

**Open Cash Session Request:**
```json
POST /api/pos/cash-session/open
{ "openingCash": 50000 }
```

**Close Cash Session Request:**
```json
POST /api/pos/cash-session/close
{ "countedCash": 185000, "notes": "Todo cuadra" }
```

### KDS (Kitchen) Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/kds/tickets/:type` | KITCHEN/MANAGER | Kitchen tickets (type: cocina/barra) |
| PATCH | `/api/kds/items/:id` | KITCHEN/MANAGER | Update KDS item status |
| PATCH | `/api/kds/tickets/:id` | KITCHEN/MANAGER | Update KDS ticket status |
| POST | `/api/kds/clear-history` | KITCHEN/MANAGER | Clear KDS history |

### Dashboard Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/dashboard?date=2026-02-23` | MANAGER | Dashboard data for date |
| GET | `/api/dashboard/orders/:id` | MANAGER | Order detail |

### Reservation Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/reservations?date=2026-02-23` | WAITER/MANAGER | List reservations |
| GET | `/api/reservations/availability?date=2026-02-23` | WAITER/MANAGER | Availability for date |
| GET | `/api/reservations/:id` | WAITER/MANAGER | Reservation detail |
| POST | `/api/reservations` | WAITER/MANAGER | Create reservation |
| PATCH | `/api/reservations/:id` | WAITER/MANAGER | Edit reservation |
| PATCH | `/api/reservations/:id/status` | WAITER/MANAGER | Change status |
| GET | `/api/reservations/duration-config` | WAITER/MANAGER | Duration config |
| GET | `/api/reservations/settings` | WAITER/MANAGER | General settings |

**Create Reservation Request:**
```json
POST /api/reservations
{
  "guestName": "María López",
  "guestPhone": "8888-1234",
  "guestEmail": "maria@example.com",
  "partySize": 4,
  "reservedDate": "2026-02-25",
  "reservedTime": "19:00",
  "tableIds": [5, 6],
  "notes": "Cumpleaños",
  "status": "CONFIRMED"
}
```

### Other Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/business-config` | Session | Business configuration |

---

## 6. Authentication Details

### Dual-Mode Authentication

The system supports two authentication modes to handle different contexts:

1. **Cookie-based (primary)**: Standard Express session with `connect.sid` cookie stored in PostgreSQL
2. **Token-based (fallback)**: For contexts where cookies are blocked (e.g., iframe/embedded). Login returns a `sessionToken` which must be sent as `X-Session-Token` header

### How to Authenticate from Mobile App

**Recommended approach:** Use the token-based method.

1. Call `POST /api/auth/login` or `POST /api/auth/pin-login`
2. Store the returned `sessionToken` securely (e.g., Keychain/KeyStore)
3. Send `X-Session-Token: <token>` header with every subsequent API request
4. Also send the `Cookie` header if the server returns `Set-Cookie`

**Session check:**
```
GET /api/auth/me
Headers: { "X-Session-Token": "s%3AaBcDeFgH..." }
```

### Roles and Permissions (RBAC)

**Roles:** WAITER, CASHIER, KITCHEN, MANAGER

**Key Permissions:**
- `MODULE_TABLES_VIEW` - Access waiter/tables module
- `MODULE_POS_VIEW` - Access POS module
- `MODULE_KDS_VIEW` - Access KDS module
- `MODULE_ADMIN_VIEW` - Access admin/manager panel
- `POS_PAY` - Process payments
- `POS_SPLIT` - Split bills
- `POS_PRINT` - Print receipts
- `POS_VOID_ORDER` - Void entire orders
- `POS_EMAIL_TICKET` - Send email tickets
- `PAYMENT_CORRECT` - Void payments / reopen orders
- `CASH_CLOSE` - Close cash sessions

**Rate Limiting:** Login endpoints have rate limiting (5 attempts per 15 minutes per IP).

---

## 7. Business Logic & Workflows

### Waiter Order Flow
1. Waiter sees list of tables → taps a free table
2. Order auto-created (status: `OPEN`)
3. Selects products from menu (by category)
4. Adds modifiers and notes as needed
5. Items are in status `PENDING`
6. Taps "Send round" → items become `SENT`, kitchen tickets created, order → `IN_KITCHEN`
7. Can add more items in subsequent rounds
8. When kitchen marks everything ready → order → `READY`
9. Cashier processes payment → order → `PAID`

### Order States
```
OPEN → IN_KITCHEN → READY → PAID
                           ↘ VOIDED
                           ↘ CANCELLED
```

### Order Item States
```
PENDING → SENT → (VOIDED if cancelled)
```

### Table Assignment
- Automatic: the waiter who opens the order becomes responsible
- Can be transferred (move account to another table)
- Individual subaccounts can be moved between tables

### Business Date & Timezone
- All business dates use `America/Costa_Rica` (UTC-6)
- Format: `YYYY-MM-DD`
- Calculated server-side with `getBusinessDate()` function

### Currency
- Costa Rican Colones (₡ / CRC)
- All amounts in numeric(10,2)

---

## 8. WebSocket (Real-Time Updates)

**Protocol:** `ws://` or `wss://`
**Endpoint:** Same server, root path

### Connection
```javascript
const ws = new WebSocket("wss://sistema-restaurante.replit.app");
ws.onmessage = (event) => {
  const { type, payload } = JSON.parse(event.data);
  // Handle event
};
```

### Events Broadcast
| Event | Payload | Description |
|-------|---------|-------------|
| `order_updated` | `{ orderId, tableId }` | Order modified |
| `table_status_changed` | `{ tableId }` | Table status changed |
| `kitchen_ticket_created` | `{ ticketIds, tableId, tableName }` | New kitchen ticket |
| `kds_refresh` | `{}` | Refresh KDS display |
| `qr_submission_created` | `{ tableId, submissionId }` | New QR order submitted |
| `qr_submission_accepted` | `{ tableId, submissionId }` | QR order accepted |
| `hr_punch_update` | `{ employeeId, type }` | Clock in/out event |

### Message Format
```json
{
  "type": "order_updated",
  "payload": { "orderId": 52, "tableId": 12 }
}
```

---

## 9. Printer Integration (Print Bridge)

The system uses Print Bridge as an intermediary service for thermal printer communication.

- **Protocol:** HTTP POST to Print Bridge server
- **Authentication:** Bearer token (`PRINT_BRIDGE_TOKEN`)
- **Printer types:** "caja" (receipt) and "cocina" (kitchen)
- **Paper widths:** 58mm and 80mm supported
- **Print commands:** ESC/POS format sent via Print Bridge API

For the mobile app, you can either:
1. Send print commands to the backend API (which forwards to Print Bridge)
2. Implement direct Bluetooth/WiFi thermal printer support natively

---

## 10. Design Preferences

- **Primary colors:** Reddish/terracotta tones ("Linen" style), with dark mode support
- **Display font:** System variable `--f-disp`
- **Layout:** Mobile-first design, everything optimized for phone screens
- **UI Language:** Spanish (Costa Rica)
- **Currency format:** ₡1,000 or ¢1,000 (colones)
- **Date format:** DD/MM/YYYY for display, YYYY-MM-DD for API
- **Time format:** HH:MM (24-hour)

---

## 11. Integration Requirements

- **Real-time:** WebSocket for live order/table updates
- **Offline support:** Not currently implemented in web version. Mobile app could add offline queue with sync
- **Push notifications:** Not currently implemented. Could be added for:
  - New QR orders pending acceptance
  - Kitchen ticket status changes
  - Reservation reminders
- **Third-party integrations:**
  - Print Bridge (thermal printers)
  - QuickBooks Online (accounting sync)
  - SMTP email (receipts/notifications)

---

## 12. QR Client Ordering (for reference)

The system has a public QR ordering flow. Each table has a QR code linking to:
```
/qr/{tableCode}
```

### QR Subaccount Endpoints (public, token-authenticated via HMAC)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/qr/:tableCode/token` | Get HMAC auth token |
| GET | `/api/qr/:tableCode/info` | Table info |
| GET | `/api/qr/:tableCode/menu` | Menu for QR |
| GET | `/api/qr/:tableCode/subaccounts` | List subaccounts |
| POST | `/api/qr/:tableCode/subaccounts` | Create subaccount |
| POST | `/api/qr/:tableCode/subaccounts-batch` | Batch create subaccounts |
| POST | `/api/qr/:tableCode/submit-v2` | Submit order |
| GET | `/api/qr/:tableCode/my-items` | Get items for subaccount |
| PATCH | `/api/qr/:tableCode/guest-count` | Update guest count |

---

## 13. Sample API Response Formats

### GET /api/waiter/tables (abbreviated)
```json
[
  {
    "id": 1,
    "tableCode": "mesa-1",
    "tableName": "Mesa 1",
    "active": true,
    "hasOpenOrder": true,
    "orderId": 52,
    "orderStatus": "IN_KITCHEN",
    "dailyNumber": 7,
    "responsibleWaiterName": "Juan",
    "openedAt": "2026-02-23T04:33:32.436Z",
    "pendingQrCount": 0,
    "itemCount": 5,
    "totalAmount": "25000.00",
    "lastSentToKitchenAt": "2026-02-23T04:35:00.000Z",
    "upcomingReservation": null,
    "hasActiveReservation": false
  }
]
```

### GET /api/pos/tables (abbreviated)
```json
[
  {
    "id": 1,
    "tableName": "Mesa 1 #7",
    "orderId": 52,
    "parentOrderId": null,
    "splitIndex": null,
    "dailyNumber": 7,
    "globalNumber": 44,
    "ticketNumber": "7",
    "totalAmount": "33000.00",
    "balanceDue": "25000.00",
    "paidAmount": "8000.00",
    "openedAt": "2026-02-23T04:33:32.436Z",
    "itemCount": 5,
    "items": [
      {
        "id": 100,
        "productNameSnapshot": "Casado con Pollo",
        "productPriceSnapshot": "6000.00",
        "qty": 2,
        "notes": "Sin ensalada",
        "status": "SENT",
        "origin": "WAITER",
        "roundNumber": 1,
        "modifiers": [
          {
            "nameSnapshot": "Extra arroz",
            "priceDeltaSnapshot": "500.00",
            "qty": 1
          }
        ]
      }
    ],
    "totalDiscounts": "0.00",
    "totalTaxes": "3900.00",
    "taxBreakdown": [
      {
        "taxName": "IVA 13%",
        "taxRate": "13.00",
        "inclusive": true,
        "totalAmount": "3900.00"
      }
    ],
    "subaccountNames": ["Juan", "María"]
  }
]
```

### GET /api/dashboard?date=2026-02-23 (abbreviated)
```json
{
  "date": "2026-02-23",
  "totalSales": 150000,
  "orderCount": 12,
  "averageTicket": 12500,
  "byPaymentMethod": [
    { "method": "Efectivo", "total": 80000, "count": 7 },
    { "method": "Tarjeta", "total": 50000, "count": 4 },
    { "method": "SINPE", "total": 20000, "count": 1 }
  ],
  "byCategory": [
    { "category": "Platos Fuertes", "total": 90000, "count": 15 },
    { "category": "Bebidas", "total": 40000, "count": 20 }
  ],
  "orders": [
    {
      "id": 45,
      "tableName": "Mesa 3",
      "dailyNumber": 1,
      "totalAmount": "15000.00",
      "status": "PAID",
      "closedAt": "2026-02-23T14:30:00.000Z"
    }
  ]
}
```
