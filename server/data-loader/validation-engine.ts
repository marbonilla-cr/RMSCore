import { db } from "../db";
import { sql } from "drizzle-orm";

interface ValidationError {
  field: string;
  message: string;
}

interface RowValidationResult {
  rowId: number;
  status: "VALID" | "INVALID";
  errors: ValidationError[];
}

interface ValidationResult {
  valid: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: { sheet: string; rowIndex: number; field: string; message: string }[];
}

function requireField(data: Record<string, any>, field: string): ValidationError | null {
  const val = data[field];
  if (val === undefined || val === null || String(val).trim() === "") {
    return { field, message: `${field} es requerido` };
  }
  return null;
}

function requireNumericRange(data: Record<string, any>, field: string, min: number, max: number): ValidationError | null {
  const val = data[field];
  if (val === undefined || val === null || String(val).trim() === "") return null;
  const num = Number(val);
  if (isNaN(num)) {
    return { field, message: `${field} debe ser un número` };
  }
  if (num < min || num > max) {
    return { field, message: `${field} debe estar entre ${min} y ${max}` };
  }
  return null;
}

function requireNonNegative(data: Record<string, any>, field: string): ValidationError | null {
  const val = data[field];
  if (val === undefined || val === null || String(val).trim() === "") return null;
  const num = Number(val);
  if (isNaN(num)) {
    return { field, message: `${field} debe ser un número` };
  }
  if (num < 0) {
    return { field, message: `${field} no puede ser negativo` };
  }
  return null;
}

function referenceExists(value: string | undefined, refSet: Set<string>, field: string, refSheet: string): ValidationError | null {
  if (!value || String(value).trim() === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (!refSet.has(normalized)) {
    return { field, message: `${field} "${value}" no existe en ${refSheet}` };
  }
  return null;
}

function buildLookupSet(rows: Record<string, any>[], field: string): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    const val = row[field];
    if (val && String(val).trim() !== "") {
      set.add(String(val).trim().toLowerCase());
    }
  }
  return set;
}

const SHEET_VALIDATORS: Record<string, (data: Record<string, any>, lookups: Record<string, Set<string>>) => ValidationError[]> = {
  business: (data) => {
    const errors: ValidationError[] = [];
    const e1 = requireField(data, "name"); if (e1) errors.push(e1);
    const e2 = requireField(data, "currency"); if (e2) errors.push(e2);
    return errors;
  },
  taxes: (data) => {
    const errors: ValidationError[] = [];
    const e1 = requireField(data, "tax_name"); if (e1) errors.push(e1);
    const e2 = requireField(data, "percentage"); if (e2) errors.push(e2);
    const e3 = requireNumericRange(data, "percentage", 0, 100); if (e3) errors.push(e3);
    return errors;
  },
  payment_methods: (data) => {
    const errors: ValidationError[] = [];
    const e1 = requireField(data, "payment_name"); if (e1) errors.push(e1);
    return errors;
  },
  employees: (data) => {
    const errors: ValidationError[] = [];
    const e1 = requireField(data, "employee_name"); if (e1) errors.push(e1);
    const e2 = requireField(data, "role"); if (e2) errors.push(e2);
    return errors;
  },
  categories: (data) => {
    const errors: ValidationError[] = [];
    const e1 = requireField(data, "category_name"); if (e1) errors.push(e1);
    return errors;
  },
  products: (data, lookups) => {
    const errors: ValidationError[] = [];
    const e1 = requireField(data, "product_name"); if (e1) errors.push(e1);
    const e3 = requireNonNegative(data, "price"); if (e3) errors.push(e3);
    const e4 = referenceExists(data.category, lookups.categories, "category", "Categories");
    if (e4) errors.push(e4);
    const e5 = referenceExists(data.tax, lookups.taxes, "tax", "Taxes");
    if (e5) errors.push(e5);
    return errors;
  },
  modifier_groups: (data) => {
    const errors: ValidationError[] = [];
    const e1 = requireField(data, "group_name"); if (e1) errors.push(e1);
    return errors;
  },
  modifiers: (data, lookups) => {
    const errors: ValidationError[] = [];
    const e1 = requireField(data, "modifier_name"); if (e1) errors.push(e1);
    const e2 = requireField(data, "group_name"); if (e2) errors.push(e2);
    const e3 = referenceExists(data.group_name, lookups.modifier_groups, "group_name", "ModifierGroups");
    if (e3) errors.push(e3);
    return errors;
  },
  product_modifiers: (data, lookups) => {
    const errors: ValidationError[] = [];
    const e1 = requireField(data, "product_name"); if (e1) errors.push(e1);
    const e2 = requireField(data, "group_name"); if (e2) errors.push(e2);
    const e3 = referenceExists(data.product_name, lookups.products, "product_name", "Products");
    if (e3) errors.push(e3);
    const e4 = referenceExists(data.group_name, lookups.modifier_groups, "group_name", "ModifierGroups");
    if (e4) errors.push(e4);
    return errors;
  },
  tables: (data) => {
    const errors: ValidationError[] = [];
    const e1 = requireField(data, "table_name"); if (e1) errors.push(e1);
    return errors;
  },
  hr_config: (data) => {
    const errors: ValidationError[] = [];
    const e1 = requireNumericRange(data, "service_percentage", 0, 100); if (e1) errors.push(e1);
    return errors;
  },
};

export async function validateSession(
  sessionId: number,
  tenantDb: any,
): Promise<ValidationResult> {
  // Tenant-aware: operaciones contra el schema del tenant actual.
  const db = tenantDb;

  const allRows = await db.execute(sql`
    SELECT id, sheet_name, row_index, data_json 
    FROM data_loader_staging 
    WHERE session_id = ${sessionId}
    ORDER BY sheet_name, row_index
  `);

  const rowsBySheet: Record<string, { id: number; rowIndex: number; data: Record<string, any> }[]> = {};
  for (const row of allRows.rows) {
    const sheet = row.sheet_name as string;
    if (!rowsBySheet[sheet]) rowsBySheet[sheet] = [];
    rowsBySheet[sheet].push({
      id: row.id as number,
      rowIndex: row.row_index as number,
      data: row.data_json as Record<string, any>,
    });
  }

  const categoryRows = (rowsBySheet.categories || []).map(r => r.data);
  const categoriesSet = buildLookupSet(categoryRows, "category_name");
  const subcategoriesSet = buildLookupSet(categoryRows, "parent_category");
  for (const val of subcategoriesSet) categoriesSet.add(val);

  const lookups: Record<string, Set<string>> = {
    categories: categoriesSet,
    taxes: buildLookupSet(
      (rowsBySheet.taxes || []).map(r => r.data),
      "tax_name"
    ),
    products: buildLookupSet(
      (rowsBySheet.products || []).map(r => r.data),
      "product_name"
    ),
    modifier_groups: buildLookupSet(
      (rowsBySheet.modifier_groups || []).map(r => r.data),
      "group_name"
    ),
  };

  const allErrors: { sheet: string; rowIndex: number; field: string; message: string }[] = [];
  let validCount = 0;
  let invalidCount = 0;

  for (const [sheet, rows] of Object.entries(rowsBySheet)) {
    const validator = SHEET_VALIDATORS[sheet];
    if (!validator) {
      for (const row of rows) {
        await db.execute(sql`
          UPDATE data_loader_staging 
          SET validation_status = 'VALID', validation_errors = NULL, updated_at = NOW()
          WHERE id = ${row.id}
        `);
        validCount++;
      }
      continue;
    }

    for (const row of rows) {
      const errors = validator(row.data, lookups);

      if (errors.length === 0) {
        await db.execute(sql`
          UPDATE data_loader_staging 
          SET validation_status = 'VALID', validation_errors = NULL, updated_at = NOW()
          WHERE id = ${row.id}
        `);
        validCount++;
      } else {
        await db.execute(sql`
          UPDATE data_loader_staging 
          SET validation_status = 'INVALID', 
              validation_errors = ${JSON.stringify(errors)}::jsonb, 
              updated_at = NOW()
          WHERE id = ${row.id}
        `);
        invalidCount++;
        for (const err of errors) {
          allErrors.push({ sheet, rowIndex: row.rowIndex, field: err.field, message: err.message });
        }
      }
    }
  }

  const totalRows = validCount + invalidCount;
  const isValid = invalidCount === 0 && totalRows > 0;

  await db.execute(sql`
    UPDATE data_loader_sessions 
    SET status = ${isValid ? "validated" : "staged"}, updated_at = NOW()
    WHERE id = ${sessionId}
  `);

  return {
    valid: isValid,
    totalRows,
    validRows: validCount,
    invalidRows: invalidCount,
    errors: allErrors,
  };
}
