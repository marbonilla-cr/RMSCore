# PROMPT MAESTRO — SISTEMA DE DISEÑO "LINEN"
# Para Replit Agent · Rediseño completo de la plataforma restaurante
# Reemplaza todos los prompts de color y diseño anteriores

---

## INSTRUCCIÓN PRINCIPAL

Aplica el sistema de diseño "Linen" a toda la plataforma.
Linen es un sistema light-mode mediterráneo: fondos crema cálidos, tipografía IBM Plex,
acento azul marino profesional, coral para alertas y estados críticos.

**Solo modificas:** CSS, tokens de color, tipografía, layouts visuales.
**NO tocas:** lógica, endpoints, hooks, queries, permisos, WebSocket, auth.

---

## PASO 0 — INSTALACIÓN DE FUENTES

Añadir en `index.html` antes de cualquier stylesheet:

```html
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

---

## PASO 1 — TOKENS LINEN (`src/styles/tokens.css`)

Crear este archivo. Es la única fuente de verdad de colores en toda la app.

```css
/* ════════════════════════════════════
   LINEN DESIGN SYSTEM — tokens.css
   ════════════════════════════════════ */

/* ── Tipografía (igual en ambos modos) ── */
:root {
  --f-disp: 'Outfit', sans-serif;
  --f-body: 'IBM Plex Sans', sans-serif;
  --f-mono: 'IBM Plex Mono', monospace;

  --r-xs: 6px;
  --r-sm: 10px;
  --r-md: 14px;
  --r-lg: 18px;
  --r-xl: 24px;

  --t-fast: 0.14s ease;
  --t-mid:  0.24s ease;
  --t-slow: 0.38s cubic-bezier(.22,.68,0,1.2);
}

/* ── LIGHT MODE (default) ── */
:root,
[data-theme="light"] {

  /* Fondos */
  --bg:   #f7f3ee;   /* crema cálido — fondo de página */
  --s0:   #ffffff;   /* superficies principales: cards, panels, header */
  --s1:   #f0ebe3;   /* superficies secundarias: hover, input bg */
  --s2:   #e6dfd5;   /* superficies terciarias: disabled, separadores */
  --s3:   #d9d0c4;   /* bordes visibles */

  /* Bordes */
  --border:  #ddd5c8;
  --border2: #cfc5b6;

  /* Acento principal — azul marino */
  --acc:   #1d4ed8;
  --acc-d: rgba(29,78,216,0.07);
  --acc-m: rgba(29,78,216,0.18);
  --acc-t: rgba(29,78,216,0.35);

  /* Coral — alertas QR, acciones destructivas, urgencia */
  --coral:   #e05e3a;
  --coral-d: rgba(224,94,58,0.08);
  --coral-m: rgba(224,94,58,0.20);

  /* Sage — estado listo, confirmaciones positivas */
  --sage:   #4a7c59;
  --sage-d: rgba(74,124,89,0.09);
  --sage-m: rgba(74,124,89,0.20);

  /* Amber — advertencias, preparando */
  --amber:   #c9841a;
  --amber-d: rgba(201,132,26,0.09);
  --amber-m: rgba(201,132,26,0.20);

  /* Rojo — errores, anulaciones */
  --red:   #dc2626;
  --red-d: rgba(220,38,38,0.08);
  --red-m: rgba(220,38,38,0.18);

  /* Texto */
  --text:  #1a1208;   /* texto principal — casi negro cálido */
  --text2: #5a4e40;   /* texto secundario */
  --text3: #9c8e7e;   /* labels, hints, placeholders */
  --text4: #c4b9ac;   /* texto deshabilitado */

  /* Rail lateral (siempre oscuro independiente del modo) */
  --rail-bg:     #1a1208;
  --rail-text:   rgba(255,255,255,0.40);
  --rail-active: rgba(255,255,255,0.12);
  --rail-accent: #e05e3a;   /* coral para indicador activo en rail */

  /* Sombras */
  --shadow-xs: 0 1px 2px rgba(26,18,8,0.06);
  --shadow-sm: 0 2px 8px rgba(26,18,8,0.08);
  --shadow-md: 0 4px 16px rgba(26,18,8,0.10);
  --shadow-lg: 0 8px 32px rgba(26,18,8,0.12);
  --shadow-dialog: 0 20px 60px rgba(26,18,8,0.18), 0 0 0 1px var(--border);
}

/* ── DARK MODE ── */
[data-theme="dark"] {

  --bg:   #1c1711;
  --s0:   #252017;
  --s1:   #2e2820;
  --s2:   #3a332a;
  --s3:   #453e34;

  --border:  #3a332a;
  --border2: #453e34;

  --acc:   #4f83f5;   /* azul más luminoso sobre fondo oscuro */
  --acc-d: rgba(79,131,245,0.12);
  --acc-m: rgba(79,131,245,0.25);
  --acc-t: rgba(79,131,245,0.40);

  --coral:   #f07653;
  --coral-d: rgba(240,118,83,0.12);
  --coral-m: rgba(240,118,83,0.25);

  --sage:   #68b07a;
  --sage-d: rgba(104,176,122,0.12);
  --sage-m: rgba(104,176,122,0.25);

  --amber:   #e6a535;
  --amber-d: rgba(230,165,53,0.12);
  --amber-m: rgba(230,165,53,0.25);

  --red:   #f87171;
  --red-d: rgba(248,113,113,0.12);
  --red-m: rgba(248,113,113,0.25);

  --text:  #f5ede3;
  --text2: #c4b5a5;
  --text3: #8a7d6e;
  --text4: #5a4e40;

  --rail-bg:     #141009;
  --rail-text:   rgba(255,255,255,0.35);
  --rail-active: rgba(255,255,255,0.10);
  --rail-accent: #f07653;

  --shadow-xs: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.4);
  --shadow-md: 0 4px 16px rgba(0,0,0,0.5);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.6);
  --shadow-dialog: 0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px var(--border);
}
```

---

## PASO 2 — BRIDGE SHADCN (`src/styles/tokens.css` — añadir al final)

Mapea los tokens Linen a las variables que shadcn/ui espera.
Esto unifica las pantallas blancas con el nuevo sistema:

```css
/* ════════════════════════════════════
   BRIDGE shadcn ← tokens Linen
   ════════════════════════════════════ */

:root,
[data-theme="light"],
[data-theme="dark"] {
  --background:              var(--bg);
  --foreground:              var(--text);
  --card:                    var(--s0);
  --card-foreground:         var(--text);
  --popover:                 var(--s0);
  --popover-foreground:      var(--text);
  --primary:                 var(--acc);
  --primary-foreground:      #ffffff;
  --secondary:               var(--s1);
  --secondary-foreground:    var(--text2);
  --muted:                   var(--s1);
  --muted-foreground:        var(--text3);
  --accent:                  var(--s2);
  --accent-foreground:       var(--text);
  --destructive:             var(--red);
  --destructive-foreground:  #ffffff;
  --border:                  var(--border);
  --input:                   var(--s1);
  --ring:                    var(--acc);
  --radius:                  var(--r-sm);

  /* Sidebar shadcn */
  --sidebar-background:           var(--rail-bg);
  --sidebar-foreground:           var(--rail-text);
  --sidebar-primary:              var(--rail-accent);
  --sidebar-primary-foreground:   #ffffff;
  --sidebar-accent:               var(--rail-active);
  --sidebar-accent-foreground:    #ffffff;
  --sidebar-border:               rgba(255,255,255,0.08);
  --sidebar-ring:                 var(--rail-accent);
}
```

---

## PASO 3 — ESTILOS GLOBALES (`src/index.css` — reemplazar sección base)

```css
@import './styles/tokens.css';

*,
*::before,
*::after { box-sizing: border-box; }

html {
  font-size: 16px;
  -webkit-tap-highlight-color: transparent;
}

body {
  background-color: var(--bg);
  color: var(--text);
  font-family: var(--f-body);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  min-height: 100dvh;
}

/* Scrollbar global */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--text3); }
```

---

## PASO 4 — ANTI-FLASH DE TEMA (`index.html`)

```html
<html lang="es" data-theme="light">
<head>
  <!-- PRIMERO — antes de cualquier script o CSS -->
  <script>
    (function(){
      var t = localStorage.getItem('linen-theme') || 'light';
      document.documentElement.setAttribute('data-theme', t);
    })();
  </script>
  <!-- fuentes y demás -->
```

---

## PASO 5 — THEME TOGGLE (`components/theme-toggle.tsx`)

Reemplazar la lógica del toggle existente:

```typescript
export function ThemeToggle() {
  const [theme, setTheme] = useState<'light'|'dark'>(
    () => (localStorage.getItem('linen-theme') as 'light'|'dark') || 'light'
  );

  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('linen-theme', next);
    setTheme(next);
  };

  return (
    <button onClick={toggle} className="theme-toggle-btn" title="Cambiar tema">
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
}
```

```css
.theme-toggle-btn {
  width: 36px; height: 36px;
  border-radius: var(--r-sm);
  background: var(--s1);
  border: 1px solid var(--border);
  color: var(--text2);
  font-size: 16px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all var(--t-fast);
}
.theme-toggle-btn:hover { background: var(--s2); }
```

---

## PASO 6 — NAVEGACIÓN: RAIL + TABS SUPERIORES

### Comportamiento
- **Mobile (< 768px):** Tab bar superior (sin rail). Botón ☰ en el header abre el rail como drawer desde la izquierda.
- **Tablet/Desktop (≥ 768px):** Rail lateral fijo de 64px siempre visible. Sin tab bar.

### Rail lateral (`components/app-sidebar.tsx` — reemplazar estilos)

El rail siempre tiene fondo oscuro (`--rail-bg`) independientemente del tema de la app.

```css
/* Override shadcn sidebar para Linen */
[data-sidebar="sidebar"] {
  background: var(--rail-bg) !important;
  border-right: 1px solid rgba(255,255,255,0.07) !important;
  width: 64px !important;
}

/* En mobile: drawer desde izquierda */
@media (max-width: 767px) {
  [data-sidebar="sidebar"] {
    width: 220px !important;   /* más ancho al abrir como drawer */
  }
}

/* Items del rail */
[data-sidebar="menu-button"] {
  border-radius: var(--r-sm) !important;
  color: var(--rail-text) !important;
  padding: 10px 8px !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  gap: 3px !important;
  font-family: var(--f-mono) !important;
  font-size: 9px !important;
  letter-spacing: 0.06em !important;
  text-transform: uppercase !important;
  transition: all var(--t-fast) !important;
  position: relative !important;
}

[data-sidebar="menu-button"]:hover {
  background: var(--rail-active) !important;
  color: rgba(255,255,255,0.75) !important;
}

[data-sidebar="menu-button"][data-active="true"] {
  background: var(--rail-active) !important;
  color: #ffffff !important;
}

/* Indicador activo — línea coral a la izquierda */
[data-sidebar="menu-button"][data-active="true"]::before {
  content: '';
  position: absolute;
  left: 0; top: 50%;
  transform: translateY(-50%);
  width: 3px; height: 22px;
  background: var(--rail-accent);
  border-radius: 0 3px 3px 0;
}

/* Logo del negocio en top del rail */
.rail-logo {
  width: 38px; height: 38px;
  border-radius: 11px;
  background: var(--coral);
  color: #fff;
  font-family: var(--f-disp);
  font-size: 20px; font-weight: 900;
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 12px;
}

/* Badge de notificación en rail item */
.rail-item-badge {
  position: absolute; top: 5px; right: 5px;
  width: 14px; height: 14px;
  background: var(--rail-accent);
  border-radius: 50%;
  font-family: var(--f-mono);
  font-size: 8px; font-weight: 700; color: #fff;
  display: flex; align-items: center; justify-content: center;
  border: 1.5px solid var(--rail-bg);
}
```

### Botón para abrir rail en mobile (`components/app-sidebar.tsx`)

```tsx
{/* Añadir en el header mobile — visible solo en < 768px */}
<button
  className="rail-trigger"
  onClick={() => setSidebarOpen(true)}
  aria-label="Menú"
>
  ☰
</button>
```

```css
.rail-trigger {
  width: 36px; height: 36px;
  border-radius: var(--r-sm);
  background: var(--s1);
  border: 1px solid var(--border);
  color: var(--text2); font-size: 16px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}
@media (min-width: 768px) { .rail-trigger { display: none; } }
```

### Tab bar superior — solo mobile

```css
/* Tab bar superior en mobile */
.top-tab-bar {
  display: flex;
  background: var(--s0);
  border-bottom: 1px solid var(--border);
  padding: 0 4px;
  overflow-x: auto;
  scrollbar-width: none;
  flex-shrink: 0;
}
.top-tab-bar::-webkit-scrollbar { display: none; }

.top-tab {
  flex: 1;
  padding: 10px 6px 11px;
  border-bottom: 2px solid transparent;
  font-family: var(--f-body);
  font-size: 12px; font-weight: 600;
  color: var(--text3); white-space: nowrap;
  cursor: pointer; transition: all var(--t-fast);
  display: flex; align-items: center; justify-content: center; gap: 5px;
  min-width: 60px;
}
.top-tab:hover  { color: var(--text2); }
.top-tab.active { color: var(--acc); border-bottom-color: var(--acc); }

.top-tab-badge {
  background: var(--coral-d);
  color: var(--coral);
  border: 1px solid var(--coral-m);
  font-family: var(--f-mono);
  font-size: 9px; font-weight: 700;
  padding: 1px 5px; border-radius: 20px;
}

@media (min-width: 768px) { .top-tab-bar { display: none; } }
```

---

## PASO 7 — COMPONENTES BASE LINEN

### Crear `src/styles/components.css` e importarlo después de tokens.css

```css
/* ════════════════════════════════════
   LINEN COMPONENTS — components.css
   ════════════════════════════════════ */

/* ── BOTONES ── */

.btn {
  font-family: var(--f-disp);
  font-weight: 700;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  transition: all var(--t-mid);
  border-radius: var(--r-sm);
  white-space: nowrap;
}
.btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none !important; }
.btn:active:not(:disabled) { transform: scale(0.97); }

/* Primario — azul marino */
.btn-primary {
  background: var(--acc);
  color: #ffffff;
  padding: 13px 20px;
  font-size: 14px;
  letter-spacing: 0.03em;
  box-shadow: 0 4px 14px var(--acc-m);
}
.btn-primary:hover:not(:disabled) { background: #1a45c4; }

/* Secundario — superficie */
.btn-secondary {
  background: var(--s1);
  border: 1px solid var(--border);
  color: var(--text2);
  padding: 13px 16px;
  font-size: 13px;
}
.btn-secondary:hover:not(:disabled) { background: var(--s2); }

/* Coral — alertas, cobrar urgente */
.btn-coral {
  background: var(--coral);
  color: #ffffff;
  padding: 13px 20px;
  font-size: 14px;
  box-shadow: 0 4px 14px var(--coral-m);
}
.btn-coral:hover:not(:disabled) { background: #c9522e; }

/* Ghost — solo borde */
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text3);
  padding: 11px 14px;
  font-size: 13px;
}
.btn-ghost:hover:not(:disabled) { background: var(--s1); color: var(--text); }

/* Icono cuadrado */
.btn-icon {
  width: 44px; height: 44px;
  background: var(--s1);
  border: 1px solid var(--border);
  color: var(--text2);
  font-size: 17px;
  border-radius: var(--r-sm);
  flex-shrink: 0;
}
.btn-icon:hover:not(:disabled) { background: var(--s2); color: var(--text); }

/* ── BADGES ── */

.badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px;
  border-radius: 20px;
  font-family: var(--f-mono);
  font-size: 9px; font-weight: 600;
  letter-spacing: 0.07em; text-transform: uppercase;
  width: fit-content;
}

.badge-acc    { background: var(--acc-d);   color: var(--acc);   border: 1px solid var(--acc-m); }
.badge-sage   { background: var(--sage-d);  color: var(--sage);  border: 1px solid var(--sage-m); }
.badge-coral  { background: var(--coral-d); color: var(--coral); border: 1px solid var(--coral-m); }
.badge-amber  { background: var(--amber-d); color: var(--amber); border: 1px solid var(--amber-m); }
.badge-red    { background: var(--red-d);   color: var(--red);   border: 1px solid var(--red-m); }
.badge-muted  { background: var(--s2);      color: var(--text3); border: 1px solid var(--border); }

/* ── CARDS ── */

.card {
  background: var(--s0);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 14px;
  box-shadow: var(--shadow-xs);
  transition: all var(--t-mid);
}
.card-interactive {
  cursor: pointer;
}
.card-interactive:hover  { box-shadow: var(--shadow-sm); border-color: var(--border2); }
.card-interactive:active { transform: scale(0.98); }

/* Card con borde superior de color (para mesas, KPIs) */
.card-top-acc   { border-top: 3px solid var(--acc); }
.card-top-sage  { border-top: 3px solid var(--sage); }
.card-top-coral { border-top: 3px solid var(--coral); }
.card-top-amber { border-top: 3px solid var(--amber); }
.card-top-red   { border-top: 3px solid var(--red); }

/* ── INPUTS ── */

.field {
  width: 100%;
  background: var(--s1);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 11px 14px;
  color: var(--text);
  font-family: var(--f-body);
  font-size: 14px;
  outline: none;
  transition: border-color var(--t-fast), box-shadow var(--t-fast);
  appearance: none;
}
.field:focus {
  border-color: var(--acc);
  box-shadow: 0 0 0 3px var(--acc-d);
}
.field::placeholder { color: var(--text3); }
.field:disabled { opacity: 0.5; cursor: not-allowed; }

.field-label {
  font-family: var(--f-mono);
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.10em; text-transform: uppercase;
  color: var(--text3);
  display: block; margin-bottom: 6px;
}

/* ── SCREEN HEADER ── */

.screen-header {
  background: var(--s0);
  border-bottom: 1px solid var(--border);
  padding: 12px 18px;
  display: flex; align-items: center; gap: 10px;
  flex-shrink: 0;
}
.screen-header .back-btn {
  width: 34px; height: 34px;
  border-radius: var(--r-sm);
  background: var(--s1); border: 1px solid var(--border);
  color: var(--text2); font-size: 17px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all var(--t-fast);
  flex-shrink: 0;
}
.screen-header .back-btn:hover { background: var(--s2); color: var(--text); }
.screen-header .header-title {
  font-family: var(--f-disp);
  font-size: 20px; font-weight: 800;
  color: var(--text); flex: 1; line-height: 1;
}
.screen-header .header-sub {
  font-family: var(--f-mono);
  font-size: 10px; color: var(--text3);
  letter-spacing: 0.07em;
  margin-top: 2px; display: block;
}
.screen-header .header-action {
  width: 34px; height: 34px;
  border-radius: var(--r-sm);
  background: var(--s1); border: 1px solid var(--border);
  color: var(--text2); font-size: 15px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all var(--t-fast); flex-shrink: 0;
}
.screen-header .header-action:hover { background: var(--s2); color: var(--text); }

/* ── META CHIPS (info contextual en headers) ── */

.meta-chips {
  display: flex; gap: 6px; flex-wrap: wrap;
  padding: 8px 18px;
  background: var(--s0);
  border-bottom: 1px solid var(--border);
}
.meta-chip {
  display: inline-flex; align-items: center; gap: 5px;
  background: var(--s1); border: 1px solid var(--border);
  border-radius: 8px; padding: 4px 10px;
  font-family: var(--f-mono); font-size: 11px; color: var(--text2);
}
.meta-chip b { color: var(--text); font-weight: 600; }
.meta-chip.acc   { color: var(--acc);   border-color: var(--acc-m);   background: var(--acc-d); }
.meta-chip.sage  { color: var(--sage);  border-color: var(--sage-m);  background: var(--sage-d); }
.meta-chip.coral { color: var(--coral); border-color: var(--coral-m); background: var(--coral-d); }
.meta-chip.amber { color: var(--amber); border-color: var(--amber-m); background: var(--amber-d); }

/* ── SECTION LABEL ── */

.section-label {
  font-family: var(--f-mono);
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--text3);
  display: flex; align-items: center; gap: 8px;
  padding: 0 0 8px;
}
.section-label::after {
  content: ''; flex: 1; height: 1px; background: var(--border);
}
.section-count {
  font-family: var(--f-mono); font-size: 9px;
  background: var(--s2); border: 1px solid var(--border);
  color: var(--text3); padding: 1px 7px; border-radius: 20px;
}

/* ── BOTTOM ACTION BAR (mobile) ── */

.bottom-action {
  background: var(--s0);
  border-top: 1px solid var(--border);
  padding: 12px 18px 20px;
  display: flex; gap: 8px;
  flex-shrink: 0;
}

/* ── ORDER ITEM ── */

.order-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 12px;
  background: var(--s0); border: 1px solid var(--border);
  border-radius: var(--r-sm); margin-bottom: 6px;
  transition: all var(--t-fast);
}
.oi-qty {
  width: 26px; height: 26px; border-radius: 7px;
  background: var(--s1); border: 1px solid var(--border2);
  font-family: var(--f-mono); font-size: 12px; font-weight: 600; color: var(--text2);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.oi-name  { font-size: 13px; font-weight: 500; color: var(--text); }
.oi-mod   { font-size: 11px; color: var(--text3); margin-top: 2px; }
.oi-price { font-family: var(--f-mono); font-size: 12px; color: var(--text); font-weight: 500; }

/* ── ROUND HEADER ── */

.round-hdr {
  display: flex; align-items: center; gap: 8px;
  margin: 14px 0 8px;
}
.round-pill {
  font-family: var(--f-mono); font-size: 9px; font-weight: 500;
  color: var(--text4); background: var(--s2); border: 1px solid var(--border2);
  padding: 2px 9px; border-radius: 20px;
  text-transform: uppercase; letter-spacing: 0.08em;
}
.round-line { flex: 1; height: 1px; background: var(--border); }
.round-time { font-family: var(--f-mono); font-size: 10px; color: var(--text4); }

/* ── TOTALS CARD ── */

.totals-card {
  background: var(--s0); border: 1px solid var(--border);
  border-radius: var(--r-md); padding: 14px;
  margin-top: 10px; margin-bottom: 10px;
}
.tot-row {
  display: flex; justify-content: space-between;
  font-size: 12px; color: var(--text2); padding: 3px 0;
}
.tot-row .lbl { font-family: var(--f-mono); }
.tot-row .val { font-family: var(--f-mono); }
.tot-row.discount .val { color: var(--sage); }
.tot-row.total { padding-top: 10px; border-top: 1px solid var(--border); margin-top: 6px; }
.tot-row.total .lbl { font-family: var(--f-disp); font-size: 15px; font-weight: 800; color: var(--text); }
.tot-row.total .val { font-family: var(--f-mono); font-size: 19px; font-weight: 600; color: var(--acc); }

/* ── QR BANNER ── */

.qr-banner {
  background: linear-gradient(135deg, var(--coral-d), rgba(224,94,58,0.05));
  border: 1px solid var(--coral-m);
  border-left: 3px solid var(--coral);
  border-radius: var(--r-sm);
  padding: 10px 14px;
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 12px;
}
.qr-banner-text { flex: 1; font-size: 12px; font-weight: 600; color: #9a3412; }
[data-theme="dark"] .qr-banner-text { color: #fdba74; }
.qr-banner-btn {
  padding: 6px 12px; border-radius: 7px;
  background: var(--coral); color: #fff;
  font-family: var(--f-body); font-size: 11px; font-weight: 600;
  border: none; cursor: pointer; transition: all var(--t-fast);
}
.qr-banner-btn:hover { background: #c9522e; }

/* ── SKELETON LOADING ── */

@keyframes shimmer {
  from { background-position: -200% center; }
  to   { background-position:  200% center; }
}
.skeleton {
  background: linear-gradient(90deg,
    var(--s2) 25%, var(--s3) 50%, var(--s2) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--r-sm);
}

/* ── ANIMACIONES ── */

@keyframes slide-up {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
.animate-in { animation: slide-up 0.25s ease both; }

@keyframes stagger-fade {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.stagger > * { animation: stagger-fade 0.22s ease both; }
.stagger > *:nth-child(1) { animation-delay: 0.04s; }
.stagger > *:nth-child(2) { animation-delay: 0.08s; }
.stagger > *:nth-child(3) { animation-delay: 0.12s; }
.stagger > *:nth-child(4) { animation-delay: 0.16s; }
.stagger > *:nth-child(5) { animation-delay: 0.20s; }
.stagger > *:nth-child(n+6) { animation-delay: 0.24s; }

@keyframes flash-success {
  0%   { box-shadow: 0 0 0 0   rgba(29,78,216,0); }
  30%  { box-shadow: 0 0 0 8px rgba(29,78,216,0.35); }
  100% { box-shadow: 0 0 0 16px rgba(29,78,216,0); }
}
.flash-acc { animation: flash-success 0.7s ease; }

@keyframes shake {
  0%,100% { transform: translateX(0); }
  20% { transform: translateX(-7px); }
  40% { transform: translateX(7px); }
  60% { transform: translateX(-5px); }
  80% { transform: translateX(5px); }
}
.shake { animation: shake 0.4s ease; }
```

---

## PASO 8 — MÓDULO MESAS (`pages/tables.tsx`)

### Mesas ocupadas — card con borde superior

El color del borde top indica estado. Usar clase `card card-interactive` más la variante:

```
orderStatus nulo             → sin borde top especial (card base)
pendingQrCount > 0           → card-top-coral  + badge-coral
orderStatus === "READY"      → card-top-sage   + badge-sage
orderStatus === "IN_KITCHEN" → card-top-acc    + badge-acc
orderStatus === "PREPARING"  → card-top-amber  + badge-amber
orderStatus === "OPEN"       → card-top-acc    + badge-muted
```

```tsx
function TableCard({ table }: { table: TableView }) {
  const topClass = table.pendingQrCount > 0
    ? 'card-top-coral'
    : { READY: 'card-top-sage', IN_KITCHEN: 'card-top-acc',
        PREPARING: 'card-top-amber', OPEN: 'card-top-acc' }
      [table.orderStatus ?? ''] ?? '';

  return (
    <Link to={`/tables/${table.id}`}
      className={`card card-interactive ${topClass}`}
      style={{ display:'flex', flexDirection:'column', gap:'8px', minHeight:'110px' }}>

      {table.pendingQrCount > 0 && (
        <div style={{ position:'absolute', top:10, right:10 }}
          className="badge badge-coral">
          📱 {table.pendingQrCount}
        </div>
      )}

      <span style={{ fontFamily:'var(--f-disp)', fontSize:'22px', fontWeight:800 }}>
        {table.tableName}
      </span>

      <StatusBadge status={table.orderStatus} />

      <div style={{ marginTop:'auto', display:'flex', flexDirection:'column', gap:3 }}>
        {table.responsibleWaiterName && (
          <MetaRow icon="👤" value={table.responsibleWaiterName} />
        )}
        {table.itemCount > 0 && (
          <MetaRow icon="🍽" value={`${table.itemCount} items`} />
        )}
        {table.totalAmount && (
          <span style={{ fontFamily:'var(--f-mono)', fontSize:'14px',
            fontWeight:600, color:'var(--acc)' }}>
            {formatCurrency(table.totalAmount)}
          </span>
        )}
      </div>
    </Link>
  );
}
```

### Mesas libres — grid 3 columnas, cards pequeñas

```tsx
<div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'8px' }}>
  {freeTables.map(t => (
    <Link key={t.id} to={`/tables/${t.id}`}
      className="card card-interactive"
      style={{ textAlign:'center', padding:'12px 8px' }}>
      <div style={{ fontFamily:'var(--f-disp)', fontSize:'17px',
        fontWeight:700, color:'var(--text2)' }}>{t.tableName}</div>
      <div style={{ fontFamily:'var(--f-mono)', fontSize:'9px',
        color:'var(--text3)', marginTop:3 }}>LIBRE</div>
    </Link>
  ))}
</div>
```

---

## PASO 9 — MÓDULO DETALLE DE MESA (`pages/table-detail.tsx`)

### Header con meta chips

```tsx
<div className="screen-header">
  <button className="back-btn" onClick={() => navigate('/tables')}>‹</button>
  <div style={{ flex:1 }}>
    <span className="header-title">{table.tableName}</span>
    <span className="header-sub">
      {waiterName} · {timeAgo(order.openedAt)}
    </span>
  </div>
  <button className="header-action" onClick={openTransfer} title="Transferir">⇄</button>
  <button className="header-action" title="Más">⋯</button>
</div>

<div className="meta-chips">
  <span className={`meta-chip ${statusChipClass}`}>
    {statusIcon} <b>{statusLabel}</b>
  </span>
  {order.itemCount > 0 &&
    <span className="meta-chip"><b>{order.itemCount}</b> items</span>}
  {order.totalAmount &&
    <span className="meta-chip acc"><b>{formatCurrency(order.totalAmount)}</b></span>}
</div>
```

### Tabs de modo

```tsx
<div className="top-tab-bar">
  <button className={`top-tab ${viewMode==='order' ? 'active' : ''}`}
    onClick={() => setViewMode('order')}>
    📋 Orden
    {itemCount > 0 && <span className="top-tab-badge">{itemCount}</span>}
  </button>
  <button className={`top-tab ${viewMode==='menu' ? 'active' : ''}`}
    onClick={() => setViewMode('menu')}>
    🍽 Menú
  </button>
</div>
```

### Barra inferior

```tsx
<div className="bottom-action">
  <button className="btn btn-icon" onClick={() => setViewMode('menu')}>＋</button>
  <button className="btn btn-primary" style={{ flex:1 }}
    onClick={openPayDialog}>
    💳 Cobrar {formatCurrency(order.totalAmount)}
  </button>
  <button className="btn btn-icon" onClick={printPrecheck}>🧾</button>
</div>
```

---

## PASO 10 — PIN LOGIN (`pages/pin-login.tsx`)

```css
.pin-page {
  min-height: 100dvh;
  background: var(--bg);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 32px 24px;
}
.pin-brand {
  text-align: center; margin-bottom: 40px;
}
.pin-business-name {
  font-family: var(--f-disp);
  font-size: 32px; font-weight: 900; color: var(--text); line-height: 1;
}
.pin-time {
  font-family: var(--f-mono);
  font-size: 48px; font-weight: 600; color: var(--acc);
  margin: 8px 0 4px; line-height: 1;
}
.pin-date { font-family: var(--f-mono); font-size: 13px; color: var(--text3); }

/* Dots indicadores */
.pin-dots { display: flex; gap: 12px; justify-content: center; margin-bottom: 32px; }
.pin-dot  {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--border2); background: transparent;
  transition: all var(--t-slow);
}
.pin-dot.filled {
  background: var(--acc); border-color: var(--acc);
  box-shadow: 0 0 10px var(--acc-m);
}
.pin-dot.error  { background: var(--red); border-color: var(--red); }

/* Pad numérico */
.pin-pad {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 12px; max-width: 280px; width: 100%;
}
.pin-btn {
  width: 80px; height: 80px; border-radius: 50%;
  background: var(--s0); border: 1.5px solid var(--border);
  color: var(--text); font-family: var(--f-disp);
  font-size: 30px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all var(--t-fast);
  box-shadow: var(--shadow-xs);
  margin: 0 auto;
}
.pin-btn:hover  { background: var(--s1); border-color: var(--border2); }
.pin-btn:active { transform: scale(0.90); background: var(--s2); }
.pin-btn.empty  { background: transparent; border: none; cursor: default; pointer-events: none; }
.pin-btn.delete { font-size: 22px; color: var(--text3); }

/* Error shake */
.pin-dots.error { animation: shake 0.4s ease; }
```

---

## PASO 11 — KDS (`pages/kds.tsx`)

El KDS es desktop/tablet. Layout en grid de columnas, tipografía grande.

```css
.kds-layout {
  background: var(--bg); min-height: 100dvh;
  display: flex; flex-direction: column;
}
.kds-header {
  background: var(--s0); border-bottom: 1px solid var(--border);
  padding: 14px 24px;
  display: flex; align-items: center; gap: 16px;
}
.kds-title { font-family: var(--f-disp); font-size: 24px; font-weight: 900; color: var(--text); }
.kds-time  { font-family: var(--f-mono); font-size: 20px; font-weight: 600; color: var(--text2); margin-left: auto; }

.kds-grid {
  flex: 1; padding: 20px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px; align-content: start; overflow-y: auto;
}

.kds-card {
  background: var(--s0); border: 1.5px solid var(--border);
  border-radius: var(--r-lg); overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: var(--shadow-sm);
}
.kds-card-header {
  padding: 12px 16px; background: var(--s1);
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid var(--border);
}
.kds-table   { font-family: var(--f-disp); font-size: 22px; font-weight: 900; color: var(--text); }
.kds-elapsed { font-family: var(--f-mono); font-size: 18px; font-weight: 600; }
.kds-elapsed.ok      { color: var(--sage); }
.kds-elapsed.warning { color: var(--amber); }
.kds-elapsed.urgent  { color: var(--red); animation: kds-pulse 1s infinite; }
@keyframes kds-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }

.kds-items { padding: 10px; display: flex; flex-direction: column; gap: 5px; }
.kds-item  {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 11px; border-radius: var(--r-sm);
  background: var(--s1); border: 1px solid var(--border);
  border-left: 3px solid var(--border2);
  cursor: pointer; transition: all var(--t-fast);
}
.kds-item:active { transform: scale(0.98); }
.kds-item.new      { border-left-color: var(--amber); }
.kds-item.preparing{ border-left-color: var(--acc); background: var(--acc-d); }
.kds-item.ready    { border-left-color: var(--sage); background: var(--sage-d); opacity: 0.75; }

.kds-item-qty  { font-family: var(--f-mono); font-size: 17px; font-weight: 700; color: var(--text2); width: 28px; flex-shrink: 0; }
.kds-item-name { font-size: 15px; font-weight: 600; flex: 1; color: var(--text); }
.kds-item-mods { font-size: 11px; color: var(--text3); margin-top: 2px; }

.kds-complete-btn {
  margin: 10px 12px 12px;
  padding: 13px; border-radius: var(--r-sm);
  background: var(--acc); color: #fff;
  font-family: var(--f-disp); font-size: 15px; font-weight: 800;
  border: none; cursor: pointer; transition: all var(--t-mid);
  box-shadow: 0 4px 14px var(--acc-m);
}
.kds-complete-btn:disabled { background: var(--s3); color: var(--text3); cursor: default; box-shadow: none; }

/* Modal nueva orden */
.kds-alert-overlay {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(26,18,8,0.80);
  display: flex; align-items: center; justify-content: center;
}
.kds-alert-box {
  background: var(--s0); border: 2px solid var(--acc-m);
  border-radius: var(--r-xl); padding: 40px;
  text-align: center; box-shadow: 0 0 60px var(--acc-d);
  animation: pop 0.4s var(--t-slow);
}
@keyframes pop { from{transform:scale(0.7);opacity:0} to{transform:scale(1);opacity:1} }
.kds-alert-count { font-family: var(--f-disp); font-size: 80px; font-weight: 900; color: var(--acc); line-height: 1; }
.kds-alert-label { font-family: var(--f-disp); font-size: 22px; color: var(--text2); margin: 8px 0 24px; }
```

---

## PASO 12 — POS / CAJA (`pages/pos.tsx`)

```css
/* Tabs POS */
.pos-tabs {
  display: flex; gap: 4px; padding: 12px 18px 0;
  background: var(--s0); border-bottom: 1px solid var(--border);
}
.pos-tab {
  padding: 9px 16px; border-radius: var(--r-sm) var(--r-sm) 0 0;
  border: 1px solid transparent; border-bottom: none;
  background: transparent; color: var(--text3);
  font-family: var(--f-body); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all var(--t-fast);
}
.pos-tab:hover { color: var(--text2); }
.pos-tab.active { background: var(--bg); border-color: var(--border); color: var(--acc); }

/* Panel de orden — bottom sheet en mobile */
.pos-order-panel {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: var(--s0); border-top: 1px solid var(--border);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  padding: 20px 18px; box-shadow: var(--shadow-lg);
  transform: translateY(100%);
  transition: transform var(--t-slow);
  z-index: 50; max-height: 85dvh; overflow-y: auto;
}
.pos-order-panel.open { transform: translateY(0); }
.pos-panel-drag {
  width: 40px; height: 4px; background: var(--border2);
  border-radius: 4px; margin: 0 auto 16px;
}

/* Cash session card */
.cash-card { /* usa .card base */ }
.cash-stat-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0;
}
.cash-stat {
  background: var(--s1); border-radius: var(--r-sm); padding: 10px 12px;
}
.cash-stat-label {
  font-family: var(--f-mono); font-size: 9px; color: var(--text3);
  letter-spacing: 0.10em; text-transform: uppercase; margin-bottom: 4px;
}
.cash-stat-val {
  font-family: var(--f-mono); font-size: 16px; font-weight: 600; color: var(--text);
}

/* Paid order item */
.paid-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 14px;
  background: var(--s0); border: 1px solid var(--border);
  border-radius: var(--r-sm); margin-bottom: 5px;
  cursor: pointer; transition: all var(--t-fast);
}
.paid-item:hover { background: var(--s1); }
.paid-ticket { font-family: var(--f-mono); font-size: 10px; color: var(--text3); }
.paid-table  { font-family: var(--f-disp); font-size: 16px; font-weight: 700; margin-top: 2px; }
.paid-amount { font-family: var(--f-mono); font-size: 15px; font-weight: 600; color: var(--acc); }
```

---

## PASO 13 — DASHBOARD (`pages/dashboard.tsx`)

```css
/* KPI grid */
.kpi-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
  padding: 0 18px 16px;
}
@media (min-width: 768px) { .kpi-grid { grid-template-columns: repeat(4, 1fr); } }

.kpi-card { /* usa .card base + variante card-top-X */ }
.kpi-icon  { font-size: 18px; margin-bottom: 6px; }
.kpi-value { font-family: var(--f-mono); font-size: 22px; font-weight: 600; color: var(--text); }
.kpi-label { font-family: var(--f-mono); font-size: 9px; color: var(--text3);
  letter-spacing: 0.10em; text-transform: uppercase; margin-top: 2px; }
.kpi-sub   { font-family: var(--f-mono); font-size: 11px; color: var(--text2); margin-top: 4px; }

/* Barras de método de pago */
.pay-bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.pay-bar-method { font-family: var(--f-mono); font-size: 10px; color: var(--text3);
  text-transform: uppercase; letter-spacing: 0.07em; width: 60px; }
.pay-bar-track { flex: 1; height: 6px; background: var(--s2); border-radius: 4px; overflow: hidden; }
.pay-bar-fill  { height: 100%; background: var(--acc); border-radius: 4px; transition: width 0.8s ease; }
.pay-bar-amount { font-family: var(--f-mono); font-size: 12px; color: var(--text); width: 80px; text-align: right; }

/* Date preset buttons */
.date-preset {
  padding: 6px 14px; border-radius: 20px;
  border: 1px solid var(--border); background: var(--s1); color: var(--text3);
  font-family: var(--f-mono); font-size: 11px; cursor: pointer; transition: all var(--t-fast);
}
.date-preset.active { background: var(--acc-d); border-color: var(--acc-m); color: var(--acc); }
```

---

## PASO 14 — QR CLIENTE (`pages/qr-client.tsx`)

El QR es público y debe ser amigable. Paleta ligeramente más cálida que el sistema interno.

```css
/* Override solo dentro de .qr-page */
.qr-page {
  --qr-acc:   #1d4ed8;   /* mismo azul marino */
  --qr-coral: #e05e3a;
  min-height: 100dvh;
  background: var(--bg);
  display: flex; flex-direction: column;
  font-family: var(--f-body);
}

/* Progress dots */
.qr-progress { display: flex; gap: 6px; }
.qr-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--s3); transition: all 0.3s; }
.qr-dot.done { background: var(--qr-acc); }

/* CTA button grande */
.qr-cta {
  width: 100%; padding: 17px;
  border-radius: var(--r-md); border: none;
  background: var(--qr-acc); color: #fff;
  font-family: var(--f-disp); font-size: 18px; font-weight: 800;
  letter-spacing: 0.03em; cursor: pointer; transition: all var(--t-mid);
  box-shadow: 0 6px 20px rgba(29,78,216,0.25);
}
.qr-cta:disabled { background: var(--s2); color: var(--text3); cursor: not-allowed; box-shadow: none; }
.qr-cta:active:not(:disabled) { transform: scale(0.98); }

/* Big category buttons */
.qr-big-cat {
  display: flex; align-items: center; gap: 16px;
  padding: 18px 16px; width: 100%; text-align: left;
  background: var(--s0); border: 1.5px solid var(--border);
  border-radius: var(--r-md); cursor: pointer;
  transition: all var(--t-mid); margin-bottom: 10px;
}
.qr-big-cat:active { border-color: var(--qr-acc); background: var(--acc-d); }
.qr-big-cat-icon  { font-size: 32px; flex-shrink: 0; }
.qr-big-cat-name  { font-family: var(--f-disp); font-size: 20px; font-weight: 800; flex: 1; }
.qr-big-cat-count { font-family: var(--f-mono); font-size: 11px; color: var(--text3); }

/* Input nombre */
.qr-name-input {
  width: 100%; padding: 16px; font-size: 18px;
  background: var(--s1); border: 2px solid var(--border);
  border-radius: var(--r-md); color: var(--text);
  font-family: var(--f-body); outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.qr-name-input:focus { border-color: var(--qr-acc); box-shadow: 0 0 0 4px var(--acc-d); }
```

---

## PASO 15 — CORRECCIÓN DE PANTALLAS BLANCAS

Si después de aplicar los tokens alguna pantalla sigue en blanco, es por clases Tailwind hardcodeadas. Buscar globalmente y reemplazar:

```
bg-white        →  bg-[--s0]
bg-gray-50      →  bg-[--s1]
bg-gray-100     →  bg-[--s2]
bg-gray-900     →  bg-[--bg]    (o bg-[--rail-bg] en sidebar)
bg-slate-950    →  bg-[--bg]
text-gray-500   →  text-[--text3]
text-gray-400   →  text-[--text3]
border-gray-200 →  border-[--border]
border-gray-800 →  border-[--border]
```

---

## PASO 16 — IMPORTAR EN `main.tsx`

El orden es crítico:

```typescript
import './styles/tokens.css'      // 1. Tokens y bridge shadcn
import './styles/components.css'  // 2. Componentes Linen
import './index.css'               // 3. Estilos globales app
```

---

## RESUMEN DEL SISTEMA LINEN

| Token           | Light            | Dark             | Uso                              |
|-----------------|------------------|------------------|----------------------------------|
| `--bg`          | `#f7f3ee`        | `#1c1711`        | Fondo de página                  |
| `--s0`          | `#ffffff`        | `#252017`        | Cards, panels, headers           |
| `--s1`          | `#f0ebe3`        | `#2e2820`        | Hover, inputs, secundario        |
| `--acc`         | `#1d4ed8`        | `#4f83f5`        | Acento principal, botón cobrar   |
| `--coral`       | `#e05e3a`        | `#f07653`        | QR alerts, urgencia, logo rail   |
| `--sage`        | `#4a7c59`        | `#68b07a`        | Estado listo, confirmación       |
| `--amber`       | `#c9841a`        | `#e6a535`        | Preparando, advertencia          |
| `--red`         | `#dc2626`        | `#f87171`        | Error, anulación                 |
| `--rail-bg`     | `#1a1208`        | `#141009`        | Rail (siempre oscuro)            |
| `--rail-accent` | `#e05e3a`        | `#f07653`        | Indicador activo en rail         |

| Fuente     | Variable      | Uso                              |
|------------|---------------|----------------------------------|
| Outfit     | `--f-disp`    | Títulos, nombres, botones CTA    |
| IBM Plex Sans | `--f-body` | Cuerpo, labels, formularios      |
| IBM Plex Mono | `--f-mono` | Precios, tiempos, códigos, datos |

---

## CHECKLIST DE VERIFICACIÓN

```
[ ] Fuentes Google cargando (Outfit, IBM Plex Sans, IBM Plex Mono)
[ ] tokens.css importado primero en main.tsx
[ ] Fondo de página: crema #f7f3ee (light) — no blanco puro
[ ] PIN Login: pad circular, dots azul marino, fondo crema
[ ] Mesas: cards con borde top de color según estado
[ ] Detalle Mesa: header + meta chips + tabs superiores
[ ] KDS: grid desktop, elapsed timer con colores urgencia
[ ] POS Caja: tabs + bottom sheet orden + cash stat grid
[ ] Dashboard: KPI cards con borde top color, barras pago
[ ] QR Cliente: botones grandes, CTA azul marino
[ ] Rail lateral: fondo #1a1208 con indicador coral
[ ] Rail en mobile: oculto por defecto, abre con botón ☰
[ ] Theme toggle: cambia data-theme en <html> + localStorage
[ ] Sin pantallas blancas — todas usan var(--bg) o var(--s0)
[ ] Shadcn dialogs/sheets: usan var(--s0) como fondo
[ ] Scrollbars: delgadas, color var(--border2)
```
