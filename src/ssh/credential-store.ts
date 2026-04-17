export interface PendingPrompt {
  credentialId: string;
  host: string;
  username: string;
  resolve: (password: string) => void;
  reject: (err: Error) => void;
}

export interface CredentialRequest {
  credentialId: string;
  host: string;
  username: string;
}

type Listener = (pending: readonly PendingPrompt[]) => void;

export class CredentialStore {
  private readonly passwords = new Map<string, string>();
  private readonly pending: PendingPrompt[] = [];
  private readonly listeners = new Set<Listener>();
  private snapshot: readonly PendingPrompt[] = [];

  set(credentialId: string, password: string): void {
    this.passwords.set(credentialId, password);
  }

  forget(credentialId: string): void {
    this.passwords.delete(credentialId);
  }

  clear(): void {
    this.passwords.clear();
  }

  getPending = (): readonly PendingPrompt[] => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async request(req: CredentialRequest): Promise<string> {
    const cached = this.passwords.get(req.credentialId);
    if (cached !== undefined) return cached;
    return new Promise<string>((resolve, reject) => {
      this.pending.push({
        credentialId: req.credentialId,
        host: req.host,
        username: req.username,
        resolve: (password) => {
          this.passwords.set(req.credentialId, password);
          resolve(password);
        },
        reject,
      });
      this.commit();
    });
  }

  resolveNext(password: string): boolean {
    const next = this.pending.shift();
    if (!next) return false;
    next.resolve(password);
    this.commit();
    return true;
  }

  rejectNext(reason: string): boolean {
    const next = this.pending.shift();
    if (!next) return false;
    next.reject(new Error(reason));
    this.commit();
    return true;
  }

  private commit(): void {
    this.snapshot = this.pending.slice();
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
