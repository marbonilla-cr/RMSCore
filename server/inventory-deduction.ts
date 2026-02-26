import { db } from "./db";
import { Pool } from "pg";
import {
  inventoryDeductions,
  invRecipes,
  invRecipeLines,
  invStockAp,
  invStockEp,
  invMovements,
  orderItems,
  products,
  auditEvents,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function getBusinessDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
}

interface ConsumptionEntry {
  invItemId: number;
  itemType: "AP" | "EP";
  qty: string;
}

export async function onOrderItemsConfirmedSent(
  orderId: number,
  orderItemIds: number[],
  userId: number
): Promise<void> {
  for (const orderItemId of orderItemIds) {
    await processOneDeduction(orderId, orderItemId, userId);
  }
}

async function processOneDeduction(
  orderId: number,
  orderItemId: number,
  userId: number
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existingRows } = await client.query(
      `SELECT id, status, basic_deducted_at, product_id, order_item_qty
       FROM inventory_deductions
       WHERE order_item_id = $1
       FOR UPDATE`,
      [orderItemId]
    );

    if (existingRows.length > 0) {
      const existing = existingRows[0];
      if (existing.status === "REVERSED") {
        await client.query("COMMIT");
        return;
      }
      if (existing.status === "CONSUMED" && existing.basic_deducted_at !== null) {
        await client.query("COMMIT");
        return;
      }
      if (existing.status === "CONSUMED" && existing.basic_deducted_at === null) {
        await runBasicDeduction(
          client,
          existing.product_id,
          Number(existing.order_item_qty),
          orderItemId,
          userId
        );
        await client.query(
          `UPDATE inventory_deductions SET basic_deducted_at = NOW() WHERE id = $1`,
          [existing.id]
        );
        await client.query("COMMIT");
        return;
      }
    }

    const { rows: oiRows } = await client.query(
      `SELECT id, product_id, qty FROM order_items WHERE id = $1 FOR UPDATE`,
      [orderItemId]
    );
    if (oiRows.length === 0) {
      await client.query("ROLLBACK");
      throw new Error(`Order item ${orderItemId} not found`);
    }
    const snapshotProductId = oiRows[0].product_id;
    const snapshotQty = Number(oiRows[0].qty);

    const { rows: recipeRows } = await client.query(
      `SELECT id FROM inv_recipes
       WHERE menu_product_id = $1 AND is_active = true
       ORDER BY version DESC LIMIT 1`,
      [snapshotProductId]
    );

    if (recipeRows.length === 0) {
      await client.query(
        `INSERT INTO inventory_deductions
         (order_item_id, order_id, recipe_id, product_id, order_item_qty, status, consumption_payload)
         VALUES ($1, $2, NULL, $3, $4, 'CONSUMED', '[]'::jsonb)`,
        [orderItemId, orderId, snapshotProductId, snapshotQty]
      );
      await runBasicDeduction(client, snapshotProductId, snapshotQty, orderItemId, userId);
      await client.query(
        `UPDATE inventory_deductions SET basic_deducted_at = NOW() WHERE order_item_id = $1`,
        [orderItemId]
      );
      await client.query("COMMIT");
      return;
    }

    const recipeId = recipeRows[0].id;

    const { rows: lineRows } = await client.query(
      `SELECT inv_item_id, item_type, qty_base_per_menu_unit, waste_pct
       FROM inv_recipe_lines WHERE recipe_id = $1`,
      [recipeId]
    );

    const aggregated = new Map<string, ConsumptionEntry>();
    for (const line of lineRows) {
      const consumption =
        snapshotQty *
        Number(line.qty_base_per_menu_unit) *
        (1 + Number(line.waste_pct) / 100);
      const key = `${line.item_type}:${line.inv_item_id}`;
      const existing = aggregated.get(key);
      if (existing) {
        aggregated.set(key, {
          ...existing,
          qty: (Number(existing.qty) + consumption).toFixed(4),
        });
      } else {
        aggregated.set(key, {
          invItemId: line.inv_item_id,
          itemType: line.item_type as "AP" | "EP",
          qty: consumption.toFixed(4),
        });
      }
    }

    const sortedEntries = Array.from(aggregated.values()).sort((a, b) => {
      if (a.itemType < b.itemType) return -1;
      if (a.itemType > b.itemType) return 1;
      return a.invItemId - b.invItemId;
    });

    const insufficientItems: string[] = [];

    for (const entry of sortedEntries) {
      const stockTable = entry.itemType === "AP" ? "inv_stock_ap" : "inv_stock_ep";

      await client.query(
        `INSERT INTO ${stockTable} (inv_item_id, location_id, organization_id, qty_on_hand)
         VALUES ($1, 1, 1, 0) ON CONFLICT (organization_id, location_id, inv_item_id) DO NOTHING`,
        [entry.invItemId]
      );

      const { rows: stockRows } = await client.query(
        `SELECT qty_on_hand FROM ${stockTable}
         WHERE organization_id = 1 AND location_id = 1 AND inv_item_id = $1
         FOR UPDATE`,
        [entry.invItemId]
      );

      if (stockRows.length === 0 || Number(stockRows[0].qty_on_hand) < Number(entry.qty)) {
        const available = stockRows.length > 0 ? stockRows[0].qty_on_hand : "0";
        const { rows: itemNameRows } = await client.query(
          `SELECT name FROM inv_items WHERE id = $1`, [entry.invItemId]
        );
        const itemName = itemNameRows.length > 0 ? itemNameRows[0].name : `Item #${entry.invItemId}`;
        insufficientItems.push(
          `${itemName} (${entry.itemType}): necesita ${entry.qty}, disponible ${available}`
        );
      }
    }

    if (insufficientItems.length > 0) {
      await client.query("ROLLBACK");
      throw new Error(
        `Stock insuficiente para deducción:\n${insufficientItems.join("\n")}`
      );
    }

    const businessDate = getBusinessDate();

    for (const entry of sortedEntries) {
      const stockTable = entry.itemType === "AP" ? "inv_stock_ap" : "inv_stock_ep";
      const movementType = entry.itemType === "AP" ? "CONSUME_AP" : "CONSUME_EP";

      await client.query(
        `UPDATE ${stockTable}
         SET qty_on_hand = qty_on_hand - $1, updated_at = NOW()
         WHERE organization_id = 1 AND location_id = 1 AND inv_item_id = $2`,
        [entry.qty, entry.invItemId]
      );

      await client.query(
        `INSERT INTO inv_movements
         (business_date, movement_type, inv_item_id, item_type, qty_delta_base, reference_type, reference_id, created_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, 'ORDER_ITEM', $6, $7)`,
        [
          businessDate,
          movementType,
          entry.invItemId,
          entry.itemType,
          (-Number(entry.qty)).toFixed(4),
          String(orderItemId),
          userId,
        ]
      );
    }

    const payload: ConsumptionEntry[] = sortedEntries.map((e) => ({
      invItemId: e.invItemId,
      itemType: e.itemType,
      qty: e.qty,
    }));

    await client.query(
      `INSERT INTO inventory_deductions
       (order_item_id, order_id, recipe_id, product_id, order_item_qty, status, consumption_payload)
       VALUES ($1, $2, $3, $4, $5, 'CONSUMED', $6::jsonb)`,
      [orderItemId, orderId, recipeId, snapshotProductId, snapshotQty, JSON.stringify(payload)]
    );

    await runBasicDeduction(client, snapshotProductId, snapshotQty, orderItemId, userId);

    await client.query(
      `UPDATE inventory_deductions SET basic_deducted_at = NOW() WHERE order_item_id = $1`,
      [orderItemId]
    );

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function runBasicDeduction(
  client: any,
  productId: number,
  qty: number,
  orderItemId: number,
  userId: number
): Promise<void> {
  const { rows: existingAudit } = await client.query(
    `SELECT id FROM audit_events
     WHERE action = 'BASIC_STOCK_DEDUCT' AND entity_type = 'order_item' AND entity_id = $1
     LIMIT 1`,
    [orderItemId]
  );
  if (existingAudit.length > 0) return;

  const { rows: productRows } = await client.query(
    `SELECT id, available_portions, active, name FROM products WHERE id = $1`,
    [productId]
  );
  if (productRows.length === 0) return;
  const product = productRows[0];
  if (product.available_portions === null) return;

  const newPortions = Math.max(0, product.available_portions - qty);
  const wasActive = product.active;
  const active = newPortions > 0;

  await client.query(
    `UPDATE products SET available_portions = $1, active = $2 WHERE id = $3`,
    [newPortions, active, productId]
  );

  await client.query(
    `INSERT INTO audit_events (actor_type, actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, 'BASIC_STOCK_DEDUCT', 'order_item', $3, $4::jsonb)`,
    [
      userId ? "USER" : "SYSTEM",
      userId || null,
      orderItemId,
      JSON.stringify({
        productId,
        productName: product.name,
        qty,
        previousPortions: product.available_portions,
        newPortions,
      }),
    ]
  );

  if (wasActive && !active) {
    await client.query(
      `INSERT INTO audit_events (actor_type, actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ('SYSTEM', $1, 'BASIC_AUTO_DISABLE', 'product', $2, $3::jsonb)`,
      [
        userId || null,
        productId,
        JSON.stringify({
          productName: product.name,
          lastQtyDeducted: qty,
          orderItemId,
        }),
      ]
    );
  }
}

export async function onOrderItemsVoided(
  orderItemIds: number[],
  userId: number
): Promise<void> {
  for (const orderItemId of orderItemIds) {
    await processOneReversal(orderItemId, userId);
  }
}

async function processOneReversal(
  orderItemId: number,
  userId: number
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: dedRows } = await client.query(
      `SELECT id, status, consumption_payload, basic_deducted_at, product_id, order_item_qty
       FROM inventory_deductions
       WHERE order_item_id = $1
       FOR UPDATE`,
      [orderItemId]
    );

    if (dedRows.length === 0 || dedRows[0].status === "REVERSED") {
      await client.query("COMMIT");
      return;
    }

    const ded = dedRows[0];
    const payload: ConsumptionEntry[] = ded.consumption_payload || [];

    if (payload.length > 0) {
      const sorted = [...payload].sort((a, b) => {
        if (a.itemType < b.itemType) return -1;
        if (a.itemType > b.itemType) return 1;
        return a.invItemId - b.invItemId;
      });

      const businessDate = getBusinessDate();

      for (const entry of sorted) {
        const stockTable = entry.itemType === "AP" ? "inv_stock_ap" : "inv_stock_ep";
        const movementType =
          entry.itemType === "AP" ? "REVERSE_CONSUME_AP" : "REVERSE_CONSUME_EP";

        await client.query(
          `INSERT INTO ${stockTable} (inv_item_id, location_id, organization_id, qty_on_hand)
           VALUES ($1, 1, 1, 0) ON CONFLICT (organization_id, location_id, inv_item_id) DO NOTHING`,
          [entry.invItemId]
        );

        await client.query(
          `SELECT qty_on_hand FROM ${stockTable}
           WHERE organization_id = 1 AND location_id = 1 AND inv_item_id = $1
           FOR UPDATE`,
          [entry.invItemId]
        );

        await client.query(
          `UPDATE ${stockTable}
           SET qty_on_hand = qty_on_hand + $1, updated_at = NOW()
           WHERE organization_id = 1 AND location_id = 1 AND inv_item_id = $2`,
          [entry.qty, entry.invItemId]
        );

        await client.query(
          `INSERT INTO inv_movements
           (business_date, movement_type, inv_item_id, item_type, qty_delta_base, reference_type, reference_id, created_by_employee_id)
           VALUES ($1, $2, $3, $4, $5, 'ORDER_ITEM', $6, $7)`,
          [
            businessDate,
            movementType,
            entry.invItemId,
            entry.itemType,
            entry.qty,
            String(orderItemId),
            userId,
          ]
        );
      }
    }

    await client.query(
      `UPDATE inventory_deductions SET status = 'REVERSED', reversed_at = NOW() WHERE id = $1`,
      [ded.id]
    );

    if (ded.basic_deducted_at !== null) {
      await runBasicReversal(
        client,
        ded.product_id,
        Number(ded.order_item_qty),
        orderItemId,
        userId
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function runBasicReversal(
  client: any,
  productId: number,
  qty: number,
  orderItemId: number,
  userId: number
): Promise<void> {
  const { rows: existingAudit } = await client.query(
    `SELECT id FROM audit_events
     WHERE action = 'BASIC_STOCK_RESTORE' AND entity_type = 'order_item' AND entity_id = $1
     LIMIT 1`,
    [orderItemId]
  );
  if (existingAudit.length > 0) return;

  const { rows: productRows } = await client.query(
    `SELECT id, available_portions, name FROM products WHERE id = $1`,
    [productId]
  );
  if (productRows.length === 0) return;
  const product = productRows[0];
  if (product.available_portions === null) return;

  const newPortions = product.available_portions + qty;
  await client.query(
    `UPDATE products SET available_portions = $1, active = true WHERE id = $2`,
    [newPortions, productId]
  );

  await client.query(
    `INSERT INTO audit_events (actor_type, actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, 'BASIC_STOCK_RESTORE', 'order_item', $3, $4::jsonb)`,
    [
      userId ? "USER" : "SYSTEM",
      userId || null,
      orderItemId,
      JSON.stringify({
        productId,
        productName: product.name,
        qty,
        previousPortions: product.available_portions,
        newPortions,
      }),
    ]
  );
}
