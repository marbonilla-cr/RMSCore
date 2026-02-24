import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const env = process.env.APP_ENV || 'development';
const validEnvs = ['development', 'production'];
if (!validEnvs.includes(env)) {
  console.error(`\n=== ERROR ===`);
  console.error(`APP_ENV inválido: "${env}"`);
  console.error(`Valores válidos: ${validEnvs.join(', ')}\n`);
  process.exit(1);
}
const isDev = env === 'development';
const isProd = env === 'production';

const baseUrl = isDev
  ? process.env.BASE_URL_DEV || 'http://localhost:3000'
  : process.env.BASE_URL_PROD || 'https://rms.yourcompany.com';

if (isProd && !baseUrl.startsWith('https://')) {
  console.error('\n=== ERROR DE SEGURIDAD ===');
  console.error('BASE_URL_PROD debe usar https://');
  console.error(`URL actual: ${baseUrl}`);
  console.error('Por seguridad, las URLs de producción DEBEN usar HTTPS.');
  console.error('Corrige tu archivo .env y vuelve a intentar.\n');
  process.exit(1);
}

if (isDev && baseUrl.startsWith('http://')) {
  console.warn('\n⚠ AVISO: Usando HTTP en modo desarrollo.');
  console.warn('  Esto es aceptable para desarrollo local.');
  console.warn('  NUNCA uses HTTP en producción.\n');
}

const config = `import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rms.app',
  appName: 'RMS',
  webDir: 'www',
  server: {
    url: '${baseUrl}',
    cleartext: ${isDev ? 'true' : 'false'},
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#1a1a2e',
      showSpinner: true,
      spinnerColor: '#e94560',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1a1a2e',
    },
  },
  android: {
    allowMixedContent: ${isDev ? 'true' : 'false'},
    captureInput: true,
    webContentsDebuggingEnabled: ${isDev ? 'true' : 'false'},
  },
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false,
  },
};

export default config;
`;

const outputPath = path.resolve(__dirname, '..', 'capacitor.config.ts');
fs.writeFileSync(outputPath, config, 'utf-8');

console.log(`✓ capacitor.config.ts generado para: ${env.toUpperCase()}`);
console.log(`  URL: ${baseUrl}`);
console.log(`  HTTPS requerido: ${isProd ? 'Sí' : 'No (solo dev)'}`);
console.log(`  Mixed content: ${isDev ? 'Permitido' : 'Bloqueado'}`);
console.log(`  WebView debug: ${isDev ? 'Habilitado' : 'Deshabilitado'}\n`);
