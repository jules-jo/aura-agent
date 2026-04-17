import { spawn } from "node:child_process";
import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";
import type { RunStore } from "../runs/run-store.js";

export interface SpawnOptions {
  cwd: string;
  command: string;
}

export type Spawner = (options: SpawnOptions) => ChildLike;

export interface ChildLike {
  onStdout: (listener: (chunk: string) => void) => void;
  onStderr: (listener: (chunk: string) => void) => void;
  onClose: (listener: (exitCode: number | null) => void) => void;
  onError: (listener: (err: Error) => void) => void;
  kill: () => void;
}

const dispatchSchema = z.object({
  command: z.string().min(1).describe("Shell command to execute."),
  cwd: z.string().optional().describe("Working directory. Defaults to the TUI cwd."),
  iteration_lines: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe("Lines per iteration event. Default 20."),
});

const pollSchema = z.object({
  run_id: z.string().describe("Run identifier returned by local_dispatch."),
  since_iteration: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Skip iterations with index < this value. Default 0."),
  wait_ms: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .optional()
    .describe("How long to wait for a new iteration before returning. Default 2000."),
});

export interface LocalToolsOptions {
  defaultCwd: string;
  spawner?: Spawner;
}

export function localRunTools(store: RunStore, options: LocalToolsOptions): Tool<any>[] {
  const spawner = options.spawner ?? defaultSpawner;

  const dispatchTool = defineTool("local_dispatch", {
    description:
      "Start a local shell command and return a run_id. Poll with local_poll until status is completed or failed.",
    parameters: dispatchSchema,
    handler: async (args) => {
      const cwd = args.cwd ?? options.defaultCwd;
      const run = store.createRun({
        command: args.command,
        cwd,
        ...(args.iteration_lines !== undefined ? { iterationSize: args.iteration_lines } : {}),
      });
      const child = spawner({ command: args.command, cwd });
      wireChild(child, store, run.id);
      return {
        run_id: run.id,
        command: run.command,
        cwd: run.cwd,
        started_at: run.startedAt,
      };
    },
  });

  const pollTool = defineTool("local_poll", {
    description:
      "Return new iterations for a run. Waits up to wait_ms for progress. Status is 'running', 'completed', or 'failed'.",
    parameters: pollSchema,
    handler: async (args) => {
      const since = args.since_iteration ?? 0;
      const wait = args.wait_ms ?? 2000;
      await store.waitForUpdate(args.run_id, since, wait);
      const run = store.get(args.run_id);
      if (!run) {
        return { error: "run_not_found", run_id: args.run_id };
      }
      const newIterations = run.iterations.slice(since).map((it) => ({
        index: it.index,
        at: it.at,
        lines: it.lines,
      }));
      return {
        run_id: run.id,
        status: run.status,
        exit_code: run.exitCode ?? null,
        error: run.error ?? null,
        started_at: run.startedAt,
        completed_at: run.completedAt ?? null,
        total_lines: run.totalLines,
        total_iterations: run.iterations.length,
        iterations: newIterations,
      };
    },
  });

  return [dispatchTool, pollTool];
}

function wireChild(child: ChildLike, store: RunStore, runId: string): void {
  const ingest = (chunk: string): void => {
    const lines = chunk.split(/\r?\n/).filter((line) => line.length > 0);
    if (lines.length > 0) store.appendLines(runId, lines);
  };
  child.onStdout(ingest);
  child.onStderr(ingest);
  child.onClose((code) => store.completeRun(runId, code));
  child.onError((err) => store.failRun(runId, err.message));
}

const defaultSpawner: Spawner = ({ command, cwd }) => {
  const proc = spawn(command, { cwd, shell: true });
  return {
    onStdout: (listener) => {
      proc.stdout?.on("data", (buf: Buffer) => listener(buf.toString("utf8")));
    },
    onStderr: (listener) => {
      proc.stderr?.on("data", (buf: Buffer) => listener(buf.toString("utf8")));
    },
    onClose: (listener) => {
      proc.on("close", (code) => listener(code));
    },
    onError: (listener) => {
      proc.on("error", (err) => listener(err));
    },
    kill: () => {
      proc.kill();
    },
  };
};
