# PROMPT MAESTRO — REDISEÑO COMPLETO SISTEMA RESTAURANTE PWA
# Para Replit Agent · Copia y pega completo en el chat

---

## INSTRUCCIÓN PRINCIPAL

Rediseña completamente el look & feel y UI/UX de toda la plataforma de restaurante.
NO cambies ninguna lógica de negocio, endpoints, estructuras de datos ni nombres de variables.
Solo modificas: componentes visuales, layouts, CSS, tipografía, espaciado, flujos de navegación UX.

El resultado debe ser una aplicación cohesiva, rápida de operar con el pulgar en un teléfono,
y consistente en todas las pantallas. El diseño ya tiene prototipos de referencia visuales —
sígue esos prototipos al pie de la letra donde existan.

---

## REGLAS QUE NUNCA PUEDES ROMPER

1. NO cambiar endpoints API ni contratos de datos
2. NO cambiar nombres de hooks, mutations ni queries existentes
3. NO cambiar lógica de permisos (usePermissions, hasPermission)
4. NO cambiar el sistema de autenticación (AuthProvider, useAuth)
5. NO cambiar lógica de WebSocket (wsManager)
6. NO eliminar funcionalidad — solo reorganizar cómo se presenta
7. NO usar librerías de UI externas nuevas (no MUI, no Ant Design, no Chakra)
8. SÍ mantener shadcn/ui para componentes base donde ya existe
9. SÍ mantener Tailwind para utilidades, PERO preferir CSS custom variables para theming
10. SÍ mantener todos los toast notifications y audio alerts existentes

---

## SISTEMA DE DISEÑO UNIFICADO

### Instalar fuentes (añadir a index.html)
```html
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

### Design Tokens (añadir a index.css como :root)
```css
:root {
  /* Fondos */
  --bg:     #080a0d;
  --s0:     #0e1117;
  --s1:     #141920;
  --s2:     #1a2030;
  --s3:     #202840;

  /* Bordes */
  --border:  #252e42;
  --border2: #2e3a54;

  /* Acentos */
  --green:    #2ecc71;
  --green-d:  rgba(46,204,113,0.10);
  --green-m:  rgba(46,204,113,0.22);
  --amber:    #f39c12;
  --amber-d:  rgba(243,156,18,0.12);
  --blue:     #3b82f6;
  --blue-d:   rgba(59,130,246,0.10);
  --red:      #ef4444;
  --red-d:    rgba(239,68,68,0.10);
  --purple:   #a855f7;
  --purple-d: rgba(168,85,247,0.10);

  /* Texto */
  --text:  #f0f2f5;
  --text2: #8494b0;
  --text3: #3d4f6b;
  --text4: #232e42;

  /* Tipografía */
  --f-disp: 'Barlow Condensed', sans-serif;
  --f-body: 'Barlow', sans-serif;
  --f-mono: 'JetBrains Mono', monospace;

  /* Radios */
  --r-xs: 6px;  --r-sm: 10px;
  --r-md: 14px; --r-lg: 18px; --r-xl: 24px;

  /* Transiciones */
  --t-fast: 0.14s ease;
  --t-mid:  0.24s ease;
  --t-slow: 0.38s cubic-bezier(.22,.68,0,1.2);

  /* Sombras */
  --shadow-card:   0 4px 24px rgba(0,0,0,0.4);
  --shadow-dialog: 0 32px 80px rgba(0,0,0,0.75), 0 0 0 1px var(--border);
  --shadow-green:  0 8px 32px rgba(46,204,113,0.30);
}
```

### Tipografía — Reglas de uso
- `font-family: var(--f-disp)` → Títulos, nombres de pantalla, nombres de mesa, botones CTA, badges de estado
- `font-family: var(--f-body)` → Párrafos, descripciones, nombres de productos, labels de formulario
- `font-family: var(--f-mono)` → Precios (₡), tiempos, contadores, códigos, datos numéricos, etiquetas pequeñas uppercase

### Componentes base reutilizables

#### Botón primario
```css
.btn-primary {
  padding: 13px 20px;
  border-radius: var(--r-sm);
  background: var(--green);
  color: #050f08;
  font-family: var(--f-disp);
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.05em;
  border: none;
  cursor: pointer;
  transition: all var(--t-mid);
  position: relative;
  overflow: hidden;
}
.btn-primary::after {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, transparent 60%);
  pointer-events: none;
}
.btn-primary:active { transform: scale(0.97); }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
```

#### Botón secundario
```css
.btn-secondary {
  padding: 13px 16px;
  border-radius: var(--r-sm);
  background: var(--s2);
  border: 1px solid var(--border);
  color: var(--text2);
  font-family: var(--f-disp);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all var(--t-fast);
}
.btn-secondary:active { background: var(--s3); }
```

#### Badge de estado
```css
.badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px;
  border-radius: 20px;
  font-family: var(--f-mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  width: fit-content;
}
.badge-green  { background: var(--green-d); color: var(--green); border: 1px solid var(--green-m); }
.badge-blue   { background: var(--blue-d);  color: var(--blue);  border: 1px solid rgba(59,130,246,0.25); }
.badge-amber  { background: var(--amber-d); color: var(--amber); border: 1px solid rgba(243,156,18,0.3); }
.badge-red    { background: var(--red-d);   color: var(--red);   border: 1px solid rgba(239,68,68,0.3); }
.badge-muted  { background: var(--s3); color: var(--text3); border: 1px solid var(--border); }
```

#### Card base
```css
.card {
  background: var(--s1);
  border: 1.5px solid var(--border);
  border-radius: var(--r-md);
  padding: 14px;
  transition: all var(--t-mid);
}
.card:active { transform: scale(0.97); }
```

#### Input / Field
```css
.field {
  background: var(--s2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 11px 14px;
  color: var(--text);
  font-family: var(--f-body);
  font-size: 14px;
  outline: none;
  width: 100%;
  transition: border-color var(--t-fast);
}
.field:focus { border-color: var(--border2); }
.field::placeholder { color: var(--text3); }
```

#### Header de pantalla (mobile)
```css
.screen-header {
  padding: 10px 18px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.header-title {
  font-family: var(--f-disp);
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 0.02em;
  flex: 1;
}
.header-sub {
  font-family: var(--f-mono);
  font-size: 10px;
  color: var(--text3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.back-btn, .header-action {
  width: 36px; height: 36px;
  border-radius: var(--r-sm);
  background: var(--s2);
  border: 1px solid var(--border);
  color: var(--text2);
  display: flex; align-items: center; justify-content: center;
  transition: all var(--t-fast);
  flex-shrink: 0;
}
.back-btn:hover, .header-action:hover { background: var(--s3); color: var(--text); }
```

#### Bottom navigation (mobile)
```css
.bottom-nav {
  height: 72px;
  background: var(--s0);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 0 8px 8px;
}
.nav-item {
  display: flex; flex-direction: column;
  align-items: center; gap: 3px;
  padding: 6px 16px;
  border-radius: var(--r-sm);
  background: transparent;
  border: none;
  color: var(--text3);
  transition: all var(--t-fast);
  cursor: pointer;
}
.nav-item.active { color: var(--green); }
.nav-label { font-family: var(--f-mono); font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; }
.nav-badge {
  position: absolute; top: -4px; right: -8px;
  width: 16px; height: 16px;
  background: var(--red); border-radius: 50%;
  font-family: var(--f-mono); font-size: 9px; font-weight: 700; color: #fff;
  display: flex; align-items: center; justify-content: center;
  border: 1.5px solid var(--s0);
}
```

---

## MÓDULO 1 — PIN LOGIN (pages/pin-login.tsx)

### Diseño actual (problemas)
- Fondo claro, PIN pad genérico
- Sin identidad visual del sistema
- Feedback visual de error poco claro

### Rediseño requerido

**Layout:** Pantalla completa dividida en 2 zonas:
- Zona superior (40%): Logo/nombre del negocio + hora actual en grande + fecha
- Zona inferior (60%): PIN pad + indicadores de dígitos

**PIN pad visual:**
```
Indicadores: ○ ○ ○ ○  → ● ● ○ ○ al ir llenando
             (círculos vacíos se llenan de verde al ingresar cada dígito)

Grid de botones 3×4:
  [ 1 ]  [ 2 ]  [ 3 ]
  [ 4 ]  [ 5 ]  [ 6 ]
  [ 7 ]  [ 8 ]  [ 9 ]
  [   ]  [ 0 ]  [ ⌫ ]
```

**Estilo de botones PIN:**
```css
.pin-btn {
  width: 72px; height: 72px;
  border-radius: 50%;
  background: var(--s2);
  border: 1.5px solid var(--border);
  color: var(--text);
  font-family: var(--f-disp);
  font-size: 28px;
  font-weight: 700;
  transition: all var(--t-fast);
  cursor: pointer;
}
.pin-btn:active {
  background: var(--s3);
  border-color: var(--border2);
  transform: scale(0.92);
}
```

**Indicadores de dígitos:**
```css
.pin-dot {
  width: 14px; height: 14px;
  border-radius: 50%;
  border: 2px solid var(--border2);
  background: transparent;
  transition: all var(--t-slow);
}
.pin-dot.filled {
  background: var(--green);
  border-color: var(--green);
  box-shadow: 0 0 10px var(--green-m);
}
```

**Estados:**
- Error: dots se sacuden (animation shake 0.4s) y se vuelven rojos, luego reset
- Loading (validando): dots pulsan con opacity
- Éxito: dots flash verde → transición a pantalla principal

**Elemento de identidad:**
```jsx
// Header con nombre del negocio desde businessConfig
<div className="login-brand">
  <div className="brand-name">{businessConfig?.businessName}</div>
  <div className="brand-time">{currentTime}</div>  {/* HH:MM en grande, var(--f-mono) */}
  <div className="brand-date">{currentDate}</div>
</div>
```

**Link "Usar contraseña":** texto pequeño debajo del PIN pad, `var(--text3)`.

**Animaciones:**
```css
@keyframes pin-shake {
  0%,100% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-6px); }
  80% { transform: translateX(6px); }
}
@keyframes pin-success {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.15); }
  100% { transform: scale(1); }
}
```

---

## MÓDULO 2 — MESAS (pages/tables.tsx)

### Referencia visual
El archivo `pos-redesign-screens.html` tiene el prototipo funcional completo. Replicar exactamente.

### Estructura JSX principal
```jsx
<div className="screen-tables">
  {/* Header */}
  <div className="screen-header">
    <div>
      <h1 className="header-title">Mesas</h1>
      <p className="header-sub">{dayName} · {time} · <span style={{color:'var(--green)'}}>{occupiedCount} activas</span></p>
    </div>
    <button className="header-action" onClick={toggleColumns}>⚙</button>
  </div>

  {/* Search */}
  <div className="tables-search">
    <div className="search-bar">
      <SearchIcon /> <input placeholder="Buscar mesa..." />
    </div>
    <button className="filter-btn">⊞</button>
  </div>

  {/* Mesas ocupadas — grid 2 columnas */}
  <p className="section-label">Con cuenta abierta <span className="section-count">{occupied.length}</span></p>
  <div className="tables-grid">
    {occupied.map(table => <TableCard key={table.id} table={table} />)}
  </div>

  {/* Mesas libres — grid 3 columnas */}
  <p className="section-label">Libres <span className="section-count">{free.length}</span></p>
  <div className="tables-free-grid">
    {free.map(table => <FreeTableCard key={table.id} table={table} />)}
  </div>

  <BottomNav active="tables" />
</div>
```

### TableCard — colores por estado
```
orderStatus === null                → clase "free"    → barra top: var(--border)
pendingQrCount > 0                  → clase "qr"      → barra top: var(--amber) + badge pulsante
orderStatus === "READY"             → clase "ready"   → barra top: var(--green) + glow
orderStatus === "IN_KITCHEN"        → clase "kitchen" → barra top: var(--blue)
orderStatus === "PREPARING"         → clase "preparing"→ barra top: var(--amber)
orderStatus === "OPEN"              → clase "open"    → barra top: var(--green)
```

```css
.table-card {
  background: var(--s1);
  border: 1.5px solid var(--border);
  border-radius: var(--r-md);
  padding: 14px 12px 12px;
  cursor: pointer;
  transition: all var(--t-mid);
  position: relative;
  overflow: hidden;
  min-height: 120px;
  display: flex; flex-direction: column; gap: 6px;
}
.table-card::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0;
  height: 3px;
  border-radius: var(--r-md) var(--r-md) 0 0;
}
.table-card.qr { border-color: rgba(243,156,18,0.4); }
.table-card.qr::before { background: var(--amber); }
.table-card.ready { border-color: rgba(46,204,113,0.5); box-shadow: 0 0 16px rgba(46,204,113,0.12); }
.table-card.ready::before { background: var(--green); }
.table-card.kitchen { border-color: rgba(59,130,246,0.3); }
.table-card.kitchen::before { background: var(--blue); }
/* etc. para cada estado */

@keyframes pulse-amber {
  0%,100% { box-shadow: 0 0 0 0 rgba(243,156,18,0.5); }
  50%      { box-shadow: 0 0 0 6px rgba(243,156,18,0); }
}
.qr-badge { animation: pulse-amber 2s infinite; }
```

---

## MÓDULO 3 — DETALLE DE MESA (pages/table-detail.tsx)

### Rediseño requerido

**Header con contexto completo:**
```jsx
<div className="screen-header">
  <button className="back-btn" onClick={() => navigate('/tables')}>‹</button>
  <div style={{flex:1}}>
    <h1 className="header-title">{table.tableName}</h1>
    <p className="header-sub">
      {waiterName} · Abierta {elapsedTime} ·
      <span style={{color: statusColor}}>{statusLabel}</span>
    </p>
  </div>
  <button className="header-action" onClick={openTransfer}>⇄</button>
  <button className="header-action" onClick={openMoreMenu}>⋯</button>
</div>
```

**Tabs de modo — siempre visibles:**
```jsx
<div className="view-tabs">
  <button className={`view-tab ${viewMode==='order' ? 'active-order' : ''}`}
          onClick={() => setViewMode('order')}>
    📋 Orden
    {order?.items?.length > 0 && <span className="tab-badge">{order.items.length}</span>}
  </button>
  <button className={`view-tab ${viewMode==='menu' ? 'active-menu' : ''}`}
          onClick={() => setViewMode('menu')}>
    🍽 Menú
  </button>
</div>
```

```css
.view-tabs { padding: 0 18px 12px; display: flex; gap: 6px; }
.view-tab {
  flex: 1; padding: 10px 6px;
  border-radius: var(--r-sm);
  border: 1.5px solid var(--border);
  background: var(--s2); color: var(--text3);
  font-family: var(--f-disp); font-size: 13px; font-weight: 700;
  letter-spacing: 0.04em; text-transform: uppercase;
  transition: all var(--t-fast); cursor: pointer;
}
.view-tab.active-order { border-color: var(--green-m); background: var(--green-d); color: var(--green); }
.view-tab.active-menu  { border-color: rgba(59,130,246,0.3); background: var(--blue-d); color: var(--blue); }
.tab-badge {
  background: var(--amber); color: #000;
  font-family: var(--f-mono); font-size: 9px; font-weight: 700;
  padding: 1px 5px; border-radius: 20px; margin-left: 4px;
}
```

**Banner QR (solo cuando pendingQrCount > 0):**
```jsx
{pendingSubmissions.length > 0 && (
  <div className="qr-banner">
    <span className="qr-banner-icon">📱</span>
    <div>
      <p className="qr-banner-title">{pendingSubmissions.length} pedido{pendingSubmissions.length>1?'s':''} QR pendiente{pendingSubmissions.length>1?'s':''}</p>
      <p className="qr-banner-sub">{submissionNames}</p>
    </div>
    <button className="qr-banner-btn" onClick={acceptAll}>Aceptar</button>
  </div>
)}
```

**Orden por rondas:**
```jsx
{roundGroups.map(round => (
  <div className="round-section" key={round.number}>
    <div className="round-header">
      <span className="round-pill">Ronda {round.number}</span>
      <div className="round-line" />
      <span className="round-time">{round.timeAgo}</span>
    </div>
    {round.items.map(item => <OrderItem key={item.id} item={item} />)}
  </div>
))}
```

**OrderItem:**
```css
.order-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 12px;
  background: var(--s1); border: 1px solid var(--border);
  border-radius: var(--r-sm); margin-bottom: 6px;
  transition: all var(--t-fast);
}
.oi-qty {
  width: 26px; height: 26px; border-radius: 7px;
  background: var(--s3); border: 1px solid var(--border2);
  font-family: var(--f-mono); font-size: 12px; font-weight: 600; color: var(--text2);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
/* Status colors en .oi-status: mismo sistema que badges */
```

**Barra inferior fija — 3 acciones:**
```jsx
<div className="bottom-action">
  <button className="btn-icon" onClick={() => setViewMode('menu')}>＋</button>
  <button className="btn-primary" style={{flex:1}} onClick={openPayDialog}>
    💳 Cobrar {formatCurrency(order.totalAmount)}
  </button>
  <button className="btn-icon" onClick={printPrecheck}>🧾</button>
</div>
```

```css
.bottom-action {
  position: absolute; bottom: 0; left: 0; right: 0;
  padding: 12px 18px;
  background: linear-gradient(to top, var(--s0) 80%, transparent);
  display: flex; gap: 8px; z-index: 20;
}
.btn-icon {
  width: 46px; height: 46px;
  border-radius: var(--r-sm);
  background: var(--s2); border: 1px solid var(--border);
  color: var(--text2); font-size: 18px;
  display: flex; align-items: center; justify-content: center;
  transition: all var(--t-fast); flex-shrink: 0;
}
```

**Vista Menú (viewMode === 'menu'):**
Ver Módulo Menú abajo — mismo componente, aparece inline en la tab.

**Totales de orden:**
```jsx
<div className="order-totals">
  <div className="ot-row"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
  {taxBreakdown.map(t => (
    <div className="ot-row" key={t.name}><span>{t.name}</span><span>{formatCurrency(t.amount)}</span></div>
  ))}
  {serviceCharge > 0 && <div className="ot-row"><span>Servicio</span><span>{formatCurrency(serviceCharge)}</span></div>}
  {totalDiscounts > 0 && <div className="ot-row" style={{color:'var(--green)'}}><span>Descuentos</span><span>−{formatCurrency(totalDiscounts)}</span></div>}
  <div className="ot-sep" />
  <div className="ot-row total"><span>Total</span><span>{formatCurrency(order.totalAmount)}</span></div>
</div>
```

---

## MÓDULO 4 — MENÚ / AGREGAR ITEMS

### Categorías TOP (segmented control horizontal scrollable)
```jsx
<div className="top-cats">
  {topCategories.map(cat => (
    <button key={cat.id}
      className={`top-cat ${selectedTop === cat.id ? `active-${cat.color}` : ''}`}
      onClick={() => setSelectedTop(cat.id)}>
      {cat.name}
    </button>
  ))}
</div>
```

```css
/* colores disponibles para top-cat.active-X */
.top-cat.active-emerald { background: rgba(16,185,129,0.12); border-color: rgba(16,185,129,0.35); color: #10b981; }
.top-cat.active-blue    { background: var(--blue-d);  border-color: rgba(59,130,246,0.35); color: var(--blue); }
.top-cat.active-amber   { background: var(--amber-d); border-color: rgba(243,156,18,0.35); color: var(--amber); }
.top-cat.active-purple  { background: var(--purple-d);border-color: rgba(168,85,247,0.35); color: var(--purple); }
.top-cat.active-rose    { background: var(--red-d);   border-color: rgba(239,68,68,0.35);  color: var(--red); }
```

### Subcategorías (pills scrollables)
```css
.sub-cat { padding: 5px 14px; border-radius: 20px; border: 1px solid var(--border);
  background: transparent; color: var(--text3); font-family: var(--f-mono); font-size: 11px;
  cursor: pointer; transition: all var(--t-fast); white-space: nowrap; }
.sub-cat.active { border-color: var(--border2); background: var(--s3); color: var(--text2); }
```

### Grid de productos (2 columnas)
```css
.products-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.product-card {
  background: var(--s1); border: 1.5px solid var(--border);
  border-radius: var(--r-md); padding: 12px;
  cursor: pointer; transition: all var(--t-mid);
  position: relative; min-height: 100px;
}
.product-card:active { transform: scale(0.96); border-color: var(--border2); }
.product-card.unavailable { opacity: 0.45; cursor: not-allowed; }
.pc-name  { font-size: 13px; font-weight: 500; color: var(--text); line-height: 1.3; }
.pc-price { font-family: var(--f-mono); font-size: 13px; font-weight: 600; color: var(--green); margin-top: 4px; }
.pc-add   { position: absolute; bottom: 10px; right: 10px; width: 28px; height: 28px;
  border-radius: 7px; background: var(--green); color: #050f08;
  font-size: 20px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.pc-in-cart { position: absolute; top: 8px; right: 8px;
  background: var(--green); color: #050f08;
  font-family: var(--f-mono); font-size: 10px; font-weight: 700;
  padding: 2px 7px; border-radius: 20px; }
.pc-agotado { position: absolute; top: 8px; right: 8px;
  background: var(--red-d); color: var(--red);
  border: 1px solid rgba(239,68,68,0.3);
  font-family: var(--f-mono); font-size: 9px; font-weight: 600;
  padding: 2px 7px; border-radius: 20px; letter-spacing: 0.06em; text-transform: uppercase; }
```

### FAB Carrito (aparece cuando cart.length > 0)
```jsx
{cart.length > 0 && (
  <button className="cart-fab" onClick={() => setShowCart(true)}>
    🛒 Ver Carrito
    <span className="cart-fab-count">{totalItems} items</span>
  </button>
)}
```
```css
.cart-fab {
  position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%);
  background: var(--green); color: #050f08;
  border-radius: var(--r-md); padding: 13px 24px;
  font-family: var(--f-disp); font-size: 15px; font-weight: 800;
  box-shadow: var(--shadow-green); white-space: nowrap; z-index: 20; border: none;
  display: flex; align-items: center; gap: 10px; cursor: pointer;
}
.cart-fab-count { background: rgba(0,0,0,0.25); padding: 2px 8px; border-radius: 20px; font-size: 13px; }
```

### Animación fly-to-cart (mantener lógica existente, actualizar estilos)
```css
.fly-item {
  position: fixed; width: 20px; height: 20px; border-radius: 50%;
  background: var(--green); pointer-events: none; z-index: 9999;
  animation: flyToCart 0.4s cubic-bezier(.4,0,.2,1) forwards;
}
@keyframes flyToCart {
  0%   { transform: scale(1); opacity: 1; }
  100% { transform: scale(0.3) translate(var(--tx), var(--ty)); opacity: 0; }
}
```

---

## MÓDULO 5 — KDS (pages/kds.tsx y kds-bar.tsx)

### Diseño actual (problemas)
- Interfaz no optimizada para cocina (luz, distancia de lectura)
- Items individuales poco diferenciados
- Timer difícil de leer de lejos

### Rediseño — KDS está diseñado para una PANTALLA EN COCINA, NO para móvil
Usar layout desktop-first aquí (grid de columnas, texto grande, alto contraste).

**Layout:**
```jsx
<div className="kds-layout">
  <div className="kds-header">
    <h1 className="kds-title">🍳 COCINA</h1>
    <div className="kds-stats">
      <span>{activeTickets.length} tickets activos</span>
    </div>
    <div className="kds-time">{currentTime}</div>
  </div>

  <div className="kds-grid">
    {groupedTickets.map(ticket => <KDSTicketCard key={ticket.orderId} ticket={ticket} />)}
  </div>
</div>
```

```css
.kds-layout {
  background: var(--bg);
  min-height: 100dvh;
  display: flex; flex-direction: column;
}
.kds-header {
  padding: 16px 24px;
  background: var(--s0);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 20px;
}
.kds-title { font-family: var(--f-disp); font-size: 26px; font-weight: 800; letter-spacing: 0.05em; }
.kds-time  { font-family: var(--f-mono); font-size: 22px; font-weight: 600; color: var(--text2); margin-left: auto; }
.kds-grid  {
  flex: 1; padding: 20px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  align-content: start;
  overflow-y: auto;
}
```

**Ticket Card — alta legibilidad:**
```css
.kds-card {
  background: var(--s1); border: 2px solid var(--border);
  border-radius: var(--r-lg); overflow: hidden;
  display: flex; flex-direction: column;
}
.kds-card-header {
  padding: 14px 16px;
  background: var(--s2);
  display: flex; align-items: center; justify-content: space-between;
}
.kds-table-name { font-family: var(--f-disp); font-size: 22px; font-weight: 800; }
.kds-elapsed    { font-family: var(--f-mono); font-size: 20px; font-weight: 600; }
/* Color del elapsed por urgencia */
.kds-elapsed.ok      { color: var(--green); }   /* < 10 min */
.kds-elapsed.warning { color: var(--amber); }   /* 10–20 min */
.kds-elapsed.urgent  { color: var(--red); animation: pulse-red 1s infinite; }  /* > 20 min */

@keyframes pulse-red {
  0%,100% { opacity: 1; }
  50%      { opacity: 0.5; }
}

.kds-items { padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.kds-item  {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: var(--r-sm);
  background: var(--s2); border: 1px solid var(--border);
  cursor: pointer; transition: all var(--t-fast);
}
.kds-item:active { transform: scale(0.98); }
.kds-item-qty  { font-family: var(--f-mono); font-size: 18px; font-weight: 700; color: var(--text2); width: 28px; }
.kds-item-name { flex: 1; font-size: 15px; font-weight: 500; }
.kds-item-mods { font-size: 12px; color: var(--text3); margin-top: 2px; }

/* Estado de item — borde izquierdo de color */
.kds-item.new      { border-left: 3px solid var(--amber); }
.kds-item.preparing{ border-left: 3px solid var(--blue); background: var(--blue-d); }
.kds-item.ready    { border-left: 3px solid var(--green); background: var(--green-d); opacity: 0.7; }
.kds-item-status   { font-family: var(--f-mono); font-size: 10px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase; }
```

**Botón Ticket Completo:**
```css
.kds-complete-btn {
  margin: 12px; padding: 14px;
  border-radius: var(--r-sm);
  background: var(--green); color: #050f08;
  font-family: var(--f-disp); font-size: 16px; font-weight: 800;
  letter-spacing: 0.05em; border: none; cursor: pointer;
  transition: all var(--t-mid);
}
.kds-complete-btn:disabled { background: var(--s3); color: var(--text3); cursor: default; }
```

**Modal de nuevo ticket (mantener lógica, actualizar estilos):**
```css
.kds-new-alert {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,0.85);
  display: flex; align-items: center; justify-content: center;
}
.kds-alert-box {
  background: var(--s1); border: 2px solid var(--green-m);
  border-radius: var(--r-xl); padding: 40px;
  text-align: center;
  box-shadow: 0 0 60px rgba(46,204,113,0.2);
  animation: alertPop 0.4s var(--t-slow);
}
@keyframes alertPop {
  from { transform: scale(0.7); opacity: 0; }
  to   { transform: scale(1);   opacity: 1; }
}
.kds-alert-count { font-family: var(--f-disp); font-size: 80px; font-weight: 800; color: var(--green); line-height: 1; }
.kds-alert-label { font-family: var(--f-disp); font-size: 24px; color: var(--text2); margin: 8px 0 24px; }
```

---

## MÓDULO 6 — POS / CAJA (pages/pos.tsx)

### Tabs principales (mantener 3 tabs: Mesas, Caja, Pagados)
```css
.pos-tabs {
  display: flex; gap: 4px; padding: 12px 18px 0;
  border-bottom: 1px solid var(--border);
}
.pos-tab {
  padding: 10px 18px; border-radius: var(--r-sm) var(--r-sm) 0 0;
  border: 1px solid transparent; border-bottom: none;
  background: transparent; color: var(--text3);
  font-family: var(--f-disp); font-size: 14px; font-weight: 700;
  transition: all var(--t-fast); cursor: pointer;
}
.pos-tab.active {
  background: var(--s1); border-color: var(--border);
  border-bottom-color: var(--s1); color: var(--green);
}
```

**Tab Mesas — Grid de órdenes abiertas:**
Misma lógica visual que TableCard de Mesas, pero con acciones de POS.
Cada card al tocar: abre panel lateral/modal con detalle completo de la orden.

**Panel de orden POS (lateral en desktop, bottom sheet en mobile):**
```jsx
<div className={`pos-order-panel ${selectedOrder ? 'open' : ''}`}>
  <div className="pop-header">
    <h2>{selectedOrder?.tableName}</h2>
    <button onClick={() => setSelectedOrder(null)}>✕</button>
  </div>
  <div className="pop-items">
    {/* lista de items con descuentos */}
  </div>
  <div className="pop-totals">
    {/* desglose igual que en table-detail */}
  </div>
  <div className="pop-actions">
    {canSplit && <button onClick={openSplit}>✂ Dividir</button>}
    {canPay   && <button onClick={openPay} className="btn-primary">💳 Cobrar</button>}
  </div>
</div>
```

```css
.pos-order-panel {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: var(--s0); border-top: 1px solid var(--border);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  padding: 20px 18px;
  transform: translateY(100%);
  transition: transform 0.35s cubic-bezier(.4,0,.2,1);
  z-index: 50; max-height: 85dvh; overflow-y: auto;
}
.pos-order-panel.open { transform: translateY(0); }
```

**Tab Caja:**
```jsx
{/* Estado de sesión */}
<div className="cash-session-card">
  <div className="csc-status">
    <span className={`badge ${cashSession?.isOpen ? 'badge-green' : 'badge-muted'}`}>
      {cashSession?.isOpen ? '● Sesión Abierta' : '○ Sesión Cerrada'}
    </span>
    <span className="csc-time">{cashSession?.openedAt}</span>
  </div>
  {cashSession?.isOpen && (
    <div className="csc-stats">
      <div className="csc-stat"><span>Apertura</span><span>{formatCurrency(cashSession.openingBalance)}</span></div>
      <div className="csc-stat"><span>Efectivo esperado</span><span>{formatCurrency(expectedCash)}</span></div>
    </div>
  )}
  <button className={`btn-primary ${cashSession?.isOpen ? 'btn-danger' : ''}`}
    onClick={cashSession?.isOpen ? openCloseSession : openOpenSession}>
    {cashSession?.isOpen ? '🔒 Cerrar Caja' : '🔓 Abrir Caja'}
  </button>
</div>
```

```css
.cash-session-card { background: var(--s1); border: 1.5px solid var(--border); border-radius: var(--r-md); padding: 16px; margin-bottom: 16px; }
.csc-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0; }
.csc-stat  { background: var(--s2); border-radius: var(--r-sm); padding: 10px 12px; }
.csc-stat span:first-child { display: block; font-family: var(--f-mono); font-size: 10px; color: var(--text3); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 4px; }
.csc-stat span:last-child  { font-family: var(--f-mono); font-size: 16px; font-weight: 600; color: var(--text); }
.btn-primary.btn-danger { background: var(--red); }
```

**Tab Pagados:**
```jsx
{paidOrders.map(order => (
  <div className="paid-order-item" key={order.id} onClick={() => openPaidDetail(order)}>
    <div className="poi-left">
      <div className="poi-ticket"># {order.ticketNumber}</div>
      <div className="poi-table">{order.tableName}</div>
    </div>
    <div className="poi-right">
      <div className="poi-amount">{formatCurrency(order.totalAmount)}</div>
      <div className="poi-method badge badge-muted">{order.paymentMethod}</div>
    </div>
  </div>
))}
```

```css
.paid-order-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px;
  background: var(--s1); border: 1px solid var(--border); border-radius: var(--r-sm);
  margin-bottom: 6px; cursor: pointer; transition: all var(--t-fast);
}
.paid-order-item:active { background: var(--s2); }
.poi-ticket { font-family: var(--f-mono); font-size: 11px; color: var(--text3); }
.poi-table  { font-family: var(--f-disp); font-size: 16px; font-weight: 700; margin-top: 2px; }
.poi-amount { font-family: var(--f-mono); font-size: 15px; font-weight: 600; color: var(--green); text-align: right; }
```

**PayDialog y SplitDialog:**
Ya rediseñados en `components/pos/pos-dialogs.css` — NO modificar, son la referencia de diseño del sistema.

---

## MÓDULO 7 — DASHBOARD GERENCIAL (pages/dashboard.tsx)

### Rediseño — orientado a MANAGER, puede ser desktop/tablet
Layout de 1 columna en mobile, 2-3 columnas en tablet+.

**Date picker sticky header:**
```jsx
<div className="dash-header">
  <h1 className="header-title">Dashboard</h1>
  <div className="dash-date-controls">
    <button className={`date-preset ${preset==='today' ? 'active' : ''}`} onClick={() => setDate(today)}>Hoy</button>
    <button className={`date-preset ${preset==='yesterday' ? 'active' : ''}`} onClick={() => setDate(yesterday)}>Ayer</button>
    <input type="date" className="field date-input" value={selectedDate} onChange={e => setDate(e.target.value)} />
  </div>
</div>
```

```css
.dash-header { padding: 14px 18px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.dash-date-controls { display: flex; gap: 6px; align-items: center; margin-left: auto; }
.date-preset {
  padding: 7px 14px; border-radius: 20px;
  border: 1px solid var(--border); background: var(--s2); color: var(--text3);
  font-family: var(--f-mono); font-size: 11px; cursor: pointer; transition: all var(--t-fast);
}
.date-preset.active { background: var(--green-d); border-color: var(--green-m); color: var(--green); }
.date-input { max-width: 140px; font-family: var(--f-mono); font-size: 12px; padding: 7px 10px; }
```

**KPI Cards (4 cards en grid):**
```jsx
<div className="kpi-grid">
  <KPICard icon="🟢" label="Órdenes Abiertas" value={data.openOrders.count} sub={formatCurrency(data.openOrders.amount)} color="green" />
  <KPICard icon="✅" label="Pagadas" value={data.paidOrders.count} sub={formatCurrency(data.paidOrders.amount)} color="blue" />
  <KPICard icon="❌" label="Canceladas" value={data.cancelledOrders.count} sub={formatCurrency(data.cancelledOrders.amount)} color="red" />
  <KPICard icon="🏷" label="Descuentos" value={formatCurrency(data.totalDiscounts)} color="amber" />
</div>
```

```css
.kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 0 18px 14px; }
@media (min-width: 768px) { .kpi-grid { grid-template-columns: repeat(4, 1fr); } }

.kpi-card {
  background: var(--s1); border: 1.5px solid var(--border);
  border-radius: var(--r-md); padding: 14px;
  display: flex; flex-direction: column; gap: 6px;
}
.kpi-icon  { font-size: 20px; }
.kpi-value { font-family: var(--f-mono); font-size: 22px; font-weight: 600; color: var(--text); }
.kpi-label { font-family: var(--f-mono); font-size: 10px; color: var(--text3); letter-spacing: 0.08em; text-transform: uppercase; }
.kpi-sub   { font-family: var(--f-mono); font-size: 12px; color: var(--text2); }
/* Border top por color */
.kpi-card.green { border-top: 3px solid var(--green); }
.kpi-card.blue  { border-top: 3px solid var(--blue); }
.kpi-card.red   { border-top: 3px solid var(--red); }
.kpi-card.amber { border-top: 3px solid var(--amber); }
```

**Sección métodos de pago:**
```jsx
<div className="dash-section">
  <div className="section-label">Métodos de Pago</div>
  {Object.entries(data.paymentMethodTotals).map(([method, amount]) => (
    <div className="payment-row" key={method}>
      <span className="pr-method">{method}</span>
      <div className="pr-bar-wrap">
        <div className="pr-bar" style={{width: `${(amount/maxPayment)*100}%`}} />
      </div>
      <span className="pr-amount">{formatCurrency(amount)}</span>
    </div>
  ))}
</div>
```

```css
.dash-section { padding: 0 18px 20px; }
.payment-row  { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.pr-method    { font-family: var(--f-mono); font-size: 11px; color: var(--text3); width: 70px; text-transform: uppercase; letter-spacing: 0.06em; }
.pr-bar-wrap  { flex: 1; height: 6px; background: var(--s3); border-radius: 4px; overflow: hidden; }
.pr-bar       { height: 100%; background: var(--green); border-radius: 4px; transition: width 0.8s ease; }
.pr-amount    { font-family: var(--f-mono); font-size: 12px; color: var(--text); width: 80px; text-align: right; }
```

**Top Productos (tabla simple):**
```css
.top-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
.top-table th { font-family: var(--f-mono); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text3); padding: 6px 0; border-bottom: 1px solid var(--border); text-align: left; }
.top-table td { padding: 9px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
.top-table tr:last-child td { border-bottom: none; }
.top-table td:last-child { font-family: var(--f-mono); color: var(--green); text-align: right; }
```

**Items anulados — collapsible:**
```jsx
<details className="voided-section">
  <summary className="voided-summary">
    🚫 Items Anulados · {data.voidedItemsSummary.count} items · {formatCurrency(data.voidedItemsSummary.amount)}
  </summary>
  <div className="voided-list">
    {data.voidedItemsSummary.items.map(item => (
      <div className="voided-item" key={item.id}>
        <span>{item.productName} ×{item.qty}</span>
        <span style={{color:'var(--text3)'}}>{item.voidedBy} · {item.reason}</span>
        <span style={{color:'var(--red)'}}>{formatCurrency(item.amount)}</span>
      </div>
    ))}
  </div>
</details>
```

```css
.voided-section { background: var(--s1); border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; margin: 0 18px 16px; }
.voided-summary { padding: 14px 16px; cursor: pointer; font-family: var(--f-disp); font-size: 14px; font-weight: 700; list-style: none; display: flex; align-items: center; gap: 8px; }
.voided-summary::-webkit-details-marker { display: none; }
.voided-item { display: flex; justify-content: space-between; padding: 8px 16px; border-top: 1px solid var(--border); font-size: 12px; flex-wrap: wrap; gap: 6px; }
```

---

## MÓDULO 8 — QR CLIENTE (pages/qr-client.tsx)

### Contexto especial
Esta pantalla es para el CLIENTE FINAL, no para staff. Debe ser:
- Amigable, warm, accesible (no tan oscura/industrial como las demás)
- Instrucciones claras en cada paso
- Botones muy grandes (dedos gordos, primera vez usando la app)
- Funcionar sin auth (ruta pública /qr/:tableCode)

### Paleta QR (diferente al resto — más amigable)
```css
/* Override de tokens SOLO para .qr-page */
.qr-page {
  --qr-bg:    #0d1117;
  --qr-s1:    #161d26;
  --qr-s2:    #1c2535;
  --qr-accent: #22c55e;
  --qr-text:  #e8edf3;
  --qr-sub:   #6b7fa0;
  background: var(--qr-bg);
  min-height: 100dvh;
  font-family: var(--f-body);
  color: var(--qr-text);
}
```

**Step layout (EasyStepLayout):**
```jsx
<div className="qr-page">
  {/* Sticky header con progreso */}
  <div className="qr-header">
    {currentStep > 0 && <button className="qr-back" onClick={goBack}>‹</button>}
    <div className="qr-progress">
      {steps.map((_, i) => (
        <div key={i} className={`qr-dot ${i <= currentStep ? 'done' : ''}`} />
      ))}
    </div>
    <div className="qr-table-chip">{tableName}</div>
  </div>

  {/* Contenido del paso */}
  <div className="qr-content">
    {renderCurrentStep()}
  </div>

  {/* Sticky footer con CTA */}
  <div className="qr-footer">
    <button className="qr-cta" onClick={nextStep} disabled={!canProceed}>
      {ctaLabel}
    </button>
  </div>
</div>
```

```css
.qr-header { position: sticky; top: 0; z-index: 10; padding: 16px 20px; background: var(--qr-bg); display: flex; align-items: center; gap: 12px; }
.qr-back   { width: 40px; height: 40px; border-radius: 50%; background: var(--qr-s2); border: none; color: var(--qr-text); font-size: 22px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.qr-progress { display: flex; gap: 6px; flex: 1; justify-content: center; }
.qr-dot    { width: 8px; height: 8px; border-radius: 50%; background: var(--qr-s2); transition: all 0.3s ease; }
.qr-dot.done { background: var(--qr-accent); }
.qr-table-chip { background: var(--qr-s2); padding: 5px 12px; border-radius: 20px; font-family: var(--f-mono); font-size: 11px; color: var(--qr-sub); }

.qr-content { padding: 0 20px; flex: 1; }
.qr-footer  { position: sticky; bottom: 0; padding: 16px 20px; background: linear-gradient(to top, var(--qr-bg) 80%, transparent); }

.qr-cta {
  width: 100%; padding: 16px;
  border-radius: var(--r-md);
  background: var(--qr-accent); color: #050f08;
  font-family: var(--f-disp); font-size: 18px; font-weight: 800;
  letter-spacing: 0.04em; border: none; cursor: pointer;
  transition: all var(--t-mid);
}
.qr-cta:disabled { background: var(--qr-s2); color: var(--qr-sub); cursor: not-allowed; }
.qr-cta:active:not(:disabled) { transform: scale(0.98); }
```

**Step: Welcome**
```jsx
<div className="qr-welcome">
  <div className="qr-welcome-emoji">👋</div>
  <h1 className="qr-welcome-title">¡Bienvenido!</h1>
  <p className="qr-welcome-sub">Estás en <strong>{tableName}</strong></p>
  <p className="qr-welcome-desc">Puedes ordenar desde aquí o ver el menú</p>
</div>
```

**Step: Nombre**
```jsx
<div className="qr-name-step">
  <h2 className="qr-step-title">¿Cómo te llamas?</h2>
  <p className="qr-step-sub">Para identificar tu pedido</p>
  <input className="qr-name-input" type="text" placeholder="Tu nombre..."
    value={name} onChange={e => setName(e.target.value)}
    autoFocus maxLength={40} />
</div>
```

```css
.qr-step-title { font-family: var(--f-disp); font-size: 26px; font-weight: 800; margin-bottom: 6px; }
.qr-step-sub   { color: var(--qr-sub); font-size: 14px; margin-bottom: 24px; }
.qr-name-input {
  width: 100%; padding: 16px; font-size: 18px;
  background: var(--qr-s2); border: 2px solid transparent;
  border-radius: var(--r-md); color: var(--qr-text); outline: none;
  transition: border-color 0.2s;
}
.qr-name-input:focus { border-color: var(--qr-accent); }
```

**Modo Fácil — Big Category Buttons:**
```jsx
<div className="qr-big-cats">
  {categories.map(cat => (
    <button key={cat.id} className="qr-big-cat" onClick={() => selectCat(cat.id)}>
      <span className="qbc-icon">{cat.icon}</span>
      <span className="qbc-name">{cat.name}</span>
      <span className="qbc-count">{cat.productCount} opciones</span>
    </button>
  ))}
</div>
```

```css
.qr-big-cats { display: flex; flex-direction: column; gap: 10px; padding: 8px 0; }
.qr-big-cat  {
  display: flex; align-items: center; gap: 16px;
  padding: 18px 16px;
  background: var(--qr-s1); border: 1.5px solid var(--qr-s2);
  border-radius: var(--r-md); cursor: pointer;
  transition: all var(--t-mid); width: 100%; text-align: left;
}
.qr-big-cat:active { border-color: var(--qr-accent); background: rgba(34,197,94,0.08); }
.qbc-icon  { font-size: 32px; flex-shrink: 0; }
.qbc-name  { font-family: var(--f-disp); font-size: 20px; font-weight: 700; flex: 1; }
.qbc-count { font-family: var(--f-mono); font-size: 11px; color: var(--qr-sub); }
```

**Resumen antes de enviar:**
```jsx
<div className="qr-review">
  <h2 className="qr-step-title">Tu pedido</h2>
  {cart.map(item => (
    <div className="qr-review-item" key={item.cartKey}>
      <span className="qri-qty">×{item.qty}</span>
      <span className="qri-name">{item.productName}</span>
      <span className="qri-price">{formatCurrency(item.unitPrice * item.qty)}</span>
    </div>
  ))}
  <div className="qr-review-total">
    <span>Total estimado</span>
    <span>{formatCurrency(cartTotal)}</span>
  </div>
</div>
```

---

## NAVEGACIÓN LATERAL — AppSidebar

### Rediseño del sidebar (components/app-sidebar.tsx)
El sidebar debe adaptarse al nuevo sistema dark:

```css
/* Override de shadcn sidebar */
[data-sidebar="sidebar"] {
  background: var(--s0) !important;
  border-right: 1px solid var(--border) !important;
}
[data-sidebar="menu-button"] {
  border-radius: var(--r-sm) !important;
  font-family: var(--f-body) !important;
  font-size: 14px !important;
  color: var(--text2) !important;
  transition: all var(--t-fast) !important;
}
[data-sidebar="menu-button"]:hover {
  background: var(--s2) !important;
  color: var(--text) !important;
}
[data-sidebar="menu-button"][data-active="true"] {
  background: var(--green-d) !important;
  color: var(--green) !important;
  border-left: 2px solid var(--green) !important;
}
```

---

## ANIMACIONES GLOBALES

Añadir a index.css:

```css
/* Entrada de pantallas */
@keyframes slideUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
.page-enter { animation: slideUp 0.28s ease both; }

/* Entrada de cards en stagger */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.stagger-children > * {
  animation: fadeIn 0.25s ease both;
}
.stagger-children > *:nth-child(1) { animation-delay: 0.04s; }
.stagger-children > *:nth-child(2) { animation-delay: 0.08s; }
.stagger-children > *:nth-child(3) { animation-delay: 0.12s; }
.stagger-children > *:nth-child(4) { animation-delay: 0.16s; }
.stagger-children > *:nth-child(5) { animation-delay: 0.20s; }
.stagger-children > *:nth-child(n+6) { animation-delay: 0.24s; }

/* Loading skeleton */
@keyframes shimmer {
  from { background-position: -200% center; }
  to   { background-position: 200% center; }
}
.skeleton {
  background: linear-gradient(90deg, var(--s2) 25%, var(--s3) 50%, var(--s2) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--r-sm);
}

/* Flash de éxito */
@keyframes flash-success {
  0%   { box-shadow: 0 0 0 0 rgba(46,204,113,0); }
  30%  { box-shadow: 0 0 0 8px rgba(46,204,113,0.4); }
  100% { box-shadow: 0 0 0 16px rgba(46,204,113,0); }
}
.flash-green { animation: flash-success 0.7s ease; }

/* Error shake */
@keyframes shake {
  0%,100% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-6px); }
  80% { transform: translateX(6px); }
}
.shake { animation: shake 0.4s ease; }
```

---

## FORMATOS Y UTILIDADES

```typescript
// Reemplazar todos los formateos de moneda en el sistema con:
export const formatCurrency = (amount: number | string): string => {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  return `₡${n.toLocaleString('es-CR')}`;
};

// Tiempo relativo (usar en mesas, órdenes)
export const timeAgo = (dateStr: string): string => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
};

// Color por estado de orden
export const getStatusColor = (status: string): string => ({
  OPEN:       'var(--green)',
  IN_KITCHEN: 'var(--blue)',
  PREPARING:  'var(--amber)',
  READY:      'var(--green)',
  PAID:       'var(--text3)',
  CANCELLED:  'var(--red)',
  VOID:       'var(--red)',
})[status] ?? 'var(--text3)';

// Label español de estado
export const getStatusLabel = (status: string): string => ({
  OPEN:       'Abierta',
  IN_KITCHEN: 'En Cocina',
  PREPARING:  'Preparando',
  READY:      'Lista',
  PAID:       'Pagada',
  CANCELLED:  'Cancelada',
  VOID:       'Anulada',
})[status] ?? status;
```

---

## LOADING STATES

Reemplazar todos los spinners genéricos con skeleton screens:

```jsx
// Skeleton para tabla de mesas
export function TablesSkeleton() {
  return (
    <div className="tables-grid">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="table-card" style={{opacity: 0.5}}>
          <div className="skeleton" style={{height:20, width:60, marginBottom:8}} />
          <div className="skeleton" style={{height:16, width:90, marginBottom:12}} />
          <div className="skeleton" style={{height:12, width:100}} />
          <div className="skeleton" style={{height:12, width:80, marginTop:4}} />
        </div>
      ))}
    </div>
  );
}
```

---

## CHECKLIST DE IMPLEMENTACIÓN

### Fase 0 — Setup (30 min)
- [ ] Añadir Google Fonts link a index.html
- [ ] Añadir todos los design tokens a index.css :root
- [ ] Crear archivo `src/styles/design-system.css` con todos los componentes base (.btn-primary, .badge, .card, .field, etc.)
- [ ] Importar design-system.css en main.tsx
- [ ] Añadir funciones utilitarias (formatCurrency, timeAgo, getStatusColor, getStatusLabel) a `src/lib/utils.ts`

### Fase 1 — Pantallas de operación diaria (Meseros)
- [ ] pin-login.tsx — nuevo PIN pad circular
- [ ] tables.tsx — cards con estado + grid libre
- [ ] table-detail.tsx — tabs + bottom bar + rondas
- [ ] (menu inline) — top cats + sub cats + product grid + FAB
- [ ] Animaciones de transición entre pantallas

### Fase 2 — Pantallas de servicio (Cocina + POS)
- [ ] kds.tsx — grid desktop + cards alta legibilidad + elapsed timer colors
- [ ] kds-bar.tsx — igual que kds pero reutilizado
- [ ] pos.tsx — tabs + order panel bottom sheet + cash session card + paid list

### Fase 3 — Gerencia + QR
- [ ] dashboard.tsx — KPI grid + payment bars + top products + voided collapsible
- [ ] qr-client.tsx — paleta warm + step layout + big category buttons

### Fase 4 — Polish
- [ ] Skeleton screens en todos los loading states
- [ ] Stagger animations en lists de cards
- [ ] Verificar touch targets ≥ 48px en todos los elementos interactivos
- [ ] Test visual en iPhone 12/13/14 (390px)
- [ ] Test visual en iPad (768px)
- [ ] Verificar que sidebar shadcn respeta los overrides CSS

---

## ARCHIVOS DE REFERENCIA VISUALES

El directorio de outputs contiene:
- `pos-redesign-screens.html` → Prototipo interactivo de Mesas + Detalle + Menú + Carrito + Transferir
- `pos-unified-responsive.html` → Prototipo de PayDialog + SplitDialog responsive
- `pos-unified-dialog.html` → Versión desktop de los diálogos

Si hay conflicto entre este texto y los prototipos HTML, **los prototipos HTML tienen prioridad visual**.
