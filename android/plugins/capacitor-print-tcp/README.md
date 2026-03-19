# capacitor-print-tcp

Plugin Capacitor para enviar datos ESC/POS a impresoras térmicas por TCP (puerto 9100) y descubrir impresoras en la red local.

## Uso en la app

Cuando la plataforma Android está agregada (`npx cap add android`), registra el plugin en `MainActivity`:

```java
import com.rms.printtcp.PrintTcpPlugin;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(PrintTcpPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
```

Luego ejecuta `npx cap sync android` para copiar el plugin al proyecto nativo.

## Métodos

- **sendToPrinter({ host, port, dataBase64 })** — Envía bytes (base64) por TCP a `host:port`.
- **discoverPrinters({ port?, timeoutMs? })** — Escanea la LAN (puerto por defecto 9100) y devuelve `{ hosts: [ { host, port }, ... ] }`.

## Dependencias

El plugin no expone dependencias npm para el cliente; la app RMS usa `window.Capacitor.Plugins.PrintTcp` cuando corre dentro del wrapper Android.
