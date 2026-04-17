import { describe, expect, it } from "vitest";
import { CredentialStore } from "../src/ssh/credential-store.js";

describe("CredentialStore", () => {
  it("returns cached passwords without prompting", async () => {
    const store = new CredentialStore();
    store.set("prod-web", "s3cret");
    const password = await store.request({
      credentialId: "prod-web",
      host: "h",
      username: "u",
    });
    expect(password).toBe("s3cret");
    expect(store.getPending().length).toBe(0);
  });

  it("queues prompts when credential is unknown and resolves them in order", async () => {
    const store = new CredentialStore();
    const promise = store.request({ credentialId: "dev", host: "h", username: "u" });
    expect(store.getPending().length).toBe(1);
    expect(store.getPending()[0]?.credentialId).toBe("dev");
    store.resolveNext("hunter2");
    await expect(promise).resolves.toBe("hunter2");
    expect(store.getPending().length).toBe(0);
  });

  it("caches resolved passwords so later requests do not re-prompt", async () => {
    const store = new CredentialStore();
    const first = store.request({ credentialId: "shared", host: "h", username: "u" });
    store.resolveNext("pw");
    await first;
    const second = await store.request({ credentialId: "shared", host: "h", username: "u" });
    expect(second).toBe("pw");
    expect(store.getPending().length).toBe(0);
  });

  it("rejectNext rejects the queued promise", async () => {
    const store = new CredentialStore();
    const promise = store.request({ credentialId: "dev", host: "h", username: "u" });
    store.rejectNext("cancelled");
    await expect(promise).rejects.toThrow("cancelled");
  });

  it("calling request.resolve directly clears the entry from pending", async () => {
    const store = new CredentialStore();
    const promise = store.request({ credentialId: "dev", host: "h", username: "u" });
    expect(store.getPending().length).toBe(1);
    const first = store.getPending()[0];
    if (!first) throw new Error("no pending entry");
    first.resolve("typed-pw");
    await expect(promise).resolves.toBe("typed-pw");
    expect(store.getPending().length).toBe(0);
  });

  it("calling request.reject directly clears the entry from pending", async () => {
    const store = new CredentialStore();
    const promise = store.request({ credentialId: "dev", host: "h", username: "u" });
    const first = store.getPending()[0];
    if (!first) throw new Error("no pending entry");
    first.reject(new Error("user escape"));
    await expect(promise).rejects.toThrow("user escape");
    expect(store.getPending().length).toBe(0);
  });

  it("subscribe notifies with a stable snapshot reference between mutations", () => {
    const store = new CredentialStore();
    const seen: readonly (readonly unknown[])[] = [];
    const mutableSeen = seen as unknown as unknown[][];
    store.subscribe((snap) => {
      mutableSeen.push(snap as unknown as unknown[]);
    });
    void store.request({ credentialId: "a", host: "h", username: "u" });
    const snap1 = store.getPending();
    const snap2 = store.getPending();
    expect(snap1).toBe(snap2);
    store.resolveNext("x");
    const snap3 = store.getPending();
    expect(snap3).not.toBe(snap1);
  });
});
