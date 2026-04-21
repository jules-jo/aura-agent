import { promises as fs } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";
import { resolveRepoPath } from "../wiki/pages.js";

const spreadsheetReadSchema = z.object({
  path: z.string().min(1).describe("Spreadsheet path relative to the repo root. Supports .csv, .tsv, and .xlsx."),
  sheet_name: z.string().min(1).optional().describe("Optional sheet name for .xlsx files. Defaults to the first sheet."),
  max_rows: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .describe("Maximum data rows to return. Defaults to 100, max 500."),
});

export interface SpreadsheetToolsOptions {
  rootDir: string;
}

export interface SpreadsheetColumn {
  index: number;
  name: string;
  key: string;
}

export type SpreadsheetCellValue = string | number | boolean | null;

export type SpreadsheetRow = {
  _row_number: number;
} & Record<string, SpreadsheetCellValue>;

export interface SpreadsheetReadResult {
  path: string;
  format: "csv" | "tsv" | "xlsx";
  sheet_name: string | null;
  sheet_names: string[];
  columns: SpreadsheetColumn[];
  rows: SpreadsheetRow[];
  row_count: number;
  returned_rows: number;
  truncated: boolean;
}

export interface SpreadsheetWriteUpdate {
  rowNumber: number;
  values: Record<string, SpreadsheetCellValue>;
}

export interface SpreadsheetWriteOptions {
  path: string;
  sheetName?: string;
  updates: SpreadsheetWriteUpdate[];
}

export interface SpreadsheetWriteResult {
  path: string;
  format: "csv" | "tsv" | "xlsx";
  sheet_name: string | null;
  updated_rows: number[];
  updated_columns: string[];
}

export function spreadsheetTools(options: SpreadsheetToolsOptions): Tool<any>[] {
  const readTool = defineTool("spreadsheet_read", {
    description:
      "Read a local CSV, TSV, or XLSX spreadsheet from the repo and return normalized rows. Read-only; does not modify files.",
    parameters: spreadsheetReadSchema,
    handler: async (args) => {
      try {
        return await readSpreadsheet(options.rootDir, {
          path: args.path,
          ...(args.sheet_name !== undefined ? { sheetName: args.sheet_name } : {}),
          ...(args.max_rows !== undefined ? { maxRows: args.max_rows } : {}),
        });
      } catch (err: unknown) {
        return {
          error: classifySpreadsheetError(err),
          path: args.path,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  return [readTool];
}

export interface ReadSpreadsheetOptions {
  path: string;
  sheetName?: string;
  maxRows?: number;
}

export async function readSpreadsheet(
  rootDir: string,
  options: ReadSpreadsheetOptions,
): Promise<SpreadsheetReadResult> {
  const repoPath = normalizeRepoPath(options.path);
  const absolutePath = resolveRepoPath(rootDir, repoPath);
  const maxRows = options.maxRows ?? 100;
  const ext = path.extname(repoPath).toLowerCase();

  if (ext === ".csv") {
    const raw = await fs.readFile(absolutePath, "utf8");
    return tableToResult(repoPath, "csv", null, [], parseDelimited(raw, ","), maxRows);
  }

  if (ext === ".tsv") {
    const raw = await fs.readFile(absolutePath, "utf8");
    return tableToResult(repoPath, "tsv", null, [], parseDelimited(raw, "\t"), maxRows);
  }

  if (ext === ".xlsx") {
    return readXlsx(repoPath, absolutePath, options.sheetName, maxRows);
  }

  throw new Error("unsupported spreadsheet format; expected .csv, .tsv, or .xlsx");
}

export async function writeSpreadsheetUpdates(
  rootDir: string,
  options: SpreadsheetWriteOptions,
): Promise<SpreadsheetWriteResult> {
  const repoPath = normalizeRepoPath(options.path);
  const absolutePath = resolveRepoPath(rootDir, repoPath);
  const ext = path.extname(repoPath).toLowerCase();
  if (options.updates.length === 0) {
    throw new Error("at least one spreadsheet update is required");
  }

  if (ext === ".csv" || ext === ".tsv") {
    const delimiter = ext === ".csv" ? "," : "\t";
    const raw = await fs.readFile(absolutePath, "utf8");
    const table = parseDelimited(raw, delimiter);
    const result = applyTableUpdates(table, options.updates);
    await fs.writeFile(absolutePath, serializeDelimited(table, delimiter), "utf8");
    return {
      path: repoPath,
      format: ext === ".csv" ? "csv" : "tsv",
      sheet_name: null,
      updated_rows: result.updatedRows,
      updated_columns: result.updatedColumns,
    };
  }

  if (ext === ".xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(absolutePath);
    const worksheet = options.sheetName
      ? workbook.getWorksheet(options.sheetName)
      : workbook.worksheets[0];
    if (!worksheet) {
      const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
      throw new Error(
        options.sheetName
          ? `sheet not found: ${options.sheetName}; available sheets: ${sheetNames.join(", ")}`
          : "workbook has no worksheets",
      );
    }
    const result = applyWorksheetUpdates(worksheet, options.updates);
    await workbook.xlsx.writeFile(absolutePath);
    return {
      path: repoPath,
      format: "xlsx",
      sheet_name: worksheet.name,
      updated_rows: result.updatedRows,
      updated_columns: result.updatedColumns,
    };
  }

  throw new Error("unsupported spreadsheet format; expected .csv, .tsv, or .xlsx");
}

async function readXlsx(
  repoPath: string,
  absolutePath: string,
  requestedSheetName: string | undefined,
  maxRows: number,
): Promise<SpreadsheetReadResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(absolutePath);
  const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
  const worksheet = requestedSheetName
    ? workbook.getWorksheet(requestedSheetName)
    : workbook.worksheets[0];
  if (!worksheet) {
    throw new Error(
      requestedSheetName
        ? `sheet not found: ${requestedSheetName}; available sheets: ${sheetNames.join(", ")}`
        : "workbook has no worksheets",
    );
  }

  const table: SpreadsheetCellValue[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values: SpreadsheetCellValue[] = [];
    for (let i = 1; i <= row.cellCount; i++) {
      values.push(normalizeCellValue(row.getCell(i).value));
    }
    table.push(values);
  });

  return tableToResult(repoPath, "xlsx", worksheet.name, sheetNames, table, maxRows);
}

function tableToResult(
  repoPath: string,
  format: SpreadsheetReadResult["format"],
  sheetName: string | null,
  sheetNames: string[],
  table: SpreadsheetCellValue[][],
  maxRows: number,
): SpreadsheetReadResult {
  const headerRow = table[0] ?? [];
  const columns = buildColumns(headerRow);
  const dataRows = table.slice(1).filter((row) => row.some((value) => value !== null && value !== ""));
  const returned = dataRows.slice(0, maxRows);
  const rows = returned.map((row, idx) => rowToObject(row, columns, idx + 2));

  return {
    path: repoPath,
    format,
    sheet_name: sheetName,
    sheet_names: sheetNames,
    columns,
    rows,
    row_count: dataRows.length,
    returned_rows: rows.length,
    truncated: dataRows.length > rows.length,
  };
}

function buildColumns(headerRow: readonly SpreadsheetCellValue[]): SpreadsheetColumn[] {
  const seen = new Map<string, number>();
  return headerRow.map((value, idx) => {
    const name = stringifyHeader(value) || `column_${idx + 1}`;
    const baseKey = normalizeColumnKey(name) || `column_${idx + 1}`;
    const count = (seen.get(baseKey) ?? 0) + 1;
    seen.set(baseKey, count);
    return {
      index: idx + 1,
      name,
      key: count === 1 ? baseKey : `${baseKey}_${count}`,
    };
  });
}

function rowToObject(
  row: readonly SpreadsheetCellValue[],
  columns: readonly SpreadsheetColumn[],
  rowNumber: number,
): SpreadsheetRow {
  const out: SpreadsheetRow = { _row_number: rowNumber };
  for (const column of columns) {
    out[column.key] = row[column.index - 1] ?? null;
  }
  return out;
}

function parseDelimited(raw: string, delimiter: "," | "\t"): SpreadsheetCellValue[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\"") {
      if (inQuotes && raw[i + 1] === "\"") {
        cell += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && raw[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch ?? "";
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.map((cells) => cells.map((value) => normalizeScalar(value)));
}

function serializeDelimited(table: readonly SpreadsheetCellValue[][], delimiter: "," | "\t"): string {
  return `${table.map((row) => row.map((value) => serializeDelimitedCell(value, delimiter)).join(delimiter)).join("\n")}\n`;
}

function serializeDelimitedCell(value: SpreadsheetCellValue, delimiter: "," | "\t"): string {
  if (value === null) return "";
  const raw = String(value);
  if (!raw.includes(delimiter) && !/["\r\n]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, "\"\"")}"`;
}

function normalizeCellValue(value: ExcelJS.CellValue): SpreadsheetCellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return normalizeCellValue(value.result as ExcelJS.CellValue);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text).join("");
    }
  }
  return String(value);
}

function normalizeScalar(value: string): SpreadsheetCellValue {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stringifyHeader(value: SpreadsheetCellValue): string {
  if (value === null) return "";
  return String(value).trim();
}

function normalizeColumnKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeRepoPath(repoPath: string): string {
  return repoPath.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function applyTableUpdates(
  table: SpreadsheetCellValue[][],
  updates: readonly SpreadsheetWriteUpdate[],
): { updatedRows: number[]; updatedColumns: string[] } {
  if (table.length === 0 || !table[0] || table[0].length === 0) {
    throw new Error("spreadsheet must contain a header row before results can be written");
  }
  const header = table[0];
  const columns = ensureColumns(header, uniqueUpdateColumns(updates));
  const updatedRows: number[] = [];

  for (const update of updates) {
    assertWritableRow(update.rowNumber);
    const tableIndex = update.rowNumber - 1;
    while (table.length <= tableIndex) table.push([]);
    const row = table[tableIndex] ?? [];
    table[tableIndex] = row;
    while (row.length < header.length) row.push(null);
    for (const [name, value] of Object.entries(update.values)) {
      const columnIndex = columns.get(normalizeColumnKey(name));
      if (columnIndex === undefined) continue;
      row[columnIndex - 1] = value;
    }
    updatedRows.push(update.rowNumber);
  }

  return {
    updatedRows,
    updatedColumns: [...uniqueUpdateColumns(updates)],
  };
}

function applyWorksheetUpdates(
  worksheet: ExcelJS.Worksheet,
  updates: readonly SpreadsheetWriteUpdate[],
): { updatedRows: number[]; updatedColumns: string[] } {
  const header = worksheet.getRow(1);
  if (header.cellCount === 0) {
    throw new Error("spreadsheet must contain a header row before results can be written");
  }
  const columns = ensureWorksheetColumns(header, uniqueUpdateColumns(updates));
  const updatedRows: number[] = [];

  for (const update of updates) {
    assertWritableRow(update.rowNumber);
    const row = worksheet.getRow(update.rowNumber);
    for (const [name, value] of Object.entries(update.values)) {
      const columnIndex = columns.get(normalizeColumnKey(name));
      if (columnIndex === undefined) continue;
      row.getCell(columnIndex).value = value;
    }
    row.commit();
    updatedRows.push(update.rowNumber);
  }
  header.commit();

  return {
    updatedRows,
    updatedColumns: [...uniqueUpdateColumns(updates)],
  };
}

function ensureColumns(
  header: SpreadsheetCellValue[],
  columnNames: readonly string[],
): Map<string, number> {
  const out = new Map<string, number>();
  header.forEach((value, index) => {
    const key = normalizeColumnKey(stringifyHeader(value));
    if (key && !out.has(key)) out.set(key, index + 1);
  });
  for (const name of columnNames) {
    const key = normalizeColumnKey(name);
    if (!key || out.has(key)) continue;
    header.push(name);
    out.set(key, header.length);
  }
  return out;
}

function ensureWorksheetColumns(
  header: ExcelJS.Row,
  columnNames: readonly string[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 1; i <= header.cellCount; i += 1) {
    const key = normalizeColumnKey(stringifyHeader(normalizeCellValue(header.getCell(i).value)));
    if (key && !out.has(key)) out.set(key, i);
  }
  let nextColumn = header.cellCount + 1;
  for (const name of columnNames) {
    const key = normalizeColumnKey(name);
    if (!key || out.has(key)) continue;
    header.getCell(nextColumn).value = name;
    out.set(key, nextColumn);
    nextColumn += 1;
  }
  return out;
}

function uniqueUpdateColumns(updates: readonly SpreadsheetWriteUpdate[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const update of updates) {
    for (const name of Object.keys(update.values)) {
      const key = normalizeColumnKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

function assertWritableRow(rowNumber: number): void {
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    throw new Error("spreadsheet row_number must point to a data row (2 or greater)");
  }
}

function classifySpreadsheetError(err: unknown): string {
  if (err instanceof Error && /path escapes repo root|path is required/i.test(err.message)) return "invalid_path";
  if (err instanceof Error && /unsupported spreadsheet format/i.test(err.message)) return "unsupported_format";
  if (err instanceof Error && /sheet not found|no worksheets/i.test(err.message)) return "sheet_not_found";
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT") return "not_found";
  return "read_failed";
}
