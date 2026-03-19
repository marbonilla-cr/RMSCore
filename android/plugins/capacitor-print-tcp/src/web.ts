import type { PrintTcpPlugin } from './definitions';

export class PrintTcpWeb implements PrintTcpPlugin {
  async sendToPrinter(_options: { host: string; port: number; dataBase64: string }): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'PrintTcp is not available on web. Use the Android app.' };
  }

  async discoverPrinters(_options?: { port?: number; timeoutMs?: number }): Promise<{ hosts: { host: string; port: number }[] }> {
    return { hosts: [] };
  }
}
