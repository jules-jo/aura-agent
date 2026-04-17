export type RunStatus = "running" | "completed" | "failed";

export interface Iteration {
  index: number;
  at: string;
  lines: readonly string[];
}

export interface Run {
  id: string;
  command: string;
  cwd: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  error?: string;
  iterations: readonly Iteration[];
  totalLines: number;
  iterationSize: number;
}

export interface CreateRunInput {
  command: string;
  cwd: string;
  iterationSize?: number;
}
