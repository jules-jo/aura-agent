import { describe, expect, it } from "vitest";
import {
  buildDispatchScript,
  buildKillScript,
  buildTailScript,
  parsePollOutput,
  resolveDispatchPaths,
  shellEscape,
} from "../src/ssh/remote-script.js";

describe("remote-script", () => {
  it("resolveDispatchPaths joins remoteBase + runId", () => {
    const paths = resolveDispatchPaths("~/.aura/runs/", "abc");
    expect(paths.runDir).toBe("~/.aura/runs/abc");
    expect(paths.logPath).toBe("~/.aura/runs/abc/output.log");
    expect(paths.pidPath).toBe("~/.aura/runs/abc/pid");
    expect(paths.exitPath).toBe("~/.aura/runs/abc/exit");
  });

  it("buildDispatchScript escapes the command and writes a PID file", () => {
    const script = buildDispatchScript({
      runId: "r1",
      command: `echo "hi there"`,
      remoteBase: "~/.aura/runs",
    });
    expect(script).toContain("mkdir -p");
    expect(script).toContain("nohup sh -c");
    expect(script).toContain("echo $!");
    expect(script).toContain("dispatch_ok");
  });

  it("buildDispatchScript does not chain '&' with '&&' (bash syntax error)", () => {
    const script = buildDispatchScript({
      runId: "r1",
      command: "echo hi",
      remoteBase: "~/.aura/runs",
    });
    // '&' is a command terminator (backgrounding). The shell rejects '& &&'.
    expect(script).not.toMatch(/&\s*&&/);
  });

  it("buildDispatchScript honours cwd and env", () => {
    const script = buildDispatchScript({
      runId: "r1",
      command: "pytest -q",
      cwd: "/srv/app",
      env: { CI: "1" },
      remoteBase: "~/.aura/runs",
    });
    expect(script).toContain("cd /srv/app");
    expect(script).toContain("CI=1");
  });

  it("buildTailScript uses byte offset for incremental tail", () => {
    const script = buildTailScript({ remoteBase: "~/.aura/runs", runId: "r1", byteOffset: 128 });
    expect(script).toContain("tail -c +$((128 + 1))");
    expect(script).toContain("STATE=");
    expect(script).toContain("---OUTPUT---");
  });

  it("buildKillScript defaults to SIGTERM and supports KILL", () => {
    const term = buildKillScript({ remoteBase: "~/.aura/runs", runId: "r1" });
    expect(term).toContain("kill -TERM");
    const kill = buildKillScript({ remoteBase: "~/.aura/runs", runId: "r1", signal: "KILL" });
    expect(kill).toContain("kill -KILL");
  });

  it("parsePollOutput extracts state, exit code, size, and output body", () => {
    const raw = [
      "STATE=stopped",
      "EXIT=0",
      "SIZE=42",
      "---OUTPUT---",
      "line 1",
      "line 2",
    ].join("\n");
    const parsed = parsePollOutput(raw);
    expect(parsed.state).toBe("stopped");
    expect(parsed.exitCode).toBe(0);
    expect(parsed.totalBytes).toBe(42);
    expect(parsed.output).toBe("line 1\nline 2");
  });

  it("parsePollOutput handles running state with no exit marker", () => {
    const raw = "STATE=running\nSIZE=10\n---OUTPUT---\npartial";
    const parsed = parsePollOutput(raw);
    expect(parsed.state).toBe("running");
    expect(parsed.exitCode).toBeNull();
    expect(parsed.output).toBe("partial");
  });

  it("shellEscape passes simple tokens through and quotes anything risky", () => {
    expect(shellEscape("simple")).toBe("simple");
    expect(shellEscape("has space")).toBe("'has space'");
    expect(shellEscape("has'apostrophe")).toContain(`'\\''`);
  });
});
