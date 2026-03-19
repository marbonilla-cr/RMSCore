import { db } from "../db";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

function generateCode(prefix: string, name: string): string {
  const slug = name
    .toString()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 20);
  return `${prefix}-${slug}`;
}

function generatePin4(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function parseBool(val: any): boolean {
  if (typeof val === "boolean") return val;
  const str = String(val).toLowerCase().trim();
  return str === "true" || str === "1" || str === "si" || str === "sí" || str === "yes";
}

export async function importSession(
  sessionId: number,
  tenantDb: any,
): Promise<{ success: boolean; message: string; details?: any }> {
  // Importación debe ser tenant-aware: operaciones contra el schema del tenant actual.
  const db = tenantDb;

  const [session] = (await db.execute(sql`
    SELECT id, status FROM data_loader_sessions WHERE id = ${sessionId}
  `)).rows;

  if (!session) {
    return { success: false, message: "Sesión no encontrada" };
  }
  if (session.status !== "validated") {
    return { success: false, message: `La sesión debe estar validada. Estado actual: ${session.status}` };
  }

  const pendingCheck = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM data_loader_staging 
    WHERE session_id = ${sessionId} AND validation_status != 'VALID'
  `);
  if (Number(pendingCheck.rows[0].cnt) > 0) {
    return { success: false, message: "Existen filas no válidas. Ejecute la validación primero." };
  }

  const allRows = await db.execute(sql`
    SELECT id, sheet_name, row_index, data_json 
    FROM data_loader_staging 
    WHERE session_id = ${sessionId}
    ORDER BY sheet_name, row_index
  `);

  const rowsBySheet: Record<string, Record<string, any>[]> = {};
  for (const row of allRows.rows) {
    const sheet = row.sheet_name as string;
    if (!rowsBySheet[sheet]) rowsBySheet[sheet] = [];
    rowsBySheet[sheet].push(row.data_json as Record<string, any>);
  }

  try {
    await db.execute(sql`BEGIN`);

    if (rowsBySheet.business && rowsBySheet.business.length > 0) {
      const biz = rowsBySheet.business[0];
      const existing = await db.execute(sql`SELECT id FROM business_config LIMIT 1`);
      if (existing.rows.length > 0) {
        await db.execute(sql`
          UPDATE business_config SET 
            business_name = ${biz.name || ""},
            address = ${biz.address || ""},
            timezone = ${biz.timezone || "America/Costa_Rica"},
            updated_at = NOW()
          WHERE id = ${existing.rows[0].id}
        `);
      } else {
        await db.execute(sql`
          INSERT INTO business_config (business_name, address, timezone)
          VALUES (${biz.name || ""}, ${biz.address || ""}, ${biz.timezone || "America/Costa_Rica"})
          ON CONFLICT DO NOTHING
        `);
      }
    }

    const taxNameToId = new Map<string, number>();
    if (rowsBySheet.taxes) {
      for (let i = 0; i < rowsBySheet.taxes.length; i++) {
        const tax = rowsBySheet.taxes[i];
        const rate = Number(tax.percentage) || 0;
        const inclusive = parseBool(tax.inclusive);
        const normalizedName = String(tax.tax_name).toLowerCase();
        const existing = await db.execute(sql`
          SELECT id
          FROM tax_categories
          WHERE LOWER(name) = ${normalizedName}
          LIMIT 1
        `);
        if (existing.rows.length > 0) {
          await db.execute(sql`
            UPDATE tax_categories
            SET rate = ${String(rate)},
                inclusive = ${inclusive},
                active = true,
                sort_order = ${i}
            WHERE id = ${existing.rows[0].id}
          `);
          taxNameToId.set(normalizedName, existing.rows[0].id as number);
        } else {
          const inserted = await db.execute(sql`
            INSERT INTO tax_categories (name, rate, inclusive, active, sort_order)
            VALUES (${tax.tax_name}, ${String(rate)}, ${inclusive}, true, ${i})
            ON CONFLICT DO NOTHING
            RETURNING id
          `);
          const insertedId = inserted.rows[0]?.id as number | undefined;
          if (!insertedId) {
            // En caso de que el INSERT no devuelva id (por conflictos inesperados),
            // intentamos resolverlo con una búsqueda.
            const fallback = await db.execute(sql`
              SELECT id
              FROM tax_categories
              WHERE LOWER(name) = ${normalizedName}
              LIMIT 1
            `);
            const fallbackId = fallback.rows[0]?.id as number | undefined;
            if (!fallbackId) throw new Error(`No se pudo resolver tax_category: ${tax.tax_name}`);
            taxNameToId.set(normalizedName, fallbackId);
          } else {
            taxNameToId.set(normalizedName, insertedId);
          }
        }
      }
    }

    if (rowsBySheet.payment_methods) {
      for (let i = 0; i < rowsBySheet.payment_methods.length; i++) {
        const pm = rowsBySheet.payment_methods[i];
        const code = generateCode("PM", pm.payment_name);
        const active = pm.active !== undefined ? parseBool(pm.active) : true;
        await db.execute(sql`
          INSERT INTO payment_methods (payment_code, payment_name, active, sort_order)
          VALUES (${code}, ${pm.payment_name}, ${active}, ${i})
          ON CONFLICT (payment_code) DO UPDATE
          SET payment_name = EXCLUDED.payment_name,
              active = EXCLUDED.active,
              sort_order = EXCLUDED.sort_order
        `);
      }
    }

    if (rowsBySheet.employees) {
      for (const emp of rowsBySheet.employees) {
        const role = String(emp.role || "WAITER").toUpperCase();
        const username = String(emp.employee_name).toLowerCase().replace(/\s+/g, ".");
        const passwordHash = await bcrypt.hash("TempPass123!", 10);
        const pin = generatePin4();
        const pinHash = await bcrypt.hash(pin, 10);
        const active = emp.active !== undefined ? parseBool(emp.active) : true;

        await db.execute(sql`
          INSERT INTO users (username, password, display_name, role, active, pin)
          VALUES (${username}, ${passwordHash}, ${emp.employee_name}, ${role}, ${active}, ${pinHash})
          ON CONFLICT (username) DO NOTHING
        `);
      }
    }

    const categoryNameToId = new Map<string, number>();
    if (rowsBySheet.categories) {
      const withoutParent: Record<string, any>[] = [];
      const withParent: Record<string, any>[] = [];
      for (const cat of rowsBySheet.categories) {
        if (cat.parent_category && String(cat.parent_category).trim() !== "") {
          withParent.push(cat);
        } else {
          withoutParent.push(cat);
        }
      }

      for (let i = 0; i < withoutParent.length; i++) {
        const cat = withoutParent[i];
        const code = generateCode("CAT", cat.category_name);
        const result = await db.execute(sql`
          INSERT INTO categories (category_code, name, active, sort_order)
          VALUES (${code}, ${cat.category_name}, true, ${i})
          ON CONFLICT (category_code) DO UPDATE
          SET name = EXCLUDED.name,
              parent_category_code = EXCLUDED.parent_category_code,
              active = EXCLUDED.active,
              sort_order = EXCLUDED.sort_order
          RETURNING id
        `);
        categoryNameToId.set(String(cat.category_name).toLowerCase(), result.rows[0].id as number);
      }

      for (let i = 0; i < withParent.length; i++) {
        const cat = withParent[i];
        const parentName = String(cat.parent_category).toLowerCase();
        const parentRow = await db.execute(sql`
          SELECT category_code FROM categories WHERE LOWER(name) = ${parentName} LIMIT 1
        `);
        const parentCode = parentRow.rows.length > 0 ? (parentRow.rows[0].category_code as string) : null;
        const code = generateCode("CAT", cat.category_name);
        const result = await db.execute(sql`
          INSERT INTO categories (category_code, name, parent_category_code, active, sort_order)
          VALUES (${code}, ${cat.category_name}, ${parentCode}, true, ${withoutParent.length + i})
          ON CONFLICT (category_code) DO UPDATE
          SET name = EXCLUDED.name,
              parent_category_code = EXCLUDED.parent_category_code,
              active = EXCLUDED.active,
              sort_order = EXCLUDED.sort_order
          RETURNING id
        `);
        categoryNameToId.set(String(cat.category_name).toLowerCase(), result.rows[0].id as number);
      }
    }

    if (rowsBySheet.products) {
      for (let i = 0; i < rowsBySheet.products.length; i++) {
        const prod = rowsBySheet.products[i];
        const code = generateCode("PROD", prod.product_name);
        const price = String(Number(prod.price) || 0);
        const catName = String(prod.category || "").toLowerCase();
        const categoryId = categoryNameToId.get(catName) || null;

        let taxCategoryId: number | null = null;
        if (prod.tax) {
          taxCategoryId = taxNameToId.get(String(prod.tax).toLowerCase()) || null;
        }

        const active = prod.active !== undefined ? parseBool(prod.active) : true;
        await db.execute(sql`
          INSERT INTO products (product_code, name, description, category_id, price, active)
          VALUES (${code}, ${prod.product_name}, ${""},  ${categoryId}, ${price}, ${active})
          ON CONFLICT (product_code) DO UPDATE
          SET name = EXCLUDED.name,
              description = EXCLUDED.description,
              category_id = EXCLUDED.category_id,
              price = EXCLUDED.price,
              active = EXCLUDED.active
        `);

        if (taxCategoryId) {
          const prodResult = await db.execute(sql`
            SELECT id FROM products WHERE product_code = ${code} LIMIT 1
          `);
          if (prodResult.rows.length > 0) {
            const existing = await db.execute(sql`
              SELECT id
              FROM product_tax_categories
              WHERE product_id = ${prodResult.rows[0].id}
                AND tax_category_id = ${taxCategoryId}
              LIMIT 1
            `);
            if (existing.rows.length === 0) {
              await db.execute(sql`
                INSERT INTO product_tax_categories (product_id, tax_category_id)
                VALUES (${prodResult.rows[0].id}, ${taxCategoryId})
                ON CONFLICT DO NOTHING
              `);
            }
          }
        }
      }
    }

    const groupNameToId = new Map<string, number>();
    if (rowsBySheet.modifier_groups) {
      for (let i = 0; i < rowsBySheet.modifier_groups.length; i++) {
        const mg = rowsBySheet.modifier_groups[i];
        const required = parseBool(mg.required);
        const maxSelect = mg.max_select ? Number(mg.max_select) : null;
        const multiSelect = !required || (maxSelect !== null && maxSelect > 1);
        const result = await db.execute(sql`
          INSERT INTO modifier_groups (name, required, multi_select, min_selections, max_selections, active, sort_order)
          VALUES (${mg.group_name}, ${required}, ${multiSelect}, ${required ? 1 : 0}, ${maxSelect}, true, ${i})
          ON CONFLICT (name) DO UPDATE
          SET required = EXCLUDED.required,
              multi_select = EXCLUDED.multi_select,
              min_selections = EXCLUDED.min_selections,
              max_selections = EXCLUDED.max_selections,
              active = EXCLUDED.active,
              sort_order = EXCLUDED.sort_order
          RETURNING id
        `);
        groupNameToId.set(String(mg.group_name).toLowerCase(), result.rows[0].id as number);
      }
    }

    if (rowsBySheet.modifiers) {
      for (let i = 0; i < rowsBySheet.modifiers.length; i++) {
        const mod = rowsBySheet.modifiers[i];
        const groupId = groupNameToId.get(String(mod.group_name).toLowerCase());
        if (!groupId) continue;
        const priceDelta = String(Number(mod.price) || 0);
        const existing = await db.execute(sql`
          SELECT id
          FROM modifier_options
          WHERE group_id = ${groupId}
            AND name = ${mod.modifier_name}
          LIMIT 1
        `);
        if (existing.rows.length > 0) {
          await db.execute(sql`
            UPDATE modifier_options
            SET price_delta = ${priceDelta},
                active = true,
                sort_order = ${i}
            WHERE id = ${existing.rows[0].id}
          `);
        } else {
          await db.execute(sql`
            INSERT INTO modifier_options (group_id, name, price_delta, active, sort_order)
            VALUES (${groupId}, ${mod.modifier_name}, ${priceDelta}, true, ${i})
            ON CONFLICT DO NOTHING
          `);
        }
      }
    }

    if (rowsBySheet.product_modifiers) {
      for (const pm of rowsBySheet.product_modifiers) {
        const productName = String(pm.product_name).toLowerCase();
        const groupName = String(pm.group_name).toLowerCase();

        const prodResult = await db.execute(sql`
          SELECT id FROM products WHERE LOWER(name) = ${productName} LIMIT 1
        `);
        const groupId = groupNameToId.get(groupName);

        if (prodResult.rows.length > 0 && groupId) {
          const existing = await db.execute(sql`
            SELECT id
            FROM item_modifier_groups
            WHERE product_id = ${prodResult.rows[0].id}
              AND modifier_group_id = ${groupId}
            LIMIT 1
          `);
          if (existing.rows.length === 0) {
            await db.execute(sql`
              INSERT INTO item_modifier_groups (product_id, modifier_group_id)
              VALUES (${prodResult.rows[0].id}, ${groupId})
              ON CONFLICT DO NOTHING
            `);
          }
        }
      }
    }

    if (rowsBySheet.tables) {
      for (let i = 0; i < rowsBySheet.tables.length; i++) {
        const t = rowsBySheet.tables[i];
        const code = String(t.table_name).toUpperCase().replace(/\s+/g, "-");
        const capacity = Number(t.capacity) || 4;
        await db.execute(sql`
          INSERT INTO tables (table_code, table_name, active, sort_order, capacity)
          VALUES (${code}, ${t.table_name}, true, ${i}, ${capacity})
          ON CONFLICT (table_code) DO NOTHING
        `);
      }
    }

    if (rowsBySheet.hr_config && rowsBySheet.hr_config.length > 0) {
      const hr = rowsBySheet.hr_config[0];
      const pct = Number(hr.service_percentage);
      if (!isNaN(pct)) {
        const rate = String(pct / 100);
        const existing = await db.execute(sql`SELECT id FROM hr_settings LIMIT 1`);
        if (existing.rows.length > 0) {
          await db.execute(sql`
            UPDATE hr_settings SET service_charge_rate = ${rate}, updated_at = NOW()
            WHERE id = ${existing.rows[0].id}
          `);
        }
      }
    }

    await db.execute(sql`
      UPDATE data_loader_staging SET imported = true, updated_at = NOW()
      WHERE session_id = ${sessionId}
    `);

    await db.execute(sql`
      UPDATE data_loader_sessions SET status = 'imported', updated_at = NOW()
      WHERE id = ${sessionId}
    `);

    await db.execute(sql`COMMIT`);

    return { success: true, message: "Importación completada exitosamente" };

  } catch (error: any) {
    await db.execute(sql`ROLLBACK`);

    await db.execute(sql`
      UPDATE data_loader_sessions 
      SET status = 'failed', error_message = ${error.message || "Error desconocido"}, updated_at = NOW()
      WHERE id = ${sessionId}
    `);

    return { success: false, message: `Error en importación: ${error.message}` };
  }
}
