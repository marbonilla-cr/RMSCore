export interface PrintTcpPlugin {
  /**
   * Send base64-encoded ESC/POS data to a printer at host:port via TCP.
   */
  sendToPrinter(options: { host: string; port: number; dataBase64: string }): Promise<{ success: boolean; error?: string }>;

  /**
   * Discover devices on the local network with the given port open (default 9100).
   * Returns { hosts: [ { host, port }, ... ] } for devices that accepted a connection.
   */
  discoverPrinters(options?: { port?: number; timeoutMs?: number }): Promise<{ hosts: { host: string; port: number }[] }>;
}
