import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDotEnv, parseDotEnv } from "../src/config/dotenv.js";

describe("dotenv config", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "aura-dotenv-"));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("parses basic dotenv syntax", () => {
    expect(
      parseDotEnv([
        "# comment",
        "A=1",
        "B=\"two words\"",
        "C='literal # value'",
        "D=bare value # comment",
        "export E=5",
        "BAD-NAME=ignored",
      ].join("\n")),
    ).toEqual({
      A: "1",
      B: "two words",
      C: "literal # value",
      D: "bare value",
      E: "5",
    });
  });

  it("loads .env and lets .env.local override values from .env", async () => {
    await fs.writeFile(path.join(rootDir, ".env"), "A=from-env\nB=base\n", "utf8");
    await fs.writeFile(path.join(rootDir, ".env.local"), "A=from-local\nC=local\n", "utf8");
    const env: NodeJS.ProcessEnv = {};

    const result = loadDotEnv(rootDir, env);

    expect(result.loaded_files).toEqual([".env", ".env.local"]);
    expect(result.loaded_keys).toEqual(["A", "B", "C"]);
    expect(env).toMatchObject({
      A: "from-local",
      B: "base",
      C: "local",
    });
  });

  it("does not override environment variables that were already set by the shell", async () => {
    await fs.writeFile(path.join(rootDir, ".env"), "A=from-env\nB=base\n", "utf8");
    await fs.writeFile(path.join(rootDir, ".env.local"), "A=from-local\n", "utf8");
    const env: NodeJS.ProcessEnv = { A: "from-shell" };

    loadDotEnv(rootDir, env);

    expect(env).toMatchObject({
      A: "from-shell",
      B: "base",
    });
  });
});
