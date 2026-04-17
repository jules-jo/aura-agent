import { randomUUID } from "node:crypto";
import type { CreateRunInput, Iteration, Run, RunStatus } from "./run-types.js";

const DEFAULT_ITERATION_SIZE = 20;
const MAX_TAIL_LINES = 1000;

type Listener = (run: Run) => void;

interface InternalRun extends Run {
  pendingLines: string[];
  tail: string[];
}

export class RunStore {
  private readonly runs = new Map<string, InternalRun>();
  private readonly snapshots = new Map<string, Run>();
  private readonly listeners = new Set<Listener>();
  private activeId: string | null = null;
  private activeSnapshot: Run | null = null;

  getActiveRunId(): string | null {
    return this.activeId;
  }

  getActive = (): Run | null => this.activeSnapshot;

  get(id: string): Run | null {
    return this.snapshots.get(id) ?? null;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  createRun(input: CreateRunInput): Run {
    const id = randomUUID();
    const run: InternalRun = {
      id,
      command: input.command,
      cwd: input.cwd,
      status: "running",
      startedAt: new Date().toISOString(),
      iterations: [],
      totalLines: 0,
      iterationSize: input.iterationSize ?? DEFAULT_ITERATION_SIZE,
      pendingLines: [],
      tail: [],
    };
    this.runs.set(id, run);
    this.activeId = id;
    return this.commit(run);
  }

  adoptRun(input: { id: string; command: string; cwd: string; startedAt: string; iterationSize?: number }): Run {
    const existing = this.runs.get(input.id);
    if (existing) {
      existing.status = "running";
      delete existing.completedAt;
      delete existing.exitCode;
      delete existing.error;
      this.activeId = input.id;
      return this.commit(existing);
    }
    const run: InternalRun = {
      id: input.id,
      command: input.command,
      cwd: input.cwd,
      status: "running",
      startedAt: input.startedAt,
      iterations: [],
      totalLines: 0,
      iterationSize: input.iterationSize ?? DEFAULT_ITERATION_SIZE,
      pendingLines: [],
      tail: [],
    };
    this.runs.set(input.id, run);
    this.activeId = input.id;
    return this.commit(run);
  }

  appendLines(id: string, lines: readonly string[]): void {
    const run = this.runs.get(id);
    if (!run || run.status !== "running") return;
    if (lines.length === 0) return;
    run.totalLines += lines.length;
    run.pendingLines.push(...lines);
    run.tail.push(...lines);
    if (run.tail.length > MAX_TAIL_LINES) {
      run.tail.splice(0, run.tail.length - MAX_TAIL_LINES);
    }
    let changed = false;
    while (run.pendingLines.length >= run.iterationSize) {
      const chunk = run.pendingLines.splice(0, run.iterationSize);
      run.iterations = [...run.iterations, makeIteration(run.iterations.length, chunk)];
      changed = true;
    }
    if (changed) this.commit(run);
  }

  completeRun(id: string, exitCode: number | null): void {
    const run = this.runs.get(id);
    if (!run || run.status !== "running") return;
    if (run.pendingLines.length > 0) {
      const chunk = run.pendingLines.splice(0, run.pendingLines.length);
      run.iterations = [...run.iterations, makeIteration(run.iterations.length, chunk)];
    }
    // null exit → completed with unknown code (process stopped but exit file
    // unreadable). Only a non-zero exit counts as failure.
    run.status = exitCode === null || exitCode === 0 ? "completed" : "failed";
    if (exitCode !== null) run.exitCode = exitCode;
    run.completedAt = new Date().toISOString();
    this.commit(run);
  }

  failRun(id: string, message: string): void {
    const run = this.runs.get(id);
    if (!run || run.status !== "running") return;
    run.status = "failed";
    run.error = message;
    run.completedAt = new Date().toISOString();
    this.commit(run);
  }

  waitForUpdate(id: string, sinceIteration: number, timeoutMs: number): Promise<void> {
    const run = this.runs.get(id);
    if (!run) return Promise.resolve();
    if (hasNews(run.iterations.length, run.status, sinceIteration)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        resolve();
      }, timeoutMs);
      const listener: Listener = (updated) => {
        if (updated.id !== id) return;
        if (hasNews(updated.iterations.length, updated.status, sinceIteration)) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve();
        }
      };
      this.listeners.add(listener);
    });
  }

  private commit(run: InternalRun): Run {
    const snap = snapshot(run);
    this.snapshots.set(run.id, snap);
    if (this.activeId === run.id) this.activeSnapshot = snap;
    for (const listener of this.listeners) listener(snap);
    return snap;
  }
}

function makeIteration(index: number, lines: string[]): Iteration {
  return { index, at: new Date().toISOString(), lines: [...lines] };
}

function snapshot(run: InternalRun): Run {
  return {
    id: run.id,
    command: run.command,
    cwd: run.cwd,
    status: run.status as RunStatus,
    startedAt: run.startedAt,
    ...(run.completedAt !== undefined ? { completedAt: run.completedAt } : {}),
    ...(run.exitCode !== undefined ? { exitCode: run.exitCode } : {}),
    ...(run.error !== undefined ? { error: run.error } : {}),
    iterations: run.iterations,
    totalLines: run.totalLines,
    iterationSize: run.iterationSize,
  };
}

function hasNews(iterationCount: number, status: RunStatus, sinceIteration: number): boolean {
  if (iterationCount > sinceIteration) return true;
  if (status !== "running") return true;
  return false;
}
