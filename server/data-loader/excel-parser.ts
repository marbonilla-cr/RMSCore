import * as XLSX from "xlsx";
import { resolveSheetName, mapColumns, normalizeHeader } from "./column-aliases";

const MAX_ROWS_PER_SHEET = 2000;

const MOJIBAKE_PAIRS: [string, string][] = [
  ["\u221a\u00b0", "\u00e1"],
  ["\u221a\u00a9", "\u00e9"],
  ["\u221a\u2260", "\u00ed"],
  ["\u221a\u00b3", "\u00f3"],
  ["\u221a\u222b", "\u00fa"],
  ["\u221a\u00b1", "\u00f1"],
  ["\u221a\u00fc", "\u00fc"],
  ["\u221a\u00c5", "\u00c1"],
  ["\u221a\u00e2", "\u00c9"],
  ["\u221a\u00e7", "\u00cd"],
  ["\u221a\u00ec", "\u00d3"],
  ["\u221a\u00f6", "\u00da"],
  ["\u221a\u00eb", "\u00d1"],
  ["\u221a\u00fa", "\u00dc"],
];

function fixMojibake(str: string): string {
  let result = str;
  for (const [broken, fixed] of MOJIBAKE_PAIRS) {
    result = result.split(broken).join(fixed);
  }
  try {
    const latin1 = Buffer.from(result, "latin1");
    const utf8Attempt = latin1.toString("utf8");
    if (utf8Attempt.length < result.length && !utf8Attempt.includes("�")) {
      return utf8Attempt;
    }
  } catch {}
  return result;
}

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
        const strValue = fixMojibake(String(value).trim());

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
