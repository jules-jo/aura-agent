import { Client } from "ssh2";

export interface SshConnectOpts {
  host: string;
  port?: number;
  username: string;
  password?: string;
  agent?: string;
  readyTimeoutMs?: number;
}

export interface SshExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface SshStreamHandlers {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface SshSession {
  exec: (command: string, handlers?: SshStreamHandlers) => Promise<SshExecResult>;
  close: () => Promise<void>;
}

export interface SshClient {
  connect: (opts: SshConnectOpts) => Promise<SshSession>;
}

export function createSsh2Client(): SshClient {
  return {
    connect: (opts) => connectWithSsh2(opts),
  };
}

function connectWithSsh2(opts: SshConnectOpts): Promise<SshSession> {
  return new Promise<SshSession>((resolve, reject) => {
    const client = new Client();
    let settled = false;
    client.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    client.once("ready", () => {
      if (settled) return;
      settled = true;
      resolve(wrapClient(client));
    });
    const resolvedAgent = opts.agent ?? defaultAgent();
    client.connect({
      host: opts.host,
      port: opts.port ?? 22,
      username: opts.username,
      ...(opts.password !== undefined ? { password: opts.password } : {}),
      ...(resolvedAgent ? { agent: resolvedAgent } : {}),
      readyTimeout: opts.readyTimeoutMs ?? 20_000,
    });
  });
}

function defaultAgent(): string | undefined {
  if (process.env.SSH_AUTH_SOCK) return process.env.SSH_AUTH_SOCK;
  if (process.platform === "win32") return "pageant";
  return undefined;
}

function wrapClient(client: Client): SshSession {
  return {
    exec: (command, handlers) =>
      new Promise<SshExecResult>((resolve, reject) => {
        client.exec(command, (err, stream) => {
          if (err) {
            reject(err);
            return;
          }
          let stdout = "";
          let stderr = "";
          let exitCode: number | null = null;
          stream.on("data", (buf: Buffer) => {
            const chunk = buf.toString("utf8");
            stdout += chunk;
            handlers?.onStdout?.(chunk);
          });
          stream.stderr.on("data", (buf: Buffer) => {
            const chunk = buf.toString("utf8");
            stderr += chunk;
            handlers?.onStderr?.(chunk);
          });
          stream.on("exit", (code: number | null) => {
            exitCode = code;
          });
          stream.on("close", () => {
            resolve({ stdout, stderr, exitCode });
          });
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        client.once("close", () => resolve());
        client.end();
      }),
  };
}
