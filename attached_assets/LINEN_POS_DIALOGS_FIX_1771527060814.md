# PROMPT — MIGRAR POS DIALOGS A LINEN
# Para Replit Agent
# Archivo: `client/src/components/pos/pos-dialogs.css`
# Cambio: UN SOLO BLOQUE de 30 líneas al inicio del archivo.

---

## DIAGNÓSTICO

El archivo usa variables CSS internas (`--c-green`, `--c-blue`, `--c-s0`, etc.)
que se declaran en el selector `.pos-overlay` entre las líneas 7 y 41.
TODO el resto del archivo ya referencia esas variables correctamente.

El único problema es que los VALORES de esas variables están hardcodeados
con los colores del dark theme original.

La solución es reemplazar solo ese bloque de tokens. No tocar ninguna
otra línea del archivo.

---

## CAMBIO ÚNICO — Reemplazar el bloque de tokens

Buscar este bloque EXACTO (líneas 7–41):

```css
/* ── DESIGN TOKENS — bridged to Linen dark palette ── */
.pos-overlay {
  --c-bg:      #141009;
  --c-s0:      #1c1711;
  --c-s1:      #252017;
  --c-s2:      #2e2820;
  --c-s3:      #3a332a;
  --c-border:  #3a332a;
  --c-border2: #453e34;
  --c-green:   #68b07a;
  --c-green-d: rgba(104,176,122,0.12);
  --c-green-m: rgba(104,176,122,0.25);
  --c-amber:   #e6a535;
  --c-amber-d: rgba(230,165,53,0.12);
  --c-amber-m: rgba(230,165,53,0.25);
  --c-blue:    #4f83f5;
  --c-blue-d:  rgba(79,131,245,0.12);
  --c-blue-m:  rgba(79,131,245,0.25);
  --c-red:     #f87171;
  --c-red-d:   rgba(248,113,113,0.12);
  --c-text:    #f5ede3;
  --c-text2:   #c4b5a5;
  --c-text3:   #8a7d6e;
  --c-text4:   #5a4e40;
  --f-display: var(--f-disp);
  --f-body:    var(--f-body);
  --f-mono:    var(--f-mono);
  --r-sm: var(--r-sm);
  --r-md: var(--r-md);
  --r-lg: var(--r-lg);
  --r-xl: var(--r-xl);
  --shadow-dialog: 0 32px 80px rgba(0,0,0,0.75), 0 0 0 1px var(--c-border);
  --t-fast: var(--t-fast);
  --t-mid:  var(--t-mid);
  --t-slow: var(--t-slow);
}
```

Reemplazarlo por este bloque nuevo:

```css
/* ── DESIGN TOKENS — Linen system ── */
.pos-overlay {
  --c-bg:      var(--bg);
  --c-s0:      var(--s0);
  --c-s1:      var(--s1);
  --c-s2:      var(--s2);
  --c-s3:      var(--s3, var(--s2));
  --c-border:  var(--border);
  --c-border2: var(--border2);
  --c-green:   var(--sage);
  --c-green-d: var(--sage-d);
  --c-green-m: var(--sage-m);
  --c-amber:   var(--amber);
  --c-amber-d: var(--amber-d);
  --c-amber-m: var(--amber-m);
  --c-blue:    var(--acc);
  --c-blue-d:  var(--acc-d);
  --c-blue-m:  var(--acc-m);
  --c-red:     var(--red);
  --c-red-d:   var(--red-d);
  --c-text:    var(--text);
  --c-text2:   var(--text2);
  --c-text3:   var(--text3);
  --c-text4:   var(--text4);
  --f-display: var(--f-disp);
  --f-body:    var(--f-body);
  --f-mono:    var(--f-mono);
  --r-sm: var(--r-sm);
  --r-md: var(--r-md);
  --r-lg: var(--r-lg);
  --r-xl: var(--r-xl);
  --shadow-dialog: 0 32px 80px rgba(0,0,0,0.55), 0 0 0 1px var(--c-border);
  --t-fast: var(--t-fast);
  --t-mid:  var(--t-mid);
  --t-slow: var(--t-slow);
}
```

---

## CAMBIO ADICIONAL — 4 valores hardcodeados que quedan en el resto del archivo

Después de reemplazar el bloque de tokens, hacer búsqueda y reemplazo
de estos 4 valores que no usan variables y quedaron hardcodeados:

| Línea | Buscar | Reemplazar por | Dónde aparece |
|---|---|---|---|
| ~871 | `rgba(46,204,113,0.3)` | `var(--sage-m)` | `.pos-sub-card.filled` border-color |
| ~900 | `rgba(46,204,113,0.3)` | `var(--sage-m)` | `.pos-sc-pay-btn` border |
| ~913 | `#050a07` | `var(--bg)` | `.pos-sc-pay-btn:hover` color de texto |
| ~939 | `rgba(52,152,219,0.5)` | `var(--acc-m)` | `.pos-separate-btn.ready` border-color |

---

## CAMBIO ADICIONAL — Animación pos-flash-success

La animación de destello usa verde hardcodeado. Actualizarla para usar
el acento azul marino de Linen:

Buscar (líneas ~986–990):

```css
@keyframes pos-flash-success {
  0%   { box-shadow: 0 0 0 0 rgba(46,204,113,0); }
  30%  { box-shadow: 0 0 0 8px rgba(46,204,113,0.45); }
  100% { box-shadow: 0 0 0 16px rgba(46,204,113,0); }
}
```

Reemplazar por:

```css
@keyframes pos-flash-success {
  0%   { box-shadow: 0 0 0 0 var(--acc-d); }
  30%  { box-shadow: 0 0 0 8px var(--acc-m); }
  100% { box-shadow: 0 0 0 16px var(--acc-d); }
}
```

---

## NADA MÁS TOCAR

El resto de las 1135 líneas del archivo ya usa `var(--c-*)` correctamente.
Con los tres cambios de arriba el sistema queda completamente en Linen:

- `.pos-overlay` → fondos y superficies del tema actual (light/dark)
- CASH → sage verde (diferente del acento)
- CARD → acc azul marino (acento principal Linen)
- SINPE → amber ámbar
- Items movidos en SplitDialog → acc azul marino
- Tab activo → acc azul marino
- Botón "Separar" ready → acc azul marino
- Destello de confirmación → acc azul marino

No tocar: PayDialog.tsx, SplitDialog.tsx, ningún archivo .tsx, breakpoints,
transforms, animación pos-vibrate.
