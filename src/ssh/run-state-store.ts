import { promises as fs } from "node:fs";
import path from "node:path";
import envPaths from "env-paths";

export interface RunStateRecord {
  runId: string;
  host: string;
  port: number;
  username: string;
  credentialId?: string;
  command: string;
  cwd?: string;
  remoteBase: string;
  remotePidPath: string;
  remoteLogPath: string;
  startedAt: string;
  completedAt?: string;
  exitCode?: number | null;
  status: "running" | "completed" | "failed" | "orphaned";
}

export interface RunStateStoreOptions {
  dataDir?: string;
}

export class RunStateStore {
  private readonly baseDir: string;

  constructor(options: RunStateStoreOptions = {}) {
    this.baseDir = options.dataDir ?? defaultDataDir();
  }

  get runsDir(): string {
    return path.join(this.baseDir, "runs");
  }

  get orphanedDir(): string {
    return path.join(this.runsDir, "orphaned");
  }

  async create(record: RunStateRecord): Promise<void> {
    await fs.mkdir(this.runsDir, { recursive: true });
    await writeJsonAtomic(this.pathFor(record.runId), record);
  }

  async read(runId: string): Promise<RunStateRecord | null> {
    try {
      const raw = await fs.readFile(this.pathFor(runId), "utf8");
      return JSON.parse(raw) as RunStateRecord;
    } catch (err: unknown) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async list(): Promise<RunStateRecord[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.runsDir);
    } catch (err: unknown) {
      if (isNotFound(err)) return [];
      throw err;
    }
    const out: RunStateRecord[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const runId = entry.slice(0, -".json".length);
      const record = await this.read(runId);
      if (record) out.push(record);
    }
    return out;
  }

  async markComplete(runId: string, exitCode: number | null): Promise<RunStateRecord | null> {
    const existing = await this.read(runId);
    if (!existing) return null;
    const next: RunStateRecord = {
      ...existing,
      status: exitCode === 0 ? "completed" : "failed",
      completedAt: new Date().toISOString(),
      exitCode: exitCode ?? null,
    };
    await writeJsonAtomic(this.pathFor(runId), next);
    return next;
  }

  async markOrphaned(runId: string): Promise<void> {
    const src = this.pathFor(runId);
    try {
      await fs.mkdir(this.orphanedDir, { recursive: true });
      await fs.rename(src, path.join(this.orphanedDir, `${runId}.json`));
    } catch (err: unknown) {
      if (isNotFound(err)) return;
      throw err;
    }
  }

  private pathFor(runId: string): string {
    return path.join(this.runsDir, `${runId}.json`);
  }
}

function defaultDataDir(): string {
  return envPaths("aura", { suffix: "" }).data;
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}

async function writeJsonAtomic(finalPath: string, value: unknown): Promise<void> {
  const tmp = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, finalPath);
}
