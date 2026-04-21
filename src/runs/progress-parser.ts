export type ProgressPatternType = "phase" | "progress" | "metric" | "warning" | "failure" | "artifact";

export interface ProgressPattern {
  type: ProgressPatternType;
  regex: string;
  name: string | null;
  message: string | null;
}

export interface ProgressSpec {
  patterns: ProgressPattern[];
}

export interface RunProgressEvent {
  type: ProgressPatternType;
  message: string;
  line: string;
  name: string | null;
  value: string | null;
}

export interface RunProgressSnapshot {
  phase: string | null;
  progress: string | null;
  metrics: Record<string, string>;
  latest_signal: string | null;
  warnings: string[];
  failures: string[];
  artifacts: string[];
  matched_events: number;
}

interface CompiledPattern extends ProgressPattern {
  compiled: RegExp;
}

const MAX_LIST_ITEMS = 8;

const DEFAULT_PATTERNS: ProgressPattern[] = [
  {
    type: "phase",
    regex: "^\\s*(?:==+\\s*)?(?:phase\\s*[:=-]\\s*)?(?<phase>setup|initialization|calibration|warmup|running|inference|validation|post[-_ ]?process|cleanup)(?:\\s*==+)?\\s*$",
    name: null,
    message: null,
  },
  {
    type: "progress",
    regex: "\\b(?:iteration|iter|step|frame)\\s+(?<current>\\d+)\\s*(?:/|of)\\s*(?<total>\\d+)\\b",
    name: null,
    message: null,
  },
  {
    type: "metric",
    regex: "\\b(?<name>fps|latency_ms|latency|throughput|duration_ms|duration|loss|accuracy)\\s*[=:]\\s*(?<value>-?\\d+(?:\\.\\d+)?)\\b",
    name: null,
    message: null,
  },
  {
    type: "warning",
    regex: "\\b(?:WARN|WARNING)\\b[:\\s-]*(?<message>.+)",
    name: null,
    message: null,
  },
  {
    type: "failure",
    regex: "(?<message>.*\\b(?:ERROR|FAILED|FAILURE|AssertionError)\\b.*)",
    name: null,
    message: null,
  },
  {
    type: "failure",
    regex: "\\bTraceback \\(most recent call last\\)",
    name: null,
    message: "Python traceback",
  },
];

export class RunProgressTracker {
  private readonly patterns: CompiledPattern[];
  private readonly state: RunProgressSnapshot = {
    phase: null,
    progress: null,
    metrics: {},
    latest_signal: null,
    warnings: [],
    failures: [],
    artifacts: [],
    matched_events: 0,
  };

  constructor(spec: ProgressSpec | null | undefined) {
    const patterns = spec?.patterns.length ? spec.patterns : DEFAULT_PATTERNS;
    this.patterns = patterns.flatMap((pattern) => compilePattern(pattern));
  }

  applyLines(lines: readonly string[]): RunProgressEvent[] {
    const events: RunProgressEvent[] = [];
    for (const rawLine of lines) {
      const line = cleanLine(rawLine);
      if (!line) continue;
      for (const pattern of this.patterns) {
        pattern.compiled.lastIndex = 0;
        const match = pattern.compiled.exec(line);
        if (!match) continue;
        const event = this.applyMatch(pattern, match, line);
        if (event) events.push(event);
      }
    }
    return events;
  }

  snapshot(): RunProgressSnapshot {
    return {
      phase: this.state.phase,
      progress: this.state.progress,
      metrics: { ...this.state.metrics },
      latest_signal: this.state.latest_signal,
      warnings: [...this.state.warnings],
      failures: [...this.state.failures],
      artifacts: [...this.state.artifacts],
      matched_events: this.state.matched_events,
    };
  }

  private applyMatch(pattern: CompiledPattern, match: RegExpExecArray, line: string): RunProgressEvent | null {
    const groups = match.groups ?? {};
    const value = renderValue(pattern, match, line);
    const name = pattern.name ?? groups.name ?? null;
    const message = renderMessage(pattern, match, line, value, name);

    switch (pattern.type) {
      case "phase":
        if (this.state.phase === value) return null;
        this.state.phase = value;
        break;
      case "progress":
        if (this.state.progress === message) return null;
        this.state.progress = message;
        break;
      case "metric": {
        const metricName = name ?? "metric";
        if (this.state.metrics[metricName] === value) return null;
        this.state.metrics[metricName] = value;
        break;
      }
      case "warning":
        if (this.state.warnings.at(-1) === message) return null;
        this.state.warnings = [...this.state.warnings, message].slice(-MAX_LIST_ITEMS);
        break;
      case "failure":
        if (this.state.failures.at(-1) === message) return null;
        this.state.failures = [...this.state.failures, message].slice(-MAX_LIST_ITEMS);
        break;
      case "artifact":
        if (this.state.artifacts.includes(value)) return null;
        this.state.artifacts = [...this.state.artifacts, value].slice(-MAX_LIST_ITEMS);
        break;
    }

    this.state.latest_signal = message;
    this.state.matched_events += 1;
    return {
      type: pattern.type,
      message,
      line,
      name,
      value,
    };
  }
}

export function formatProgressEvents(label: string, events: readonly RunProgressEvent[]): string {
  const signals = events.map((event) => event.message).filter(Boolean);
  return `${label} status: ${signals.slice(0, 4).join("; ")}${signals.length > 4 ? "; ..." : ""}.`;
}

export function summarizeProgressSnapshot(snapshot: RunProgressSnapshot): string | null {
  const parts = [
    snapshot.failures.at(-1) ?? null,
    snapshot.warnings.at(-1) && !snapshot.failures.at(-1) ? snapshot.warnings.at(-1) : null,
    snapshot.phase ? `phase ${snapshot.phase}` : null,
    snapshot.progress,
    formatMetrics(snapshot.metrics),
    snapshot.artifacts.at(-1) ? `artifact ${snapshot.artifacts.at(-1)}` : null,
  ].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join("; ") : null;
}

function compilePattern(pattern: ProgressPattern): CompiledPattern[] {
  try {
    return [{ ...pattern, compiled: new RegExp(pattern.regex, "i") }];
  } catch {
    return [];
  }
}

function renderValue(pattern: ProgressPattern, match: RegExpExecArray, line: string): string {
  const groups = match.groups ?? {};
  if (pattern.type === "progress" && groups.current && groups.total) return `${groups.current}/${groups.total}`;
  if (pattern.type === "metric" && groups.value) return groups.value;
  return groups.value ?? groups.phase ?? groups.progress ?? groups.message ?? groups.path ?? firstCapture(match) ?? line;
}

function renderMessage(
  pattern: ProgressPattern,
  match: RegExpExecArray,
  line: string,
  value: string,
  name: string | null,
): string {
  if (pattern.message) return applyTemplate(pattern.message, match.groups ?? {}, value, line);
  switch (pattern.type) {
    case "phase":
      return `phase ${value}`;
    case "progress":
      return match.groups?.current && match.groups.total ? `progress ${match.groups.current}/${match.groups.total}` : `progress ${value}`;
    case "metric":
      return `${name ?? "metric"}=${value}`;
    case "warning":
      return `warning: ${value || line}`;
    case "failure":
      return `failure: ${value || line}`;
    case "artifact":
      return `artifact ${value}`;
  }
}

function applyTemplate(template: string, groups: Record<string, string | undefined>, value: string, line: string): string {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, key: string) => {
    if (key === "value") return value;
    if (key === "line") return line;
    return groups[key] ?? "";
  });
}

function firstCapture(match: RegExpExecArray): string | null {
  for (let i = 1; i < match.length; i += 1) {
    const value = match[i];
    if (value) return value;
  }
  return null;
}

function formatMetrics(metrics: Record<string, string>): string | null {
  const entries = Object.entries(metrics);
  if (entries.length === 0) return null;
  return entries.slice(0, 4).map(([key, value]) => `${key}=${value}`).join(", ");
}

function cleanLine(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "").trim().replace(/\s{2,}/g, " ");
}
