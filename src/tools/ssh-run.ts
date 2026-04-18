import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";
import type { RunStore } from "../runs/run-store.js";
import type { SshClient, SshSession } from "../ssh/ssh-client.js";
import type { CredentialStore } from "../ssh/credential-store.js";
import type { ConfirmationStore } from "../ssh/confirmation-store.js";
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

const checkFileSchema = z.object({
  host: z.string().min(1).describe("Remote host to SSH into."),
  username: z.string().min(1).describe("SSH username."),
  credential_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional credential identifier. If provided, the TUI prompts for a password when it is not yet cached. Omit this field to connect without a password when SSH agent auth is enabled.",
    ),
  port: z.number().int().positive().max(65535).optional(),
  cwd: z.string().optional().describe("Optional remote working directory for resolving relative paths."),
  path: z.string().min(1).describe("Remote file path to check. Relative paths are resolved from cwd when provided."),
});

export interface SshToolsOptions {
  sshClient: SshClient;
  credentials: CredentialStore;
  confirmations: ConfirmationStore;
  runStateStore: RunStateStore;
  pollIntervalMs?: number;
  readyTimeoutMs?: number;
  useAgentAuth?: boolean;
  /** Max retries when STATE=stopped but the exit file is not yet visible. */
  exitFileRetryCount?: number;
  /** Delay between exit-file retries in ms. */
  exitFileRetryDelayMs?: number;
}

const DEFAULT_EXIT_RETRY_COUNT = 5;
const DEFAULT_EXIT_RETRY_DELAY_MS = 300;

const reattachSchema = z.object({
  run_id: z.string().describe("Run identifier returned by a prior ssh_dispatch."),
});

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
      "Start a command on a remote host over SSH. Returns a run_id. The remote process keeps running even if the SSH connection drops; poll with ssh_poll, terminate with ssh_kill, reconnect to an existing run with ssh_reattach.",
    parameters: dispatchSchema,
    handler: async (args) => {
      const approved = await options.confirmations.request({
        summary: `run on ${args.username}@${args.host}`,
        detail: args.command,
      });
      if (!approved) {
        return { error: "user_declined", host: args.host, command: args.command };
      }
      const credentialId = args.credential_id ?? `${args.username}@${args.host}`;
      const connectResult = await connectWithAuthRetry({
        sshClient: options.sshClient,
        credentials: options.credentials,
        useAgentAuth: options.useAgentAuth === true,
        ...(options.readyTimeoutMs !== undefined ? { readyTimeoutMs: options.readyTimeoutMs } : {}),
        host: args.host,
        port: args.port ?? DEFAULT_PORT,
        username: args.username,
        credentialId,
      });
      if ("error" in connectResult) {
        return {
          error: connectResult.error,
          message: connectResult.message,
          host: args.host,
          username: args.username,
          command: args.command,
        };
      }
      const session = connectResult.session;
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
      const approved = await options.confirmations.request({
        summary: `kill remote run ${args.run_id}`,
        detail: `signal ${args.signal ?? "TERM"}`,
      });
      if (!approved) return { run_id: args.run_id, error: "user_declined" };
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

  const reattachTool = defineTool("ssh_reattach", {
    description:
      "Reconnect to an SSH run that was previously dispatched. Reads the persisted run state, opens a new SSH connection, and resumes tailing the remote log without re-running the command. Use this when an ssh_poll previously failed with a connection error or when the user asks what happened to a past run.",
    parameters: reattachSchema,
    handler: async (args) => {
      const record = await options.runStateStore.read(args.run_id);
      if (!record) return { run_id: args.run_id, error: "run_not_found" };
      if (active.has(args.run_id)) {
        return { run_id: args.run_id, error: "already_attached" };
      }
      const credentialId = record.credentialId ?? `${record.username}@${record.host}`;
      const connectResult = await connectWithAuthRetry({
        sshClient: options.sshClient,
        credentials: options.credentials,
        useAgentAuth: options.useAgentAuth === true,
        ...(options.readyTimeoutMs !== undefined ? { readyTimeoutMs: options.readyTimeoutMs } : {}),
        host: record.host,
        port: record.port,
        username: record.username,
        credentialId,
      });
      if ("error" in connectResult) {
        return {
          run_id: record.runId,
          error: connectResult.error,
          message: connectResult.message,
        };
      }
      const session = connectResult.session;
      store.adoptRun({
        id: record.runId,
        command: record.command,
        cwd: record.cwd ?? `${record.username}@${record.host}`,
        startedAt: record.startedAt,
      });
      const tail = buildTailScript({
        remoteBase: record.remoteBase,
        runId: record.runId,
        byteOffset: 0,
      });
      const firstPoll = await session.exec(tail);
      const parsed = parsePollOutput(firstPoll.stdout);
      applyPollOutput(store, record.runId, parsed);
      if (parsed.state === "missing") {
        store.failRun(record.runId, "remote run directory missing");
        await options.runStateStore.markComplete(record.runId, null);
        await session.close();
        return {
          run_id: record.runId,
          status: "failed",
          exit_code: null,
          total_bytes: parsed.totalBytes,
          error: "remote run directory missing",
        };
      }
      if (parsed.state === "stopped") {
        const finalized = await finalizeStoppedRun({
          session,
          store,
          runId: record.runId,
          remoteBase: record.remoteBase,
          initial: parsed,
          retryCount: options.exitFileRetryCount ?? DEFAULT_EXIT_RETRY_COUNT,
          retryDelayMs: options.exitFileRetryDelayMs ?? DEFAULT_EXIT_RETRY_DELAY_MS,
        });
        store.completeRun(record.runId, finalized.exitCode);
        await options.runStateStore.markComplete(record.runId, finalized.exitCode);
        await session.close();
        const finalStatus = store.get(record.runId)?.status ?? "completed";
        return {
          run_id: record.runId,
          status: finalStatus,
          exit_code: finalized.exitCode,
          total_bytes: finalized.totalBytes,
        };
      }
      const entry: ActiveSshRun = {
        session,
        byteOffset: parsed.totalBytes,
        stopPoller: false,
        remoteBase: record.remoteBase,
      };
      active.set(record.runId, entry);
      void runPoller(record.runId, entry, store, options);
      return {
        run_id: record.runId,
        status: "running",
        total_bytes: parsed.totalBytes,
      };
    },
  });

  const checkFileTool = defineTool("ssh_check_file", {
    description:
      "Check whether a regular file exists on a remote host over SSH. Use this for read-only preflight checks like calibration files.",
    parameters: checkFileSchema,
    handler: async (args) => {
      const credentialId = args.credential_id ?? `${args.username}@${args.host}`;
      const connectResult = await connectWithAuthRetry({
        sshClient: options.sshClient,
        credentials: options.credentials,
        useAgentAuth: options.useAgentAuth === true,
        ...(options.readyTimeoutMs !== undefined ? { readyTimeoutMs: options.readyTimeoutMs } : {}),
        host: args.host,
        port: args.port ?? DEFAULT_PORT,
        username: args.username,
        credentialId,
      });
      if ("error" in connectResult) {
        return {
          error: connectResult.error,
          message: connectResult.message,
          host: args.host,
          username: args.username,
          path: args.path,
        };
      }

      const session = connectResult.session;
      try {
        const result = await session.exec(buildCheckFileScript(args.path, args.cwd));
        if (result.exitCode !== 0) {
          return {
            error: "check_failed",
            host: args.host,
            username: args.username,
            path: args.path,
            cwd: args.cwd ?? null,
            exit_code: result.exitCode,
            message: result.stderr.trim() || "remote file check failed",
          };
        }
        const exists = /__AURA_FILE_EXISTS__=1/.test(result.stdout);
        return {
          host: args.host,
          username: args.username,
          path: args.path,
          cwd: args.cwd ?? null,
          exists,
        };
      } catch (err: unknown) {
        return {
          error: "check_failed",
          host: args.host,
          username: args.username,
          path: args.path,
          cwd: args.cwd ?? null,
          message: err instanceof Error ? err.message : String(err),
        };
      } finally {
        try {
          await session.close();
        } catch {
          /* best effort */
        }
      }
    },
  });

  return [dispatchTool, pollTool, killTool, reattachTool, checkFileTool];
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
      if (parsed.state === "missing") {
        store.failRun(runId, "remote run directory missing");
        await options.runStateStore.markComplete(runId, null);
        break;
      }
      if (parsed.state === "stopped") {
        const finalized = await finalizeStoppedRun({
          session: entry.session,
          store,
          runId,
          remoteBase: entry.remoteBase,
          initial: parsed,
          retryCount: options.exitFileRetryCount ?? DEFAULT_EXIT_RETRY_COUNT,
          retryDelayMs: options.exitFileRetryDelayMs ?? DEFAULT_EXIT_RETRY_DELAY_MS,
        });
        entry.byteOffset = finalized.totalBytes;
        store.completeRun(runId, finalized.exitCode);
        await options.runStateStore.markComplete(runId, finalized.exitCode);
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

interface FinalizeArgs {
  session: SshSession;
  store: RunStore;
  runId: string;
  remoteBase: string;
  initial: ReturnType<typeof parsePollOutput>;
  retryCount: number;
  retryDelayMs: number;
}

interface FinalizeResult {
  exitCode: number | null;
  totalBytes: number;
}

async function finalizeStoppedRun(args: FinalizeArgs): Promise<FinalizeResult> {
  let exitCode = args.initial.exitCode;
  let totalBytes = args.initial.totalBytes;
  let attempts = 0;
  while (exitCode === null && attempts < args.retryCount) {
    await delay(args.retryDelayMs);
    const script = buildTailScript({
      remoteBase: args.remoteBase,
      runId: args.runId,
      byteOffset: totalBytes,
    });
    const result = await args.session.exec(script);
    if (result.exitCode !== 0 && result.exitCode !== null) break;
    const parsed = parsePollOutput(result.stdout);
    applyPollOutput(args.store, args.runId, parsed);
    if (parsed.totalBytes > totalBytes) totalBytes = parsed.totalBytes;
    if (parsed.exitCode !== null) {
      exitCode = parsed.exitCode;
      break;
    }
    if (parsed.state !== "stopped") break;
    attempts += 1;
  }
  return { exitCode, totalBytes };
}

function applyPollOutput(
  store: RunStore,
  runId: string,
  parsed: ReturnType<typeof parsePollOutput>,
): void {
  if (parsed.output.length === 0) return;
  const lines = parsed.output.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length > 0) store.appendLines(runId, lines);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCheckFileScript(filePath: string, cwd?: string): string {
  const commands = [];
  if (cwd) commands.push(`cd ${shQuote(cwd)}`);
  commands.push(`if [ -f ${shQuote(filePath)} ]; then printf '__AURA_FILE_EXISTS__=1\\n'; else printf '__AURA_FILE_EXISTS__=0\\n'; fi`);
  return `sh -lc ${shQuote(commands.join(" && "))}`;
}

function isAuthError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /auth|permission denied|access denied/i.test(message);
}

interface ConnectWithAuthRetryArgs {
  sshClient: SshClient;
  credentials: CredentialStore;
  useAgentAuth: boolean;
  readyTimeoutMs?: number;
  host: string;
  port: number;
  username: string;
  credentialId: string;
}

type ConnectResult =
  | { session: SshSession }
  | { error: "auth_failed" | "connect_failed"; message: string };

async function connectWithAuthRetry(args: ConnectWithAuthRetryArgs): Promise<ConnectResult> {
  const connectOnce = (pw: string | undefined): Promise<SshSession> =>
    args.sshClient.connect({
      host: args.host,
      port: args.port,
      username: args.username,
      ...(pw !== undefined ? { password: pw } : {}),
      ...(args.readyTimeoutMs !== undefined ? { readyTimeoutMs: args.readyTimeoutMs } : {}),
    });
  let password: string | undefined;
  if (!args.useAgentAuth) {
    password = await args.credentials.request({
      credentialId: args.credentialId,
      host: args.host,
      username: args.username,
    });
  }
  try {
    return { session: await connectOnce(password) };
  } catch (err: unknown) {
    if (!isAuthError(err)) {
      return { error: "connect_failed", message: toErrorMessage(err) };
    }
    // Auth failed. Forget the cached credential, re-prompt the user for a
    // fresh password, and retry once. This catches both "wrong password
    // cached from a typo" and "agent-auth rejected, fall back to password".
    args.credentials.forget(args.credentialId);
    const retryPassword = await args.credentials.request({
      credentialId: args.credentialId,
      host: args.host,
      username: args.username,
    });
    try {
      return { session: await connectOnce(retryPassword) };
    } catch (retryErr: unknown) {
      // Second failure: forget again so a future tool call re-prompts cleanly.
      args.credentials.forget(args.credentialId);
      const code: "auth_failed" | "connect_failed" = isAuthError(retryErr)
        ? "auth_failed"
        : "connect_failed";
      return { error: code, message: toErrorMessage(retryErr) };
    }
  }
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
