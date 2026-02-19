# Documentación Interna — Módulos Frontend
## Sistema Restaurante PWA

> Referencia completa de lógica interna, estado, flujos de datos, endpoints API, eventos WebSocket y patrones compartidos.
> Objetivo: servir como base para planificación de rediseño UI/UX.

---

## TABLA DE CONTENIDOS

1. [Arquitectura General](#1-arquitectura-general)
2. [Autenticación](#2-autenticación)
3. [Infraestructura Compartida](#3-infraestructura-compartida)
4. [Mesas (Waiter)](#4-mesas-waiter)
5. [Detalle de Mesa](#5-detalle-de-mesa)
6. [KDS (Kitchen Display System)](#6-kds-kitchen-display-system)
7. [POS (Punto de Venta)](#7-pos-punto-de-venta)
8. [Dashboard Gerencial](#8-dashboard-gerencial)
9. [Sales Cube (Cubo de Ventas)](#9-sales-cube)
10. [Cliente QR](#10-cliente-qr)
11. [Admin Panel](#11-admin-panel)
12. [Inventario](#12-inventario)
13. [Faltantes (Shortages)](#13-faltantes-shortages)
14. [Recursos Humanos (HR)](#14-recursos-humanos-hr)
15. [Patrones Compartidos](#15-patrones-compartidos)
16. [Mapa de Rutas y Permisos](#16-mapa-de-rutas-y-permisos)

---

## 1. ARQUITECTURA GENERAL

### Stack
- **Frontend:** React + Vite, Tailwind CSS, shadcn/ui, wouter (routing)
- **Backend:** Express.js + TypeScript, Drizzle ORM, PostgreSQL
- **Real-time:** WebSocket (ws library)
- **Auth:** Session-based (express-session + memorystore), PIN login

### App Shell (App.tsx — 302 líneas)
- **Providers (outer→inner):** QueryClientProvider → TooltipProvider → AuthProvider → AppRouter
- **Route split:** `/qr/:tableCode` renders QRClientPage sin autenticación; todo lo demás va a `AppContent`
- **Login flow:** PinLoginPage (default) ↔ LoginPage (password fallback), toggle via button
- **Authenticated layout:** SidebarProvider + AppSidebar + header (SidebarTrigger, RefreshCw, ThemeToggle, user name, logout)
- **Route protection:** `canAccessRouteByPermissions()` checks MODULE_* permissions against path patterns; redirects to best default route
- **Global hooks:** useWakeLock (screen awake), usePreventPullRefresh (touch), useShortageAlerts (WebSocket alerts)

### File Structure
```
client/src/
├── App.tsx                    — App shell, routing, auth flow
├── lib/
│   ├── auth.tsx               — AuthProvider, useAuth hook
│   ├── ws.ts                  — wsManager singleton
│   ├── queryClient.ts         — TanStack Query client + apiRequest
│   ├── print-receipt.ts       — Receipt HTML generation
│   └── utils.ts               — cn() classname utility
├── hooks/
│   ├── use-permissions.ts     — RBAC hook
│   ├── use-shortage-alerts.ts — Real-time shortage notifications
│   ├── use-prevent-pull-refresh.ts — Mobile pull-to-refresh prevention
│   ├── use-mobile.tsx         — Mobile breakpoint detection
│   └── use-toast.ts           — Toast notification hook
├── components/
│   ├── app-sidebar.tsx        — Navigation sidebar
│   ├── theme-toggle.tsx       — Dark/light mode toggle
│   ├── pos/
│   │   ├── PayDialog.tsx      — Payment dialog (custom CSS)
│   │   ├── SplitDialog.tsx    — Split dialog (custom CSS)
│   │   └── pos-dialogs.css    — Custom dark theme CSS
│   └── ui/                    — shadcn components
├── pages/
│   ├── pin-login.tsx          — PIN login (174 lines)
│   ├── login.tsx              — Password login (81 lines)
│   ├── enroll-pin.tsx         — PIN enrollment (174 lines)
│   ├── tables.tsx             — Table overview (310 lines)
│   ├── table-detail.tsx       — Table detail/ordering (1,657 lines)
│   ├── kds.tsx                — Kitchen display (456 lines)
│   ├── kds-bar.tsx            — Bar display (6 lines, reuses KDSDisplay)
│   ├── pos.tsx                — Point of sale (2,123 lines)
│   ├── dashboard.tsx          — Manager dashboard (1,126 lines)
│   ├── sales-cube.tsx         — Sales analytics (908 lines)
│   ├── qr-client.tsx          — QR customer ordering (1,436 lines)
│   ├── admin/                 — 12 admin CRUD pages (~3,280 lines)
│   ├── inventory/             — 7 inventory pages (~3,404 lines)
│   ├── shortages/             — 3 shortage pages (~1,348 lines)
│   └── hr/                    — 5 HR pages (~1,923 lines)
```

**Total frontend:** ~37 pages, ~18,500+ lines

---

## 2. AUTENTICACIÓN

### Files
- `client/src/lib/auth.tsx` — AuthProvider context + useAuth hook
- `client/src/pages/pin-login.tsx` — PIN pad UI
- `client/src/pages/login.tsx` — Password form fallback
- `client/src/pages/enroll-pin.tsx` — First-time PIN setup

### AuthProvider Context
```typescript
interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  email: string | null;
  hasPin: boolean;
  createdAt: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  pinLogin: (pin: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  setUser: (u: AuthUser | null) => void;
}
```
- Session check on mount: `GET /api/auth/me` — returns user if session cookie valid
- Session persistence: HTTP-only cookies managed by express-session
- Logout: `POST /api/auth/logout` + clear user state + redirect to `/`
- 5-second timeout fallback: if session check hangs, sets loading=false

### PIN Login (pin-login.tsx)
- **4-digit PIN pad** with numeric buttons 0-9
- Digits shown as filled/empty circles (visual feedback)
- Auto-submit on 4th digit entry
- Backspace to delete last digit
- Clock-in/out integration: after successful login, can clock in/out via `/api/hr/clock-in` and `/api/hr/clock-out`
- "Usar contraseña" link switches to password form
- **API:** `POST /api/auth/pin-login` `{ pin: "1234" }` → returns `{ user: AuthUser }`

### Password Login (login.tsx)
- Simple username + password form
- **API:** `POST /api/auth/login` `{ username, password }`

### PIN Enrollment (enroll-pin.tsx)
- Enter + confirm 4-digit PIN flow
- **API:** `POST /api/auth/enroll-pin` `{ pin: "1234" }`

### Roles
`MANAGER | FARM_MANAGER | CASHIER | WAITER | KITCHEN | STAFF`

---

## 3. INFRAESTRUCTURA COMPARTIDA

### 3.1 WebSocket Manager (ws.ts)
**Singleton:** `wsManager` — auto-connects, auto-reconnects

```typescript
class WSManager {
  connect(): void              // Connect to ws:// or wss://
  on(event, callback): unsubFn // Register event listener
  off(event, callback): void   // Remove listener
}
```

**Connection behavior:**
- URL: `ws(s)://${host}/ws`
- Auto-reconnect on close (1s delay)
- Heartbeat: ping every 10s, expect pong within 2 missed intervals (20s timeout)
- Multiple components call `wsManager.connect()` — idempotent (single connection)

**WebSocket Events Used:**
| Event | Consumers | Purpose |
|-------|-----------|---------|
| `order_updated` | Tables, TableDetail, KDS, POS | Order state change |
| `table_status_changed` | Tables, TableDetail, POS | Table open/close |
| `qr_submission_created` | Tables, TableDetail, POS | New QR order |
| `qr_submission` | TableDetail | QR order (legacy event) |
| `kitchen_ticket_created` | KDS | New KDS ticket |
| `kitchen_item_status_changed` | Tables, TableDetail, KDS, POS | Item prep status |
| `payment_completed` | Tables, TableDetail, POS | Payment done |
| `payment_voided` | Tables, TableDetail, POS | Payment reversed |
| `shortage_created` | ShortageAlerts hook | New shortage alert |
| `shortage_updated` | ShortageAlerts hook | Shortage status change |
| `product_availability_changed` | ShortageAlerts hook | Product availability toggled |

### 3.2 Permissions Hook (use-permissions.ts)
```typescript
function usePermissions(): {
  permissions: string[];        // Array of permission keys
  hasPermission: (key: string) => boolean;
  isLoading: boolean;
}
```
- **API:** `GET /api/auth/my-permissions`
- **Cache:** 60s staleTime, only fetches when user authenticated
- Used for: route guarding, POS action gating, module visibility

**Permission Keys:**
- Module access: `MODULE_TABLES_VIEW`, `MODULE_POS_VIEW`, `MODULE_KDS_VIEW`, `MODULE_DASHBOARD_VIEW`, `MODULE_ADMIN_VIEW`, `MODULE_HR_VIEW`, `MODULE_INV_VIEW`, `MODULE_PRODUCTS_VIEW`, `SHORTAGES_VIEW`
- POS operations: `POS_PAY`, `POS_SPLIT`, `POS_PRINT`, `POS_EMAIL_TICKET`, `POS_EDIT_CUSTOMER_PREPAY`, `POS_EDIT_CUSTOMER_POSTPAY`, `POS_VOID`, `POS_VOID_ORDER`, `POS_REOPEN`, `POS_VIEW_CASH_REPORT`
- Cash: `CASH_CLOSE`

### 3.3 Shortage Alerts (use-shortage-alerts.ts)
- Global hook activated in AuthenticatedLayout
- WebSocket listeners:
  - `shortage_created` → invalidate `/api/shortages`, `/api/shortages/active`, `/api/shortages/active-count` + play beep + destructive toast
  - `shortage_updated` → invalidate `/api/shortages`, `/api/shortages/active`, `/api/shortages/active-count`
  - `product_availability_changed` → invalidate `/api/shortages/products`
- Audio alert: 880Hz triangle wave, 0.15 gain, 0.5s duration
- Toast distinguishes INV_ITEM vs product entity type

### 3.4 Print Receipt (print-receipt.ts)
```typescript
function printReceipt(data: ReceiptData): void
```
- Opens new browser popup window (320x600)
- Generates full HTML document styled for 80mm thermal printer
- Sections: business header, order number/table, items table, subtotal + tax breakdown + discounts + total, payment method, legal note
- Print button + close button in popup (hidden on print via `@media print`)
- Auto-triggers `window.print()` after load

### 3.5 Prevent Pull-to-Refresh (use-prevent-pull-refresh.ts)
- Prevents mobile browser pull-to-refresh gesture
- Monitors touchstart/touchmove, calls `preventDefault()` when scrolled to top and swiping down
- Global effect at App level

### 3.6 Wake Lock (in App.tsx)
- Requests `navigator.wakeLock.request("screen")` to keep screen on
- Re-requests on visibility change (tab switch back)

### 3.7 Query Client Patterns
- Default fetcher configured: just pass `queryKey: ["/api/endpoint"]`
- `apiRequest(method, url, body?)` — returns Response, throws on non-OK
- All mutations use `queryClient.invalidateQueries()` for cache refresh
- Polling: most lists use `refetchInterval: 5000` (5s)

---

## 4. MESAS (Waiter)

### File: `pages/tables.tsx` (310 lines)
### Route: `/tables`

### Data Model
```typescript
interface TableView {
  id: number;
  tableCode: string;
  tableName: string;
  active: boolean;
  hasOpenOrder: boolean;
  orderId: number | null;
  orderStatus: string | null;        // OPEN, IN_KITCHEN, PREPARING, READY
  responsibleWaiterName: string | null;
  openedAt: string | null;
  pendingQrCount: number;
  itemCount: number;
  totalAmount: string | null;
  lastSentToKitchenAt: string | null;
}
```

### API
- `GET /api/waiter/tables` — polling every 5s

### WebSocket Events
- `table_status_changed` → invalidate tables
- `qr_submission_created` → invalidate + toast + audio beep (880Hz sine, 0.3 gain, 0.5s)
- `order_updated`, `payment_completed`, `payment_voided`, `kitchen_item_status_changed` → invalidate

### UI Layout
- **Split view:** "Con cuenta abierta" (occupied) | "Libres" (free)
- **Grid:** 2 columns on mobile, responsive
- **Configurable columns toggle:** waiter, items, amount, time — persisted in localStorage (`tables_visible_columns`)
- **Status indicators:** Color-coded ring borders:
  - Orange ring → pending QR orders
  - Emerald ring → READY
  - Yellow ring → PREPARING
  - Blue ring → IN_KITCHEN
  - Green ring → open order
- **Badge variants:** destructive (QR pending), default (open), secondary (free)
- **Info shown per card:** table name, status badge, waiter name, item count, open time, kitchen time, total amount (all toggleable)
- Cards are links → navigate to `/tables/:id`

### State
- `visibleColumns: Set<ColumnKey>` — persisted in localStorage
- No other local state needed (all from query)

---

## 5. DETALLE DE MESA

### File: `pages/table-detail.tsx` (1,657 lines)
### Route: `/tables/:id`

### Core State
```typescript
type ViewMode = "order" | "menu" | "split";
```
- **order:** View current order items, QR submissions, voided items
- **menu:** Browse products, add to cart
- **split:** Manage split accounts (for POS integration)

### Cart System
```typescript
interface CartItem {
  productId: number;
  name: string;
  price: string;
  qty: number;
  notes: string;
  modifiers: CartModifier[];
  cartKey: string;    // `${productId}:${sortedModifierIds}`
}
```
- **Persistence:** localStorage per table (`cart_table_${tableId}`)
- **Cart key:** Composite of productId + sorted modifier option IDs — allows same product with different modifiers as separate cart items
- **Operations:** add (with fly animation), remove, update qty, set notes

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/tables/:id/current` | Table + order + items + QR submissions + voided items |
| GET | `/api/waiter/menu` | Active products list |
| GET | `/api/waiter/categories` | Categories list |
| GET | `/api/business-config` | Business configuration |
| GET | `/api/products/:id/modifiers` | Modifier groups for product |
| GET | `/api/waiter/orders/:id/by-subaccount` | Items grouped by subaccount |
| POST | `/api/waiter/tables/:id/send-round` | Send cart items to kitchen |
| POST | `/api/waiter/qr-submissions/:id/accept-v2` | Accept single QR submission |
| POST | `/api/waiter/orders/:id/items/:itemId/void` | Soft-void an item |
| DELETE | `/api/waiter/orders/:id/items/:itemId` | Hard-delete (manager only) |

### Order Display
- Items grouped by **round number** (`roundNumber` field)
- Each round shown as collapsible section
- Items show: qty, name, price, modifiers, notes, status badge, customer name
- Subaccount filter: "Todos" or individual subaccount names
- Expandable subaccount sections when filtering

### Menu Browsing
- **2-level category system:**
  - TOP categories (prefixed `TOP-`) shown as segmented control buttons (colored)
  - Subcategories shown below as smaller pills/buttons
  - Products filtered by selected subcategory
  - Falls back to flat category list when no TOPs configured
- **Search:** Debounced (250ms), searches name, code, description
- **Search sheet:** Full-screen search on mobile
- **Product display:** Grid, showing name, price, add button
- **Out-of-stock:** Disabled with "Agotado" label when `availablePortions === 0`

### Modifier Dialog
- Fetches `/api/products/:id/modifiers` on product tap
- If product has modifier groups → shows dialog
- Groups can be: required/optional, single/multi-select, min/max selections
- Validation before confirming: required groups, min/max constraints

### Void System
- **Soft void (waiters):** Opens void dialog → enter reason + qty to void → `POST /api/waiter/orders/:id/items/:itemId/void`
- **Hard delete (managers):** Direct `DELETE /api/waiter/orders/:id/items/:itemId` — removes item entirely
- Manager check: `user?.role === "MANAGER"`
- Voided items shown in collapsible section with reason and who voided

### QR Submissions
- Pending submissions shown at top of order view with alert styling
- Expandable to see submission items
- Accept individual: `POST /api/waiter/qr-submissions/:id/accept-v2`
- Accept all: loops through all pending submission IDs

### Animations
- **Fly-to-cart:** Ghost circle animates from product card to cart badge (300ms ease-in)
- **Badge pop:** Scale animation on cart badge when item added (350ms)
- Respects `prefers-reduced-motion`

### Round System
- Cart items sent as a "round" (ronda) to kitchen
- `POST /api/waiter/tables/:id/send-round { items: CartItem[] }`
- On success: clears cart, switches to order view, invalidates queries
- "Ronda sheet" shows cart summary before sending

### WebSocket Events
- `order_updated`, `qr_submission_created`, `kitchen_item_status_changed`, `payment_completed`, `payment_voided`, `table_status_changed`, `qr_submission` → all invalidate table current view

---

## 6. KDS (Kitchen Display System)

### Files: `pages/kds.tsx` (456 lines), `pages/kds-bar.tsx` (6 lines)
### Routes: `/kds` (cocina), `/kds-bar` (bar)

### Architecture
- **Reusable component:** `KDSDisplay({ destination, title, icon })` — shared between kitchen and bar
- `KDSPage` → `<KDSDisplay destination="cocina" />`
- `KDSBarPage` → `<KDSDisplay destination="bar" />`

### Data Model
```typescript
interface KDSTicket {
  id: number;
  orderId: number;
  tableNameSnapshot: string;
  status: string;
  createdAt: string;
  items: KDSTicketItem[];
}

interface KDSTicketItem {
  id: number;
  productNameSnapshot: string;
  qty: number;
  notes: string | null;
  status: string;           // NEW, PREPARING, READY
  customerNameSnapshot?: string | null;
  modifiers?: { nameSnapshot: string; priceDeltaSnapshot: string; qty: number }[];
}

interface GroupedTicket {      // Tickets merged by orderId
  orderId: number;
  tableNameSnapshot: string;
  earliestCreatedAt: string;
  ticketIds: number[];
  items: KDSTicketItem[];
  allReady: boolean;
}
```

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/kds/tickets/active?destination=cocina` | Active tickets |
| GET | `/api/kds/tickets/history?destination=cocina` | Completed tickets |
| PATCH | `/api/kds/items/:itemId` | Update item status |
| PATCH | `/api/kds/tickets/:id` | Mark ticket complete |
| POST | `/api/kds/clear-history?destination=cocina` | Clear history view |

### Ticket Grouping
- Multiple tickets from same order merged into single `GroupedTicket`
- All items combined, earliest createdAt used for timing
- `allReady` flag: true when every item status === "READY"

### Stable Card Ordering
- `groupOrderRef` (useRef) maintains card order
- Existing orders keep their position
- New orders append to end
- Prevents card shuffling on data refresh

### Item Status Flow
```
NEW → PREPARING → READY
```
- **Tap item** → advances to next status
- **Optimistic update:** Item status changes instantly in UI, rolls back on error
- Color coding: NEW=yellow, PREPARING=blue, READY=green

### Complete Ticket
- When `allReady === true`, "Ticket Completo" button appears (green)
- Marks all ticket IDs as READY via `PATCH /api/kds/tickets/:id`
- Optimistic: removes card from active view immediately

### New Order Alert
- **Full-screen modal overlay** appears when new tickets detected
- Shows count of new orders
- Multi-tone audio alert: square waves (1200Hz, 1500Hz) + sawtooth (1800Hz), pattern repeats 2x
- Dismiss button clears alert
- New ticket detection: compares current ticket IDs vs known IDs ref

### Real-time Updates
- Polling: every 5s (refetchInterval)
- WebSocket: `kitchen_ticket_created`, `kitchen_item_status_changed`, `order_updated` → invalidate queries

### Elapsed Timer
- 1-second interval updating elapsed time display for each card
- Format: `<1min` → "Xs", `1-59min` → "Xm", `60min+` → "Xh Ym"

### History Tab
- Lazy loaded (only fetches when tab="history")
- Cards at 75% opacity
- "Vaciar Vista" button to clear history

---

## 7. POS (Punto de Venta)

### File: `pages/pos.tsx` (2,123 lines)
### Route: `/pos`
### Additional files: `components/pos/PayDialog.tsx`, `components/pos/SplitDialog.tsx`, `components/pos/pos-dialogs.css`

### Permission Gates
```typescript
canPay = hasPermission("POS_PAY")
canSplit = hasPermission("POS_SPLIT")
canPrint = hasPermission("POS_PRINT")
canEmailTicket = hasPermission("POS_EMAIL_TICKET")
canEditCustomerPrepay = hasPermission("POS_EDIT_CUSTOMER_PREPAY")
canVoid = hasPermission("POS_VOID")
canReopen = hasPermission("POS_REOPEN")
canVoidOrder = hasPermission("POS_VOID_ORDER")
canCashClose = hasPermission("CASH_CLOSE")
canViewCashReport = hasPermission("POS_VIEW_CASH_REPORT")
```

### Data Model
```typescript
interface POSTable {
  id: number;
  tableName: string;
  orderId: number;
  parentOrderId?: number | null;
  splitIndex?: number | null;
  dailyNumber?: number | null;
  globalNumber?: number | null;
  ticketNumber?: string;
  totalAmount: string;
  itemCount: number;
  items: POSItem[];
  totalDiscounts?: string;
  totalTaxes?: string;
  taxBreakdown?: TaxBreakdownEntry[];
}

interface POSItem {
  id: number;
  productNameSnapshot: string;
  qty: number;
  productPriceSnapshot: string;
  status: string;
  notes?: string | null;
  customerNameSnapshot?: string | null;
  subaccountId?: number | null;
  modifiers?: POSItemModifier[];
  discounts?: POSItemDiscount[];
  taxes?: POSItemTax[];
}
```

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/pos/tables` | All tables with open orders |
| GET | `/api/pos/payment-methods` | Available payment methods |
| GET | `/api/pos/cash-session` | Current cash session state |
| GET | `/api/pos/paid-orders` | Today's paid orders |
| GET | `/api/pos/orders/:id/splits` | Split accounts for order |
| GET | `/api/pos/orders/:id/payments` | Payments for order |
| POST | `/api/pos/pay` | Process full payment |
| POST | `/api/pos/pay-split` | Pay a split account |
| POST | `/api/pos/split-order` | Create split account |
| POST | `/api/pos/split-items/move` | Move items between splits |
| POST | `/api/pos/send-ticket` | Email receipt |
| POST | `/api/pos/cash-session/open` | Open cash session |
| POST | `/api/pos/cash-session/close` | Close cash session |
| POST | `/api/pos/void-payment/:id` | Void a payment |
| POST | `/api/pos/reopen-order/:id` | Reopen a paid order |
| POST | `/api/pos/void-order` | Void entire order |
| POST | `/api/pos/items/:id/discount` | Apply item discount |
| DELETE | `/api/pos/items/:id/discount` | Remove item discount |

### Tabs
1. **Mesas (tables):** Grid of open orders, click to select → detail view
2. **Caja (cash):** Cash session management (open/close), cash report
3. **Pagados (paid):** List of today's paid orders with post-payment actions

### Payment Flow (PayDialog)
- **3-panel layout:** Order Summary | Method & Client | Cash Denominations
- Payment methods: CASH (green), CARD (blue), SINPE (amber)
- Cash panel: denomination buttons (500, 1000, 2000, 5000, 10000, 20000), custom input
- Real-time change calculation
- On success: triggers receipt print + auto-print + drawer open

### Split Flow (SplitDialog)
- **3-panel layout:** Items | Active Subcuenta | Summary
- Create new split accounts with label
- Move items between main order and split accounts
- Visual states: dashed border + opacity for moved items
- Animations: vibrate (0.4s) + flash-success (green glow, 0.7s)

### Cash Session
- Open: set opening cash amount
- Close: enter counted cash, notes → produces report
- Report shows: expected vs counted, difference, payment method totals

### Order Detail View
- Shows all items with modifiers, discounts, taxes
- Split accounts display
- Payment history
- Actions: pay, split, print, email, void payment, reopen, void order

### Item Discounts
- Per-item discount dialog
- Types: percentage or fixed amount
- Applied at item level with audit trail

### Post-Payment Actions (Paid tab)
- View paid order details
- Reprint receipt
- Email receipt
- Void payment (with reason)

### WebSocket Events
- `order_updated`, `table_status_changed`, `payment_completed`, `payment_voided`, `kitchen_item_status_changed`, `qr_submission_created` → invalidate relevant queries

### Price Calculations
```typescript
getItemUnitPrice(item) = base price + sum(modifier priceDelta * qty)
getItemTotal(item) = unitPrice * qty
getSplitTotal(split) = sum of items in split's unit prices
```

---

## 8. DASHBOARD GERENCIAL

### File: `pages/dashboard.tsx` (1,126 lines)
### Route: `/dashboard`

### Data Model
```typescript
interface DashboardData {
  openOrders: { count: number; amount: number; orders: OrderSummary[] };
  paidOrders: { count: number; amount: number; orders: OrderSummary[] };
  cancelledOrders: { count: number; amount: number; orders: OrderSummary[] };
  totalDiscounts: number;
  totalTaxes: number;
  taxBreakdown: TaxBreakdownItem[];
  voidedItemsSummary: { count: number; amount: number; items: VoidedItemSummary[] };
  topProducts: { name: string; qty: number; amount: number }[];
  topCategories: { name: string; qty: number; amount: number }[];
  ledgerDetails: LedgerDetail[];
  paymentMethodTotals: Record<string, number>;
}
```

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/dashboard?date=YYYY-MM-DD` | Full dashboard data for date |
| GET | `/api/dashboard/orders/:id` | Order detail drill-down |

### Date Picker
- Preset buttons: "Hoy" (today), "Ayer" (yesterday)
- Custom date input
- Query re-fetches on date change

### Sections
1. **Summary cards:** Open orders (count + amount), Paid orders, Cancelled orders
2. **Payment method totals:** Card breakdown by method
3. **Tax breakdown:** Per tax category with rates and inclusive/exclusive flag
4. **Total discounts:** Sum
5. **Top products:** Table with name, qty, amount — sortable
6. **Top categories:** Table with name, qty, amount
7. **Voided items:** Count + amount, expandable list with reason, voider name, timestamp
8. **Order lists:** Collapsible sections for open, paid, cancelled — each row clickable → order detail dialog
9. **Ledger details:** Full item-level breakdown

### Order Detail Dialog
- Shows: order number (daily + global), status, table, timestamps
- Items table: product, qty, unit price, subtotal, status
- Payments table: method, amount, time, status
- Total amount

### Status Labels (Spanish)
```
OPEN → "Abierta", IN_KITCHEN → "En Cocina", READY → "Lista",
PAID → "Pagada", CANCELLED → "Cancelada", VOID → "Anulada"
```

---

## 9. SALES CUBE (Cubo de Ventas)

### File: `pages/sales-cube.tsx` (908 lines)
### Route: `/reports/sales-cube`

### Purpose
Advanced analytical reporting over `sales_ledger_items` with flexible grouping, filtering, and drill-down.

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/reports/sales-cube/filter-options` | Available filter values |
| POST | `/api/reports/sales-cube/query` | Execute cube query |

### Presets
| Key | GroupBy | Description |
|-----|---------|-------------|
| `totals_by_product` | product, category | Product sales totals |
| `product_by_day` | business_date, product | Daily product breakdown |
| `product_by_month` | month, product | Monthly product breakdown |
| `product_by_hour` | hour, product | Hourly product breakdown |
| `top_hours` | hour | Busiest hours |
| `heatmap` | weekday, hour | Weekday×hour heatmap |
| `cube` | custom row/col | Free-form pivot table |

### Filters
- Date range (from/to)
- Weekday selection (Mon-Sun toggles)
- Hour range (from/to)
- Category multi-select
- Origin multi-select (SYSTEM, LOYVERSE)
- Product multi-select
- Top N limit

### Features
- Client-side sorting (click column headers)
- CSV export with BOM for Excel compatibility
- Drill-down: click product row → see daily/hourly breakdown in sub-query
- Heatmap view: weekday labels (Lun-Dom), color intensity by value
- Custom cube: configurable row dimension, column dimension, metric (subtotal/qty/orders)
- Summary metadata: total qty, total subtotal, total orders, row count

---

## 10. CLIENTE QR

### File: `pages/qr-client.tsx` (1,436 lines)
### Route: `/qr/:tableCode` (no authentication required)

### Step Flow
```
welcome → subaccount → name → mode_select →
  [easy mode]: easy_cats → easy_products → easy_review → sent
  [standard mode]: menu → modifiers → review → sent
  [view_menu]: view_menu (read-only)
```

### Data Model
```typescript
interface Subaccount {
  id: number; orderId: number; tableId: number;
  slotNumber: number; code: string; label: string; isActive: boolean;
}

interface CartItem {
  productId: number; productName: string; unitPrice: string;
  qty: number; customerName: string;
  modifiers?: { modGroupId: number; optionId: number }[];
  categoryName: string;
}
```

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/qr/:tableCode/info` | Table info (id, name, maxSubaccounts) |
| GET | `/api/qr/:tableCode/menu` | Menu products + top categories |
| GET | `/api/qr/:tableCode/subaccounts` | Active subaccounts |
| GET | `/api/products/:id/modifiers` | Product modifier groups |
| POST | `/api/qr/:tableCode/submit` | Submit order |
| POST | `/api/qr/:tableCode/subaccounts` | Create new subaccount |

### Subaccount System
- Max 6 subaccounts per table (`MAX_SUBACCOUNTS = 6`)
- Each subaccount has: slot number, code, label, active status
- Customer selects existing or creates new subaccount
- Customer name tracked per subaccount

### Dual Mode
1. **Easy Mode (Interview flow):**
   - Step-by-step: pick category → pick products → review
   - Big category buttons with icons and counts
   - Guided experience for less tech-savvy customers
   - Step counter: "Paso X de 5"

2. **Standard Mode (Card grid):**
   - Full menu browsing with category tabs
   - TOP category segmented control
   - Subcategory pills
   - Product cards in grid layout
   - Similar to waiter's menu view

3. **View Menu (Read-only):**
   - Browse menu without ordering
   - No cart functionality

### Modifier Selection
- Triggered when product has modifier groups
- Full-screen step for modifier selection
- Required/optional groups with validation

### Cart
- Items tracked with customer name association
- Qty increment/decrement
- Remove items
- Review step shows full summary before submit

### UI Components
- `EasyStepLayout` — Sticky header with back button, step counter, sticky bottom button
- `ProductCard` — Product display with add button, in-cart badge, out-of-stock state
- `BigCategoryButton` — Large touchable category selector with icon and count
- All elements have min-height 48px for touch targets

---

## 11. ADMIN PANEL

### Routes: `/admin/*`
### Permission: `MODULE_ADMIN_VIEW`

### 11.1 Categories (`admin/categories.tsx` — 461 lines)
- **2-level management:** TOP categories + Subcategories
- **TOP categories:** Code prefix `TOP-`, color selection (emerald/blue/rose/amber/purple/cyan/orange), seed default TOPs button
- **Subcategory fields:** code, name, parent TOP, active, sort order, KDS destination (cocina/bar), food type, easy mode toggle
- **API:** `GET/POST/PATCH /api/admin/categories`, `POST /api/admin/categories/seed-tops`

### 11.2 Products (`admin/products.tsx` — 395 lines)
- **Fields:** productCode, name, description, categoryId, price, visibleQr, availablePortions
- **Tax categories:** Multi-select checkboxes, saved via `PUT /api/admin/products/:id/taxes`
- **Filters:** Search (debounced), TOP category, subcategory
- **Toggle switches:** active, visibleQr (inline toggle mutations)
- **API:** `GET/POST/PATCH /api/admin/products`, `PUT /api/admin/products/:id/taxes`

### 11.3 Modifiers (`admin/modifiers.tsx` — 274 lines)
- **Expandable groups:** Accordion-style, click to expand options
- **Group fields:** name, required, multiSelect, sortOrder
- **Option fields:** name, priceDelta, sortOrder
- **API:** `GET/POST/PATCH /api/admin/modifier-groups`, `POST /api/admin/modifier-groups/:id/options`, `PATCH/DELETE /api/admin/modifier-options/:id`

### 11.4 Payment Methods (`admin/payment-methods.tsx` — 120 lines)
- Simple CRUD: name, code, active toggle
- **API:** `GET/POST/PATCH /api/admin/payment-methods`

### 11.5 Tables (`admin/tables.tsx` — 191 lines)
- **Fields:** tableCode, tableName, active, sortOrder
- **API:** `GET/POST/PATCH /api/admin/tables`

### 11.6 Employees (`admin/employees.tsx` — 465 lines)
- **Fields:** username, displayName, role (select), active
- **Password management:** Set/change password
- **PIN management:** Reset PIN
- **API:** `GET/POST/PATCH /api/admin/employees`

### 11.7 Users (`admin/users.tsx` — 137 lines)
- Lightweight user list view
- **API:** `GET /api/admin/users`

### 11.8 Roles & Permissions (`admin/roles.tsx` — 272 lines)
- **Matrix view:** Roles as columns, permissions as rows
- **Permission groups:** Acceso a Módulos, Operaciones POS, Caja
- **6 roles:** MANAGER, FARM_MANAGER, CASHIER, WAITER, KITCHEN, STAFF
- Checkbox toggles per role×permission
- Dirty tracking: only saves changed roles
- **API:** `GET /api/admin/permissions`, `GET/PUT /api/admin/role-permissions`, `PUT /api/admin/role-permissions/:role`

### 11.9 Business Config (`admin/business-config.tsx` — 255 lines)
- **Fields:** businessName, legalName, taxId, address, phone, email, legalNote
- **Danger zone:** "Truncate transactions" button with confirmation dialog
- **API:** `GET/PUT /api/admin/business-config`, `POST /api/admin/truncate-transactions`

### 11.10 Printers (`admin/printers.tsx` — 298 lines)
- Printer configuration management
- **API:** `GET/POST/PATCH /api/admin/printers`

### 11.11 Discounts (`admin/discounts.tsx` — 194 lines)
- Discount definitions for item-level application
- **API:** `GET/POST/PATCH /api/admin/discounts`

### 11.12 Tax Categories (`admin/tax-categories.tsx` — 223 lines)
- Tax category definitions with rates
- **API:** `GET/POST/PATCH /api/admin/tax-categories`

---

## 12. INVENTARIO

### Routes: `/inventory/*`
### Permission: `MODULE_INV_VIEW`

### 12.1 Items (`inventory/items.tsx` — 591 lines)
- **Data:** SKU, name, category, base UOM, on-hand qty, reorder point, par level, avg cost, last cost, perishable flag
- **UOM options:** UNIT, KG, G, LB, OZ, LT, ML, GAL, M, CM, BOLSA, CAJA, PAQUETE, BOTELLA, LATA
- **Stock badges:** Red (Sin stock) when qty≤0, Yellow (Bajo) when qty≤reorder point, Green (OK) otherwise
- **Form validation:** Zod schema (sku, name, category, baseUom, onHandQtyBase required)
- **Search + filter**
- **CSV import**
- Navigate to item detail: `/inventory/items/:id`
- **API:** `GET/POST/PATCH /api/inventory/items`

### 12.2 Item Detail (`inventory/item-detail.tsx` — 534 lines)
- Full item view with movement history
- Stock level display with cost information
- **API:** `GET /api/inventory/items/:id`, `GET /api/inventory/items/:id/movements`

### 12.3 Suppliers (`inventory/suppliers.tsx` — 377 lines)
- CRUD: name, contact info, active status
- **API:** `GET/POST/PATCH /api/inventory/suppliers`

### 12.4 Purchase Orders (`inventory/purchase-orders.tsx` — 668 lines)
- **Status flow:** DRAFT → SENT → PARTIALLY_RECEIVED → RECEIVED / CANCELLED
- **PO lines:** inventory item, qty in purchase UOM, unit price, base UOM conversion multiplier
- **Receiving:** Enter received quantities + actual unit prices per line
- **WAC update:** Weighted Average Cost recalculated on receive
- **API:** `GET/POST /api/inventory/purchase-orders`, `PATCH /api/inventory/purchase-orders/:id/status`, `POST /api/inventory/purchase-orders/:id/lines`, `POST /api/inventory/purchase-orders/:id/receive`

### 12.5 Physical Counts (`inventory/physical-counts.tsx` — 434 lines)
- **Status flow:** OPEN → FINALIZED
- **Scope:** ALL or by category
- **Count lines:** system qty vs counted qty, delta calculation, adjustment reason
- **Finalize:** Adjusts inventory based on counted quantities
- **API:** `GET/POST /api/inventory/physical-counts`, `POST /api/inventory/physical-counts/:id/lines`, `POST /api/inventory/physical-counts/:id/finalize`

### 12.6 Recipes (`inventory/recipes.tsx` — 555 lines)
- **Links:** Menu product → Recipe → Recipe lines (inventory items)
- **Recipe fields:** menuProductId, version, isActive, yieldQty
- **Line fields:** invItemId, qtyBasePerMenuUnit, wastePct
- **Purpose:** Defines inventory consumption per menu item sold
- Product search + filter by inventoryControlEnabled
- **API:** `GET /api/inventory/recipes?productId=X`, `POST /api/inventory/recipes`, `GET/POST/DELETE /api/inventory/recipes/:id/lines`

### 12.7 Reports (`inventory/reports.tsx` — 249 lines)
- Inventory reporting views
- **API:** `GET /api/inventory/reports/*`

---

## 13. FALTANTES (Shortages)

### Routes: `/shortages/*`
### Permission: `SHORTAGES_VIEW`

### 13.1 Active Shortages (`shortages/active.tsx` — 548 lines)
- **Status lifecycle:** OPEN → ACKNOWLEDGED → RESOLVED → CLOSED
- **Severity levels:** LOW_STOCK (yellow), NO_STOCK (red), URGENT (red+bold)
- **Entity types:** Inventory items or Menu products
- **Fields:** entityType, invItemId/menuProductId, status, priority, severityReport, reportedBy, notes, reportCount, lastReportedAt, suggestedPurchaseQty, systemOnHandQtySnapshot, systemAvgCostSnapshot, auditFlag, auditReason
- **Actions:** Acknowledge, Resolve, Close — each advances status
- **Event timeline:** Shows status change history per shortage
- **Tabs:** By status (OPEN, ACKNOWLEDGED, RESOLVED, CLOSED)
- **API:** `GET /api/shortages`, `PATCH /api/shortages/:id/status`, `GET /api/shortages/:id/events`

### 13.2 Report (`shortages/report.tsx` — 429 lines)
- Create new shortage reports
- **API:** `POST /api/shortages/report`

### 13.3 Audit (`shortages/audit.tsx` — 372 lines)
- Audit log of all shortage events
- **API:** `GET /api/shortages/audit`

### Real-time Integration
- WebSocket: `shortage_created`, `shortage_updated` events
- Global hook `useShortageAlerts()` provides toast + audio notifications
- Cache invalidation on events

---

## 14. RECURSOS HUMANOS (HR)

### Routes: `/hr/*`
### Permission: `MODULE_HR_VIEW`

### 14.1 Mi Turno (`hr/mi-turno.tsx` — 279 lines)
- **Self-service clock in/out** for current employee
- **Geolocation required:** Captures lat, lng, accuracy on punch
- **Live elapsed timer:** Updates every 1 second when clocked in (HH:MM:SS format)
- **Today's punches:** List of clock-in/out records with worked time
- **API:** `GET /api/hr/my-punch` (30s polling), `GET /api/hr/punches/my`, `POST /api/hr/clock-in`, `POST /api/hr/clock-out`

### 14.2 Punches Management (`hr/punches.tsx` — 432 lines)
- **Admin view:** All employee punches with filters
- **Fields:** employeeId, clockInAt, clockOutAt, workedMinutes, lateMinutes, exitType, geoVerified
- **Edit punch:** Modify clock-in/out times (manager function)
- **Open punches:** List of employees currently clocked in
- **Date filter**
- **API:** `GET /api/hr/punches`, `GET /api/hr/punches/open`, `PATCH /api/hr/punches/:id`

### 14.3 Schedules (`hr/schedules.tsx` — 486 lines)
- **Weekly schedule per employee**
- **Week navigation:** Previous/next week buttons
- **Day configuration:** Start time, end time, day off toggle
- **Copy week:** Duplicate schedule to next week
- **Day-of-week values:** Mon=1, Tue=2, ... Sun=0
- **API:** `GET /api/hr/schedules?employeeId=X&weekStart=YYYY-MM-DD`, `POST/PUT /api/hr/schedules`

### 14.4 Reports (`hr/reports.tsx` — 418 lines)
- HR analytics and attendance reports
- **API:** `GET /api/hr/reports/*`

### 14.5 Settings (`hr/settings.tsx` — 311 lines)
- HR module configuration
- **API:** `GET/PUT /api/hr/settings`

---

## 15. PATRONES COMPARTIDOS

### 15.1 Data Fetching
- All modules use `@tanstack/react-query` v5 (object syntax only)
- Default fetcher: `queryKey: ["/api/endpoint"]` — no queryFn needed
- Mutations use `apiRequest(method, url, body)` from `@/lib/queryClient`
- Cache invalidation after every mutation via `queryClient.invalidateQueries({ queryKey: [...] })`
- **Polling intervals by module:**
  - Tables list: 5s (`/api/waiter/tables`)
  - Table detail: 5s (`/api/tables/:id/current`)
  - KDS active tickets: 5s
  - POS tables: 5s (`/api/pos/tables`)
  - HR my-punch: 30s (`/api/hr/my-punch`)
  - Dashboard, Admin CRUDs, Inventory, Sales Cube: no polling (on-demand + WebSocket invalidation)
  - Permissions: 60s staleTime (not refetchInterval)

### 15.2 Real-time Updates
- WebSocket + polling dual approach (WebSocket for instant, polling as fallback)
- Pattern: `useEffect` → `wsManager.connect()` → register event handlers → return cleanup
- All WS handlers trigger `queryClient.invalidateQueries()`

### 15.3 State Management
- No global state library (no Redux/Zustand)
- State via: React Query cache (server state) + local useState + localStorage (persistence)
- Auth state via React Context (AuthProvider)
- localStorage keys used: `tables_visible_columns`, `cart_table_${id}`

### 15.4 UI Patterns
- **Loading states:** Skeleton components or Loader2 spinner
- **Empty states:** Card with centered icon + message
- **Error handling:** Toast notifications (destructive variant) on mutation errors
- **Forms:** Dialog-based CRUD (no separate pages), controlled inputs
- **Tables:** Responsive with overflow-x-auto, text-xs on mobile
- **Touch targets:** min-h-[48px] on interactive elements
- **Mobile-first:** Responsive breakpoints (sm/md/lg), grid column adjustments

### 15.5 Audio Notifications
| Context | Frequency | Waveform | Duration |
|---------|-----------|----------|----------|
| QR submission (tables) | 880Hz | sine | 0.5s |
| Shortage alert | 880Hz | triangle | 0.5s |
| KDS new order | 1200-1800Hz | square+sawtooth | 1.8s pattern |
| QR submission (table detail) | Audio file | `/notification.mp3` | - |

### 15.6 Currency
- Costa Rican Colón (₡)
- Formatting: `₡${amount.toLocaleString("es-CR")}`
- Locale: `es-CR` throughout

### 15.7 Timezone
- Business timezone: `America/Costa_Rica` (UTC-6)
- All business date calculations server-side
- Frontend displays using browser locale formatting

---

## 16. MAPA DE RUTAS Y PERMISOS

| Route | Page | Permission Required |
|-------|------|-------------------|
| `/` | TablesPage (default) | Redirects based on permissions |
| `/tables` | TablesPage | `MODULE_TABLES_VIEW` |
| `/tables/:id` | TableDetailPage | `MODULE_TABLES_VIEW` |
| `/kds` | KDSPage | `MODULE_KDS_VIEW` |
| `/kds-bar` | KDSBarPage | `MODULE_KDS_VIEW` |
| `/pos` | POSPage | `MODULE_POS_VIEW` |
| `/dashboard` | DashboardPage | `MODULE_DASHBOARD_VIEW` |
| `/admin/tables` | AdminTablesPage | `MODULE_ADMIN_VIEW` |
| `/admin/categories` | AdminCategoriesPage | `MODULE_ADMIN_VIEW` |
| `/admin/products` | AdminProductsPage | `MODULE_PRODUCTS_VIEW` |
| `/admin/payment-methods` | AdminPaymentMethodsPage | `MODULE_ADMIN_VIEW` |
| `/admin/employees` | AdminEmployeesPage | `MODULE_ADMIN_VIEW` |
| `/admin/roles` | AdminRolesPage | `MODULE_ADMIN_VIEW` |
| `/admin/business-config` | AdminBusinessConfigPage | `MODULE_ADMIN_VIEW` |
| `/admin/printers` | AdminPrintersPage | `MODULE_ADMIN_VIEW` |
| `/admin/modifiers` | AdminModifiersPage | `MODULE_ADMIN_VIEW` |
| `/admin/discounts` | AdminDiscountsPage | `MODULE_ADMIN_VIEW` |
| `/admin/tax-categories` | AdminTaxCategoriesPage | `MODULE_ADMIN_VIEW` |
| `/hr/mi-turno` | HrMiTurnoPage | `MODULE_HR_VIEW` |
| `/hr/horarios` | HrSchedulesPage | `MODULE_HR_VIEW` |
| `/hr/marcas` | HrPunchesPage | `MODULE_HR_VIEW` |
| `/hr/reportes` | HrReportsPage | `MODULE_HR_VIEW` |
| `/hr/config` | HrSettingsPage | `MODULE_HR_VIEW` |
| `/inventory/items` | InvItemsPage | `MODULE_INV_VIEW` |
| `/inventory/items/:id` | InvItemDetailPage | `MODULE_INV_VIEW` |
| `/inventory/suppliers` | InvSuppliersPage | `MODULE_INV_VIEW` |
| `/inventory/purchase-orders` | InvPurchaseOrdersPage | `MODULE_INV_VIEW` |
| `/inventory/physical-counts` | InvPhysicalCountsPage | `MODULE_INV_VIEW` |
| `/inventory/recipes` | InvRecipesPage | `MODULE_INV_VIEW` |
| `/inventory/reports` | InvReportsPage | `MODULE_INV_VIEW` |
| `/shortages/report` | ShortagesReportPage | `SHORTAGES_VIEW` |
| `/shortages/active` | ShortagesActivePage | `SHORTAGES_VIEW` |
| `/shortages/audit` | ShortagesAuditPage | `SHORTAGES_VIEW` |
| `/reports/sales-cube` | SalesCubePage | `MODULE_DASHBOARD_VIEW` |
| `/qr/:tableCode` | QRClientPage | **None (public)** |

### Default Route Priority
```
MODULE_TABLES_VIEW → /tables
MODULE_POS_VIEW → /pos
MODULE_KDS_VIEW → /kds
MODULE_DASHBOARD_VIEW → /dashboard
MODULE_ADMIN_VIEW → /admin/employees
MODULE_HR_VIEW → /hr/mi-turno
MODULE_PRODUCTS_VIEW → /admin/products
fallback → /tables
```

---

## NOTAS PARA REDISEÑO UI/UX

### Áreas de mayor complejidad visual
1. **Table Detail** (1,657 LOC) — Cart + menu + order view + void dialog + modifier dialog + QR submissions + round system + subaccount filter
2. **POS** (2,123 LOC) — Payment flow + split flow + cash session + paid orders + item discounts + void capabilities
3. **QR Client** (1,436 LOC) — Multi-step flow with dual mode + subaccounts + modifiers
4. **Dashboard** (1,126 LOC) — Many metrics + drill-downs + tables + date picker
5. **Sales Cube** (908 LOC) — Analytical pivot tables + heatmap + drill-down

### Componentes custom (no-shadcn)
- `PayDialog.tsx` + `SplitDialog.tsx` + `pos-dialogs.css` — Custom dark theme, responsive 3-panel layouts
- These use pure CSS (no Tailwind/shadcn) with design tokens: #0a0c0f bg, #111318/#181c22 surfaces, green #2ecc71, blue #3498db, amber #f39c12
- Typography: Barlow Condensed (titles), Barlow (body), JetBrains Mono (numbers)

### Business logic que NO debe cambiar
- Tax snapshots on order item creation
- Order consecutive numbering (daily + global)
- Payment validation and cash session integrity
- Inventory WAC calculations
- Shortage lifecycle (OPEN→ACKNOWLEDGED→RESOLVED→CLOSED)
- Subaccount system (max 6 per table)
- Round-based ordering flow
- Soft-void (waiter) vs hard-delete (manager) item removal
