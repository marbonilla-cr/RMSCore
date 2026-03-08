import { Pool } from 'pg';

const timezoneCache = new Map<string, { tz: string; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

let pool: Pool;

export function setTimezonePool(p: Pool) {
  pool = p;
}

export async function getTenantTimezone(schema: string): Promise<string> {
  const cached = timezoneCache.get(schema);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.tz;
  }
  try {
    const result = await pool.query(
      `SELECT timezone FROM "${schema}".business_config LIMIT 1`
    );
    const tz = result.rows?.[0]?.timezone || 'America/Costa_Rica';
    timezoneCache.set(schema, { tz, cachedAt: Date.now() });
    return tz;
  } catch {
    return 'America/Costa_Rica';
  }
}

export function getBusinessDateInTZ(timezone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

export function getNowInTZ(timezone: string): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
}

export function invalidateTimezoneCache(schema: string): void {
  timezoneCache.delete(schema);
}
