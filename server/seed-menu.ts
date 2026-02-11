import fs from "fs";
import path from "path";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import {
  categories, products, modifierGroups, modifierOptions,
  itemModifierGroups, discounts,
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

  console.log("Seeding modifier groups and options...");
  const groupIdMap: Record<string, number> = {};
  let sortOrder = 0;
  for (const [groupName, groupData] of Object.entries(MODIFIER_GROUPS_DATA)) {
    let [existing] = await db.select().from(modifierGroups).where(eq(modifierGroups.name, groupName));
    if (!existing) {
      [existing] = await db.insert(modifierGroups).values({
        name: groupName,
        multiSelect: true,
        sortOrder: sortOrder++,
      }).returning();
      console.log(`  Created modifier group: ${groupName}`);
    }
    groupIdMap[groupName] = existing.id;

    let optSort = 0;
    for (const opt of groupData.options) {
      const [existingOpt] = await db.select().from(modifierOptions)
        .where(and(eq(modifierOptions.groupId, existing.id), eq(modifierOptions.name, opt.name)));
      if (!existingOpt) {
        await db.insert(modifierOptions).values({
          groupId: existing.id,
          name: opt.name,
          priceDelta: opt.priceDelta,
          sortOrder: optSort++,
        });
        console.log(`    Option: ${opt.name} (₡${opt.priceDelta})`);
      }
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
      const [existing] = await db.select().from(categories).where(eq(categories.categoryCode, catCode));
      if (existing) {
        catIdMap[catName] = existing.id;
      } else {
        const [created] = await db.insert(categories).values({
          categoryCode: catCode,
          name: catName,
          sortOrder: Object.keys(catIdMap).length,
        }).returning();
        catIdMap[catName] = created.id;
        console.log(`  Category: ${catName}`);
      }
    }

    const productCode = handle || slugify(name);
    const cleaned = priceStr.replace(/[^0-9.]/g, "");
    if (!cleaned && cleaned !== "0") continue;
    const price = cleaned || "0";

    const [existingProd] = await db.select().from(products).where(eq(products.productCode, productCode));
    let productId: number;
    if (existingProd) {
      await db.update(products).set({
        name,
        price,
        categoryId: catIdMap[catName],
        description: name,
      }).where(eq(products.id, existingProd.id));
      productId = existingProd.id;
    } else {
      const [created] = await db.insert(products).values({
        productCode,
        name,
        description: name,
        categoryId: catIdMap[catName],
        price,
      }).returning();
      productId = created.id;
      console.log(`  Product: ${name} (₡${price})`);
    }

    for (let m = 0; m < MODIFIER_COL_NAMES.length; m++) {
      const colIdx = modColIndices[m];
      if (colIdx < 0 || colIdx >= cols.length) continue;
      const val = cols[colIdx]?.toUpperCase();
      if (val === "Y") {
        const gId = groupIdMap[MODIFIER_COL_NAMES[m]];
        if (gId) {
          const [existingLink] = await db.select().from(itemModifierGroups)
            .where(and(eq(itemModifierGroups.productId, productId), eq(itemModifierGroups.modifierGroupId, gId)));
          if (!existingLink) {
            await db.insert(itemModifierGroups).values({ productId, modifierGroupId: gId });
          }
        }
      }
    }
  }

  console.log("Seeding discounts...");
  for (const disc of DISCOUNTS_DATA) {
    const [existing] = await db.select().from(discounts).where(eq(discounts.name, disc.name));
    if (!existing) {
      await db.insert(discounts).values({
        name: disc.name,
        type: disc.type,
        value: disc.value,
        restricted: disc.restricted,
      });
      console.log(`  Discount: ${disc.name}`);
    }
  }

  console.log("Menu seed complete!");
}
