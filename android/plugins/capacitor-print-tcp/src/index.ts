import { registerPlugin } from '@capacitor/core';
import type { PrintTcpPlugin } from './definitions';

const PrintTcp = registerPlugin<PrintTcpPlugin>('PrintTcp', {
  web: () => import('./web').then(m => new m.PrintTcpWeb()),
});

export * from './definitions';
export { PrintTcp };
