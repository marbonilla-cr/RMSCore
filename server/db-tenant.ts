/**
 * server/db-tenant.ts
 * Pool de conexión por tenant.
 * Para "public", reutiliza el pool global de server/db.ts.
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { db as globalDb } from "./db";

const dbCache = new Map<string, ReturnType<typeof drizzle>>();

export function getTenantDb(schemaName: string) {
  if (schemaName === "public") return globalDb;

  if (dbCache.has(schemaName)) return dbCache.get(schemaName)!;

  const tenantPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  tenantPool.on("connect", (client) => {
    client.query(`SET search_path TO "${schemaName}"`);
  });

  const tenantDb = drizzle(tenantPool, { schema });
  dbCache.set(schemaName, tenantDb);
  console.log(`[db-tenant] Schema "${schemaName}" conectado`);
  return tenantDb;
}

export function evictTenantDb(schemaName: string) {
  dbCache.delete(schemaName);
}
