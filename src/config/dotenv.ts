import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_ENV_FILES = [".env", ".env.local"] as const;

export interface DotEnvLoadResult {
  loaded_files: string[];
  loaded_keys: string[];
}

export function loadDotEnv(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env,
  filenames: readonly string[] = DEFAULT_ENV_FILES,
): DotEnvLoadResult {
  const shellKeys = new Set(Object.keys(env));
  const loadedFiles: string[] = [];
  const loadedKeys = new Set<string>();

  for (const filename of filenames) {
    const filePath = path.resolve(rootDir, filename);
    if (!existsSync(filePath)) continue;
    loadedFiles.push(filename);
    const entries = parseDotEnv(readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(entries)) {
      if (shellKeys.has(key)) continue;
      env[key] = value;
      loadedKeys.add(key);
    }
  }

  return {
    loaded_files: loadedFiles,
    loaded_keys: [...loadedKeys].sort(),
  };
}

export function parseDotEnv(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const equalsIndex = assignment.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = assignment.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    out[key] = parseValue(assignment.slice(equalsIndex + 1).trim());
  }
  return out;
}

function parseValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return stripInlineComment(value).trim();
}

function stripInlineComment(value: string): string {
  const match = /^(.*?)(?:\s+#.*)?$/.exec(value);
  return match?.[1] ?? value;
}
