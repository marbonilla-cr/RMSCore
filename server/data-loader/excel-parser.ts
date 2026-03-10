import * as XLSX from "xlsx";
import { resolveSheetName, mapColumns, normalizeHeader } from "./column-aliases";

const MAX_ROWS_PER_SHEET = 2000;

export interface ParseResult {
  sheets: Record<string, Record<string, any>[]>;
  unmappedColumns: Record<string, string[]>;
}

export function parseExcelBuffer(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer", codepage: 65001 });

  const sheets: Record<string, Record<string, any>[]> = {};
  const unmappedColumns: Record<string, string[]> = {};

  for (const rawSheetName of workbook.SheetNames) {
    const canonicalName = resolveSheetName(rawSheetName);
    if (!canonicalName) continue;

    const worksheet = workbook.Sheets[rawSheetName];
    if (!worksheet) continue;

    const rawData: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, {
      defval: "",
      raw: false,
    });

    if (rawData.length === 0) continue;

    const headers = Object.keys(rawData[0]);
    const { mapped, unmapped } = mapColumns(headers, canonicalName);

    if (unmapped.length > 0) {
      unmappedColumns[canonicalName] = unmapped;
    }

    const rows: Record<string, any>[] = [];

    const limit = Math.min(rawData.length, MAX_ROWS_PER_SHEET);
    for (let i = 0; i < limit; i++) {
      const rawRow = rawData[i];
      const row: Record<string, any> = {};
      let hasData = false;

      for (const [originalHeader, value] of Object.entries(rawRow)) {
        const canonicalColumn = mapped[originalHeader];
        const key = canonicalColumn || normalizeHeader(originalHeader);
        const strValue = String(value).trim();

        if (strValue !== "") {
          hasData = true;
        }

        row[key] = strValue;
      }

      if (hasData) {
        rows.push(row);
      }
    }

    if (rows.length > 0) {
      sheets[canonicalName] = rows;
    }
  }

  return { sheets, unmappedColumns };
}
