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
- Packaging tool: Electerm's existing `electron-builder` configuration

Workflow:

- `.github/workflows/windows-electerm-agent-release.yml`

Outputs:

- NSIS installer: `SSH-Agent-Tool-*-win-x64-installer.exe`
- Portable package: `SSH-Agent-Tool-*-win-x64-portable.tar.gz`
- Additional electron-builder metadata under `apps/electerm-agent/dist/`

## How To Build

Manual CI build:

1. Open GitHub Actions.
2. Run `Windows Electerm Agent Release`.
3. Download the uploaded artifact from the workflow run.

Local development environment check:

```powershell
powershell -ExecutionPolicy Bypass -File test\local\check-windows-dev-env.ps1
```

The local machine is only suitable for building or running the development app
when this check reports Node.js 22, Yarn Classic, Visual C++ compiler, MSBuild
and local dependencies as ready. End-user machines do not need these tools.

## How To Verify The Uploaded Artifact

After a successful workflow run, download the artifact and check the package
structure before handing it to testers:

```powershell
$runId = '28866311621'
$artifact = 'ssh-agent-tool-windows-master'
$out = ".artifacts\run-$runId"
New-Item -ItemType Directory -Force -Path $out | Out-Null
gh run download $runId --name $artifact --dir $out
powershell -ExecutionPolicy Bypass -File test\packaging\verify-windows-artifact.ps1 -ArtifactPath $out
```

The script accepts either the extracted artifact directory or the zip downloaded
from the artifact API. Confirm manually only if the script cannot run. The
artifact must contain:

- `SSH-Agent-Tool-*-win-x64-installer.exe`
- `SSH-Agent-Tool-*-win-x64-portable.tar.gz`

Passing this check only proves that the CI artifact has the expected Windows
client packages. It does not replace the clean-machine SSH/SFTP smoke test.

Tagged release build:

```powershell
git tag v0.1.0-electerm-agent
git push origin v0.1.0-electerm-agent
```

Tag builds create a draft GitHub Release. Keep the release as draft until SSH/SFTP manual smoke tests pass.

## Online Update Channel

The client checks GitHub Releases from:

- `https://api.github.com/repos/lx3559359/ssh-agent-tool/releases/latest`

Draft releases are not returned by this API. To make a version visible to the in-app update checker:

1. Build from a version tag.
2. Download and smoke test the draft Release artifact on a clean Windows machine.
3. Publish the GitHub Release after the installer and portable package pass.

The updater matches assets by installer source suffix, such as `win-x64-installer.exe` or `win-x64-portable.tar.gz`, so the branded file prefix can change without breaking update downloads.

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

The second workflow run compiled native modules and prepared the packaged app successfully, but the NSIS step failed after creating the installer because Electerm's upstream build script allowed electron-builder's CI auto-publish behavior. It tried to publish against the upstream `electerm/electerm` release target. The workflow now calls `electron-builder --publish never` directly so CI produces repository artifacts only.

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
- `npm ci` with Node 24 also failed locally on `node-pty`; use Node 22 plus Visual Studio C++ Build Tools, matching CI.
- SSH-agent-only unit tests need Windows OpenSSH Agent behavior review.

The CI workflow is the next verification point because it provides the correct Windows native build environment.
