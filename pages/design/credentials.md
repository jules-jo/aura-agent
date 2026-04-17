---
tags: [design, credentials, security, ssh]
created: 2026-04-17
updated: 2026-04-17
sources: [raw/aura-agent-brief-2026-04-16.md]
---

# Credentials

*SSH passwords live in an encrypted file outside the wiki. The test catalog only stores a `credential_id` that resolves to the secret at dispatch time.*

Resolution of [[open-questions]] Q14. Host OS: **Windows** (see
[[host-platform]]).

## File

| Path (Windows) | `%APPDATA%\aura\credentials.age` |
| Path (macOS/Linux, for reference) | `$XDG_CONFIG_HOME/aura/credentials.age` |
| Format | `age`-encrypted YAML |
| Source of truth | Never committed, never in the wiki, gitignored at the repo level for defence-in-depth. |

Path resolution is done via the `env-paths` npm package so we don't
hand-roll `%APPDATA%` logic. The directory is created with user-only
permissions on creation.

### Decrypted shape

```yaml
# credentials.yaml (before encryption)
version: 1
hosts:
  runner-01:
    user: ci
    password: "…"            # the actual SSH password
  staging-db:
    user: tester
    password: "…"
```

Each top-level key under `hosts:` is a **`credential_id`**. Test spec pages
reference the id, never the password.

## Encryption -- `age`

`age` (<https://github.com/FiloSottile/age>) is chosen because:

- Cross-platform, minimal dependency surface. Works identically on Windows, macOS, Linux.
- Well-audited, modern primitive (X25519 + ChaCha20-Poly1305).
- First-class Node.js binding: `age-encryption` on npm.
- Passphrase mode is sufficient (no keypair management overhead).

A single master passphrase protects the whole file. The user types it once
per aura-agent session; the derived key is held in memory only and zeroised
when the TUI exits.

Optional Windows-only enhancement for later: wrap the `age` key with Windows
DPAPI (`node-dpapi`) so the OS user account auto-unlocks the file -- removes
the per-session passphrase prompt while keeping the secret encrypted at rest.
Out of scope for v1.

## Session lifecycle

1. On startup aura-agent checks for `credentials.age`. If absent, walks the user through creating one.
2. If present, TUI prompts for the master passphrase via `session.ui.input({ mask: true })` (an Ink masked-input widget where the SDK's elicitation doesn't support masking).
3. Decrypt into memory -> typed object `CredentialStore`.
4. `ssh.dispatch` / `ssh.poll` tools look up `credential_id` on demand. The password never leaves the TUI process and is never written to logs, stdout, or wiki pages.
5. On session end: zero the buffer and drop the reference.

## Test spec integration

The test spec's `host:` block becomes:

```yaml
host: "runner-01"               # matches a credential_id
credential_id: "runner-01"      # explicit, defaults to host value
cwd: "/srv/tests/x"
```

`user` and `password` are **not** fields on the test spec -- they come from
the credential store. See [[test-catalog]] for the updated schema.

## Management commands (TUI)

- `/creds add <id>` -- prompt for user + password, save, re-encrypt.
- `/creds remove <id>`.
- `/creds list` -- ids and users only, never passwords.
- `/creds rotate-passphrase` -- re-encrypt with a new master passphrase.

Implemented via the SDK's `CommandDefinition` surface.

## Gitignore

The project-level `.gitignore` must include:

```
credentials.age
*.age
```

plus whatever location `env-paths` resolves to on the dev machine if the
repo ever sits inside it. Belt and braces.

## Related

- [[test-catalog]] -- spec references credential ids, not passwords.
- [[execution-and-monitoring]] -- `ssh.dispatch` looks up the credential at call time.
- [[host-platform]] -- Windows-specific path and SSH-client notes.
- [[permission-model]] -- the keyfile unlock is a one-time per-session side-effect, not every-call.
