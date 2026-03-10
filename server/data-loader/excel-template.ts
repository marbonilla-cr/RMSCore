import * as XLSX from "xlsx";
import { SHEET_EXPECTED_COLUMNS } from "./column-aliases";

const SHEET_ORDER = [
  "business",
  "taxes",
  "payment_methods",
  "employees",
  "categories",
  "products",
  "modifier_groups",
  "modifiers",
  "product_modifiers",
  "tables",
  "hr_config",
];

const DISPLAY_NAMES: Record<string, string> = {
  business: "Business",
  taxes: "Taxes",
  payment_methods: "PaymentMethods",
  employees: "Employees",
  categories: "Categories",
  products: "Products",
  modifier_groups: "ModifierGroups",
  modifiers: "Modifiers",
  product_modifiers: "ProductModifiers",
  tables: "Tables",
  hr_config: "HRConfig",
};

const EXAMPLE_ROWS: Record<string, Record<string, any>> = {
  business: {
    name: "Mi Restaurante",
    currency: "CRC",
    timezone: "America/Costa_Rica",
    address: "San José, Costa Rica",
    service_percentage: "10",
    default_tax: "IVA",
  },
  taxes: {
    tax_name: "IVA",
    percentage: "13",
    inclusive: "false",
  },
  payment_methods: {
    payment_name: "Efectivo",
    type: "cash",
    active: "true",
  },
  employees: {
    employee_name: "Admin Principal",
    role: "MANAGER",
    active: "true",
  },
  categories: {
    category_name: "Hamburguesas",
    parent_category: "",
  },
  products: {
    product_name: "Hamburguesa Clásica",
    category: "Hamburguesas",
    price: "4500",
    tax: "IVA",
  },
  modifier_groups: {
    group_name: "Tipo de Pan",
    required: "true",
    max_select: "1",
  },
  modifiers: {
    modifier_name: "Pan Brioche",
    group_name: "Tipo de Pan",
    price: "0",
  },
  product_modifiers: {
    product_name: "Hamburguesa Clásica",
    group_name: "Tipo de Pan",
  },
  tables: {
    table_name: "M1",
    area: "Principal",
    capacity: "4",
  },
  hr_config: {
    service_percentage: "10",
  },
};

export function generateTemplateBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();

  for (const sheetKey of SHEET_ORDER) {
    const columns = SHEET_EXPECTED_COLUMNS[sheetKey] || [];
    const displayName = DISPLAY_NAMES[sheetKey] || sheetKey;
    const example = EXAMPLE_ROWS[sheetKey] || {};

    const exampleRow: Record<string, any> = {};
    for (const col of columns) {
      exampleRow[col] = example[col] || "";
    }

    const worksheet = XLSX.utils.json_to_sheet([exampleRow], { header: columns });

    const colWidths = columns.map(col => ({ wch: Math.max(col.length + 2, 15) }));
    worksheet["!cols"] = colWidths;

    XLSX.utils.book_append_sheet(workbook, worksheet, displayName);
  }

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return buffer;
}
