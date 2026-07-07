# Windows Release Build

Date: 2026-07-07

## Purpose

The final user-facing product must be a normal Windows client package. Users should download an installer or portable package and run it directly. They should not install Node.js, npm, Python, Visual Studio Build Tools, or run BAT scripts.

Development and packaging still need those tools because Electerm depends on native modules such as `node-pty`.

## Current Packaging Strategy

Primary packaging path:

- Build base: `apps/electerm-agent`
- Runtime base: Electerm
- Windows runner: GitHub Actions `windows-latest`
- Node.js: Node 22
- Native build toolchain: Visual Studio C++ Build Tools from the hosted Windows runner
- Packaging tool: Electerm's existing `electron-builder` scripts

Workflow:

- `.github/workflows/windows-electerm-agent-release.yml`

Outputs:

- NSIS installer: `*-installer.exe`
- Portable package: `*-portable.tar.gz`
- Additional electron-builder metadata under `apps/electerm-agent/dist/`

## How To Build

Manual CI build:

1. Open GitHub Actions.
2. Run `Windows Electerm Agent Release`.
3. Download the uploaded artifact from the workflow run.

Tagged release build:

```powershell
git tag v0.1.0-electerm-agent
git push origin v0.1.0-electerm-agent
```

Tag builds create a draft GitHub Release. Keep the release as draft until SSH/SFTP manual smoke tests pass.

## Why This Solves Other-PC Usage

Only the CI build machine needs:

- Node.js
- npm
- Yarn Classic
- Visual Studio C++ Build Tools
- Electron native rebuild tooling

End-user machines only need:

- Windows
- The generated installer or portable package

The native modules are compiled and bundled during packaging, so the user does not need a development environment.

## CI Toolchain Note

The first workflow run on 2026-07-07 used `windows-latest`, which resolved to Windows Server 2025 with Visual Studio 2026. `node-gyp` rejected a forced `msvs_version=2022` because the valid detected version was `2026`. The workflow therefore sets `npm_config_msvs_version=2026` and uses x64 MSBuild on the hosted runner.

## Required Acceptance Before Public Release

Before publishing a release as non-draft, verify on a clean Windows machine:

- Installer launches without command-line windows.
- Portable package launches without Node.js installed.
- Create or import an SSH host.
- Open SSH terminal.
- Press Enter after a command without white screen or layout growth.
- `Ctrl+C` interrupts a running command.
- Right-click menu is readable.
- SFTP lists a directory.
- Upload and download a small file.
- Tool logs can be opened for troubleshooting.

## Known Follow-Up

The 2026-07-07 local runtime validation found two local machine issues:

- `npm install` failed locally because Visual Studio C++ Build Tools were not installed.
- SSH-agent-only unit tests need Windows OpenSSH Agent behavior review.

The CI workflow is the next verification point because it provides the correct Windows native build environment.
