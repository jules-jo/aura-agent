export interface DispatchScriptInput {
  runId: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  remoteBase: string;
}

export interface DispatchPaths {
  runDir: string;
  logPath: string;
  pidPath: string;
  exitPath: string;
}

export function resolveDispatchPaths(remoteBase: string, runId: string): DispatchPaths {
  const runDir = `${remoteBase.replace(/\/+$/, "")}/${runId}`;
  return {
    runDir,
    logPath: `${runDir}/output.log`,
    pidPath: `${runDir}/pid`,
    exitPath: `${runDir}/exit`,
  };
}

export function buildDispatchScript(input: DispatchScriptInput): string {
  const paths = resolveDispatchPaths(input.remoteBase, input.runId);
  const cwdClause = input.cwd ? `cd ${shellEscape(input.cwd)} && ` : "";
  const envClause = buildEnvExports(input.env);
  const innerCommand = `${envClause}${cwdClause}${input.command}`;
  // Commands are joined with ';' (not '&&') because '&' (background) cannot
  // be chained with '&&'. 'set -e' gives us the fail-fast behaviour we would
  // have gotten from '&&'. Keep 'nohup ... &' adjacent to 'echo $!' so the
  // PID we capture is the one we just backgrounded.
  return [
    `set -e`,
    `mkdir -p ${shellEscape(paths.runDir)}`,
    `nohup sh -c ${shellEscape(`${innerCommand}; echo $? > ${shellEscape(paths.exitPath)}`)} > ${shellEscape(paths.logPath)} 2>&1 & echo $! > ${shellEscape(paths.pidPath)}`,
    `echo dispatch_ok`,
  ].join("; ");
}

export interface TailScriptInput {
  remoteBase: string;
  runId: string;
  byteOffset: number;
}

export function buildTailScript(input: TailScriptInput): string {
  const paths = resolveDispatchPaths(input.remoteBase, input.runId);
  const offset = Math.max(0, Math.floor(input.byteOffset));
  return [
    `if [ ! -d ${shellEscape(paths.runDir)} ]; then echo STATE=missing; exit 0; fi`,
    `PID=$(cat ${shellEscape(paths.pidPath)} 2>/dev/null || echo "")`,
    `if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then echo STATE=running; else echo STATE=stopped; fi`,
    `if [ -f ${shellEscape(paths.exitPath)} ]; then echo EXIT=$(cat ${shellEscape(paths.exitPath)}); fi`,
    `if [ -f ${shellEscape(paths.logPath)} ]; then SIZE=$(wc -c < ${shellEscape(paths.logPath)}); echo SIZE=$SIZE; echo ---OUTPUT---; tail -c +$((${offset} + 1)) ${shellEscape(paths.logPath)}; fi`,
  ].join("; ");
}

export interface KillScriptInput {
  remoteBase: string;
  runId: string;
  signal?: "TERM" | "KILL";
}

export function buildKillScript(input: KillScriptInput): string {
  const paths = resolveDispatchPaths(input.remoteBase, input.runId);
  const signal = input.signal ?? "TERM";
  return [
    `PID=$(cat ${shellEscape(paths.pidPath)} 2>/dev/null || echo "")`,
    `if [ -z "$PID" ]; then echo KILL=missing; exit 0; fi`,
    `if kill -${signal} "$PID" 2>/dev/null; then echo KILL=signalled; else echo KILL=not_running; fi`,
  ].join("; ");
}

export interface PollOutput {
  state: "running" | "stopped" | "missing" | "unknown";
  exitCode: number | null;
  totalBytes: number;
  output: string;
}

export function parsePollOutput(raw: string): PollOutput {
  const [header, ...outputParts] = raw.split("---OUTPUT---");
  const headerLines = (header ?? "").split(/\r?\n/);
  let state: PollOutput["state"] = "unknown";
  let exitCode: number | null = null;
  let totalBytes = 0;
  for (const line of headerLines) {
    if (line.startsWith("STATE=")) {
      const value = line.slice("STATE=".length).trim();
      state = value === "running" || value === "stopped" || value === "missing" ? value : "unknown";
    } else if (line.startsWith("EXIT=")) {
      const n = Number.parseInt(line.slice("EXIT=".length).trim(), 10);
      exitCode = Number.isFinite(n) ? n : null;
    } else if (line.startsWith("SIZE=")) {
      const n = Number.parseInt(line.slice("SIZE=".length).trim(), 10);
      totalBytes = Number.isFinite(n) ? n : 0;
    }
  }
  const output = outputParts.join("---OUTPUT---").replace(/^\r?\n/, "");
  return { state, exitCode, totalBytes, output };
}

function buildEnvExports(env: Record<string, string> | undefined): string {
  if (!env) return "";
  const parts = Object.entries(env).map(([k, v]) => `${k}=${shellEscape(v)}`);
  return parts.length > 0 ? `${parts.join(" ")} ` : "";
}

export function shellEscape(value: string): string {
  if (value === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
