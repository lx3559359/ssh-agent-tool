# ShellPilot v0.4.40 SFTP Progress Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the visible SFTP upload/download progress work and publish it as the immutable ShellPilot v0.4.40 Windows stable update.

**Architecture:** Prepare release metadata on a clean branch descended from `origin/master`, verify the exact feature and release contracts, then merge through GitHub without touching the dirty primary worktree. Build and verify Windows x64 installer/portable assets locally before creating the GitHub release, sync the approved update subset to ModelScope from a fresh temporary clone, and finally byte-verify both public update sources.

**Tech Stack:** Git, GitHub CLI, Node.js test runner, StandardJS, Playwright/Electron, electron-builder, PowerShell, Git LFS, GitHub Releases, ModelScope Git.

---

## File map

- Modify `apps/electerm-agent/package.json`: bump the application version to `0.4.40`.
- Modify `apps/electerm-agent/package-lock.json`: keep the root package versions synchronized at `0.4.40`.
- Create `apps/electerm-agent/docs/releases/v0.4.40.md`: publish user-facing SFTP progress notes using the required three categories.
- Create this plan: record the guarded merge, packaging, publication, and post-publication verification sequence.
- Generated only, never commit: `apps/electerm-agent/work/`, `apps/electerm-agent/dist/`, `apps/electerm-agent/electron-builder.json`, temporary ModelScope clone data.

### Task 1: Prepare v0.4.40 metadata

**Files:**
- Modify: `apps/electerm-agent/package.json:3`
- Modify: `apps/electerm-agent/package-lock.json:3,9`
- Create: `apps/electerm-agent/docs/releases/v0.4.40.md`

- [ ] **Step 1: Create the release branch**

Run:

```powershell
git switch -c codex/release-0.4.40
```

Expected: the clean worktree is on `codex/release-0.4.40` and still descends from the fetched `origin/master`.

- [ ] **Step 2: Bump all root application version fields**

Change the three version values to exactly:

```json
{
  "name": "ssh-agent-tool",
  "version": "0.4.40"
}
```

The lockfile root must contain:

```json
{
  "version": "0.4.40",
  "packages": {
    "": {
      "version": "0.4.40"
    }
  }
}
```

- [ ] **Step 3: Add the complete stable release note**

Create `apps/electerm-agent/docs/releases/v0.4.40.md` with:

```markdown
# ShellPilot v0.4.40

## [新增]

- SFTP 上传或下载开始后，文件区底部会自动显示固定进度坞，无需展开菜单即可看到当前文件和整体进度。
- 进度摘要新增“上传中”“下载中”方向标签，并同时显示任务数、百分比、已传输/总大小和实时速度。

## [修复]

- 修复大文件刚开始传输时已有字节进度仍显示为 `0%`、导致进度反馈不明显的问题。
- 修复窄窗口会隐藏百分比的问题；现在仅隐藏次要的字节和速度详情，核心进度始终保留。

## [改动]

- SFTP 活动进度条加粗到 8px，并使用主题主色强化活动边框、方向标签和百分比。
- 保留现有逐文件详情、暂停、继续、取消、失败和完成状态逻辑，不改变 SFTP 传输协议与队列行为。
```

- [ ] **Step 4: Verify release metadata contracts**

Run:

```powershell
node --test test/unit-ci/release-version-consistency.spec.js test/unit-ci/release-notes.spec.js test/unit-ci/release-version-baseline.spec.js
```

Expected: every selected test passes with zero failures and the package, lockfile, release note, and baseline rules accept `0.4.40`.

- [ ] **Step 5: Commit release metadata**

Run:

```powershell
git add -- apps/electerm-agent/package.json apps/electerm-agent/package-lock.json apps/electerm-agent/docs/releases/v0.4.40.md docs/superpowers/plans/2026-08-22-shellpilot-v0.4.40-sftp-progress-release.md
git commit -m "chore: prepare ShellPilot v0.4.40"
```

Expected: one scoped release commit and a clean worktree.

### Task 2: Verify and merge the release branch

**Files:**
- Verify only.

- [ ] **Step 1: Run focused SFTP regression and lint**

Run from `apps/electerm-agent`:

```powershell
node --test test/unit-ci/sftp-transfer-progress-dock.spec.js test/unit-ci/transfer-progress-ui.spec.js test/unit-ci/glacier-silver-ui-style-contract.spec.js
npx standard src/client/components/sftp/sftp-transfer-progress-dock.jsx src/client/components/sftp/sftp-transfer-progress-model.js test/unit-ci/sftp-transfer-progress-dock.spec.js
```

Expected: all focused tests pass and StandardJS exits 0.

- [ ] **Step 2: Run the full unit gate**

Run:

```powershell
npm run test-unit-ci
```

Expected: zero failures; environment-only skips remain explicitly reported.

- [ ] **Step 3: Build the complete Electron runtime and run local transfer E2E**

Run:

```powershell
npm run compile
npx playwright test test/e2e/027.quality-core-flows.spec.js --workers=1
```

Expected: production compilation passes and the local 64 MiB upload/download flow sees non-zero dock progress and matching hashes.

- [ ] **Step 4: Push and merge through GitHub**

Run:

```powershell
git push -u origin codex/release-0.4.40
gh pr create --base master --head codex/release-0.4.40 --title "Release ShellPilot v0.4.40" --body "## Summary`n- add prominent SFTP upload/download progress dock labels and styling`n- keep percentage visible on narrow layouts`n- fix first-byte progress visibility`n`n## Verification`n- full unit-CI suite`n- focused SFTP and style contracts`n- production compile`n- local Electron upload/download quality flow"
gh pr merge --merge --delete-branch=false
git fetch origin
git merge-base --is-ancestor HEAD origin/master
```

Expected: the PR is merged, the release commit is an ancestor of `origin/master`, and the local primary worktree remains untouched.

### Task 3: Build and verify Windows release assets

**Files:**
- Generated only: `apps/electerm-agent/work/`, `apps/electerm-agent/dist/`, `apps/electerm-agent/electron-builder.json`.

- [ ] **Step 1: Prepare and directory-package the production runtime**

Run from `apps/electerm-agent`:

```powershell
npm run package:win:dir
npm run test-package-smoke
```

Expected: native modules rebuild, `dist/win-unpacked` is created, and packaged runtime smoke passes.

- [ ] **Step 2: Build installer and portable ZIP without auto-publish**

Run:

```powershell
npx electron-builder --win nsis --x64 --publish never
npx electron-builder --win zip --x64 --publish never
```

Expected: `ShellPilot-0.4.40-win-x64-installer.exe`, its blockmap, and `ShellPilot-0.4.40-win-x64-portable.zip` are generated without contacting a release API.

- [ ] **Step 3: Prepare approved update metadata and verify all local assets**

Run:

```powershell
npm run release:prepare-assets
npm run release:local:verify
npm run verify-win-portable
npm run release:github:dry
```

Expected: the approved nine-file GitHub asset set and eight-file automatic-update set are complete, hashes and versions match `0.4.40`, the portable ZIP structure passes, and dry-run targets a new immutable `v0.4.40` release.

### Task 4: Publish and verify both update sources

**Files:**
- External state: GitHub Release `v0.4.40` and ModelScope update repository.

- [ ] **Step 1: Publish the GitHub stable release**

Run:

```powershell
npm run release:github
npm run release:github:verify
```

Expected: `v0.4.40` is public, non-draft, non-prerelease, and contains the exact validated assets.

- [ ] **Step 2: Sync ModelScope from a fresh temporary clone**

Resolve the already configured Git credential without printing it, pass it only to the child process, and call `syncModelScopeRelease` with a new temporary clone directory. The command must remove the temporary clone after a successful push.

Expected: the ModelScope `master` branch receives the eight approved automatic-update assets for `0.4.40`; no stale local ModelScope clone is modified.

- [ ] **Step 3: Verify both public update sources byte-for-byte**

Run:

```powershell
npm run release:update-sources:verify
```

Expected: GitHub and ModelScope both report version `0.4.40`, every required update asset downloads successfully, and all bytes match the release index and checksums.

- [ ] **Step 4: Record final immutable identities**

Run:

```powershell
git fetch origin --tags
git rev-parse origin/master
git rev-parse v0.4.40
gh release view v0.4.40 --json tagName,isDraft,isPrerelease,publishedAt,url
git status --short
```

Expected: the tag and release are public, the source commit contains the release branch, and no generated files are staged or committed.
