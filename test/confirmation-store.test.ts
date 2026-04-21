import { describe, expect, it } from "vitest";
import { ConfirmationStore } from "../src/ssh/confirmation-store.js";

describe("ConfirmationStore", () => {
  it("queues confirmations by default and resolves them in order", async () => {
    const store = new ConfirmationStore();
    const promise = store.request({ summary: "Run command", detail: "python test.py" });

    expect(store.isBypassEnabled()).toBe(false);
    expect(store.getPending()).toHaveLength(1);
    expect(store.getPending()[0]?.summary).toBe("Run command");

    store.resolveNext(true);

    await expect(promise).resolves.toBe(true);
    expect(store.getPending()).toHaveLength(0);
  });

  it("auto-approves confirmations when bypass is enabled", async () => {
    const store = new ConfirmationStore({ bypass: true });
    const seen: readonly unknown[][] = [];

    store.subscribe((pending) => {
      (seen as unknown[][]).push([...pending]);
    });

    await expect(
      store.request({ summary: "Write wiki", detail: "pages/tests/test-z.md" }),
    ).resolves.toBe(true);

    expect(store.isBypassEnabled()).toBe(true);
    expect(store.getPending()).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it("auto-approves matching confirmations with an autoApprove policy", async () => {
    const store = new ConfirmationStore({
      autoApprove: (req) => req.kind === "ssh_dispatch",
    });

    await expect(
      store.request({
        kind: "ssh_dispatch",
        summary: "run on root@host",
        detail: "python test.py",
      }),
    ).resolves.toBe(true);

    expect(store.getPending()).toHaveLength(0);
  });

  it("still queues non-matching confirmations with an autoApprove policy", async () => {
    const store = new ConfirmationStore({
      autoApprove: (req) => req.kind === "ssh_dispatch",
    });
    const promise = store.request({
      kind: "wiki_write",
      summary: "write wiki page pages/tests/x.md",
      detail: "create new file",
    });

    expect(store.getPending()).toHaveLength(1);
    expect(store.getPending()[0]?.kind).toBe("wiki_write");

    store.resolveNext(false);

    await expect(promise).resolves.toBe(false);
  });
});
