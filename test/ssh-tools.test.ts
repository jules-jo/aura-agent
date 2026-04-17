import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (name: string, config: Record<string, unknown>) => ({ name, ...config }),
}));

const { RunStore } = await import("../src/runs/run-store.js");
const { CredentialStore } = await import("../src/ssh/credential-store.js");
const { RunStateStore } = await import("../src/ssh/run-state-store.js");
const { sshRunTools } = await import("../src/tools/ssh-run.js");
type SshClient = import("../src/ssh/ssh-client.js").SshClient;
type SshSession = import("../src/ssh/ssh-client.js").SshSession;
type SshExecResult = import("../src/ssh/ssh-client.js").SshExecResult;

interface ExecHandler {
  (command: string): Promise<SshExecResult> | SshExecResult;
}

function makeFakeClient(handler: ExecHandler): { client: SshClient; closed: () => number } {
  let closes = 0;
  const session: SshSession = {
    exec: async (command) => await handler(command),
    close: async () => {
      closes += 1;
    },
  };
  return {
    client: { connect: async () => session },
    closed: () => closes,
  };
}

function callHandler<T = unknown>(
  tools: ReturnType<typeof sshRunTools>,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  const invocation = { sessionId: "test", toolCallId: "tc1", toolName: name, arguments: args };
  return Promise.resolve(tool.handler(args, invocation)) as Promise<T>;
}

describe("ssh-run tools", () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "aura-ssh-"));
  });
  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("ssh_dispatch primes the credential store, dispatches, and persists run state", async () => {
    const store = new RunStore();
    const credentials = new CredentialStore();
    credentials.set("c1", "pw");
    const runStateStore = new RunStateStore({ dataDir });
    const calls: string[] = [];
    const { client } = makeFakeClient(async (command) => {
      calls.push(command);
      if (command.includes("dispatch_ok")) {
        return { stdout: "dispatch_ok\n", stderr: "", exitCode: 0 };
      }
      if (command.includes("---OUTPUT---")) {
        return {
          stdout: "STATE=stopped\nEXIT=0\nSIZE=4\n---OUTPUT---\nhi\n",
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const tools = sshRunTools(store, {
      sshClient: client,
      credentials,
      runStateStore,
      pollIntervalMs: 5,
    });
    const result = await callHandler<{ run_id: string }>(tools, "ssh_dispatch", {
      host: "h.example",
      username: "u",
      credential_id: "c1",
      command: "echo hi",
    });
    expect(result.run_id).toBeDefined();
    const persisted = await runStateStore.read(result.run_id);
    expect(persisted?.host).toBe("h.example");
    expect(persisted?.command).toBe("echo hi");
    expect(calls.some((c) => c.includes("dispatch_ok"))).toBe(true);

    // allow poll loop to see STATE=stopped and persist markComplete
    for (let i = 0; i < 100; i += 1) {
      const inMemoryDone = store.get(result.run_id)?.status === "completed";
      const persisted = inMemoryDone ? await runStateStore.read(result.run_id) : null;
      if (persisted?.status === "completed") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(store.get(result.run_id)?.status).toBe("completed");
    const afterComplete = await runStateStore.read(result.run_id);
    expect(afterComplete?.status).toBe("completed");
  });

  it("ssh_poll returns run_not_found for unknown run_id", async () => {
    const store = new RunStore();
    const credentials = new CredentialStore();
    const runStateStore = new RunStateStore({ dataDir });
    const { client } = makeFakeClient(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const tools = sshRunTools(store, { sshClient: client, credentials, runStateStore });
    const result = await callHandler<{ error?: string }>(tools, "ssh_poll", {
      run_id: "missing",
      wait_ms: 0,
    });
    expect(result.error).toBe("run_not_found");
  });

  it("ssh_dispatch surfaces dispatch failure and marks the run failed", async () => {
    const store = new RunStore();
    const credentials = new CredentialStore();
    credentials.set("c1", "pw");
    const runStateStore = new RunStateStore({ dataDir });
    const { client } = makeFakeClient(async () => ({
      stdout: "",
      stderr: "nohup: command not found",
      exitCode: 127,
    }));
    const tools = sshRunTools(store, {
      sshClient: client,
      credentials,
      runStateStore,
      pollIntervalMs: 5,
    });
    const result = await callHandler<{ run_id: string; error?: string }>(tools, "ssh_dispatch", {
      host: "h",
      username: "u",
      credential_id: "c1",
      command: "boom",
    });
    expect(result.error).toBe("dispatch_failed");
    const persisted = await runStateStore.read(result.run_id);
    expect(persisted?.status).toBe("failed");
    expect(store.get(result.run_id)?.status).toBe("failed");
  });

  it("ssh_dispatch connects without a password when credential_id is omitted", async () => {
    const store = new RunStore();
    const credentials = new CredentialStore();
    const runStateStore = new RunStateStore({ dataDir });
    let connectArgs: { password?: string } | null = null;
    const { client } = makeFakeClient(async (command) => {
      if (command.includes("dispatch_ok")) {
        return { stdout: "dispatch_ok\n", stderr: "", exitCode: 0 };
      }
      // return stopped so the poller exits cleanly before teardown
      return {
        stdout: "STATE=stopped\nEXIT=0\nSIZE=0\n---OUTPUT---\n",
        stderr: "",
        exitCode: 0,
      };
    });
    const spyingClient: typeof client = {
      connect: async (opts) => {
        connectArgs = opts;
        return client.connect(opts);
      },
    };
    const tools = sshRunTools(store, {
      sshClient: spyingClient,
      credentials,
      runStateStore,
      pollIntervalMs: 50,
    });
    const result = await callHandler<{ run_id: string }>(tools, "ssh_dispatch", {
      host: "h",
      username: "u",
      command: "whoami",
    });
    expect(result.run_id).toBeDefined();
    expect(connectArgs).not.toBeNull();
    expect((connectArgs as unknown as { password?: string }).password).toBeUndefined();
    expect(credentials.getPending().length).toBe(0);
    for (let i = 0; i < 100; i += 1) {
      if (store.get(result.run_id)?.status === "completed") {
        const check = await runStateStore.read(result.run_id);
        if (check?.status === "completed") break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    const persisted = await runStateStore.read(result.run_id);
    expect(persisted?.credentialId).toBeUndefined();
  });

  it("ssh_dispatch requests the password from the credential store when missing", async () => {
    const store = new RunStore();
    const credentials = new CredentialStore();
    const runStateStore = new RunStateStore({ dataDir });
    const { client } = makeFakeClient(async (command) => {
      if (command.includes("dispatch_ok")) {
        return { stdout: "dispatch_ok\n", stderr: "", exitCode: 0 };
      }
      if (command.includes("---OUTPUT---")) {
        return {
          stdout: "STATE=stopped\nEXIT=0\nSIZE=0\n---OUTPUT---\n",
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const tools = sshRunTools(store, {
      sshClient: client,
      credentials,
      runStateStore,
      pollIntervalMs: 5,
    });
    const promise = callHandler<{ run_id: string }>(tools, "ssh_dispatch", {
      host: "h",
      username: "u",
      credential_id: "c1",
      command: "x",
    });
    await new Promise((r) => setImmediate(r));
    expect(credentials.getPending().length).toBe(1);
    credentials.resolveNext("resolved-pw");
    const result = await promise;
    expect(result.run_id).toBeDefined();
    // wait for the poll loop to persist markComplete so afterEach cleanup
    // does not race with an in-flight atomic rename
    for (let i = 0; i < 100; i += 1) {
      if (store.get(result.run_id)?.status === "completed") {
        const persisted = await runStateStore.read(result.run_id);
        if (persisted?.status === "completed") break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  });

  it("ssh_dispatch prompts for password when agent auth fails and no credential_id given", async () => {
    const store = new RunStore();
    const credentials = new CredentialStore();
    const runStateStore = new RunStateStore({ dataDir });
    let connectAttempts = 0;
    const { client: innerClient } = makeFakeClient(async (command) => {
      if (command.includes("dispatch_ok")) {
        return { stdout: "dispatch_ok\n", stderr: "", exitCode: 0 };
      }
      return {
        stdout: "STATE=stopped\nEXIT=0\nSIZE=0\n---OUTPUT---\n",
        stderr: "",
        exitCode: 0,
      };
    });
    const retryingClient: typeof innerClient = {
      connect: async (opts) => {
        connectAttempts += 1;
        if (connectAttempts === 1 && opts.password === undefined) {
          throw new Error("All configured authentication methods failed");
        }
        return innerClient.connect(opts);
      },
    };
    const tools = sshRunTools(store, {
      sshClient: retryingClient,
      credentials,
      runStateStore,
      pollIntervalMs: 50,
    });
    const promise = callHandler<{ run_id: string }>(tools, "ssh_dispatch", {
      host: "h.example",
      username: "root",
      command: "uname -a",
    });
    // wait for the pending prompt to materialise after the auth failure
    for (let i = 0; i < 50; i += 1) {
      if (credentials.getPending().length > 0) break;
      await new Promise((r) => setImmediate(r));
    }
    expect(credentials.getPending().length).toBe(1);
    expect(credentials.getPending()[0]?.credentialId).toBe("root@h.example");
    credentials.resolveNext("the-password");
    const result = await promise;
    expect(result.run_id).toBeDefined();
    expect(connectAttempts).toBe(2);
    for (let i = 0; i < 100; i += 1) {
      if (store.get(result.run_id)?.status === "completed") {
        const persisted = await runStateStore.read(result.run_id);
        if (persisted?.status === "completed") break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  });

  it("ssh_dispatch does not retry when agent auth succeeds", async () => {
    const store = new RunStore();
    const credentials = new CredentialStore();
    const runStateStore = new RunStateStore({ dataDir });
    let connectAttempts = 0;
    const { client: innerClient } = makeFakeClient(async (command) => {
      if (command.includes("dispatch_ok")) {
        return { stdout: "dispatch_ok\n", stderr: "", exitCode: 0 };
      }
      return {
        stdout: "STATE=stopped\nEXIT=0\nSIZE=0\n---OUTPUT---\n",
        stderr: "",
        exitCode: 0,
      };
    });
    const spyingClient: typeof innerClient = {
      connect: async (opts) => {
        connectAttempts += 1;
        return innerClient.connect(opts);
      },
    };
    const tools = sshRunTools(store, {
      sshClient: spyingClient,
      credentials,
      runStateStore,
      pollIntervalMs: 50,
    });
    const result = await callHandler<{ run_id: string }>(tools, "ssh_dispatch", {
      host: "h.example",
      username: "root",
      command: "uname -a",
    });
    expect(result.run_id).toBeDefined();
    expect(connectAttempts).toBe(1);
    expect(credentials.getPending().length).toBe(0);
    for (let i = 0; i < 100; i += 1) {
      if (store.get(result.run_id)?.status === "completed") {
        const persisted = await runStateStore.read(result.run_id);
        if (persisted?.status === "completed") break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  });

  it("ssh_kill sends a kill script over the live session", async () => {
    const store = new RunStore();
    const credentials = new CredentialStore();
    credentials.set("c1", "pw");
    const runStateStore = new RunStateStore({ dataDir });
    const calls: string[] = [];
    const { client } = makeFakeClient(async (command) => {
      calls.push(command);
      if (command.includes("dispatch_ok")) {
        return { stdout: "dispatch_ok\n", stderr: "", exitCode: 0 };
      }
      if (command.includes("kill -")) {
        return { stdout: "KILL=signalled\n", stderr: "", exitCode: 0 };
      }
      return {
        stdout: "STATE=running\nSIZE=0\n---OUTPUT---\n",
        stderr: "",
        exitCode: 0,
      };
    });
    const tools = sshRunTools(store, {
      sshClient: client,
      credentials,
      runStateStore,
      pollIntervalMs: 50,
    });
    const dispatched = await callHandler<{ run_id: string }>(tools, "ssh_dispatch", {
      host: "h",
      username: "u",
      credential_id: "c1",
      command: "long-running",
    });
    const kill = await callHandler<{ stdout?: string }>(tools, "ssh_kill", {
      run_id: dispatched.run_id,
    });
    expect(kill.stdout).toContain("KILL=signalled");
    expect(calls.some((c) => c.includes("kill -TERM"))).toBe(true);
    // give the poller a chance to observe stopPoller and exit before cleanup
    await new Promise((r) => setTimeout(r, 80));
  });
});
