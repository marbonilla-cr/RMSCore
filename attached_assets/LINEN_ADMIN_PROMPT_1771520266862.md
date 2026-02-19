# PROMPT COMPLEMENTARIO — MÓDULOS ADMINISTRATIVOS SISTEMA LINEN
# Para Replit Agent
# PREREQUISITO: LINEN_SYSTEM_PROMPT.md ya debe estar aplicado y funcionando.

---

## CONTEXTO Y FILOSOFÍA

El sistema ya tiene Linen aplicado en las pantallas operativas (Mesas, KDS, POS, QR, Dashboard).
Este prompt cubre TODO lo que quedó sin estilo unificado.

**Regla absoluta para este prompt:**
Las pantallas administrativas deben ser funcionales y consistentes, NO decorativas.
- ✅ Misma paleta de colores Linen (tokens ya definidos en `tokens.css`)
- ✅ Misma tipografía (Outfit, IBM Plex Sans, IBM Plex Mono)
- ✅ Mismos componentes base (cards, badges, inputs, botones)
- ❌ Sin animaciones de entrada
- ❌ Sin gradientes decorativos
- ❌ Sin sombras elaboradas
- ❌ Sin reestructurar layouts que ya funcionan

**Nota crítica sobre PayDialog/SplitDialog:**
Estos componentes tienen su propio CSS (`pos-dialogs.css`) con tokens dark propios.
Solo migrar sus colores de fondo/superficie a tokens Linen. Sus animaciones, layout
responsivo (mobile bottom-sheet, tablet 2-col, desktop 3-col) y lógica NO se tocan.

**NO tocar en ningún archivo:**
- Lógica de negocio, endpoints, mutations, queries
- Validaciones Zod, permisos, RBAC
- Sistema de subaccounts (max 6 por mesa)
- WAC calculations, lifecycle de faltantes
- Animaciones existentes en PayDialog/SplitDialog (pos-vibrate, pos-flash-success)

---

## PASO 1 — CREAR `src/styles/admin.css`

Este archivo contiene todos los componentes reutilizables para las pantallas admin.
Importar en `main.tsx` DESPUÉS de `components.css`.

```css
/* ════════════════════════════════════════
   LINEN ADMIN — admin.css
   Componentes para pantallas back-office
   Simple, funcional, consistente.
   ════════════════════════════════════════ */

/* ── Wrapper de página ── */
.admin-page {
  padding: 20px 24px;
  max-width: 1200px;
  margin: 0 auto;
}
@media (max-width: 640px) {
  .admin-page { padding: 14px 16px; }
}

/* ── Header de página ── */
.admin-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.admin-page-title {
  font-family: var(--f-disp);
  font-size: 22px;
  font-weight: 800;
  color: var(--text);
  line-height: 1.1;
}
.admin-page-sub {
  font-family: var(--f-mono);
  font-size: 11px;
  color: var(--text3);
  letter-spacing: 0.07em;
  margin-top: 3px;
}

/* ── Toolbar (search + filtros + acciones) ── */
.admin-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.admin-search {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--s1);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 8px 12px;
  min-width: 180px;
  flex: 1;
  max-width: 300px;
  transition: border-color var(--t-fast);
}
.admin-search:focus-within {
  border-color: var(--acc);
}
.admin-search input {
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-family: var(--f-body);
  font-size: 13px;
  width: 100%;
}
.admin-search input::placeholder { color: var(--text3); }
.admin-search-icon { color: var(--text3); font-size: 14px; flex-shrink: 0; }

/* ── Filter chips (tabs de filtro inline) ── */
.filter-chips {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
.filter-chip {
  padding: 5px 12px;
  border-radius: 20px;
  border: 1px solid var(--border);
  background: var(--s1);
  color: var(--text3);
  font-family: var(--f-mono);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--t-fast);
  white-space: nowrap;
  user-select: none;
}
.filter-chip:hover { border-color: var(--border2); color: var(--text2); }
.filter-chip.active {
  background: var(--acc-d);
  border-color: var(--acc-m);
  color: var(--acc);
}

/* ── Tabla de datos ── */
.admin-table-wrap {
  background: var(--s0);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  overflow: hidden;
  overflow-x: auto;
}
.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.admin-table th {
  background: var(--s1);
  border-bottom: 1px solid var(--border);
  padding: 9px 14px;
  text-align: left;
  font-family: var(--f-mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--text3);
  white-space: nowrap;
}
.admin-table th.sortable { cursor: pointer; user-select: none; }
.admin-table th.sortable:hover { color: var(--text2); }
.admin-table th.sorted { color: var(--acc); }
.admin-table th.num { text-align: right; }

.admin-table td {
  padding: 9px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  vertical-align: middle;
}
.admin-table tr:last-child td { border-bottom: none; }
.admin-table tr:hover td { background: var(--s1); }
.admin-table td.mono {
  font-family: var(--f-mono);
  font-size: 12px;
  color: var(--text2);
}
.admin-table td.num {
  font-family: var(--f-mono);
  font-size: 12px;
  text-align: right;
}
.admin-table td.actions {
  width: 1%;
  white-space: nowrap;
  text-align: right;
}

/* ── Botones de acción en tabla ── */
.tbl-btn {
  padding: 4px 10px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: var(--s1);
  color: var(--text2);
  font-family: var(--f-body);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--t-fast);
  margin-left: 4px;
}
.tbl-btn:hover { background: var(--s2); color: var(--text); }
.tbl-btn.primary {
  border-color: var(--acc-m);
  color: var(--acc);
}
.tbl-btn.primary:hover { background: var(--acc-d); }
.tbl-btn.danger {
  border-color: var(--red-m);
  color: var(--red);
}
.tbl-btn.danger:hover { background: var(--red-d); }
.tbl-btn.coral {
  border-color: var(--coral-m);
  color: var(--coral);
}
.tbl-btn.coral:hover { background: var(--coral-d); }

/* ── Form grid dentro de dialogs ── */
.admin-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 640px) {
  .admin-form-grid { grid-template-columns: 1fr; }
}
.admin-form-grid.full { grid-template-columns: 1fr; }
.admin-form-field { display: flex; flex-direction: column; gap: 5px; }

/* ── Accordion (para modifiers, recetas) ── */
.admin-accordion-item {
  background: var(--s0);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  margin-bottom: 6px;
  overflow: hidden;
}
.admin-accordion-trigger {
  width: 100%; padding: 11px 14px;
  display: flex; align-items: center; gap: 10px;
  background: transparent; border: none;
  cursor: pointer; text-align: left;
  font-family: var(--f-body); font-size: 13px; font-weight: 600;
  color: var(--text); transition: background var(--t-fast);
}
.admin-accordion-trigger:hover { background: var(--s1); }
.admin-accordion-arrow {
  margin-left: auto; color: var(--text3); font-size: 11px;
  transition: transform var(--t-fast);
}
.admin-accordion-item.open .admin-accordion-arrow { transform: rotate(180deg); }
.admin-accordion-content {
  padding: 10px 14px 14px;
  border-top: 1px solid var(--border);
  background: var(--s1);
}
.admin-accordion-sub-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px;
  background: var(--s0); border: 1px solid var(--border);
  border-radius: var(--r-xs); margin-bottom: 5px; font-size: 13px;
}
.admin-accordion-sub-item:last-child { margin-bottom: 0; }

/* ── Empty state ── */
.admin-empty {
  text-align: center;
  padding: 40px 24px;
  color: var(--text3);
}
.admin-empty-icon { font-size: 32px; margin-bottom: 10px; opacity: 0.45; }
.admin-empty-title { font-size: 13px; font-weight: 600; color: var(--text3); }
.admin-empty-sub { font-size: 11px; color: var(--text4); margin-top: 3px; }

/* ── Zona de peligro (business-config) ── */
.danger-zone {
  background: var(--red-d);
  border: 1px solid var(--red-m);
  border-left: 3px solid var(--red);
  border-radius: var(--r-sm);
  padding: 14px 16px;
  margin-top: 24px;
}
.danger-zone-title {
  font-family: var(--f-mono);
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--red); margin-bottom: 6px;
}
.danger-zone-desc {
  font-size: 12px; color: var(--text2); margin-bottom: 12px; line-height: 1.5;
}

/* ── Matriz de permisos (roles.tsx) ── */
.permissions-matrix {
  background: var(--s0);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  overflow: auto;
}
.permissions-matrix table {
  width: 100%; border-collapse: collapse; min-width: 560px;
}
.permissions-matrix th {
  background: var(--s1); padding: 9px 10px;
  font-family: var(--f-mono); font-size: 9px; font-weight: 600;
  letter-spacing: 0.10em; text-transform: uppercase; color: var(--text3);
  border-bottom: 1px solid var(--border); text-align: center; white-space: nowrap;
}
.permissions-matrix th:first-child { text-align: left; min-width: 180px; }
.permissions-matrix th.dirty { color: var(--acc); }
.permissions-matrix td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  text-align: center; vertical-align: middle;
}
.permissions-matrix td:first-child {
  text-align: left; font-size: 12px; color: var(--text2);
}
.permissions-matrix tr:last-child td { border-bottom: none; }
.permissions-matrix tr:hover td { background: var(--s1); }
.permissions-matrix tr.group-hdr td {
  background: var(--s1);
  font-family: var(--f-mono); font-size: 9px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase; color: var(--text3);
  padding: 6px 10px; border-top: 1px solid var(--border);
}

/* ── Color swatches (categories.tsx — selector de color TOP) ── */
.color-swatch-row {
  display: flex; gap: 7px; flex-wrap: wrap;
}
.color-swatch {
  width: 26px; height: 26px; border-radius: 50%;
  border: 2px solid transparent; cursor: pointer;
  transition: transform var(--t-fast);
  position: relative; flex-shrink: 0;
}
.color-swatch:hover { transform: scale(1.12); }
.color-swatch.active {
  border-color: var(--text);
  box-shadow: 0 0 0 2px var(--bg);
}
.color-swatch.active::after {
  content: '✓';
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 12px; font-weight: 700;
}

/* ── Status badges para flujos de estado ── */
.badge-draft    { background: var(--s2);      color: var(--text3); border: 1px solid var(--border); }
.badge-sent     { background: var(--acc-d);   color: var(--acc);   border: 1px solid var(--acc-m); }
.badge-partial  { background: var(--amber-d); color: var(--amber); border: 1px solid var(--amber-m); }
.badge-received { background: var(--sage-d);  color: var(--sage);  border: 1px solid var(--sage-m); }
.badge-cancelled{ background: var(--red-d);   color: var(--red);   border: 1px solid var(--red-m); }
.badge-open-sh  { background: var(--coral-d); color: var(--coral); border: 1px solid var(--coral-m); }
.badge-ack      { background: var(--amber-d); color: var(--amber); border: 1px solid var(--amber-m); }
.badge-resolved { background: var(--sage-d);  color: var(--sage);  border: 1px solid var(--sage-m); }
.badge-closed   { background: var(--s2);      color: var(--text3); border: 1px solid var(--border); }
.badge-finalized{ background: var(--sage-d);  color: var(--sage);  border: 1px solid var(--sage-m); }

/* Stock */
.badge-stock-ok   { background: var(--sage-d);  color: var(--sage);  border: 1px solid var(--sage-m); }
.badge-stock-low  { background: var(--amber-d); color: var(--amber); border: 1px solid var(--amber-m); }
.badge-stock-none { background: var(--red-d);   color: var(--red);   border: 1px solid var(--red-m); }

/* Severity faltantes */
.badge-sev-low    { background: var(--amber-d); color: var(--amber); border: 1px solid var(--amber-m); }
.badge-sev-no     { background: var(--red-d);   color: var(--red);   border: 1px solid var(--red-m); }
.badge-sev-urgent { background: var(--red-d);   color: var(--red);   border: 1px solid var(--red-m); font-weight: 700; }

/* ── Delta en conteos físicos ── */
.delta-pos  { color: var(--sage);  font-family: var(--f-mono); font-size: 12px; font-weight: 600; }
.delta-neg  { color: var(--red);   font-family: var(--f-mono); font-size: 12px; font-weight: 600; }
.delta-zero { color: var(--text4); font-family: var(--f-mono); font-size: 12px; }

/* ── Timeline de eventos (shortages) ── */
.event-timeline { padding: 4px 0; }
.timeline-item {
  display: flex; gap: 10px;
  padding: 5px 0; position: relative;
}
.timeline-item:not(:last-child)::before {
  content: '';
  position: absolute; left: 5px; top: 18px; bottom: -5px;
  width: 1px; background: var(--border);
}
.timeline-dot {
  width: 11px; height: 11px; border-radius: 50%;
  border: 2px solid var(--border2); background: var(--s0);
  flex-shrink: 0; margin-top: 3px;
}
.timeline-dot.acc   { border-color: var(--acc);   background: var(--acc-d); }
.timeline-dot.sage  { border-color: var(--sage);  background: var(--sage-d); }
.timeline-dot.amber { border-color: var(--amber); background: var(--amber-d); }
.timeline-dot.coral { border-color: var(--coral); background: var(--coral-d); }
.timeline-content   { flex: 1; font-size: 12px; color: var(--text2); line-height: 1.4; }
.timeline-time      { font-family: var(--f-mono); font-size: 10px; color: var(--text3); margin-top: 1px; }

/* ── Historial de movimientos de inventario ── */
.movement-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.movement-row:last-child { border-bottom: none; }
.movement-qty     { font-family: var(--f-mono); font-size: 13px; font-weight: 600; min-width: 60px; }
.movement-qty.in  { color: var(--sage); }
.movement-qty.out { color: var(--red); }
.movement-date    { font-family: var(--f-mono); font-size: 10px; color: var(--text3); margin-left: auto; }

/* ── Schedule grid — HR horarios ── */
.schedule-grid {
  display: grid;
  grid-template-columns: 130px repeat(7, 1fr);
  gap: 3px;
}
.schedule-header-cell {
  font-family: var(--f-mono); font-size: 9px; font-weight: 600;
  letter-spacing: 0.10em; text-transform: uppercase; color: var(--text3);
  text-align: center; padding: 6px 3px;
  background: var(--s1); border: 1px solid var(--border);
  border-radius: var(--r-xs);
}
.schedule-header-cell.today {
  color: var(--acc); border-color: var(--acc-m); background: var(--acc-d);
}
.schedule-name-cell {
  font-size: 12px; font-weight: 500; color: var(--text);
  display: flex; align-items: center;
  padding: 5px 8px;
  background: var(--s0); border: 1px solid var(--border);
  border-radius: var(--r-xs);
}
.schedule-day-cell {
  background: var(--s0); border: 1px solid var(--border);
  border-radius: var(--r-xs); padding: 4px;
  text-align: center; font-family: var(--f-mono); font-size: 9px; color: var(--text2);
}
.schedule-day-cell.has-schedule {
  border-color: var(--acc-m); background: var(--acc-d); color: var(--acc);
}
.schedule-day-cell.day-off {
  background: var(--s1); color: var(--text4);
  font-size: 8px; letter-spacing: 0.06em; text-transform: uppercase;
}

/* ── Timer de turno HR ── */
.turno-clock {
  font-family: var(--f-mono);
  font-size: 48px; font-weight: 600;
  color: var(--acc); text-align: center;
  letter-spacing: 0.06em; padding: 20px 0;
  line-height: 1;
}
.turno-clock.inactive { color: var(--text3); }

/* ── Heatmap Sales Cube ── */
.heatmap-table { border-collapse: separate; border-spacing: 3px; }
.heatmap-label {
  font-family: var(--f-mono); font-size: 9px; color: var(--text3);
  text-align: center; padding: 3px 4px;
  letter-spacing: 0.07em; text-transform: uppercase; white-space: nowrap;
}
.heatmap-cell {
  padding: 6px 4px; text-align: center;
  font-family: var(--f-mono); font-size: 10px;
  border-radius: var(--r-xs); min-width: 32px;
  /* Usar inline style: background-color: rgba(29,78,216,{intensity})
     donde intensity = valor/maxValor, mínimo 0.08, máximo 1.0
     color de texto: intensity > 0.55 ? '#fff' : 'var(--text)' */
}
.heatmap-cell.zero { background: var(--s2); color: var(--text4); }

/* ── Cube summary metadata ── */
.cube-meta {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
  margin-bottom: 14px;
}
@media (max-width: 640px) { .cube-meta { grid-template-columns: repeat(2, 1fr); } }
.cube-meta-item {
  background: var(--s1); border: 1px solid var(--border);
  border-radius: var(--r-sm); padding: 10px 12px;
}
.cube-meta-label {
  font-family: var(--f-mono); font-size: 9px; color: var(--text3);
  letter-spacing: 0.10em; text-transform: uppercase; margin-bottom: 4px;
}
.cube-meta-value {
  font-family: var(--f-mono); font-size: 17px; font-weight: 600; color: var(--text);
}
```

---

## PASO 2 — IMPORTAR EN `main.tsx`

```typescript
import './styles/tokens.css'      // 1. Tokens Linen — ya existía
import './styles/components.css'  // 2. Componentes operativos — ya existía
import './styles/admin.css'       // 3. NUEVO — añadir esta línea
import './index.css'               // 4. Globales — ya existía
```

---

## PASO 3 — MIGRAR `pos-dialogs.css` A TOKENS LINEN

El archivo `client/src/components/pos/pos-dialogs.css` tiene su propio sistema
de tokens dark completamente funcional. Solo cambiar los valores de color.

NO tocar: breakpoints responsivos, transforms, animaciones `pos-vibrate` y
`pos-flash-success`, la lógica de panels con translateX, el drag handle.

Hacer búsqueda y reemplazo EXACTO:

```
/* Fondos */
#0a0c0f    →  var(--bg)
#111318    →  var(--s0)
#141920    →  var(--s0)
#181c22    →  var(--s0)
#1a2030    →  var(--s1)
#1f242d    →  var(--s1)
#202840    →  var(--s2)
#262c38    →  var(--s2)
#2a3040    →  var(--border)
#2e3a54    →  var(--border2)
#333d50    →  var(--border2)

/* Verde → azul marino (acento principal Linen) */
#2ecc71                  →  var(--acc)
rgba(46,204,113,0.10)    →  var(--acc-d)
rgba(46,204,113,0.22)    →  var(--acc-m)
rgba(46,204,113,0.25)    →  var(--acc-m)
rgba(46,204,113,0.30)    →  var(--acc-m)
rgba(46,204,113,0.35)    →  var(--acc-t)

/* Amber */
#f39c12                  →  var(--amber)
rgba(243,156,18,0.10)    →  var(--amber-d)
rgba(243,156,18,0.12)    →  var(--amber-d)
rgba(243,156,18,0.30)    →  var(--amber-m)

/* Azul → acc también */
#3498db                  →  var(--acc)
#3b82f6                  →  var(--acc)
rgba(52,152,219,0.10)    →  var(--acc-d)
rgba(59,130,246,0.10)    →  var(--acc-d)
rgba(59,130,246,0.12)    →  var(--acc-d)

/* Rojo */
#e74c3c                  →  var(--red)
#ef4444                  →  var(--red)
rgba(231,76,60,0.10)     →  var(--red-d)
rgba(239,68,68,0.10)     →  var(--red-d)
rgba(239,68,68,0.12)     →  var(--red-d)

/* Texto */
#f0f2f5                  →  var(--text)
#eef0f4                  →  var(--text)
#8494b0                  →  var(--text2)
#8a95a8                  →  var(--text2)
#3d4f6b                  →  var(--text3)
#4a5568                  →  var(--text3)
#232e42                  →  var(--text4)

/* IMPORTANTE:
   - NO reemplazar #050f08 (texto sobre botones de acento)
   - Los 3 métodos de pago quedan así:
     CASH  → var(--sage)   (verde sage Linen, reemplazar el verde anterior)
     CARD  → var(--acc)    (azul marino)
     SINPE → var(--amber)  (ámbar, igual que antes)
   Buscar las variables --method-cash, --method-card, --method-sinpe
   en pos-dialogs.css y actualizar sus valores a los de arriba.         */
```

---

## PASO 4 — TOASTS Y NOTIFICACIONES

Añadir al final de `src/index.css`:

```css
/* shadcn/Sonner toasts — tokens Linen */
[data-sonner-toast][data-type="error"],
[data-sonner-toast][data-type="destructive"] {
  background: var(--red-d) !important;
  border: 1px solid var(--red-m) !important;
  color: var(--red) !important;
}
[data-sonner-toast][data-type="success"] {
  background: var(--sage-d) !important;
  border: 1px solid var(--sage-m) !important;
  color: var(--sage) !important;
}
/* shadcn Toast clásico (si aplica): */
[data-variant="destructive"] {
  background: var(--red-d) !important;
  border-color: var(--red-m) !important;
  color: var(--red) !important;
}
```

---

## PASO 5 — APP SHELL Y AUTH

### App header (`App.tsx` — layout autenticado)

Añadir a `index.css`:

```css
header.app-header, .app-topbar {
  background: var(--s0);
  border-bottom: 1px solid var(--border);
  height: 52px;
  display: flex; align-items: center; gap: 8px;
  padding: 0 16px; flex-shrink: 0;
}
.app-header-user {
  font-size: 13px; font-weight: 500; color: var(--text2); margin-left: auto;
}
.app-header-logout {
  padding: 5px 12px; border-radius: var(--r-xs);
  border: 1px solid var(--border); background: transparent; color: var(--text3);
  font-family: var(--f-body); font-size: 12px; cursor: pointer;
  transition: all var(--t-fast);
}
.app-header-logout:hover {
  background: var(--red-d); color: var(--red); border-color: var(--red-m);
}
```

### `pages/login.tsx` (password form)
```
- Añadir className="pin-page" al wrapper raíz (reutiliza el estilo de PIN login)
- Verificar que no haya bg-white ni bg-gray-50 en el archivo
- Card de shadcn hereda --card = var(--s0) del bridge automáticamente
- Botón submit hereda --primary = var(--acc) del bridge
```

### `pages/enroll-pin.tsx` (configurar PIN por primera vez)
```
- Aplicar las mismas clases que pin-login.tsx:
  pin-page, pin-brand, pin-dots, pin-pad, pin-btn
- Paso 1 (ingresar PIN): dots vacíos → se llenan de var(--acc) al escribir
- Paso 2 (confirmar PIN): nuevo set de dots independiente
- Mismatch entre PINs: clase .shake en los dots + texto en color var(--red)
- No requiere ningún cambio de lógica
```

---

## PASO 6 — ADMIN PANEL (12 páginas)

### Patrón estructural para TODAS las páginas `/admin/*`

```tsx
<div className="admin-page">

  <div className="admin-page-header">
    <div>
      <h1 className="admin-page-title">Título</h1>
      <p className="admin-page-sub">{count} registros</p>
    </div>
    <button className="btn btn-primary" onClick={openCreate}>+ Nuevo</button>
  </div>

  <div className="admin-toolbar">
    <div className="admin-search">
      <span className="admin-search-icon">🔍</span>
      <input placeholder="Buscar..." value={search} onChange={...} />
    </div>
    {/* filtros adicionales aquí */}
  </div>

  <div className="admin-table-wrap">
    <table className="admin-table">
      <thead><tr><th>Col</th></tr></thead>
      <tbody>
        {items.map(item => <tr key={item.id}><td>{item.name}</td></tr>)}
      </tbody>
    </table>
    {items.length === 0 && (
      <div className="admin-empty">
        <div className="admin-empty-icon">📋</div>
        <p className="admin-empty-title">Sin registros</p>
      </div>
    )}
  </div>

</div>
```

Los dialogs de crear/editar (shadcn Dialog) heredan `--card = var(--s0)` del bridge.
Internamente usar `.admin-form-grid` + `.admin-form-field` + `.field-label` + `.field`.

### Cambios específicos por página

**`admin/categories.tsx`** — 461 líneas
```
- Aplicar patrón estructural
- Selector de color para TOP categories → .color-swatch-row + .color-swatch
  Valores hex por nombre de color:
  emerald → #4a7c59    blue → #1d4ed8    rose → #e05e3a
  amber   → #c9841a    purple → #7c3aed  cyan → #0891b2    orange → #c2410c
- Tabla de TOPs: badge → .badge .badge-acc
- Tabla de subcategorías: columna "Destino KDS":
  cocina → .badge .badge-acc   |   bar → .badge .badge-amber
- Botón "Seed TOPs" → .tbl-btn (neutro, no primario)
```

**`admin/products.tsx`** — 395 líneas
```
- Aplicar patrón estructural
- Toggle active, visibleQr → Switch shadcn (hereda --primary = var(--acc))
- availablePortions === 0 → <span className="badge badge-red">Agotado</span>
- visibleQr === true → <span className="badge badge-acc">QR</span>
- Precio → td.mono
- Filtros TOP/subcategoría → .filter-chips
- Checkboxes de impuestos en dialog → Checkbox shadcn (hereda colores del bridge)
```

**`admin/modifiers.tsx`** — 274 líneas
```
- Lista de grupos → .admin-accordion-item por grupo
- Trigger → .admin-accordion-trigger
  Badge required → .badge .badge-coral
  Badge optional → .badge .badge-muted
- Contenido → .admin-accordion-content
- Cada opción → .admin-accordion-sub-item
  priceDelta > 0 → color: var(--sage), mostrar "+₡X"
  priceDelta < 0 → color: var(--red), mostrar "-₡X"
  priceDelta = 0 → color: var(--text3), mostrar "Sin cargo"
```

**`admin/payment-methods.tsx`** — 120 líneas
```
- Aplicar patrón estructural. Toggle active → Switch shadcn. Código → td.mono
```

**`admin/tables.tsx`** — 191 líneas
```
- Aplicar patrón estructural. Toggle active → Switch shadcn. sortOrder → td.mono
```

**`admin/employees.tsx`** — 465 líneas
```
- Aplicar patrón estructural
- Badge de rol:
  MANAGER      → .badge .badge-acc
  FARM_MANAGER → .badge .badge-sage
  CASHIER / WAITER / KITCHEN / STAFF → .badge .badge-muted
- Toggle active → Switch shadcn
- Botón "Reset PIN"      → .tbl-btn (texto: "🔑 Reset PIN")
- Botón "Contraseña"     → .tbl-btn
- Dialog contraseña/PIN  → .admin-form-grid.full con .field
```

**`admin/users.tsx`** — 137 líneas
```
- Aplicar patrón estructural. Lista de lectura, sin acciones complejas.
```

**`admin/roles.tsx`** — 272 líneas  ← LA MÁS COMPLEJA
```
- Aplicar .admin-page wrapper
- Título "Roles y Permisos" + sub "Configura acceso por rol"
- Tabla → .permissions-matrix
- Filas de grupo (Acceso a Módulos / Operaciones POS / Caja) → tr.group-hdr
- Si un rol tiene cambios pendientes → th.dirty en esa columna
- Checkboxes → Checkbox shadcn (hereda --primary = var(--acc))
- Botón "Guardar cambios" → .btn .btn-primary
  Colocar en el admin-page-header cuando haya dirty changes
  O debajo de la tabla como footer
```

**`admin/business-config.tsx`** — 255 líneas
```
- Aplicar .admin-page wrapper
- Formulario → .admin-form-grid + .admin-form-field + .field + .field-label
- Sección "Zona de Peligro" → .danger-zone
  .danger-zone-title → "⚠ Zona de Peligro"
  .danger-zone-desc → descripción del riesgo
  Botón "Truncar transacciones" → .btn .btn-coral
  Abre AlertDialog shadcn (hereda colores del bridge)
```

**`admin/printers.tsx`** — 298 líneas
```
- Aplicar patrón estructural. Toggle active → Switch shadcn. Tipo → td.mono
```

**`admin/discounts.tsx`** — 194 líneas
```
- Aplicar patrón estructural
- Tipo (porcentaje/monto fijo) → .badge .badge-muted
- Valor → td.mono. Toggle active → Switch shadcn
```

**`admin/tax-categories.tsx`** — 223 líneas
```
- Aplicar patrón estructural
- Tipo inclusive → .badge .badge-sage   |   exclusive → .badge .badge-acc
- Tasa (%) → td.mono
```

---

## PASO 7 — INVENTARIO (7 páginas)

**`inventory/items.tsx`** — 591 líneas
```
- Aplicar patrón estructural, título "Inventario"
- Stock badge:
  qty <= 0                 → .badge .badge-stock-none  "Sin stock"
  0 < qty <= reorderPoint  → .badge .badge-stock-low   "Bajo"
  qty > reorderPoint       → .badge .badge-stock-ok    "OK"
- Perecedero → .badge .badge-amber "Perecedero"
- SKU → td.mono
- Columnas numéricas (qty, costos) → td.num
- Nombre del item → <a> o <Link> con color: var(--acc) → navega a /inventory/items/:id
- Botón CSV import → .btn .btn-ghost "📥 Importar CSV"
```

**`inventory/item-detail.tsx`** — 534 líneas
```
- Header con nombre del item (admin-page-title) + badge de stock
- Sección de datos (costos, UOM, puntos de reorden) → .card con .admin-form-grid (solo lectura)
  Todos los valores numéricos → font-family: var(--f-mono)
- Sección de movimientos → .admin-table-wrap con filas .movement-row
  Tipo IN  → .movement-qty.in
  Tipo OUT → .movement-qty.out
  Fecha    → .movement-date
```

**`inventory/suppliers.tsx`** — 377 líneas
```
- Aplicar patrón estructural. Toggle active → Switch shadcn.
```

**`inventory/purchase-orders.tsx`** — 668 líneas
```
- Aplicar patrón estructural, título "Órdenes de Compra"
- Status badges:
  DRAFT              → .badge .badge-draft
  SENT               → .badge .badge-sent
  PARTIALLY_RECEIVED → .badge .badge-partial
  RECEIVED           → .badge .badge-received
  CANCELLED          → .badge .badge-cancelled
- Tabla de líneas de PO → .admin-table (en panel expandible o dialog)
  qty, unitPrice → td.num
- Inputs de recepción de qty → .field (inline)
- Botón avanzar estado → .btn .btn-primary
```

**`inventory/physical-counts.tsx`** — 434 líneas
```
- Aplicar patrón estructural, título "Conteos Físicos"
- Status: OPEN → .badge .badge-sent   |   FINALIZED → .badge .badge-finalized
- Tabla de líneas: columnas sistema / contado / delta
  delta > 0 → <span className="delta-pos">+{n}</span>
  delta < 0 → <span className="delta-neg">{n}</span>
  delta = 0 → <span className="delta-zero">0</span>
- Botón "Finalizar Conteo" → .btn .btn-coral
  SIEMPRE precedido de AlertDialog shadcn:
  "Esta acción ajustará el inventario con los valores contados. No se puede deshacer."
```

**`inventory/recipes.tsx`** — 555 líneas
```
- Aplicar patrón estructural, título "Recetas"
- Buscador de productos → .admin-search
- Tabla de líneas de receta → .admin-table
  Columnas: Insumo | Qty | UOM | Desperdicio%
  wastePct > 0 → color: var(--amber)
  wastePct = 0 → color: var(--text3)
- Añadir línea → .tbl-btn .primary
- Eliminar línea → .tbl-btn .danger
```

**`inventory/reports.tsx`** — 249 líneas
```
- Aplicar patrón estructural. Tablas → .admin-table-wrap. Valores → td.num / td.mono
```

---

## PASO 8 — FALTANTES (3 páginas)

**`shortages/active.tsx`** — 548 líneas
```
- Aplicar .admin-page wrapper, título "Faltantes Activos"
- Tabs de estado → .filter-chips
  Cada estado → .filter-chip / .filter-chip.active
- Card de shortage → .card sin card-interactive
  Borde top según severidad:
  LOW_STOCK → border-top: 3px solid var(--amber)
  NO_STOCK  → border-top: 3px solid var(--red)
  URGENT    → border-top: 3px solid var(--red), background: var(--red-d)
- Badges:
  Severidad  → .badge .badge-sev-low / .badge-sev-no / .badge-sev-urgent
  Estado     → .badge .badge-open-sh / .badge-ack / .badge-resolved / .badge-closed
- Botones Acknowledge / Resolve / Close → .tbl-btn en línea dentro del card
- Timeline de eventos por shortage → .event-timeline
  OPEN → .timeline-dot.coral   |   ACKNOWLEDGED → .timeline-dot.amber
  RESOLVED → .timeline-dot.sage  |   CLOSED → .timeline-dot (base)
```

**`shortages/report.tsx`** — 429 líneas
```
- Aplicar .admin-page wrapper, título "Reportar Faltante"
- Formulario → .admin-form-grid.full + .admin-form-field + .field-label + .field
- Selector tipo → Select shadcn
- Selector severidad → Select shadcn
- Botón enviar → .btn .btn-primary ancho completo
```

**`shortages/audit.tsx`** — 372 líneas
```
- Aplicar patrón estructural, título "Auditoría"
- Tabla → .admin-table-wrap + .admin-table
- Fecha/usuario → td.mono
- Tipo de evento → .badge según tipo de acción
```

---

## PASO 9 — RECURSOS HUMANOS (5 páginas)

**`hr/mi-turno.tsx`** — 279 líneas
```
- Aplicar .admin-page wrapper, título "Mi Turno"
- Timer HH:MM:SS → .turno-clock
  Clocked in → .turno-clock (azul marino)
  Clocked out → .turno-clock.inactive (gris)
- Botón CLOCK IN  → .btn .btn-primary ancho completo  "▶ Marcar Entrada"
- Botón CLOCK OUT → .btn .btn-coral ancho completo    "■ Marcar Salida"
- Nota de geolocalización → <p> con font-size: 11px, color: var(--text3)
- Lista de punches del día → .admin-table-wrap + .admin-table
  clock-in  → color: var(--sage)
  clock-out → color: var(--text2)
  horas     → td.mono
```

**`hr/punches.tsx`** — 432 líneas
```
- Aplicar patrón estructural, título "Marcas de Tiempo"
- Filtro de fecha → .field tipo date en el toolbar
- En turno actualmente → .badge .badge-sage "En turno"
- Tabla → .admin-table-wrap + .admin-table
  workedMinutes → td.mono formateado como horas:minutos
  lateMinutes > 0 → color: var(--red) con prefijo "+"
  geoVerified true → "📍" color: var(--sage)
  geoVerified false → "📍" color: var(--text4)
- Botón editar punch → .tbl-btn
- Dialog edición → .admin-form-grid con 2 .field (clockIn, clockOut)
```

**`hr/schedules.tsx`** — 486 líneas
```
- Aplicar .admin-page wrapper, título "Horarios"
- Navegación semana:
  "‹ Semana anterior" → .btn .btn-ghost
  "Semana siguiente ›" → .btn .btn-ghost
  "📋 Copiar semana" → .btn .btn-ghost
- Grid → .schedule-grid
  Nombre empleado → .schedule-name-cell
  Header día → .schedule-header-cell
  Día de hoy → .schedule-header-cell.today
  Celda con horario (inicio-fin) → .schedule-day-cell.has-schedule
  Día libre → .schedule-day-cell.day-off  (texto "Libre")
  Sin definir → .schedule-day-cell vacía
```

**`hr/reports.tsx`** — 418 líneas
```
- Aplicar patrón estructural. Tablas → .admin-table-wrap. Valores → td.num / td.mono
```

**`hr/settings.tsx`** — 311 líneas
```
- Aplicar .admin-page wrapper, título "Configuración HR"
- Formulario → .admin-form-grid + .admin-form-field + .field + .field-label
- Botón "Guardar" → .btn .btn-primary
```

---

## PASO 10 — SALES CUBE (`pages/sales-cube.tsx`) — 908 líneas

```
- Wrapper → .admin-page sin max-width (full width para tablas anchas)
  añadir: style={{ maxWidth: 'none' }}

- Panel de filtros → .card + .admin-form-grid
  Date range (from/to) → .field tipo date
  Weekday toggles (Lun-Dom) → .filter-chips con un chip por día
  Category, origin, product multi-selects → Select shadcn
  Top N → .field tipo number (max-width: 80px inline)

- Preset buttons → .filter-chips con .filter-chip / .filter-chip.active
  Colocar encima de la tabla de resultados

- Summary metadata → .cube-meta con 4 .cube-meta-item
  Total qty | Total subtotal | Total órdenes | N filas

- Tabla de resultados → .admin-table-wrap + .admin-table
  th clickeable para sort → th.sortable
  th con sort activo → th.sorted
  Columnas numéricas → td.num
  Fila de drill-down → tr con:
    background: var(--s1)
    border-left: 3px solid var(--acc)
    Tabla anidada dentro usa mismos estilos .admin-table

- Vista heatmap → tabla .heatmap-table
  Label de eje → .heatmap-label
  Celda con valor → .heatmap-cell con inline style:
    backgroundColor: `rgba(29, 78, 216, ${Math.max(0.08, valor/maxValor)})`
    color: intensidad > 0.55 ? '#ffffff' : 'var(--text)'
  Celda cero → .heatmap-cell.zero

- Botón "📥 Exportar CSV" → .btn .btn-ghost
  Estado loading → disabled + texto "Exportando..."
```

---

## PASO 11 — LIMPIEZA GLOBAL DE CLASES TAILWIND DE COLOR

Ejecutar este grep para encontrar las clases residuales:

```bash
grep -rn "bg-white\|bg-gray-50\|bg-gray-100\|bg-gray-900\|bg-slate-900\|text-gray-900\|text-gray-700\|text-gray-600\|text-gray-500\|text-gray-400\|text-blue-600\|text-green-600\|text-red-600\|border-gray-200\|border-gray-700" \
  client/src/pages/admin \
  client/src/pages/inventory \
  client/src/pages/hr \
  client/src/pages/shortages \
  client/src/pages/sales-cube.tsx
```

Reemplazar SOLO las clases de color, NO las de layout/spacing:

```
bg-white        → style={{background:'var(--s0)'}}
bg-gray-50      → style={{background:'var(--s1)'}}
bg-gray-100     → style={{background:'var(--s2)'}}
bg-gray-900     → style={{background:'var(--bg)'}}
text-gray-900   → style={{color:'var(--text)'}}
text-gray-700   → style={{color:'var(--text2)'}}
text-gray-500   → style={{color:'var(--text3)'}}
text-gray-400   → style={{color:'var(--text4)'}}
text-blue-600   → style={{color:'var(--acc)'}}
text-green-600  → style={{color:'var(--sage)'}}
text-red-600    → style={{color:'var(--red)'}}
text-yellow-600 → style={{color:'var(--amber)'}}
bg-blue-50      → style={{background:'var(--acc-d)'}}
bg-green-50     → style={{background:'var(--sage-d)'}}
bg-red-50       → style={{background:'var(--red-d)'}}
border-gray-200 → style={{borderColor:'var(--border)'}}
border-gray-700 → style={{borderColor:'var(--border)'}}
```

---

## CHECKLIST FINAL

### Componentes compartidos
```
[ ] pos-dialogs.css → fondos/superficies en tokens Linen, métodos de pago actualizados
[ ] PayDialog funcional en light y dark mode sin perder layout
[ ] SplitDialog funcional en light y dark mode sin perder animaciones
[ ] Toasts destructive → red | success → sage
[ ] App header autenticado → fondo s0, borde border
[ ] login.tsx → usa wrapper pin-page, sin bg-white residual
[ ] enroll-pin.tsx → mismo look que pin-login, shake en mismatch
```

### Admin (12 páginas)
```
[ ] categories    → patrón tabla + color swatches + badges KDS
[ ] products      → toggles acc, badges Agotado/QR, filtros filter-chips
[ ] modifiers     → accordion con tokens, priceDelta coloreado
[ ] payment-methods / tables / users → patrón tabla básico
[ ] employees     → badges de rol por color, botones PIN/pass
[ ] roles         → permissions-matrix con dirty indicator y checkbox acc
[ ] business-config → danger-zone coral, formulario limpio
[ ] printers / discounts / tax-categories → patrón tabla
```

### Inventario (7 páginas)
```
[ ] items         → badges stock-ok/low/none, link en acc, columnas num
[ ] item-detail   → movimientos in/out coloreados
[ ] suppliers     → tabla simple
[ ] purchase-orders → status flow completo con badges
[ ] physical-counts → delta pos/neg coloreado, botón finalizar con confirmación
[ ] recipes       → wastePct en amber, botones add/delete con tokens
[ ] reports       → tabla con tokens
```

### Faltantes (3 páginas)
```
[ ] active  → borde top por severidad, timeline de eventos, filter-chips de estado
[ ] report  → formulario limpio
[ ] audit   → tabla con tokens
```

### RRHH (5 páginas)
```
[ ] mi-turno  → timer azul marino, botones diferenciados clock-in/out
[ ] punches   → lateMinutes en rojo, geoVerified con ícono coloreado
[ ] schedules → schedule-grid con tokens, day-off vs has-schedule visibles
[ ] reports / settings → patrón tabla y formulario
```

### Sales Cube
```
[ ] Filtros con tokens, presets como filter-chips
[ ] Tabla sortable con th.sortable/sorted, drill-down con borde acc
[ ] Heatmap con rgba(29,78,216,intensity) calculado correctamente
[ ] Botón CSV con estado loading
[ ] cube-meta con 4 valores resumen
```
