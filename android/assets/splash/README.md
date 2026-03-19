# Splash Screen

Place your splash screen files here.

## Required Files
- `splash.png` - 2732x2732px (center content in safe area of 1200x1200px)
- `splash-dark.png` - (optional) dark mode variant

## How to Replace

1. Create a 2732x2732px PNG splash image
2. Keep the important content centered within 1200x1200px
3. Save as `splash.png` in this folder
4. Run the asset generator:

```bash
npx @capacitor/assets generate --splashBackgroundColor '#1a1a2e' --splashBackgroundColorDark '#1a1a2e'
```

## Current Configuration (capacitor.config.ts)
- Background color: `#1a1a2e`
- Spinner color: `#e94560`
- Display duration: 2000ms
- Auto-hide: enabled
- Fullscreen + Immersive mode
