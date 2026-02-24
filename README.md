# RMS Mobile Wrapper

Wrapper móvil usando **Capacitor** para cargar tu aplicación RMS (PWA/web) como app nativa en Android e iOS.

> **No reescribe pantallas** — carga tu RMS existente dentro de un WebView nativo con funcionalidades extra: manejo del botón atrás, detección de conectividad, persistencia de sesión y panel de diagnóstico.

---

## Tabla de Contenido

1. [Requisitos Previos](#requisitos-previos)
2. [Instalación](#instalación)
3. [Configuración de Entorno](#configuración-de-entorno)
4. [Generar Proyecto Android](#generar-proyecto-android)
5. [Compilar en Android Studio](#compilar-en-android-studio)
6. [Firmar APK/AAB para Release](#firmar-apkaab-para-release)
7. [Distribución por WhatsApp (Android)](#distribución-por-whatsapp-android)
8. [iOS](#ios)
9. [Funcionalidades](#funcionalidades)
10. [Cookies y Sesiones](#cookies-y-sesiones)
11. [Troubleshooting](#troubleshooting)

---

## Requisitos Previos

| Herramienta       | Versión mínima | Descarga                                         |
| ----------------- | -------------- | ------------------------------------------------ |
| Node.js           | 18+            | https://nodejs.org                               |
| npm               | 9+             | (incluido con Node.js)                           |
| Java JDK          | 17+            | https://adoptium.net                             |
| Android Studio    | 2023+          | https://developer.android.com/studio             |
| Android SDK       | API 33+        | (instalar desde Android Studio SDK Manager)      |
| Xcode (solo Mac)  | 15+            | Mac App Store                                    |

### Verificar instalaciones

```bash
node --version    # v18+
npm --version     # 9+
java --version    # 17+
```

---

## Instalación

### A) Clonar el repositorio e instalar dependencias

```bash
git clone <tu-repositorio-url> rms-mobile-wrapper
cd rms-mobile-wrapper
npm install
```

### B) Configurar el entorno

```bash
cp .env.example .env
```

Edita `.env` con las URLs de tu RMS:

```env
BASE_URL_DEV=http://192.168.1.100:3000
BASE_URL_PROD=https://rms.tuempresa.com
```

---

## Configuración de Entorno

El proyecto usa dos variables de entorno:

| Variable          | Uso                              | Protocolo      |
| ----------------- | -------------------------------- | -------------- |
| `BASE_URL_DEV`    | URL de desarrollo/staging        | http o https   |
| `BASE_URL_PROD`   | URL de producción                | **solo https** |

### Scripts disponibles

```bash
# Android
npm run cap:android:dev    # Genera config DEV + sincroniza Android
npm run cap:android:prod   # Genera config PROD + sincroniza Android

# iOS
npm run cap:ios:dev        # Genera config DEV + sincroniza iOS
npm run cap:ios:prod       # Genera config PROD + sincroniza iOS
```

Cada script:
1. Lee `.env` y genera `capacitor.config.ts` con la URL correcta
2. Valida que PROD use HTTPS (bloquea si no)
3. Sincroniza los archivos con la plataforma nativa

---

## Generar Proyecto Android

### Primera vez

```bash
# 1. Generar configuración para DEV
npm run cap:android:dev

# 2. Agregar plataforma Android (solo la primera vez)
npm run cap:add:android

# 3. Sincronizar
npm run cap:android:dev
```

### Abrir en Android Studio

```bash
npx cap open android
```

---

## Compilar en Android Studio

### APK Debug (para pruebas)

1. Abre el proyecto en Android Studio
2. Menú: **Build → Build Bundle(s) / APK(s) → Build APK(s)**
3. El APK se genera en: `android/app/build/outputs/apk/debug/app-debug.apk`

### Desde la terminal (alternativa)

```bash
cd android
./gradlew assembleDebug
```

---

## Firmar APK/AAB para Release

### Paso 1: Crear Keystore (solo una vez)

```bash
keytool -genkey -v \
  -keystore rms-release-key.jks \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -alias rms-key
```

> **IMPORTANTE**: Guarda el keystore y la contraseña en un lugar seguro. Si los pierdes, no podrás actualizar la app.

### Paso 2: Configurar firma en Android Studio

1. Menú: **Build → Generate Signed Bundle / APK**
2. Selecciona **APK** (para distribución directa) o **AAB** (para Play Store)
3. Selecciona tu keystore (`rms-release-key.jks`)
4. Ingresa las contraseñas
5. Selecciona **release** como build variant
6. Click en **Create**

### Paso 3: Ubicación del APK firmado

```
android/app/build/outputs/apk/release/app-release.apk
```

### Alternativa por terminal

Crea `android/app/signing.properties`:

```properties
storeFile=../../rms-release-key.jks
storePassword=TU_PASSWORD
keyAlias=rms-key
keyPassword=TU_KEY_PASSWORD
```

Luego:

```bash
cd android
./gradlew assembleRelease
```

---

## Distribución por WhatsApp (Android)

> **Nota importante**: La distribución por WhatsApp/link directo es **solo para Android**. Para iOS, ver la [sección de iOS](#ios).

### Opción 1: Google Drive / Dropbox

1. Sube el APK firmado a Google Drive o Dropbox
2. Obtén el enlace de descarga directa
3. Comparte el enlace por WhatsApp

### Opción 2: Hosting propio

1. Sube el APK a tu servidor web
2. Asegúrate de que el servidor permita descargar archivos `.apk` (MIME type: `application/vnd.android.package-archive`)
3. Comparte la URL por WhatsApp

### Opción 3: Firebase App Distribution

1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com)
2. Sube el APK en **App Distribution**
3. Invita a testers por email/link

### Instrucciones para el usuario final

Envía este mensaje junto al link:

```
📱 Descarga RMS App:
[TU_LINK_AQUÍ]

Instrucciones:
1. Abre el link y descarga el archivo
2. Si te pide permiso, activa "Instalar desde fuentes desconocidas"
   (Ajustes → Seguridad → Fuentes desconocidas)
3. Abre el archivo descargado e instala
4. ¡Listo! Busca "RMS" en tus apps
```

---

## iOS

### Distribución en iOS

iOS **NO** permite instalar apps por enlace directo como Android. Las opciones son:

| Método             | Requisito                            | Costo    |
| ------------------ | ------------------------------------ | -------- |
| **PWA**            | Agregar web a pantalla de inicio     | Gratis   |
| **TestFlight**     | Cuenta Apple Developer               | $99/año  |
| **App Store**      | Cuenta Apple Developer + Revisión    | $99/año  |

### Compilar para iOS (requiere Mac)

```bash
# Generar config
npm run cap:ios:dev   # o cap:ios:prod

# Agregar plataforma (primera vez)
npm run cap:add:ios

# Abrir en Xcode
npx cap open ios
```

En Xcode:
1. Selecciona tu equipo de desarrollo (Signing & Capabilities)
2. Conecta un iPhone o selecciona un simulador
3. **Product → Run**

---

## Funcionalidades

### Botón Atrás (Android)
- Si hay historial de navegación web → navega hacia atrás
- Si no hay historial → muestra diálogo "¿Salir de RMS?" → cierra la app

### Detección de Conectividad
- Detecta automáticamente cuando se pierde la conexión
- Muestra overlay: **"Sin conexión. Reintentando..."**
- Al reconectar: oculta el overlay y recarga automáticamente
- **Cooldown de 5 segundos** entre recargas para evitar loops

### Panel de Debug (solo DEV)
- **Triple tap** en la esquina superior derecha para abrir
- Muestra:
  - Versión del wrapper
  - Entorno (DEV/PROD)
  - URL actual
  - Estado online/offline
  - Estado de cookies

### Splash Screen
- Pantalla de carga con logo "RMS" y spinner
- Duración: 2 segundos
- Reemplaza los assets en `assets/splash/` y `assets/icon/`

### Seguridad
- **PROD**: Requiere HTTPS obligatoriamente
- **DEV**: Permite HTTP (con advertencia en consola)
- Cleartext traffic bloqueado en PROD

---

## Cookies y Sesiones

### Persistencia de Sesión
El WebView de Capacitor **mantiene las cookies y sesión** entre cierres y aperturas de la app por defecto. Tu sesión de login permanecerá activa.

### ⚠ Recomendación Importante: SameSite Cookies

Para evitar problemas con cookies y sesiones, se recomienda:

1. **Frontend y backend en el mismo dominio**
   - ✅ `https://rms.tuempresa.com` (todo en el mismo dominio)
   - ✅ `https://app.tuempresa.com` + `https://api.tuempresa.com` (subdominios del mismo dominio)
   - ❌ `https://frontend.com` + `https://api-backend.com` (dominios diferentes)

2. **Configurar cookies del backend correctamente**:
   ```
   Set-Cookie: session=abc123; SameSite=None; Secure; HttpOnly
   ```

3. **Si usas subdominios diferentes**, configura:
   ```
   Set-Cookie: session=abc123; Domain=.tuempresa.com; SameSite=Lax; Secure; HttpOnly
   ```

### WebSockets
El WebView de Capacitor soporta WebSockets nativamente. No requiere configuración adicional.

---

## Troubleshooting

### Checklist: "No se instala el APK"

- [ ] **Fuentes desconocidas**: Activar en Ajustes → Seguridad → "Instalar apps desconocidas"
- [ ] **Espacio**: Verificar que hay espacio suficiente en el dispositivo
- [ ] **Versión Android**: Requiere Android 5.0+ (API 21+)
- [ ] **APK corrupto**: Volver a descargar el archivo
- [ ] **Permisos**: Dar permiso al navegador/WhatsApp para instalar apps
- [ ] **Play Protect**: Si Google Play Protect bloquea, tocar "Instalar de todas formas"

### La app muestra pantalla en blanco

1. Verificar que la URL en `.env` es accesible desde el dispositivo
2. Si es desarrollo local, el dispositivo debe estar en la misma red WiFi
3. Revisar que el servidor RMS está corriendo
4. En DEV, usar `npx cap open android` → Chrome DevTools para inspeccionar

### Las cookies no persisten

1. Verificar configuración SameSite (ver sección Cookies)
2. Asegurar que frontend y backend están en el mismo dominio
3. No usar modo incógnito en el WebView

### El WebSocket no conecta

1. Verificar que la URL del WebSocket usa `wss://` en producción
2. Asegurar que el certificado SSL es válido
3. En desarrollo, `ws://` funciona con `cleartext: true`

### Error "HTTPS requerido"

- La URL de producción (`BASE_URL_PROD`) **debe** comenzar con `https://`
- Si ves este error, edita tu archivo `.env`
- HTTP solo se permite en modo desarrollo

### Cómo inspeccionar el WebView (DEV)

1. Conecta el dispositivo Android por USB
2. Habilita "Depuración USB" en Opciones de Desarrollador
3. En Chrome desktop, ve a `chrome://inspect`
4. Selecciona tu dispositivo y la pestaña del WebView

---

## Personalización

### Cambiar App ID y Nombre

1. Edita `scripts/generate-config.ts`:
   - `appId`: Cambia `'com.rms.app'` por tu package ID
   - `appName`: Cambia `'RMS'` por el nombre deseado

2. Regenera y sincroniza:
   ```bash
   npm run cap:android:dev
   ```

### Cambiar Colores

Los colores principales están en:
- `www/css/app.css` — colores del overlay y debug panel
- `scripts/generate-config.ts` — color del splash screen y status bar

| Color     | Uso                          | Ubicación                |
| --------- | ---------------------------- | ------------------------ |
| `#1a1a2e` | Background principal         | CSS + Capacitor config   |
| `#e94560` | Accent (spinner, borders)    | CSS + Capacitor config   |
| `#4ecca3` | Success (estados positivos)  | CSS                      |

---

## Estructura del Proyecto

```
rms-mobile-wrapper/
├── www/                    # Web assets (cargados en el WebView)
│   ├── index.html          # HTML principal con overlays
│   ├── css/app.css         # Estilos
│   └── js/app.js           # Lógica: offline, back button, debug
├── scripts/
│   └── generate-config.ts  # Generador de capacitor.config.ts
├── assets/
│   ├── icon/               # Íconos de la app (placeholder)
│   └── splash/             # Splash screen (placeholder)
├── .env.example            # Template de configuración
├── package.json            # Dependencias y scripts
├── tsconfig.json           # Configuración TypeScript
└── README.md               # Este archivo
```

---

## Notas Técnicas

- **No** se implementa push notifications (fase futura)
- **No** se implementa impresión nativa (fase futura)
- La compilación se hace localmente en Android Studio / Xcode
- El wrapper es compatible con cookies, sesiones y WebSockets sin cambios en el backend
