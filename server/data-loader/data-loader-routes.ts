import { Router, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { parseExcelBuffer } from "./excel-parser";
import { validateSession } from "./validation-engine";
import { importSession } from "./import-engine";
import { runTenantBootstrapCheck } from "./system-check";
import { generateTemplateBuffer } from "./excel-template";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export function registerDataLoaderRoutes(app: any) {
  const router = Router();

  router.post("/upload", async (req: Request, res: Response) => {
    try {
      const db = req.db;
      const { fileData, fileName } = req.body;

      if (!fileData || !fileName) {
        return res.status(400).json({ message: "fileData y fileName son requeridos" });
      }

      if (!fileName.toLowerCase().endsWith(".xlsx")) {
        return res.status(400).json({ message: "Solo se aceptan archivos .xlsx" });
      }

      const buffer = Buffer.from(fileData, "base64");

      if (buffer.length > MAX_FILE_SIZE) {
        return res.status(400).json({ message: "El archivo excede el límite de 5MB" });
      }

      const userId = req.session?.userId || null;

      const sessionResult = await db.execute(sql`
        INSERT INTO data_loader_sessions (status, file_name, created_by, created_at, updated_at)
        VALUES ('uploaded', ${fileName}, ${userId}, NOW(), NOW())
        RETURNING id
      `);
      const sessionId = sessionResult.rows[0].id as number;

      let parseResult;
      try {
        parseResult = parseExcelBuffer(buffer);
      } catch (parseError: any) {
        await db.execute(sql`
          UPDATE data_loader_sessions 
          SET status = 'failed', error_message = ${parseError.message || "Error al parsear el archivo"}, updated_at = NOW()
          WHERE id = ${sessionId}
        `);
        return res.status(400).json({ message: `Error al parsear: ${parseError.message}` });
      }

      const sheetsFound = Object.keys(parseResult.sheets);
      const sheetsArrayLiteral = `{${sheetsFound.join(",")}}`;

      await db.execute(sql`
        UPDATE data_loader_sessions 
        SET status = 'parsed', sheets_found = ${sheetsArrayLiteral}::text[], updated_at = NOW()
        WHERE id = ${sessionId}
      `);

      const rowCounts: Record<string, number> = {};

      for (const [sheetName, rows] of Object.entries(parseResult.sheets)) {
        rowCounts[sheetName] = rows.length;

        for (let i = 0; i < rows.length; i++) {
          await db.execute(sql`
            INSERT INTO data_loader_staging (session_id, sheet_name, row_index, data_json, validation_status, created_at, updated_at)
            VALUES (${sessionId}, ${sheetName}, ${i}, ${JSON.stringify(rows[i])}::jsonb, 'PENDING', NOW(), NOW())
          `);
        }
      }

      await db.execute(sql`
        UPDATE data_loader_sessions 
        SET status = 'staged', updated_at = NOW()
        WHERE id = ${sessionId}
      `);

      res.json({
        sessionId,
        sheetsFound,
        rowCounts,
        unmappedColumns: parseResult.unmappedColumns,
      });
    } catch (error: any) {
      console.error("Data loader upload error:", error);
      try {
        const { fileData: _fd, ...safeBody } = req.body || {};
        console.error("Data loader upload context:", JSON.stringify(safeBody));
      } catch (_) {}
      res.status(500).json({ message: error.message || "Error interno" });
    }
  });

  router.delete("/sessions/:id", async (req: Request, res: Response) => {
    try {
      const db = req.db;
      const sessionId = Number(req.params.id);
      const [session] = (await db.execute(sql`
        SELECT id, status FROM data_loader_sessions WHERE id = ${sessionId}
      `)).rows;

      if (!session) {
        return res.status(404).json({ message: "Sesión no encontrada" });
      }
      if (session.status === "imported") {
        return res.status(400).json({ message: "No se puede eliminar una sesión ya importada" });
      }

      await db.execute(sql`DELETE FROM data_loader_sessions WHERE id = ${sessionId}`);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Data loader delete session error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  router.get("/sessions", async (req: Request, res: Response) => {
    try {
      const db = req.db;
      const result = await db.execute(sql`
        SELECT id, status, file_name, sheets_found, error_message, created_by, created_at, updated_at
        FROM data_loader_sessions
        ORDER BY created_at DESC
      `);
      res.json(result.rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  router.get("/sessions/:id", async (req: Request, res: Response) => {
    try {
      const db = req.db;
      const sessionId = Number(req.params.id);

      const [session] = (await db.execute(sql`
        SELECT id, status, file_name, sheets_found, error_message, created_by, created_at, updated_at
        FROM data_loader_sessions WHERE id = ${sessionId}
      `)).rows;

      if (!session) {
        return res.status(404).json({ message: "Sesión no encontrada" });
      }

      const rows = await db.execute(sql`
        SELECT id, sheet_name, row_index, data_json, validation_status, validation_errors, imported
        FROM data_loader_staging
        WHERE session_id = ${sessionId}
        ORDER BY sheet_name, row_index
      `);

      const grouped: Record<string, any[]> = {};
      for (const row of rows.rows) {
        const sheet = row.sheet_name as string;
        if (!grouped[sheet]) grouped[sheet] = [];
        grouped[sheet].push(row);
      }

      res.json({ session, rows: grouped });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  router.patch("/staging/:rowId", async (req: Request, res: Response) => {
    try {
      const db = req.db;
      const rowId = Number(req.params.rowId);
      const { dataJson } = req.body;

      if (!dataJson) {
        return res.status(400).json({ message: "dataJson es requerido" });
      }

      await db.execute(sql`
        UPDATE data_loader_staging 
        SET data_json = ${JSON.stringify(dataJson)}::jsonb, 
            validation_status = 'PENDING', 
            validation_errors = NULL,
            updated_at = NOW()
        WHERE id = ${rowId}
      `);

      const sessionResult = await db.execute(sql`
        SELECT session_id FROM data_loader_staging WHERE id = ${rowId}
      `);
      if (sessionResult.rows.length > 0) {
        await db.execute(sql`
          UPDATE data_loader_sessions SET status = 'staged', updated_at = NOW()
          WHERE id = ${sessionResult.rows[0].session_id}
        `);
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  router.delete("/staging/:rowId", async (req: Request, res: Response) => {
    try {
      const db = req.db;
      const rowId = Number(req.params.rowId);
      await db.execute(sql`DELETE FROM data_loader_staging WHERE id = ${rowId}`);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  router.post("/sessions/:id/add-row", async (req: Request, res: Response) => {
    try {
      const db = req.db;
      const sessionId = Number(req.params.id);
      const { sheetName, dataJson } = req.body;

      if (!sheetName || !dataJson) {
        return res.status(400).json({ message: "sheetName y dataJson son requeridos" });
      }

      const maxIdx = await db.execute(sql`
        SELECT COALESCE(MAX(row_index), -1) + 1 as next_idx
        FROM data_loader_staging
        WHERE session_id = ${sessionId} AND sheet_name = ${sheetName}
      `);

      const nextIdx = Number(maxIdx.rows[0].next_idx);

      const result = await db.execute(sql`
        INSERT INTO data_loader_staging (session_id, sheet_name, row_index, data_json, validation_status, created_at, updated_at)
        VALUES (${sessionId}, ${sheetName}, ${nextIdx}, ${JSON.stringify(dataJson)}::jsonb, 'PENDING', NOW(), NOW())
        RETURNING id
      `);

      await db.execute(sql`
        UPDATE data_loader_sessions SET status = 'staged', updated_at = NOW()
        WHERE id = ${sessionId}
      `);

      res.json({ success: true, rowId: result.rows[0].id });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  router.post("/sessions/:id/validate", async (req: Request, res: Response) => {
    try {
      const db = req.db;
      const sessionId = Number(req.params.id);
      const result = await validateSession(sessionId, db);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  router.post("/sessions/:id/import", async (req: Request, res: Response) => {
    try {
      const db = req.db;
      const sessionId = Number(req.params.id);
      const result = await importSession(sessionId, db);

      if (!result.success) {
        return res.status(400).json(result);
      }

      const systemCheck = await runTenantBootstrapCheck(db);

      res.json({
        import: result,
        systemCheck,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  router.get("/sessions/:id/ledger", async (req: Request, res: Response) => {
    try {
      const db = req.db;
      const sessionId = Number(req.params.id);

      const [session] = (await db.execute(sql`
        SELECT id, status FROM data_loader_sessions WHERE id = ${sessionId}
      `)).rows;

      if (!session) {
        return res.status(404).json({ message: "Sesión no encontrada" });
      }

      const allRows = await db.execute(sql`
        SELECT id, sheet_name, row_index, data_json, validation_status
        FROM data_loader_staging
        WHERE session_id = ${sessionId}
        ORDER BY sheet_name, row_index
      `);

      const grouped: Record<string, { rowId: number; rowIndex: number; data: Record<string, any>; validationStatus: string }[]> = {};
      for (const row of allRows.rows) {
        const sheet = row.sheet_name as string;
        if (!grouped[sheet]) grouped[sheet] = [];
        grouped[sheet].push({
          rowId: row.id as number,
          rowIndex: row.row_index as number,
          data: row.data_json as Record<string, any>,
          validationStatus: row.validation_status as string,
        });
      }

      const business = (grouped.business || []).map(r => ({ rowId: r.rowId, ...r.data }));
      const taxes = (grouped.taxes || []).map(r => ({ rowId: r.rowId, ...r.data }));
      const paymentMethods = (grouped.payment_methods || []).map(r => ({ rowId: r.rowId, ...r.data }));
      const employees = (grouped.employees || []).map(r => ({ rowId: r.rowId, ...r.data }));
      const categories = (grouped.categories || []).map(r => ({ rowId: r.rowId, ...r.data }));
      const products = (grouped.products || []).map(r => ({ rowId: r.rowId, validationStatus: r.validationStatus, ...r.data }));
      const modifierGroups = (grouped.modifier_groups || []).map(r => ({ rowId: r.rowId, ...r.data }));
      const modifiers = (grouped.modifiers || []).map(r => ({ rowId: r.rowId, ...r.data }));
      const productModifiers = (grouped.product_modifiers || []).map(r => ({ rowId: r.rowId, ...r.data }));
      const tables = (grouped.tables || []).map(r => ({ rowId: r.rowId, ...r.data }));
      const hrConfig = (grouped.hr_config || []).map(r => ({ rowId: r.rowId, ...r.data }));

      const categoryTree: Record<string, string[]> = {};
      for (const cat of categories as Array<{ rowId: number; [key: string]: unknown }>) {
        const parent = String(cat.category_name || "Sin padre");
        const child = String(cat.parent_category || "");
        if (!categoryTree[parent]) categoryTree[parent] = [];
        if (child) categoryTree[parent].push(child);
      }

      const productsByCategory: Record<string, Array<Record<string, unknown>>> = {};
      for (const prod of products as Array<{ rowId: number; [key: string]: unknown }>) {
        const cat = String(prod.category || "Sin categoría");
        if (!productsByCategory[cat]) productsByCategory[cat] = [];
        productsByCategory[cat].push(prod);
      }

      const modifiersByGroup: Record<string, Array<Record<string, unknown>>> = {};
      for (const mod of modifiers as Array<{ rowId: number; [key: string]: unknown }>) {
        const grp = String(mod.group_name || "Sin grupo");
        if (!modifiersByGroup[grp]) modifiersByGroup[grp] = [];
        modifiersByGroup[grp].push(mod);
      }

      res.json({
        business,
        taxes,
        paymentMethods,
        employees,
        categories,
        categoryTree,
        products,
        productsByCategory,
        modifierGroups,
        modifiers,
        modifiersByGroup,
        productModifiers,
        tables,
        hrConfig,
        stats: {
          totalCategories: categories.length,
          totalProducts: products.length,
          totalEmployees: employees.length,
          totalTables: tables.length,
          totalModifierGroups: modifierGroups.length,
          totalModifiers: modifiers.length,
          totalTaxes: taxes.length,
          totalPaymentMethods: paymentMethods.length,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  router.get("/system-check", async (req: Request, res: Response) => {
    try {
      const db = req.db;
      const result = await runTenantBootstrapCheck(db);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  router.get("/template", async (_req: Request, res: Response) => {
    try {
      const buffer = generateTemplateBuffer();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=RMS_Master_Template.xlsx");
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.use("/api/admin/data-loader", router);
}
