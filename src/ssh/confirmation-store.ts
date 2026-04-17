export interface PendingConfirmation {
  id: string;
  summary: string;
  detail: string;
  resolve: (approved: boolean) => void;
}

export interface ConfirmationRequest {
  summary: string;
  detail: string;
}

type Listener = (pending: readonly PendingConfirmation[]) => void;

export class ConfirmationStore {
  private readonly pending: PendingConfirmation[] = [];
  private readonly listeners = new Set<Listener>();
  private snapshot: readonly PendingConfirmation[] = [];
  private nextId = 0;

  getPending = (): readonly PendingConfirmation[] => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async request(req: ConfirmationRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const id = `c${this.nextId++}`;
      const entry: PendingConfirmation = {
        id,
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
