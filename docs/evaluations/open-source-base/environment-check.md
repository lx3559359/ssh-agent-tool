# Environment Check

Date: 2026-06-25
Machine: Windows workspace in the project worktree.

## Required Tools

| Tool | Command | Required For | Installed Version | Status | Notes |
|---|---|---|---|---|---|
| Git | `git --version` | cloning repositories | `git version 2.54.0.windows.1` | PASS | Available for cloning repositories and committing evaluation notes. |
| Node.js | `node --version` | web/desktop builds | MISSING | MISSING | Command not found; see details below. |
| npm | `npm --version` | Node dependencies | MISSING | MISSING | Command not found; see details below. |
| pnpm | `pnpm --version` | Chaterm/WinkTerm if required | MISSING | MISSING | Command not found; see details below. |
| Python | `python --version` | WinkTerm backend if Python-based | MISSING | MISSING | Windows Store app execution alias found, but no usable Python runtime; see details below. |
| Docker | `docker --version` | Docker-based quickstart | MISSING | MISSING | Docker CLI not found on PATH; see details below. |
| Docker Compose | `docker compose version` | Docker-based quickstart | MISSING | MISSING | Docker CLI not found on PATH; see details below. |
| Rust | `rustc --version` | Tauri/Rust candidates | MISSING | MISSING | Command not found; see details below. |
| Go | `go version` | Go MCP candidates | MISSING | MISSING | Command not found; see details below. |

## Summary

- Missing blockers: Node.js, npm, pnpm, Python, Docker/Docker Compose, Rust, and Go are missing or not usable on PATH. This blocks Node/Electron/Tauri/web builds, Python backends, Docker quickstarts, Rust/Tauri candidates, and Go-based MCP candidates.
- Workarounds: Repository cloning, static inspection, license review, README review, and Git metadata capture can proceed with Git only. Runtime/build evaluation requires installing the missing runtimes or running those checks on another prepared machine.
- Candidate projects that can be evaluated on this machine: WinkTerm, Chaterm, mcp-ssh-manager, and mcp-ssh-orchestrator can be cloned and inspected statically; no candidate can be fully built or run locally until the missing toolchain blockers are resolved.

## Command Output Details

### `git --version`

```text
git version 2.54.0.windows.1
```

### `node --version`

```text
node : The term 'node' is not recognized as the name of a cmdlet, function, script file, or operable program. Check the
 spelling of the name, or if a path was included, verify that the path is correct and try again.
At line:2 char:1
+ node --version
+ ~~~~
    + CategoryInfo          : ObjectNotFound: (node:String) [], CommandNotFoundException
    + FullyQualifiedErrorId : CommandNotFoundException
```

### `npm --version`

```text
npm : The term 'npm' is not recognized as the name of a cmdlet, function, script file, or operable program. Check the s
pelling of the name, or if a path was included, verify that the path is correct and try again.
At line:2 char:1
+ npm --version
+ ~~~
    + CategoryInfo          : ObjectNotFound: (npm:String) [], CommandNotFoundException
    + FullyQualifiedErrorId : CommandNotFoundException
```

### `pnpm --version`

```text
pnpm : The term 'pnpm' is not recognized as the name of a cmdlet, function, script file, or operable program. Check the
 spelling of the name, or if a path was included, verify that the path is correct and try again.
At line:2 char:1
+ pnpm --version
+ ~~~~
    + CategoryInfo          : ObjectNotFound: (pnpm:String) [], CommandNotFoundException
    + FullyQualifiedErrorId : CommandNotFoundException
```

### `python --version`

```text
```

Exit code: 1. Follow-up command output:

```text
LASTEXITCODE=9009
```

`Get-Command python` resolves to:

```text
%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe
```

### `docker --version`

```text
docker : The term 'docker' is not recognized as the name of a cmdlet, function, script file, or operable program. Check
 the spelling of the name, or if a path was included, verify that the path is correct and try again.
At line:2 char:1
+ docker --version
+ ~~~~~~
    + CategoryInfo          : ObjectNotFound: (docker:String) [], CommandNotFoundException
    + FullyQualifiedErrorId : CommandNotFoundException
```

### `docker compose version`

```text
docker : The term 'docker' is not recognized as the name of a cmdlet, function, script file, or operable program. Check
 the spelling of the name, or if a path was included, verify that the path is correct and try again.
At line:2 char:1
+ docker compose version
+ ~~~~~~
    + CategoryInfo          : ObjectNotFound: (docker:String) [], CommandNotFoundException
    + FullyQualifiedErrorId : CommandNotFoundException
```

### `rustc --version`

```text
rustc : The term 'rustc' is not recognized as the name of a cmdlet, function, script file, or operable program. Check t
he spelling of the name, or if a path was included, verify that the path is correct and try again.
At line:2 char:1
+ rustc --version
+ ~~~~~
    + CategoryInfo          : ObjectNotFound: (rustc:String) [], CommandNotFoundException
    + FullyQualifiedErrorId : CommandNotFoundException
```

### `go version`

```text
go : The term 'go' is not recognized as the name of a cmdlet, function, script file, or operable program. Check the spe
lling of the name, or if a path was included, verify that the path is correct and try again.
At line:2 char:1
+ go version
+ ~~
    + CategoryInfo          : ObjectNotFound: (go:String) [], CommandNotFoundException
    + FullyQualifiedErrorId : CommandNotFoundException
```
