import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (name: string, config: Record<string, unknown>) => ({ name, ...config }),
}));

const { readSpreadsheet, spreadsheetTools, writeSpreadsheetUpdates } = await import("../src/tools/spreadsheet.js");

function callHandler<T = unknown>(
  tools: ReturnType<typeof spreadsheetTools>,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  const invocation = { sessionId: "test", toolCallId: "tc1", toolName: name, arguments: args };
  return Promise.resolve(tool.handler(args, invocation)) as Promise<T>;
}

describe("spreadsheet tools", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "aura-spreadsheet-"));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("reads CSV files into normalized row objects", async () => {
    await fs.writeFile(
      path.join(rootDir, "plan.csv"),
      [
        "Test Name,System Name,Iterations,Notes",
        "Test Z,System A,10,\"quoted, note\"",
        "Test X,System B,,",
      ].join("\n"),
      "utf8",
    );

    const result = await readSpreadsheet(rootDir, { path: "plan.csv" });

    expect(result.format).toBe("csv");
    expect(result.columns.map((column) => column.key)).toEqual([
      "test_name",
      "system_name",
      "iterations",
      "notes",
    ]);
    expect(result.rows).toEqual([
      {
        _row_number: 2,
        test_name: "Test Z",
        system_name: "System A",
        iterations: "10",
        notes: "quoted, note",
      },
      {
        _row_number: 3,
        test_name: "Test X",
        system_name: "System B",
        iterations: null,
        notes: null,
      },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("reads a selected XLSX sheet", async () => {
    const workbook = new ExcelJS.Workbook();
    const ignored = workbook.addWorksheet("Ignored");
    ignored.addRow(["Test Name"]);
    ignored.addRow(["Wrong"]);
    const sheet = workbook.addWorksheet("Plan");
    sheet.addRow(["Test Name", "System Name", "Iterations"]);
    sheet.addRow(["Test Z", "System A", 10]);
    const filePath = path.join(rootDir, "plan.xlsx");
    await workbook.xlsx.writeFile(filePath);

    const result = await readSpreadsheet(rootDir, { path: "plan.xlsx", sheetName: "Plan" });

    expect(result.format).toBe("xlsx");
    expect(result.sheet_name).toBe("Plan");
    expect(result.sheet_names).toEqual(["Ignored", "Plan"]);
    expect(result.rows).toEqual([
      {
        _row_number: 2,
        test_name: "Test Z",
        system_name: "System A",
        iterations: 10,
      },
    ]);
  });

  it("truncates large row sets", async () => {
    await fs.writeFile(
      path.join(rootDir, "plan.csv"),
      ["Test Name", "A", "B", "C"].join("\n"),
      "utf8",
    );

    const result = await readSpreadsheet(rootDir, { path: "plan.csv", maxRows: 2 });

    expect(result.row_count).toBe(3);
    expect(result.returned_rows).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it("writes result columns into a selected XLSX sheet", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Plan");
    sheet.addRow(["Test Name", "System Name"]);
    sheet.addRow(["Test Z", "System A"]);
    await workbook.xlsx.writeFile(path.join(rootDir, "plan.xlsx"));

    const write = await writeSpreadsheetUpdates(rootDir, {
      path: "plan.xlsx",
      sheetName: "Plan",
      updates: [
        {
          rowNumber: 2,
          values: {
            aura_status: "success",
            aura_run_id: "run-1",
            aura_summary: "passed",
          },
        },
      ],
    });

    expect(write).toMatchObject({
      path: "plan.xlsx",
      format: "xlsx",
      sheet_name: "Plan",
      updated_rows: [2],
      updated_columns: ["aura_status", "aura_run_id", "aura_summary"],
    });
    const result = await readSpreadsheet(rootDir, { path: "plan.xlsx", sheetName: "Plan" });
    expect(result.rows[0]).toMatchObject({
      test_name: "Test Z",
      system_name: "System A",
      aura_status: "success",
      aura_run_id: "run-1",
      aura_summary: "passed",
    });
  });

  it("reads and writes spreadsheet files outside the repo root by absolute path", async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "aura-spreadsheet-outside-"));
    try {
      const filePath = path.join(outsideDir, "plan.csv");
      await fs.writeFile(filePath, "Test Name\nExternal Test\n", "utf8");

      const read = await readSpreadsheet(rootDir, { path: filePath });
      expect(read).toMatchObject({
        path: filePath,
        format: "csv",
        row_count: 1,
      });

      const write = await writeSpreadsheetUpdates(rootDir, {
        path: filePath,
        updates: [
          {
            rowNumber: 2,
            values: {
              aura_status: "success",
              aura_summary: "external spreadsheet updated",
            },
          },
        ],
      });

      expect(write).toMatchObject({
        path: filePath,
        format: "csv",
        updated_rows: [2],
        updated_columns: ["aura_status", "aura_summary"],
      });
      const reread = await readSpreadsheet(rootDir, { path: filePath });
      expect(reread.rows[0]).toMatchObject({
        test_name: "External Test",
        aura_status: "success",
        aura_summary: "external spreadsheet updated",
      });
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("returns structured errors from spreadsheet_read", async () => {
    const tools = spreadsheetTools({ rootDir });
    const result = await callHandler<{ error: string; message: string }>(tools, "spreadsheet_read", {
      path: "  ",
    });

    expect(result.error).toBe("invalid_path");
    expect(result.message).toContain("spreadsheet path is required");
  });

  it("reports missing XLSX sheets", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Plan");
    sheet.addRow(["Test Name"]);
    await workbook.xlsx.writeFile(path.join(rootDir, "plan.xlsx"));

    const tools = spreadsheetTools({ rootDir });
    const result = await callHandler<{ error: string; message: string }>(tools, "spreadsheet_read", {
      path: "plan.xlsx",
      sheet_name: "Missing",
    });

    expect(result.error).toBe("sheet_not_found");
    expect(result.message).toContain("available sheets: Plan");
  });
});
