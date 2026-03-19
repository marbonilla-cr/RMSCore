# App Icons

Place your app icon files here. Capacitor requires the following:

## Android
- `icon.png` - 1024x1024px (Capacitor will generate all required sizes)

## iOS
- `icon.png` - 1024x1024px (no transparency, no alpha channel)

## How to Replace

1. Create a 1024x1024px PNG icon
2. Save it as `icon.png` in this folder
3. Use the Capacitor asset generation tool:

```bash
npx @capacitor/assets generate --iconBackgroundColor '#1a1a2e' --iconBackgroundColorDark '#1a1a2e'
```

Or manually place icons in:
- Android: `android/app/src/main/res/mipmap-*`
- iOS: `ios/App/App/Assets.xcassets/AppIcon.appiconset/`
