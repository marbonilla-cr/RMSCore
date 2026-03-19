# Plan de implementación: Print Server nativo Android (self-service) + compatibilidad Surface Go

## Caso de uso

- **Cliente:** tablet Android con app RMSCore (Capacitor).
- **Impresora:** Hoin H803 WiFi en la misma red local (TCP 9100).
- **Solo tickets de venta** (no KDS por ahora).
- **Sin Surface Go ni PC local.**
- **Self-service:** el cliente no configura tokens ni IPs a mano; descubre impresoras en la red, elige una y la guarda.

## Objetivos de arquitectura

1. Plugin Capacitor en Android: TCP directo a impresora (ip:9100) y descubrimiento en LAN (escaneo puerto 9100).
2. Reutilizar tabla `printers` (IP, puerto, paperWidth); configuración guardada vía API desde la app.
3. Backend genera ESC/POS con `server/escpos.ts` y envía el job por WebSocket.
4. Android recibe el job por WebSocket y envía bytes por TCP a la impresora.
5. **Bridge Android se autentica con la sesión del usuario** (sin token separado).
6. **Descubrimiento automático** de impresoras en la red local desde la app; el cliente **solo selecciona** de una lista encontrada.
7. **Superadmin** puede ver el estado de todos los bridges conectados por tenant.
8. Mantener compatibilidad con el print bridge del Surface Go (La Antigua), que sigue usando token.
9. Pago en efectivo: comando ESC/POS de gaveta en el mismo ticket (ya en `server/escpos.ts` con `openDrawer`).

---

## Arquitectura de alto nivel (actualizada)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ FLUJO SELF-SERVICE (Android)                                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│ 1. Usuario inicia sesión en la app (tablet).                                      │
│ 2. App abre WebSocket a /ws CON LA MISMA SESIÓN (cookie).                         │
│ 3. App envía "register_as_print_bridge" → servidor registra bridge por usuario   │
│    (bridgeId = "user-{userId}"), crea/actualiza fila en print_bridges.           │
│ 4. Usuario va a "Configurar impresora" → "Buscar impresoras" → plugin escanea    │
│    la LAN (puerto 9100) → lista de { host, port }.                                │
│ 5. Usuario elige una → opcionalmente nombre → Guardar → POST /api/admin/printers │
│    con { name, type: "caja", ipAddress, port, paperWidth }; el servidor asigna   │
│    bridgeId = "user-{userId}" a esa impresora.                                   │
│ 6. Al imprimir desde POS, backend usa dispatchPrintJobViaBridge(printerId)       │
│    → busca conexión por printer.bridgeId ("user-123") → envía PRINT_JOB al WS.  │
│ 7. Android recibe PRINT_JOB → plugin TCP envía payload a printerIp:9100.         │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│ FLUJO LEGACY (Surface Go) — sin cambios para La Antigua                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Conexión con header x-bridge-token; validación por token en DB; bridgeId del row.│
│ Misma cola PRINT_JOB; Surface Go añade handler PRINT_JOB (ip/port en mensaje).   │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│ SUPERADMIN                                                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│ GET /api/superadmin/print-bridges → lista por tenant: bridges conectados,        │
│ bridgeId, displayName, connectedAt, tenantSchema/name.                           │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Cambios significativos respecto al plan anterior

| Aspecto | Antes | Ahora (self-service) |
|---------|--------|------------------------|
| **Auth del bridge Android** | Token en header `x-bridge-token`, guardado en localStorage / pantalla manual | Sesión del usuario: WebSocket a /ws con cookie de sesión; mensaje `register_as_print_bridge`; servidor asocia bridge a `user-{userId}` |
| **Configuración de impresora** | Admin crea impresora con IP/puerto manual; usuario pega token en tablet | Usuario en tablet: "Buscar impresoras" (descubrimiento en LAN) → elige de la lista → Guardar; backend persiste en `printers` y asigna `bridgeId = user-{userId}` |
| **Identificación del bridge** | Token → bridgeId desde tabla `print_bridges` | bridgeId = `"user-"+userId`; fila en `print_bridges` creada/actualizada al registrar por sesión |
| **Lookup de conexión en servidor** | Map keyed by token; dispatch busca bridge por token del row | Map keyed by **bridgeId**; dispatch busca `bridgeConnections.get(printer.bridgeId)` |
| **Superadmin** | No existía | Endpoint que lista bridges conectados por tenant |

---

## Contrato WebSocket para bridges

**Mensaje servidor → bridge (sin cambio):**

```json
{
  "type": "PRINT_JOB",
  "printerId": 1,
  "printerIp": "192.168.2.200",
  "printerPort": 9100,
  "paperWidth": 80,
  "jobType": "receipt",
  "payload": "<base64 del buffer ESC/POS>"
}
```

**Nuevo: registro de bridge por sesión (solo Android/app con sesión):**

- Cliente conecta a `/ws` **sin** header `x-bridge-token` (usa cookie de sesión; el upgrade de WebSocket debe pasar por el mismo middleware de sesión que la app).
- Tras el upgrade, cliente envía:
  ```json
  { "type": "register_as_print_bridge" }
  ```
- Servidor: valida sesión (req.session.userId), define `bridgeId = "user-" + userId`, hace upsert en `print_bridges` (bridge_id, display_name desde usuario, token puede ser interno o null), registra la conexión en un map por **bridgeId**, responde:
  ```json
  { "type": "CONNECTED", "bridgeId": "user-123", "schema": "tenant_xxx" }
  ```

---

## Descubrimiento de impresoras en la LAN

- **Qué se necesita:** desde la app Android, obtener una lista de hosts en la red local que tengan el puerto **9100** abierto (impresoras térmicas típicas).
- **Implementación:** plugin Capacitor que en Android recorra las IPs del subred local (ej. WiFi del dispositivo) y haga intentos de conexión TCP al puerto 9100 con timeout corto (ej. 500–800 ms); las que respondan se consideran candidatas. Alternativa: escaneo en paralelo (por rangos) para no tardar demasiado.
- **Salida del plugin:** lista de `{ host: string, port: number }` (port será 9100). Opcional: intentar leer un byte o enviar INIT para confirmar que es impresora ESC/POS; si no, igualmente mostrarla como candidata.
- **UI:** en la app, pantalla “Configurar impresora” o sección en Admin (visible en tablet) con botón “Buscar impresoras” → se llama al plugin → se muestra la lista → el usuario elige una, puede editar nombre y tipo (caja) → “Guardar” → POST a la API para crear/actualizar la impresora con ese host/puerto y `bridgeId` asignado en servidor.

---

## Plan de implementación paso a paso (actualizado)

### Fase 1 — Backend: map de bridges por bridgeId y registro por sesión

Objetivo: keyear conexiones por `bridgeId`; permitir registro de bridge por sesión (sin token) además del actual por token.

| Paso | Descripción | Archivo(s) |
|------|-------------|------------|
| 1.1 | En `print-service.ts`: cambiar `bridgeConnections` para que la clave sea **bridgeId** (no token). `registerBridge(bridgeId, tenantSchema, ws)` y `unregisterBridge(bridgeId)`. En `dispatchPrintJobViaBridge` obtener conexión con `bridgeConnections.get(printer.bridgeId)` (y seguir actualizando `lastSeenAt` en la fila de `print_bridges` si se desea). | `server/services/print-service.ts` |
| 1.2 | Para bridges con token (Surface Go): al validar token y obtener bridgeId, llamar `registerBridge(bridgeId, tenantSchema, ws)` y en el `close` del ws llamar `unregisterBridge(bridgeId)`. Mantener creación/actualización de fila en `print_bridges` por token como hoy. | `server/routes.ts` (handler WebSocket bridge por token) |
| 1.3 | WebSocket con sesión: en el upgrade de `/ws`, si **no** viene `x-bridge-token`, aceptar la conexión pasando por el middleware de sesión (igual que el resto de la app). En el handler de conexión, aceptar mensaje `register_as_print_bridge`: leer userId de la sesión asociada al request (hay que pasar la request al handler o guardar session en el upgrade). Crear o actualizar fila en `print_bridges` con `bridge_id = 'user-'+userId`, `display_name` desde usuario (ej. "Tablet - Juan") o por defecto "Tablet"; token puede ser un valor interno aleatorio (para no romper schema). Llamar `registerBridge('user-'+userId, tenantSchema, ws)` y enviar `CONNECTED` con bridgeId y schema. | `server/routes.ts` |
| 1.4 | Al crear impresora vía API: si el usuario tiene un bridge registrado (conexión activa con bridgeId = 'user-'+userId) o al menos una fila en `print_bridges` con ese bridge_id, al hacer POST /api/admin/printers sin `bridgeId` en el body, el servidor puede asignar `bridgeId = 'user-'+req.session.userId` para esa impresora. Así la tablet solo envía name, type, ipAddress, port, paperWidth. | `server/routes.ts` (POST /api/admin/printers) |

---

### Fase 2 — Backend: rutas POS usan dispatchPrintJobViaBridge cuando hay bridgeId

Objetivo: igual que antes; no depende de token vs sesión.

| Paso | Descripción | Archivo(s) |
|------|-------------|------------|
| 2.1 | En `POST /api/pos/print-receipt`: si `cajaPrinter.bridgeId` está definido, usar `dispatchPrintJobViaBridge(...)`; si no, lógica actual. `openDrawer: hasCashPayment` ya está. | `server/routes.ts` |
| 2.2 | Igual en `POST /api/pos/print-precuenta` y `POST /api/pos/open-drawer`. | `server/routes.ts` |

---

### Fase 3 — Superadmin: estado de bridges por tenant

| Paso | Descripción | Archivo(s) |
|------|-------------|------------|
| 3.1 | Añadir en el módulo superadmin un endpoint `GET /api/superadmin/print-bridges` (protegido con `requireSuperadmin`). Obtener lista de tenants activos; para cada uno, llamar a `getConnectedBridgesForTenant(tenantSchema)` (o equivalente que devuelva bridgeId, connectedAt). Opcionalmente unir con datos de `print_bridges` (displayName, etc.) por tenant. Respuesta: array por tenant con schema/name y lista de bridges conectados (bridgeId, displayName, connectedAt). | `server/provision/provision-routes.ts` o donde estén las rutas superadmin; posiblemente exportar/uso de `getConnectedBridgesForTenant` desde print-service y una función que itere todos los tenants. |

---

### Fase 4 — Android: plugin Capacitor (TCP + descubrimiento)

Objetivo: enviar bytes por TCP y descubrir hosts con puerto 9100 abierto en la LAN.

| Paso | Descripción | Archivo(s) |
|------|-------------|------------|
| 4.1 | Crear plugin local `capacitor-print-tcp` (o nombre similar). Método `sendToPrinter({ host, port, dataBase64 })` → TCP a host:port, escribir payload, cerrar. Timeout ~5–8 s. | `android/plugins/capacitor-print-tcp/` (Java/Kotlin + defs TS) |
| 4.2 | Método `discoverPrinters(options?: { port?: number, timeoutMs?: number })` → en Android obtener la IP del dispositivo y el prefijo de subred (ej. 192.168.1.x), iterar (ej. 192.168.1.1–254), intentar conexión TCP a puerto (default 9100) con timeout corto; devolver lista de `{ host: string, port: number }` que hayan aceptado conexión. No bloquear el UI: ejecutar en background y devolver resultado. | Mismo plugin |
| 4.3 | Registrar plugin en el proyecto Android del wrapper. | `android/package.json`, `MainActivity`, `capacitor.config` si aplica |

---

### Fase 5 — Cliente: bridge por sesión (sin token) y UI de descubrimiento

Objetivo: en Capacitor Android, con sesión iniciada, registrar el bridge por sesión y ofrecer “Buscar impresoras” + guardar en `printers` vía API.

| Paso | Descripción | Archivo(s) |
|------|-------------|------------|
| 5.1 | Bridge client: conectar WebSocket a `/ws` **sin** header `x-bridge-token` (la cookie de sesión se envía automáticamente si el WS es al mismo origin). Tras conectar, enviar `{ type: "register_as_print_bridge" }`. Al recibir `CONNECTED`, considerar bridge listo. Al recibir `PRINT_JOB`, llamar al plugin `sendToPrinter({ host: printerIp, port: printerPort, dataBase64: payload })`. Solo activar este flujo cuando `Capacitor.getPlatform() === 'android'` (y opcionalmente solo si hay sesión). | `client/src/lib/print-bridge-client.ts` |
| 5.2 | Integrar el bridge client en el arbol de la app (ej. en `App.tsx` o layout): al montar, si es Android nativo, iniciar el cliente WebSocket (singleton) sin depender de ningún token en localStorage. | `client/src/App.tsx` (o layout) |
| 5.3 | Pantalla o sección “Configurar impresora” (accesible desde Admin en la tablet): botón “Buscar impresoras” que llama al plugin `discoverPrinters()`, muestra la lista de candidatos; el usuario selecciona una, puede editar nombre (ej. “Impresora Caja”) y tipo (caja), luego “Guardar” → POST `/api/admin/printers` con `{ name, type: "caja", ipAddress, port, paperWidth }`. El backend asigna `bridgeId = 'user-'+userId` a esa impresora. Si ya existe una impresora de caja para ese bridge, puede ser PATCH en lugar de POST (editar la existente). | Nueva página o sección: ej. `client/src/pages/admin/printers.tsx` (añadir bloque “Configurar mi impresora” cuando sea Android) o `client/src/pages/admin/printer-setup.tsx` |
| 5.4 | Wrapper seguro del plugin (Capacitor + sendToPrinter / discoverPrinters) para usarlo solo cuando el plugin exista. | `client/src/lib/capacitor-print.ts` |

---

### Fase 6 — Print bridge Surface Go: soportar PRINT_JOB

Sin cambios respecto al plan anterior.

| Paso | Descripción | Archivo(s) |
|------|-------------|------------|
| 6.1 | En `print-bridge/index.js`, si `msg.type === 'PRINT_JOB'`: usar `msg.printerIp`, `msg.printerPort`, `msg.payload` (base64) y enviar por TCP. Mantener `print_job` legacy. | `print-bridge/index.js` |

---

### Fase 7 — Pruebas y documentación

| Paso | Descripción | Archivo(s) |
|------|-------------|------------|
| 7.1 | Probar flujo self-service: login en tablet → “Configurar impresora” → Buscar → seleccionar → Guardar → imprimir desde POS (efectivo y no efectivo; gaveta en efectivo). | — |
| 7.2 | Probar que Surface Go (La Antigua) sigue funcionando con token y que superadmin ve bridges por tenant. | — |
| 7.3 | Documentar en .cursorrules o README: bridge por sesión (user-{userId}), descubrimiento LAN, guardado en `printers` vía API, superadmin print-bridges. | `.cursorrules` o `docs/` |

---

## Resumen de archivos a crear o modificar (actualizado)

| Acción | Ruta |
|--------|------|
| Modificar | `server/services/print-service.ts` — map por bridgeId; register/unregister por bridgeId; dispatch look up by printer.bridgeId |
| Modificar | `server/routes.ts` — WebSocket: registro por sesión (`register_as_print_bridge`), registro por token que use bridgeId en register/unregister; POS print-receipt/precuenta/open-drawer usan dispatchPrintJobViaBridge cuando hay bridgeId; POST /api/admin/printers asigna bridgeId = 'user-'+userId cuando aplica |
| Modificar | `server/provision/provision-routes.ts` (o donde esté superadmin) — GET /api/superadmin/print-bridges |
| Modificar | `print-bridge/index.js` — handler PRINT_JOB |
| Crear | `android/plugins/capacitor-print-tcp/` — sendToPrinter + discoverPrinters |
| Crear | `client/src/lib/capacitor-print.ts` — wrapper del plugin |
| Crear | `client/src/lib/print-bridge-client.ts` — WebSocket por sesión, sin token; handler PRINT_JOB |
| Modificar | `client/src/App.tsx` — arrancar bridge client en Android |
| Crear / Modificar | Pantalla o sección en Admin “Configurar impresora” con “Buscar impresoras” y guardado vía API — ej. `client/src/pages/admin/printers.tsx` o `client/src/pages/admin/printer-setup.tsx` |

---

## Comando de gaveta en pago efectivo

Sin cambios: ya está en `server/escpos.ts` (`openDrawer`, `CMD.OPEN_DRAWER`) y en `POST /api/pos/print-receipt` con `openDrawer: hasCashPayment`. El buffer único se envía en `PRINT_JOB.payload`; el bridge (Android o Surface Go) solo reenvía por TCP.

---

## Compatibilidad Surface Go (La Antigua)

- Surface Go sigue conectando con `x-bridge-token`; el servidor valida token, obtiene bridgeId de la tabla, registra con `registerBridge(bridgeId, tenantSchema, ws)`. No se usa bridgeId "user-*" para Surface Go.
- La tabla `print_bridges` sigue teniendo filas con token para bridges legacy; para usuarios que se registran por sesión, se crean filas con `bridge_id = 'user-'+userId` y un token interno si el schema lo exige.

---

## Notas de implementación

- **WebSocket y sesión:** el upgrade de WebSocket no tiene cookies en algunos clientes por defecto. En el caso de la app Capacitor cargando la misma origin que el backend, hay que asegurar que la petición de upgrade incluya la cookie de sesión (Capacitor WebView suele enviarla). Si el WS se abre desde otra URL (ej. otra pestaña), habría que pasar un token de sesión en el primer mensaje y validarlo en el servidor como alternativa.
- **Descubrimiento:** el rango de IPs a escanear se puede derivar de la IP del dispositivo (ej. 192.168.1.2 → escanear 192.168.1.1–254). En Android hay APIs para obtener la dirección de red del WiFi actual.
- **Un bridge por usuario:** si el mismo usuario abre la app en dos dispositivos, el segundo registro puede reemplazar al primero (un solo bridgeId por usuario), de modo que solo el último dispositivo reciba los PRINT_JOB. Alternativa: permitir varios bridges por usuario (bridgeId = user-123-device-1, etc.); el plan actual usa un solo bridge por usuario para simplificar.
