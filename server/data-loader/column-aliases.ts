const COLUMN_ALIAS_MAP: Record<string, string[]> = {
  product_name: ["product", "nombre", "producto", "name"],
  price: ["price", "precio", "cost", "costo"],
  category: ["category", "categoria"],
  tax: ["tax", "impuesto", "tax_name"],
  employee_name: ["employee", "empleado", "nombre"],
  group_name: ["group", "grupo", "group_name"],
  modifier_name: ["modifier", "modificador"],
  payment_name: ["payment", "pago", "payment_name"],
  table_name: ["table", "mesa", "table_name"],
  category_name: ["category_name", "categoria", "category"],
  percentage: ["porcentaje", "rate", "tasa"],
  inclusive: ["inclusivo", "included"],
  required: ["obligatorio", "requerido"],
  max_select: ["max", "max_selections"],
  parent_category: ["parent", "categoria_padre", "parent_category"],
  area: ["zona", "section"],
  capacity: ["capacidad", "seats"],
  active: ["activo"],
  role: ["rol", "puesto"],
  type: ["tipo"],
  service_percentage: ["service_pct", "porcentaje_servicio"],
  default_tax: ["impuesto_default"],
  timezone: ["zona_horaria"],
  currency: ["moneda"],
  address: ["direccion"],
  name: ["nombre"],
  tax_name: ["tax_name", "impuesto", "tax"],
};

const SHEET_NAME_ALIASES: Record<string, string[]> = {
  business: ["Business", "01_Business", "Negocio"],
  taxes: ["Taxes", "02_Taxes", "Impuestos"],
  payment_methods: ["PaymentMethods", "03_PaymentMethods", "MetodosPago"],
  employees: ["Employees", "04_Employees", "Empleados"],
  categories: ["Categories", "05_MenuCategories", "Categorias"],
  products: ["Products", "06_Products", "Productos"],
  modifier_groups: ["ModifierGroups", "07_ModifierGroups", "GruposModificadores"],
  modifiers: ["Modifiers", "08_Modifiers", "Modificadores"],
  product_modifiers: ["ProductModifiers", "09_ProductModifiers"],
  tables: ["Tables", "10_Tables", "Mesas"],
  hr_config: ["HRConfig", "15_HRConfig", "ConfigHR"],
};

const SHEET_EXPECTED_COLUMNS: Record<string, string[]> = {
  business: ["name", "currency", "timezone", "address", "service_percentage", "default_tax"],
  taxes: ["tax_name", "percentage", "inclusive"],
  payment_methods: ["payment_name", "type", "active"],
  employees: ["employee_name", "role", "active"],
  categories: ["category_name", "parent_category"],
  products: ["product_name", "category", "price", "tax"],
  modifier_groups: ["group_name", "required", "max_select"],
  modifiers: ["modifier_name", "group_name", "price"],
  product_modifiers: ["product_name", "group_name"],
  tables: ["table_name", "area", "capacity"],
  hr_config: ["service_percentage"],
};

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeHeader(header: string): string {
  return removeAccents(header.toString().toLowerCase().trim()).replace(/\s+/g, "_");
}

function buildReverseAliasMap(context: string): Map<string, string> {
  const reverseMap = new Map<string, string>();

  const expectedColumns = SHEET_EXPECTED_COLUMNS[context] || [];

  for (const canonical of expectedColumns) {
    reverseMap.set(canonical, canonical);
  }

  for (const [canonical, aliases] of Object.entries(COLUMN_ALIAS_MAP)) {
    if (expectedColumns.length > 0 && !expectedColumns.includes(canonical)) {
      continue;
    }
    for (const alias of aliases) {
      const normalizedAlias = normalizeHeader(alias);
      if (!reverseMap.has(normalizedAlias)) {
        reverseMap.set(normalizedAlias, canonical);
      }
    }
  }

  return reverseMap;
}

export function resolveSheetName(rawName: string): string | null {
  const normalized = removeAccents(rawName.trim());

  for (const [canonical, aliases] of Object.entries(SHEET_NAME_ALIASES)) {
    if (normalized.toLowerCase() === canonical) return canonical;
    for (const alias of aliases) {
      if (removeAccents(alias).toLowerCase() === normalized.toLowerCase()) {
        return canonical;
      }
    }
  }

  return null;
}

export function mapColumns(
  headers: string[],
  sheetContext: string
): { mapped: Record<string, string>; unmapped: string[] } {
  const reverseMap = buildReverseAliasMap(sheetContext);
  const mapped: Record<string, string> = {};
  const unmapped: string[] = [];

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    const canonical = reverseMap.get(normalized);
    if (canonical) {
      mapped[header] = canonical;
    } else {
      unmapped.push(header);
    }
  }

  return { mapped, unmapped };
}

export function getExpectedColumns(sheetName: string): string[] {
  return SHEET_EXPECTED_COLUMNS[sheetName] || [];
}

export { SHEET_EXPECTED_COLUMNS, SHEET_NAME_ALIASES, normalizeHeader };
