export interface PendingConfirmation {
  id: string;
  kind?: ConfirmationKind;
  summary: string;
  detail: string;
  resolve: (approved: boolean) => void;
}

export type ConfirmationKind =
  | "ssh_dispatch"
  | "ssh_kill"
  | "wiki_write"
  | "jira_create"
  | "spreadsheet_write"
  | "agentic_preflight";

export interface ConfirmationRequest {
  kind?: ConfirmationKind;
  summary: string;
  detail: string;
}

export interface ConfirmationStoreOptions {
  bypass?: boolean;
  autoApprove?: (req: ConfirmationRequest) => boolean;
}

type Listener = (pending: readonly PendingConfirmation[]) => void;

export class ConfirmationStore {
  private readonly pending: PendingConfirmation[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly bypass: boolean;
  private readonly autoApprove: (req: ConfirmationRequest) => boolean;
  private snapshot: readonly PendingConfirmation[] = [];
  private nextId = 0;

  constructor(options: ConfirmationStoreOptions = {}) {
    this.bypass = options.bypass === true;
    this.autoApprove = options.autoApprove ?? (() => false);
  }

  getPending = (): readonly PendingConfirmation[] => this.snapshot;

  isBypassEnabled = (): boolean => this.bypass;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async request(req: ConfirmationRequest): Promise<boolean> {
    if (this.bypass || this.autoApprove(req)) return true;

    return new Promise<boolean>((resolve) => {
      const id = `c${this.nextId++}`;
      const entry: PendingConfirmation = {
        id,
        ...(req.kind !== undefined ? { kind: req.kind } : {}),
        summary: req.summary,
        detail: req.detail,
        resolve: (approved: boolean) => {
          this.remove(entry);
          resolve(approved);
        },
      };
      this.pending.push(entry);
      this.commit();
    });
  }

  resolveNext(approved: boolean): boolean {
    const next = this.pending[0];
    if (!next) return false;
    next.resolve(approved);
    return true;
  }

  private remove(entry: PendingConfirmation): void {
    const idx = this.pending.indexOf(entry);
    if (idx === -1) return;
    this.pending.splice(idx, 1);
    this.commit();
  }

  private commit(): void {
    this.snapshot = this.pending.slice();
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
