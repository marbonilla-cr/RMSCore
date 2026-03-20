import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rms.app',
  appName: 'RMS',
  webDir: 'www',
  server: {
    url: 'https://login.rmscore.app',
    androidScheme: 'https',
    allowNavigation: ['*.rmscore.app'],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#1a1a2e',
      showSpinner: true,
      spinnerColor: '#e94560',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#f5f0eb',
      overlaysWebView: false,
    },
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;