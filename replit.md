# RMS Mobile Wrapper

## Overview
Capacitor-based mobile wrapper project that loads an existing RMS web application inside a native WebView for Android and iOS. The project is designed to be compiled locally using Android Studio or Xcode — not inside Replit.

## Current State
- Project initialized with Capacitor 6.x, TypeScript, and all required plugins
- Environment-based URL configuration (DEV/PROD) with build scripts
- Web assets with offline overlay, Android back button handling, debug panel, and cookie persistence
- Comprehensive README with build, signing, and distribution instructions

## Project Architecture

### Key Directories
- `www/` — Web assets loaded into the WebView (index.html, CSS, JS)
- `scripts/` — Build scripts (config generator)
- `assets/` — Placeholder icons and splash screens
- `attached_assets/` — Original project requirements

### Key Files
- `scripts/generate-config.ts` — Generates `capacitor.config.ts` based on environment
- `www/js/app.js` — Core logic: offline detection, back button, debug panel, zoom prevention
- `www/css/app.css` — Styles for overlays, debug panel, loading screen
- `.env.example` — Environment variable template

### Build Scripts
- `npm run cap:android:dev` — Generate DEV config + sync Android
- `npm run cap:android:prod` — Generate PROD config + sync Android
- `npm run cap:ios:dev` — Generate DEV config + sync iOS
- `npm run cap:ios:prod` — Generate PROD config + sync iOS
- `npm run preview` — Preview web assets locally on port 5000

### Features Implemented
1. WebView loading external URL with environment switching
2. Cookie/session persistence across app restarts
3. Android back button: web history navigation or exit confirmation
4. Offline/online detection with overlay and auto-reload (5s cooldown)
5. Debug panel (DEV only) via triple-tap on top-right corner
6. HTTPS enforcement for production builds
7. Fullscreen mode with splash screen configuration
8. Zoom and keyboard issue prevention

### Technology Stack
- Capacitor 6.x (Core, CLI, Android, iOS)
- TypeScript for build scripts
- Vanilla JS for web assets (no framework needed)
- Capacitor plugins: @capacitor/app, @capacitor/network, @capacitor/splash-screen, @capacitor/status-bar

## User Preferences
- Language: Spanish (project documentation in Spanish)
- Distribution: Android APK via WhatsApp/direct link
- Build environment: Local (Android Studio / Xcode)
- No push notifications or printing in this phase

## Recent Changes
- Initial project creation with all core features
- Complete README with build, signing, and distribution documentation
