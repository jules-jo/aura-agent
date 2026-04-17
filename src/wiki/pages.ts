import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export interface WikiPage {
  path: string;
  absolutePath: string;
  slug: string;
  title: string | null;
  frontmatter: Record<string, unknown>;
  body: string;
}

export async function readWikiPage(rootDir: string, repoPath: string): Promise<WikiPage> {
  const normalizedPath = normalizeRepoPath(repoPath);
  const absolutePath = resolveRepoPath(rootDir, normalizedPath);
  const raw = await fs.readFile(absolutePath, "utf8");
  return parseWikiPage(rootDir, normalizedPath, raw);
}

export async function listTestPages(rootDir: string): Promise<WikiPage[]> {
  const testsDir = path.join(rootDir, "pages", "tests");
  let entries: string[];
  try {
    entries = await walkMarkdownFiles(testsDir);
  } catch (err: unknown) {
    if (isNotFound(err)) return [];
    throw err;
  }
  const pages = await Promise.all(
    entries.map(async (absolutePath) => {
      const repoPath = toRepoPath(rootDir, absolutePath);
      const raw = await fs.readFile(absolutePath, "utf8");
      return parseWikiPage(rootDir, repoPath, raw);
    }),
  );
  return pages.sort((a, b) => a.path.localeCompare(b.path));
}

export interface WriteWikiPageOptions {
  overwrite?: boolean;
}

export async function writeWikiPage(
  rootDir: string,
  repoPath: string,
  content: string,
  options: WriteWikiPageOptions = {},
): Promise<{ path: string; absolutePath: string; overwritten: boolean; bytesWritten: number }> {
  const normalizedPath = normalizeRepoPath(repoPath);
  if (!normalizedPath.endsWith(".md")) {
    throw new Error("wiki pages must be markdown files");
  }
  const absolutePath = resolveRepoPath(rootDir, normalizedPath);
  let overwritten = false;
  try {
    await fs.access(absolutePath);
    overwritten = true;
  } catch (err: unknown) {
    if (!isNotFound(err)) throw err;
  }
  if (overwritten && options.overwrite !== true) {
    throw new Error("file exists; set overwrite=true to replace it");
  }
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
  return {
    path: normalizedPath,
    absolutePath,
    overwritten,
    bytesWritten: Buffer.byteLength(content, "utf8"),
  };
}

export function resolveRepoPath(rootDir: string, repoPath: string): string {
  const normalized = normalizeRepoPath(repoPath);
  const absolutePath = path.resolve(rootDir, normalized);
  const relative = path.relative(rootDir, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("path escapes repo root");
  }
  return absolutePath;
}

function parseWikiPage(rootDir: string, repoPath: string, raw: string): WikiPage {
  const { frontmatter, body } = splitFrontmatter(raw);
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
  const absolutePath = resolveRepoPath(rootDir, repoPath);
  return {
    path: repoPath,
    absolutePath,
    slug: path.basename(repoPath, path.extname(repoPath)),
    title,
    frontmatter,
    body,
  };
}

function splitFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return { frontmatter: {}, body: raw.trimStart() };
  }
  const parsed = parseYaml(match[1] ?? "");
  if (parsed !== undefined && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) {
    throw new Error("frontmatter must be a YAML mapping");
  }
  return {
    frontmatter: (parsed as Record<string, unknown> | undefined) ?? {},
    body: raw.slice(match[0].length).trimStart(),
  };
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walkMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) out.push(fullPath);
  }
  return out;
}

function normalizeRepoPath(repoPath: string): string {
  const trimmed = repoPath.trim();
  if (!trimmed) throw new Error("path is required");
  return trimmed.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function toRepoPath(rootDir: string, absolutePath: string): string {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}
