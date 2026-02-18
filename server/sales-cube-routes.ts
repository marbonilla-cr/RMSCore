import type { Express, Request, Response } from "express";
import { db } from "./db";
import { salesLedgerItems } from "@shared/schema";
import { sql, and, eq, inArray, gte, lte, or, SQL } from "drizzle-orm";

function requirePermission(perm: string) {
  return async (req: Request, res: Response, next: Function) => {
    if (!req.session?.userId) return res.status(401).json({ message: "No autenticado" });
    next();
  };
}

const VALID_GROUP_KEYS = [
  "business_date", "month", "weekday", "hour",
  "product", "category", "origin", "waiter", "table"
] as const;
type GroupKey = typeof VALID_GROUP_KEYS[number];

const VALID_METRICS = ["subtotal", "qty", "orders_count"] as const;
const VALID_SORT_DIR = ["asc", "desc"] as const;

interface CubeFilters {
  dateFrom?: string;
  dateTo?: string;
  dates?: string[];
  weekdays?: number[];
  hourFrom?: number;
  hourTo?: number;
  origins?: string[];
  categories?: string[];
  products?: (number | string)[];
  waiterIds?: number[];
}

interface CubeRequest extends CubeFilters {
  groupBy: string[];
  metric?: string;
  sortBy?: string;
  sortDir?: string;
  topN?: number;
}

function getGroupSelect(key: GroupKey): { selectExpr: SQL; alias: string } {
  switch (key) {
    case "business_date":
      return { selectExpr: sql`${salesLedgerItems.businessDate}`, alias: "business_date" };
    case "month":
      return { selectExpr: sql`substring(${salesLedgerItems.businessDate} from 1 for 7)`, alias: "month" };
    case "weekday":
      return {
        selectExpr: sql`(extract(isodow from ${salesLedgerItems.businessDate}::date)::int - 1)`,
        alias: "weekday"
      };
    case "hour":
      return {
        selectExpr: sql`extract(hour from (coalesce(${salesLedgerItems.paidAt}, ${salesLedgerItems.createdAt}) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Costa_Rica'))::int`,
        alias: "hour"
      };
    case "product":
      return {
        selectExpr: sql`coalesce(${salesLedgerItems.productId}::text, ${salesLedgerItems.productNameSnapshot})`,
        alias: "product_key"
      };
    case "category":
      return { selectExpr: sql`${salesLedgerItems.categoryNameSnapshot}`, alias: "category" };
    case "origin":
      return { selectExpr: sql`${salesLedgerItems.origin}`, alias: "origin" };
    case "waiter":
      return { selectExpr: sql`${salesLedgerItems.responsibleWaiterId}`, alias: "waiter_id" };
    case "table":
      return { selectExpr: sql`${salesLedgerItems.tableNameSnapshot}`, alias: "table_name" };
  }
}

function buildWhereConditions(filters: CubeFilters): SQL[] {
  const conditions: SQL[] = [
    eq(salesLedgerItems.status, "PAID")
  ];

  if (filters.dateFrom) {
    conditions.push(sql`${salesLedgerItems.businessDate} >= ${filters.dateFrom}`);
  }
  if (filters.dateTo) {
    conditions.push(sql`${salesLedgerItems.businessDate} <= ${filters.dateTo}`);
  }
  if (filters.dates && filters.dates.length > 0) {
    conditions.push(sql`${salesLedgerItems.businessDate} IN (${sql.join(filters.dates.map(d => sql`${d}`), sql`, `)})`);
  }
  if (filters.weekdays && filters.weekdays.length > 0) {
    const wdExprs = filters.weekdays.map(w => sql`${w}`);
    conditions.push(sql`(extract(isodow from ${salesLedgerItems.businessDate}::date)::int - 1) IN (${sql.join(wdExprs, sql`, `)})`);
  }

  if (filters.hourFrom !== undefined && filters.hourTo !== undefined) {
    const hourExpr = sql`extract(hour from (coalesce(${salesLedgerItems.paidAt}, ${salesLedgerItems.createdAt}) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Costa_Rica'))::int`;
    if (filters.hourFrom <= filters.hourTo) {
      conditions.push(sql`${hourExpr} >= ${filters.hourFrom} AND ${hourExpr} <= ${filters.hourTo}`);
    } else {
      conditions.push(sql`(${hourExpr} >= ${filters.hourFrom} OR ${hourExpr} <= ${filters.hourTo})`);
    }
  } else if (filters.hourFrom !== undefined) {
    const hourExpr = sql`extract(hour from (coalesce(${salesLedgerItems.paidAt}, ${salesLedgerItems.createdAt}) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Costa_Rica'))::int`;
    conditions.push(sql`${hourExpr} >= ${filters.hourFrom}`);
  } else if (filters.hourTo !== undefined) {
    const hourExpr = sql`extract(hour from (coalesce(${salesLedgerItems.paidAt}, ${salesLedgerItems.createdAt}) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Costa_Rica'))::int`;
    conditions.push(sql`${hourExpr} <= ${filters.hourTo}`);
  }

  if (filters.origins && filters.origins.length > 0) {
    conditions.push(sql`${salesLedgerItems.origin} IN (${sql.join(filters.origins.map(o => sql`${o}`), sql`, `)})`);
  }
  if (filters.categories && filters.categories.length > 0) {
    conditions.push(sql`${salesLedgerItems.categoryNameSnapshot} IN (${sql.join(filters.categories.map(c => sql`${c}`), sql`, `)})`);
  }
  if (filters.products && filters.products.length > 0) {
    const numericIds = filters.products.filter(p => typeof p === "number") as number[];
    const nameKeys = filters.products.filter(p => typeof p === "string") as string[];
    const productConditions: SQL[] = [];
    if (numericIds.length > 0) {
      productConditions.push(sql`${salesLedgerItems.productId} IN (${sql.join(numericIds.map(id => sql`${id}`), sql`, `)})`);
    }
    if (nameKeys.length > 0) {
      productConditions.push(sql`${salesLedgerItems.productNameSnapshot} IN (${sql.join(nameKeys.map(n => sql`${n}`), sql`, `)})`);
    }
    if (productConditions.length === 1) {
      conditions.push(productConditions[0]);
    } else if (productConditions.length > 1) {
      conditions.push(sql`(${sql.join(productConditions, sql` OR `)})`);
    }
  }
  if (filters.waiterIds && filters.waiterIds.length > 0) {
    conditions.push(sql`${salesLedgerItems.responsibleWaiterId} IN (${sql.join(filters.waiterIds.map(w => sql`${w}`), sql`, `)})`);
  }

  return conditions;
}

const PRESETS = {
  totals_by_product: {
    name: "Totales por Producto",
    groupBy: ["product", "category"],
    metric: "subtotal",
    sortBy: "subtotal",
    sortDir: "desc",
  },
  product_by_day: {
    name: "Producto por Día",
    groupBy: ["business_date", "product"],
    metric: "subtotal",
    sortBy: "business_date",
    sortDir: "asc",
  },
  product_by_month: {
    name: "Producto por Mes",
    groupBy: ["month", "product"],
    metric: "subtotal",
    sortBy: "month",
    sortDir: "asc",
  },
  product_by_hour: {
    name: "Producto por Hora",
    groupBy: ["hour", "product"],
    metric: "subtotal",
    sortBy: "hour",
    sortDir: "asc",
  },
  top_hours: {
    name: "Horas más vendidas",
    groupBy: ["hour"],
    metric: "subtotal",
    sortBy: "subtotal",
    sortDir: "desc",
    topN: 10,
  },
  heatmap: {
    name: "Heatmap Hora x Día de Semana",
    groupBy: ["weekday", "hour"],
    metric: "subtotal",
    sortBy: "weekday",
    sortDir: "asc",
  },
};

export function registerSalesCubeRoutes(app: Express) {
  app.get("/api/reports/sales-cube/presets", async (_req, res) => {
    res.json(PRESETS);
  });

  app.get("/api/reports/sales-cube/filter-options", async (_req, res) => {
    try {
      const [categories, origins, products, waiters, dateRange] = await Promise.all([
        db.select({ value: sql<string>`DISTINCT ${salesLedgerItems.categoryNameSnapshot}` })
          .from(salesLedgerItems)
          .where(and(eq(salesLedgerItems.status, "PAID"), sql`${salesLedgerItems.categoryNameSnapshot} IS NOT NULL`)),
        db.select({ value: sql<string>`DISTINCT ${salesLedgerItems.origin}` })
          .from(salesLedgerItems)
          .where(eq(salesLedgerItems.status, "PAID")),
        db.select({
          id: sql<number>`${salesLedgerItems.productId}`,
          name: sql<string>`${salesLedgerItems.productNameSnapshot}`,
        }).from(salesLedgerItems)
          .where(eq(salesLedgerItems.status, "PAID"))
          .groupBy(salesLedgerItems.productId, salesLedgerItems.productNameSnapshot)
          .orderBy(salesLedgerItems.productNameSnapshot),
        db.select({
          id: sql<number>`${salesLedgerItems.responsibleWaiterId}`,
        }).from(salesLedgerItems)
          .where(and(eq(salesLedgerItems.status, "PAID"), sql`${salesLedgerItems.responsibleWaiterId} IS NOT NULL`))
          .groupBy(salesLedgerItems.responsibleWaiterId),
        db.select({
          minDate: sql<string>`MIN(${salesLedgerItems.businessDate})`,
          maxDate: sql<string>`MAX(${salesLedgerItems.businessDate})`,
        }).from(salesLedgerItems)
          .where(eq(salesLedgerItems.status, "PAID")),
      ]);
      res.json({
        categories: categories.map(c => c.value).filter(Boolean).sort(),
        origins: origins.map(o => o.value).filter(Boolean).sort(),
        products: products.filter(p => p.name),
        waiterIds: waiters.map(w => w.id).filter(Boolean),
        dateRange: dateRange[0] || { minDate: null, maxDate: null },
      });
    } catch (err) {
      console.error("[SalesCube] filter-options error:", err);
      res.status(500).json({ message: "Error loading filter options" });
    }
  });

  app.post("/api/reports/sales-cube/query", async (req: Request, res: Response) => {
    try {
      const body = req.body as CubeRequest;

      const groupByKeys = (body.groupBy || []).filter(k =>
        VALID_GROUP_KEYS.includes(k as any)
      ) as GroupKey[];

      if (groupByKeys.length === 0) {
        return res.status(400).json({ message: "groupBy debe tener al menos 1 dimensión" });
      }
      if (groupByKeys.length > 2) {
        return res.status(400).json({ message: "MVP: máximo 2 dimensiones simultáneas" });
      }

      const conditions = buildWhereConditions(body);
      const whereClause = and(...conditions)!;

      const groupSelects = groupByKeys.map(k => getGroupSelect(k));

      const selectParts = [
        ...groupSelects.map(g => sql`${g.selectExpr} as "${sql.raw(g.alias)}"`),
        sql`SUM(${salesLedgerItems.qty})::int as "qty_total"`,
        sql`SUM(${salesLedgerItems.lineSubtotal})::numeric as "subtotal_total"`,
        sql`COUNT(DISTINCT ${salesLedgerItems.orderId})::int as "orders_count"`,
      ];

      if (groupByKeys.includes("product")) {
        selectParts.push(sql`MIN(${salesLedgerItems.productNameSnapshot}) as "product_name"`);
        selectParts.push(sql`MIN(${salesLedgerItems.productId})::int as "product_id"`);
      }

      const groupByExprs = groupSelects.map(g => g.selectExpr);

      let sortExpr: SQL;
      const sortBy = body.sortBy || "subtotal";
      const sortDir = (body.sortDir || "desc").toLowerCase();
      const dirSql = sortDir === "asc" ? sql`ASC` : sql`DESC`;

      if (sortBy === "subtotal") {
        sortExpr = sql`SUM(${salesLedgerItems.lineSubtotal})`;
      } else if (sortBy === "qty") {
        sortExpr = sql`SUM(${salesLedgerItems.qty})`;
      } else if (sortBy === "orders_count") {
        sortExpr = sql`COUNT(DISTINCT ${salesLedgerItems.orderId})`;
      } else {
        const matchGroup = groupSelects.find(g => g.alias === sortBy);
        if (matchGroup) {
          sortExpr = matchGroup.selectExpr;
        } else {
          sortExpr = sql`SUM(${salesLedgerItems.lineSubtotal})`;
        }
      }

      let limitClause = sql``;
      if (body.topN && body.topN > 0) {
        limitClause = sql` LIMIT ${body.topN}`;
      }

      const query = sql`
        SELECT ${sql.join(selectParts, sql`, `)}
        FROM ${salesLedgerItems}
        WHERE ${whereClause}
        GROUP BY ${sql.join(groupByExprs, sql`, `)}
        ORDER BY ${sortExpr} ${dirSql}
        ${limitClause}
      `;

      const rows = await db.execute(query);

      const metaQuery = sql`
        SELECT
          SUM(${salesLedgerItems.qty})::int as "totalQty",
          SUM(${salesLedgerItems.lineSubtotal})::numeric as "totalSubtotal",
          COUNT(DISTINCT ${salesLedgerItems.orderId})::int as "totalOrders"
        FROM ${salesLedgerItems}
        WHERE ${whereClause}
      `;
      const metaResult = await db.execute(metaQuery);
      const meta = metaResult.rows[0] || { totalQty: 0, totalSubtotal: 0, totalOrders: 0 };

      let processedRows = rows.rows.map((row: any) => {
        const processed: any = { ...row };
        if (processed.subtotal_total !== undefined) {
          processed.subtotal_total = Number(processed.subtotal_total);
        }
        if (processed.qty_total !== undefined) {
          processed.qty_total = Number(processed.qty_total);
        }
        if (processed.orders_count !== undefined) {
          processed.orders_count = Number(processed.orders_count);
        }
        return processed;
      });

      if (body.groupBy?.includes("hour") && body.groupBy.length === 1 && body.topN) {
        const grandTotal = Number(meta.totalSubtotal) || 1;
        processedRows = processedRows.map((row: any) => ({
          ...row,
          share_pct: Math.round((row.subtotal_total / grandTotal) * 10000) / 100,
        }));
      }

      res.json({
        rows: processedRows,
        meta: {
          totalQty: Number(meta.totalQty) || 0,
          totalSubtotal: Number(meta.totalSubtotal) || 0,
          totalOrders: Number(meta.totalOrders) || 0,
          groupBy: groupByKeys,
          rowCount: processedRows.length,
        },
      });
    } catch (err) {
      console.error("[SalesCube] query error:", err);
      res.status(500).json({ message: "Error ejecutando consulta del cubo" });
    }
  });
}
