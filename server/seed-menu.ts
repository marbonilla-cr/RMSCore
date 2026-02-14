import fs from "fs";
import path from "path";
import { db } from "./db";
import { eq, and, notInArray, inArray, sql } from "drizzle-orm";
import {
  categories, products, modifierGroups, modifierOptions,
  itemModifierGroups, discounts, taxCategories, productTaxCategories, orders,
  payments, salesLedgerItems, voidedItems,
} from "@shared/schema";

const MODIFIER_GROUPS_DATA: Record<string, { options: { name: string; priceDelta: string }[] }> = {
  "Termino Carnes, Salmon y Atun": {
    options: [
      { name: "Blue", priceDelta: "0" },
      { name: "Medio", priceDelta: "0" },
      { name: "Tres cuartos", priceDelta: "0" },
      { name: "Bien Cocido", priceDelta: "0" },
    ],
  },
  "Hamburguesa": {
    options: [
      { name: "Sin Vegetales", priceDelta: "0" },
      { name: "Sin Salsas", priceDelta: "0" },
      { name: "Sin Tomate", priceDelta: "0" },
      { name: "Sin Lechuga", priceDelta: "0" },
      { name: "Sin Queso", priceDelta: "0" },
      { name: "Sin Cebolla", priceDelta: "0" },
      { name: "Sin Tocineta", priceDelta: "0" },
      { name: "Tocineta extra", priceDelta: "800" },
    ],
  },
  "Cervezas": {
    options: [
      { name: "Michelada", priceDelta: "400" },
    ],
  },
  "Tipo de coctail": {
    options: [
      { name: "Ruso Blanco", priceDelta: "0" },
      { name: "Ruso Negro", priceDelta: "0" },
      { name: "Long Island", priceDelta: "0" },
      { name: "Sexo en la Montaña", priceDelta: "0" },
      { name: "Bloody Mary", priceDelta: "0" },
      { name: "Gin Tonic Pepino", priceDelta: "0" },
      { name: "Gin Tonic Frutos Rojos", priceDelta: "0" },
      { name: "Mojito", priceDelta: "0" },
      { name: "Margarita", priceDelta: "0" },
      { name: "Caipiriña", priceDelta: "0" },
      { name: "Daiquiri", priceDelta: "0" },
      { name: "Cosmopolitan", priceDelta: "0" },
    ],
  },
  "Extras Carnes": {
    options: [
      { name: "Vegetale a la Parrilla", priceDelta: "2000" },
      { name: "Arroz", priceDelta: "1000" },
      { name: "Maduro con Queso", priceDelta: "1500" },
      { name: "Frijoles Molidos", priceDelta: "1500" },
    ],
  },
  "Desayuno": {
    options: [
      { name: "Huevo Extra", priceDelta: "500" },
      { name: "Huevo frito bien cocido", priceDelta: "0" },
      { name: "Huevo frito tierno", priceDelta: "0" },
      { name: "Huevo Revuelto", priceDelta: "0" },
    ],
  },
  "Refresco Combos": {
    options: [],
  },
};

const DISCOUNTS_DATA = [
  { name: "Desc dueño 100%", type: "percentage", value: "100", restricted: true },
  { name: "Desc empleados 30%", type: "percentage", value: "30", restricted: false },
  { name: "Pago efectivo 7%", type: "percentage", value: "7", restricted: false },
  { name: "Vecinos5000 31/01", type: "fixed", value: "5000", restricted: false },
];

const MODIFIER_COL_NAMES = [
  "Hamburguesa",
  "Cervezas",
  "Refresco Combos",
  "Termino Carnes, Salmon y Atun",
  "Extras Carnes",
  "Tipo de coctail",
  "Desayuno",
];

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ";" && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function seedMenuFromCsv() {
  const csvPath = path.resolve(process.cwd(), "server", "menu_seed.csv");
  if (!fs.existsSync(csvPath)) {
    console.log("menu_seed.csv not found, skipping menu seed");
    return;
  }

  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return;

  const header = parseCsvLine(lines[0]);
  const nameIdx = header.findIndex((h) => h === "Nombre");
  const catIdx = header.findIndex((h) => h === "Categoria");
  const priceIdx = header.findIndex((h) => h.startsWith("Precio"));
  const handleIdx = header.findIndex((h) => h === "Handle");

  const modColIndices: number[] = [];
  for (const modName of MODIFIER_COL_NAMES) {
    const idx = header.findIndex((h) => h.includes(modName));
    modColIndices.push(idx);
  }

  console.log("Cleaning existing menu data before reimport...");
  await db.delete(itemModifierGroups);
  await db.delete(modifierOptions);
  await db.delete(modifierGroups);
  await db.delete(products);
  await db.delete(categories);
  await db.delete(discounts);
  console.log("  Cleaned products, categories, modifiers, and discounts.");

  console.log("Seeding modifier groups and options...");
  const groupIdMap: Record<string, number> = {};
  let sortOrder = 0;
  for (const [groupName, groupData] of Object.entries(MODIFIER_GROUPS_DATA)) {
    const [created] = await db.insert(modifierGroups).values({
      name: groupName,
      multiSelect: true,
      sortOrder: sortOrder++,
    }).returning();
    groupIdMap[groupName] = created.id;
    console.log(`  Created modifier group: ${groupName}`);

    let optSort = 0;
    for (const opt of groupData.options) {
      await db.insert(modifierOptions).values({
        groupId: created.id,
        name: opt.name,
        priceDelta: opt.priceDelta,
        sortOrder: optSort++,
      });
    }
  }

  console.log("Seeding categories and products from CSV...");
  const catIdMap: Record<string, number> = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const name = cols[nameIdx];
    const catName = cols[catIdx];
    const priceStr = cols[priceIdx];
    const handle = cols[handleIdx] || slugify(name);

    if (!name || !catName || !priceStr) continue;

    if (!catIdMap[catName]) {
      const catCode = slugify(catName);
      const [created] = await db.insert(categories).values({
        categoryCode: catCode,
        name: catName,
        sortOrder: Object.keys(catIdMap).length,
      }).returning();
      catIdMap[catName] = created.id;
      console.log(`  Category: ${catName}`);
    }

    const productCode = handle || slugify(name);
    const cleaned = priceStr.replace(/[^0-9.]/g, "");
    if (!cleaned && cleaned !== "0") continue;
    const price = cleaned || "0";

    const [created] = await db.insert(products).values({
      productCode,
      name,
      description: name,
      categoryId: catIdMap[catName],
      price,
    }).returning();
    console.log(`  Product: ${name} (₡${price})`);

    for (let m = 0; m < MODIFIER_COL_NAMES.length; m++) {
      const colIdx = modColIndices[m];
      if (colIdx < 0 || colIdx >= cols.length) continue;
      const val = cols[colIdx]?.toUpperCase();
      if (val === "Y") {
        const gId = groupIdMap[MODIFIER_COL_NAMES[m]];
        if (gId) {
          await db.insert(itemModifierGroups).values({ productId: created.id, modifierGroupId: gId });
        }
      }
    }
  }

  console.log("Seeding discounts...");
  for (const disc of DISCOUNTS_DATA) {
    await db.insert(discounts).values({
      name: disc.name,
      type: disc.type,
      value: disc.value,
      restricted: disc.restricted,
    });
    console.log(`  Discount: ${disc.name}`);
  }

  console.log("Seeding tax categories...");
  const existingTaxes = await db.select().from(taxCategories);
  if (existingTaxes.length === 0) {
    const [servicioTax] = await db.insert(taxCategories).values({
      name: "Servicio",
      rate: "10.00",
      inclusive: true,
      active: true,
      sortOrder: 0,
    }).returning();
    console.log(`  Tax: Servicio (10% inclusive) created`);

    const allProducts = await db.select().from(products);
    for (const p of allProducts) {
      await db.insert(productTaxCategories).values({
        productId: p.id,
        taxCategoryId: servicioTax.id,
      });
    }
    console.log(`  Assigned Servicio tax to ${allProducts.length} products`);
  } else {
    console.log("  Tax categories already exist, re-assigning to all products...");
    const activeTaxes = existingTaxes.filter(t => t.active);
    const allProds = await db.select({ id: products.id }).from(products);
    const productIdSet = new Set(allProds.map(p => p.id));
    const allPtc = await db.select().from(productTaxCategories);
    const orphaned = allPtc.filter(ptc => !productIdSet.has(ptc.productId));
    if (orphaned.length > 0) {
      const validProductIds = allProds.map(p => p.id);
      if (validProductIds.length > 0) {
        await db.delete(productTaxCategories).where(
          notInArray(productTaxCategories.productId, validProductIds)
        );
      } else {
        await db.delete(productTaxCategories);
      }
      console.log(`  Cleaned ${orphaned.length} orphaned tax assignments`);
    }
    for (const tc of activeTaxes) {
      const existing = await db.select().from(productTaxCategories)
        .where(eq(productTaxCategories.taxCategoryId, tc.id));
      const existingSet = new Set(existing.map(e => e.productId));
      const toInsert = allProds.filter(p => !existingSet.has(p.id));
      if (toInsert.length > 0) {
        await db.insert(productTaxCategories).values(
          toInsert.map(p => ({ productId: p.id, taxCategoryId: tc.id }))
        );
        console.log(`  Assigned ${tc.name} tax to ${toInsert.length} products`);
      }
    }
  }

  const { recalcOrderTotal } = await import("./storage");
  const openOrders = await db.select({ id: orders.id }).from(orders)
    .where(inArray(orders.status, ["OPEN", "IN_KITCHEN", "READY"]));
  if (openOrders.length > 0) {
    for (const o of openOrders) {
      await recalcOrderTotal(o.id);
    }
    console.log(`  Recalculated ${openOrders.length} open orders`);
  }

  await fixUtcBusinessDates();

  console.log("Menu seed complete!");
}

async function fixUtcBusinessDates() {
  const cutoffDate = "2026-02-15";
  const affectedOrders = await db.select({
    id: orders.id,
    businessDate: orders.businessDate,
    openedAt: orders.openedAt,
  }).from(orders).where(
    and(
      sql`${orders.businessDate} <= ${cutoffDate}`,
      sql`${orders.openedAt} IS NOT NULL`
    )
  );

  let fixedOrders = 0;
  for (const o of affectedOrders) {
    if (!o.openedAt) continue;
    const correctDate = new Date(o.openedAt).toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
    if (o.businessDate !== correctDate) {
      await db.update(orders).set({ businessDate: correctDate }).where(eq(orders.id, o.id));
      await db.update(salesLedgerItems).set({ businessDate: correctDate }).where(eq(salesLedgerItems.orderId, o.id));
      await db.update(voidedItems).set({ businessDate: correctDate }).where(eq(voidedItems.orderId, o.id));
      fixedOrders++;
    }
  }

  const allPayments = await db.select({
    id: payments.id,
    businessDate: payments.businessDate,
    paidAt: payments.paidAt,
  }).from(payments).where(
    sql`${payments.businessDate} <= ${cutoffDate} AND ${payments.paidAt} IS NOT NULL`
  );
  let fixedPayments = 0;
  for (const p of allPayments) {
    if (!p.paidAt) continue;
    const correctPayDate = new Date(p.paidAt).toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
    if (p.businessDate !== correctPayDate) {
      await db.update(payments).set({ businessDate: correctPayDate }).where(eq(payments.id, p.id));
      fixedPayments++;
    }
  }

  if (fixedOrders > 0 || fixedPayments > 0) {
    console.log(`  Fixed business_date: ${fixedOrders} orders, ${fixedPayments} payments (UTC -> America/Costa_Rica)`);
  }
}
