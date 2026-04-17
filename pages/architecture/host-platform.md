---
tags: [architecture, platform, windows]
created: 2026-04-17
updated: 2026-04-17
sources: [raw/aura-agent-brief-2026-04-16.md]
---

# Host Platform

*aura-agent runs on the user's Windows machine. Test targets are reached over SSH and may be any OS. This page pins Windows-specific choices that would otherwise leak into multiple design pages.*

## TUI host: Windows

Confirmed 2026-04-17. Design implications:

### Paths

All user-data paths resolve via the [`env-paths`](https://www.npmjs.com/package/env-paths)
npm package. On Windows this maps to:

| Purpose | Windows location |
|---|---|
| Config (`credentials.age`, user prefs) | `%APPDATA%\aura\Config` |
| Data (run-state JSON, cached artifacts) | `%APPDATA%\aura\Data` |
| Cache | `%LOCALAPPDATA%\aura\Cache` |
| Logs | `%LOCALAPPDATA%\aura\Log` |

No hard-coded `~/.config/` or `/tmp/` paths anywhere in the code.

### Terminal

Ink works best in a modern terminal with full ANSI + Unicode support. Order of
preference on Windows:

1. **Windows Terminal** (recommended, default on Windows 11). Full ANSI colour, box-drawing, emoji, mouse.
2. **PowerShell 7 in an ANSI-capable host**. Fine.
3. `cmd.exe`. Works but cosmetic glitches; not a target we tune for.

aura-agent degrades gracefully on terminals that don't support truecolour --
Ink handles this -- but no design decision is pinned to specific terminal
features.

### SSH client

Use the pure-Node [`ssh2`](https://www.npmjs.com/package/ssh2) library. Do
**not** shell out to `ssh.exe` or OpenSSH:

- `ssh2` runs identically across OSes.
- Avoids a dependency on the user having OpenSSH for Windows installed.
- Lets us manage connections, PID files, and dispatch as library calls rather than subprocesses.

### Subprocess / MCP servers

MCP tool servers are launched as Node subprocesses (see [[copilot-sdk]]
MCP transport section). Windows-specific notes:

- Use `shell: false` and explicit `command` + `args`. Never rely on shell expansion.
- Working directory is always an absolute path computed via `env-paths` + `path.join`.
- Kill-on-exit is wired via `process.on("exit")` and `tree-kill` to clean up any subprocess tree on Windows where SIGTERM doesn't cascade.

### Remote targets

Remote test targets may be Linux or Windows; that's a property of the test
spec, not the TUI host. The `ssh2` client handles both. Commands in a test
spec are literal -- the spec author is responsible for matching the target
shell. Future improvement: a `shell: "bash" | "powershell" | "cmd"` hint
on the spec so aura-agent can quote arguments correctly.

### Windows-only enhancements deferred

- DPAPI-wrapped credential store (auto-unlock without passphrase) -- see [[credentials]].
- Windows toast notifications as a future channel beyond the TUI.

## Node.js runtime

- Node 18+ (required by `@github/copilot-sdk`).
- Install path: user installs Node from nodejs.org or via `nvm-windows`.
- aura-agent ships as an npm package; `npx aura` runs it.

## `gh copilot` authentication

The Copilot SDK delegates auth to the GitHub Copilot CLI. On Windows:
- Install via `winget install GitHub.cli`, then `gh extension install github/gh-copilot`.
- Or: install the bundled CLI that ships with `@github/copilot-sdk` -- the docs note this is automatic for Node.
- One-time `gh auth login` completes it.

## Related

- [[credentials]] -- cross-platform encryption, Windows paths.
- [[copilot-sdk]] -- Node.js SDK; confirmed working on Windows.
- [[architecture/overview]] -- overall shape.
