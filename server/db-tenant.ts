/**
 * server/db-tenant.ts
 * Pool de conexión por tenant. NO modifica server/db.ts.
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

const dbCache = new Map<string, ReturnType<typeof drizzle>>();

export function getTenantDb(schemaName: string) {
  if (dbCache.has(schemaName)) return dbCache.get(schemaName)!;

  const tenantPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  tenantPool.on("connect", (client) => {
    if (schemaName === 'public') {
      client.query(`SET search_path TO "public"`);
    } else {
      client.query(`SET search_path TO "${schemaName}"`);
    }
  });

  const tenantDb = drizzle(tenantPool, { schema });
  dbCache.set(schemaName, tenantDb);
  console.log(`[db-tenant] Schema "${schemaName}" conectado`);
  return tenantDb;
}

export function evictTenantDb(schemaName: string) {
  dbCache.delete(schemaName);
}
