import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";
import type { RunStore } from "../runs/run-store.js";
import type { SshClient, SshSession } from "../ssh/ssh-client.js";
import type { CredentialStore } from "../ssh/credential-store.js";
import type { RunStateStore, RunStateRecord } from "../ssh/run-state-store.js";
import {
  buildDispatchScript,
  buildKillScript,
  buildTailScript,
  parsePollOutput,
  resolveDispatchPaths,
} from "../ssh/remote-script.js";

const DEFAULT_REMOTE_BASE = "~/.aura/runs";
const DEFAULT_PORT = 22;

const dispatchSchema = z.object({
  host: z.string().min(1).describe("Remote host to SSH into."),
  username: z.string().min(1).describe("SSH username."),
  credential_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional credential identifier. If provided, the TUI prompts for a password when it is not yet cached. Omit this field to connect without a password (SSH agent / key-based auth).",
    ),
  command: z.string().min(1).describe("Remote shell command to run."),
  port: z.number().int().positive().max(65535).optional(),
  cwd: z.string().optional().describe("Working directory on the remote host."),
  env: z.record(z.string(), z.string()).optional().describe("Extra environment variables."),
  iteration_lines: z.number().int().positive().max(200).optional(),
  remote_base: z.string().optional().describe("Override the remote run directory base."),
});

const pollSchema = z.object({
  run_id: z.string().describe("Run identifier returned by ssh_dispatch."),
  since_iteration: z.number().int().min(0).optional(),
  wait_ms: z.number().int().min(0).max(10000).optional(),
});

const killSchema = z.object({
  run_id: z.string().describe("Run identifier returned by ssh_dispatch."),
  signal: z.enum(["TERM", "KILL"]).optional(),
});

export interface SshToolsOptions {
  sshClient: SshClient;
  credentials: CredentialStore;
  runStateStore: RunStateStore;
  pollIntervalMs?: number;
  readyTimeoutMs?: number;
}

interface ActiveSshRun {
  session: SshSession;
  byteOffset: number;
  stopPoller: boolean;
  remoteBase: string;
}

export function sshRunTools(store: RunStore, options: SshToolsOptions): Tool<any>[] {
  const active = new Map<string, ActiveSshRun>();

  const dispatchTool = defineTool("ssh_dispatch", {
    description:
      "Start a command on a remote host over SSH. Returns a run_id. The remote process keeps running even if the SSH connection drops; poll with ssh_poll and terminate with ssh_kill.",
    parameters: dispatchSchema,
    handler: async (args) => {
      const password = args.credential_id
        ? await options.credentials.request({
            credentialId: args.credential_id,
            host: args.host,
            username: args.username,
          })
        : undefined;
      const session = await options.sshClient.connect({
        host: args.host,
        port: args.port ?? DEFAULT_PORT,
        username: args.username,
        ...(password !== undefined ? { password } : {}),
        ...(options.readyTimeoutMs !== undefined ? { readyTimeoutMs: options.readyTimeoutMs } : {}),
      });
      const run = store.createRun({
        command: args.command,
        cwd: args.cwd ?? `${args.username}@${args.host}`,
        ...(args.iteration_lines !== undefined ? { iterationSize: args.iteration_lines } : {}),
      });
      const remoteBase = args.remote_base ?? DEFAULT_REMOTE_BASE;
      const paths = resolveDispatchPaths(remoteBase, run.id);
      const record: RunStateRecord = {
        runId: run.id,
        host: args.host,
        port: args.port ?? DEFAULT_PORT,
        username: args.username,
        ...(args.credential_id !== undefined ? { credentialId: args.credential_id } : {}),
        command: args.command,
        ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
        remoteBase,
        remotePidPath: paths.pidPath,
        remoteLogPath: paths.logPath,
        startedAt: run.startedAt,
        status: "running",
      };
      await options.runStateStore.create(record);
      const script = buildDispatchScript({
        runId: run.id,
        command: args.command,
        ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
        ...(args.env !== undefined ? { env: args.env } : {}),
        remoteBase,
      });
      try {
        const result = await session.exec(script);
        if (result.exitCode !== 0 || !result.stdout.includes("dispatch_ok")) {
          const message = result.stderr.trim() || `dispatch failed (exit ${result.exitCode})`;
          store.failRun(run.id, message);
          await options.runStateStore.markComplete(run.id, result.exitCode);
          await session.close();
          return {
            run_id: run.id,
            error: "dispatch_failed",
            stderr: result.stderr,
            exit_code: result.exitCode,
          };
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        store.failRun(run.id, message);
        await options.runStateStore.markComplete(run.id, null);
        await session.close();
        return { run_id: run.id, error: "dispatch_failed", message };
      }
      const entry: ActiveSshRun = {
        session,
        byteOffset: 0,
        stopPoller: false,
        remoteBase,
      };
      active.set(run.id, entry);
      void runPoller(run.id, entry, store, options);
      return {
        run_id: run.id,
        host: args.host,
        username: args.username,
        command: args.command,
        remote_log: paths.logPath,
        remote_pid_file: paths.pidPath,
        started_at: run.startedAt,
      };
    },
  });

  const pollTool = defineTool("ssh_poll", {
    description:
      "Return new iterations for an SSH run. Waits up to wait_ms for progress. Status is 'running', 'completed', or 'failed'.",
    parameters: pollSchema,
    handler: async (args) => {
      const since = args.since_iteration ?? 0;
      const wait = args.wait_ms ?? 2000;
      await store.waitForUpdate(args.run_id, since, wait);
      const run = store.get(args.run_id);
      if (!run) return { error: "run_not_found", run_id: args.run_id };
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

  const killTool = defineTool("ssh_kill", {
    description:
      "Terminate a running SSH dispatch. Sends SIGTERM by default; pass signal='KILL' to force.",
    parameters: killSchema,
    handler: async (args) => {
      const entry = active.get(args.run_id);
      if (!entry) return { run_id: args.run_id, error: "run_not_found_or_inactive" };
      const script = buildKillScript({
        remoteBase: entry.remoteBase,
        runId: args.run_id,
        ...(args.signal !== undefined ? { signal: args.signal } : {}),
      });
      const result = await entry.session.exec(script);
      entry.stopPoller = true;
      return {
        run_id: args.run_id,
        stdout: result.stdout.trim(),
        exit_code: result.exitCode,
      };
    },
  });

  return [dispatchTool, pollTool, killTool];
}

async function runPoller(
  runId: string,
  entry: ActiveSshRun,
  store: RunStore,
  options: SshToolsOptions,
): Promise<void> {
  const interval = options.pollIntervalMs ?? 1500;
  try {
    while (!entry.stopPoller) {
      const script = buildTailScript({
        remoteBase: entry.remoteBase,
        runId,
        byteOffset: entry.byteOffset,
      });
      const result = await entry.session.exec(script);
      if (result.exitCode !== 0 && result.exitCode !== null) {
        const message = result.stderr.trim() || `poll exit ${result.exitCode}`;
        store.failRun(runId, message);
        break;
      }
      const parsed = parsePollOutput(result.stdout);
      if (parsed.output.length > 0) {
        const lines = parsed.output.split(/\r?\n/).filter((line) => line.length > 0);
        if (lines.length > 0) store.appendLines(runId, lines);
        entry.byteOffset = parsed.totalBytes;
      }
      if (parsed.state === "stopped" || parsed.state === "missing") {
        const exit = parsed.exitCode;
        store.completeRun(runId, exit);
        await options.runStateStore.markComplete(runId, exit);
        break;
      }
      await delay(interval);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    store.failRun(runId, message);
    await options.runStateStore.markComplete(runId, null);
  } finally {
    try {
      await entry.session.close();
    } catch {
      /* best effort */
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
