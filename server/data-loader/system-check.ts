import { db } from "../db";
import { sql } from "drizzle-orm";

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

interface SystemCheckResult {
  status: "ready" | "warnings";
  checks: CheckResult[];
}

export async function runTenantBootstrapCheck(tenantDb: any): Promise<SystemCheckResult> {
  // Tenant-aware: operaciones contra el schema del tenant actual.
  const db = tenantDb;
  const checks: CheckResult[] = [];

  const businessResult = await db.execute(sql`SELECT COUNT(*) as cnt FROM business_config`);
  const businessCount = Number(businessResult.rows[0].cnt);
  checks.push({
    name: "Configuración del negocio",
    passed: businessCount > 0,
    detail: businessCount > 0 ? "Configurado" : "No se encontró configuración del negocio",
  });

  const taxResult = await db.execute(sql`SELECT COUNT(*) as cnt FROM tax_categories WHERE active = true`);
  const taxCount = Number(taxResult.rows[0].cnt);
  checks.push({
    name: "Impuestos",
    passed: taxCount > 0,
    detail: taxCount > 0 ? `${taxCount} impuesto(s) configurado(s)` : "No hay impuestos configurados",
  });

  const pmResult = await db.execute(sql`SELECT COUNT(*) as cnt FROM payment_methods WHERE active = true`);
  const pmCount = Number(pmResult.rows[0].cnt);
  checks.push({
    name: "Métodos de pago",
    passed: pmCount > 0,
    detail: pmCount > 0 ? `${pmCount} método(s) de pago` : "No hay métodos de pago",
  });

  const empResult = await db.execute(sql`SELECT COUNT(*) as cnt FROM users WHERE active = true`);
  const empCount = Number(empResult.rows[0].cnt);
  checks.push({
    name: "Empleados",
    passed: empCount > 0,
    detail: empCount > 0 ? `${empCount} empleado(s)` : "No hay empleados",
  });

  const catResult = await db.execute(sql`SELECT COUNT(*) as cnt FROM categories WHERE active = true`);
  const catCount = Number(catResult.rows[0].cnt);
  checks.push({
    name: "Categorías",
    passed: catCount > 0,
    detail: catCount > 0 ? `${catCount} categoría(s)` : "No hay categorías",
  });

  const prodResult = await db.execute(sql`SELECT COUNT(*) as cnt FROM products WHERE active = true`);
  const prodCount = Number(prodResult.rows[0].cnt);
  checks.push({
    name: "Productos",
    passed: prodCount > 0,
    detail: prodCount > 0 ? `${prodCount} producto(s)` : "No hay productos",
  });

  const allPassed = checks.every(c => c.passed);

  return {
    status: allPassed ? "ready" : "warnings",
    checks,
  };
}
