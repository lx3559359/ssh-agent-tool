# WinkTerm Runtime Validation

Date: 2026-06-25
Repository: https://github.com/Cznorth/winkterm

## Runtime Clone

- Path: `external/winkterm-runtime`
- Commit: `2471cd5`
- Latest commit: `2026-06-14 04:45:49 +0800 refactor(skill): split HTTP API reference, make CLI the default path`

## Docker Compose Validation

- Command: `docker info`
- Result: FAIL. In the non-profile PowerShell session, bare `docker` was not on PATH. Retried with the installed Docker CLI at `C:\Program Files\Docker\Docker\resources\bin\docker.exe` after starting Docker Desktop once with `Start-Process -WindowStyle Hidden`. The Docker client was available (`Version: 29.5.3`, context `desktop-linux`, Compose plugin `v5.1.4`), but the daemon did not become healthy within the 180 second wait:

```text
ERROR: request returned 500 Internal Server Error for API route and version http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.54/info, check if the server supports the requested API version
Server:
errors pretty printing info
EXIT_CODE=1
```

- Command: `docker compose config`
- Result: PASS using the installed Docker CLI path. Compose rendered the `winkterm-runtime` service and reported only the obsolete top-level `version` warning. Relevant output:

```text
name: winkterm-runtime
services:
  winkterm:
    build:
      dockerfile: Dockerfile
    healthcheck:
      test:
        - CMD
        - curl
        - -f
        - http://localhost:8000/health
    ports:
      - target: 3000
        published: "3000"
      - target: 8000
        published: "8000"
EXIT_CODE=0
```

- Command: `docker compose up -d`
- Result: FAIL/SKIPPED. The Docker daemon was unavailable after the startup retry, so containers were not started.
- Command: `docker compose ps`
- Result: FAIL/SKIPPED. `docker compose up -d` was not run because `docker info` failed.
- Cleanup: `docker compose down` was not needed for this path because no Compose containers were started.

## Backend Validation

- Command: Python virtual environment creation and dependency install.
- Result: PASS. Bare `python` resolved to a WindowsApps shim that returned `9009`, so the real Python 3.12.10 interpreter was used from the local Python 312 installation. Key output:

```text
Python 3.12.10
VENV_EXIT=0
Successfully installed pip-26.1.2
PIP_UPGRADE_EXIT=0
Successfully installed fastapi-0.138.0 uvicorn-0.49.0 paramiko-5.0.0 pywinpty-3.0.5 ...
PIP_INSTALL_EXIT=0
```

- Command: `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`
- Result: PASS. Uvicorn started on `http://127.0.0.1:8000`, served smoke requests, and was terminated afterward.

## Frontend Validation

- Command: `npm.cmd install`
- Result: PASS after local PATH correction. The first install attempt failed because package lifecycle scripts invoked bare `node` and `npm` while Node was not on PATH in this shell. Retried with `C:\Program Files\nodejs` prepended to `PATH`; `npm.cmd install` then completed:

```text
v24.18.0
added 931 packages, and audited 932 packages in 28s
33 vulnerabilities (1 low, 7 moderate, 15 high, 10 critical)
NPM_INSTALL_RETRY_EXIT=0
```

- Command: `npm.cmd run dev`
- Result: PASS. Next.js served `http://127.0.0.1:3000/` with HTTP 200 and response length `6786`. The dev server was terminated afterward.

## Agent API Smoke Test

- Command: `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/health`
- Result: PASS, HTTP 200, response summary `{"status":"ok","version":"0.1.0"}`.
- Command: `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/agent/skill.md`
- Result: PASS, HTTP 200, Markdown response length `8062`.
- Command: `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/agent/http.md`
- Result: PASS, HTTP 200, Markdown response length `10501`.

## Service Cleanup

- Backend port 8000 still listening after cleanup: `false`.
- Frontend port 3000 still listening after cleanup: `false`.
- Docker Compose containers started by this validation: none, because Docker daemon health failed before `docker compose up -d`.

## Decision

RETRY AFTER FIX

Evidence: WinkTerm local backend install/start/smoke passed, Agent API smoke passed, and frontend install/start/smoke passed. Docker Compose config passed, but Docker Desktop's Linux engine returned a 500 error from `docker info` after one startup attempt and a 180 second wait, so Docker start/ps validation could not be completed in this local environment.

## Docker Root Cause Follow-up

Additional investigation after the first validation run found:

- Docker CLI is installed and can inspect the `desktop-linux` context.
- Docker Desktop's Linux engine pipe returns HTTP 500 for `docker version` / `docker info`.
- Windows optional features are enabled: `Microsoft-Windows-Subsystem-Linux`, `VirtualMachinePlatform`, and `Microsoft-Hyper-V-All`.
- `systeminfo` reports `Virtualization Enabled In Firmware: No`.

Root cause: Docker Desktop Linux engine cannot become healthy because firmware virtualization is disabled. This cannot be fixed from this repository; it requires enabling virtualization in BIOS/UEFI, then restarting Windows and Docker Desktop.

Milestone 1 product impact: the target product is a Windows desktop `.exe`, not a Docker-first deployment. Backend, frontend, and Agent API local runtime validation passed, so Docker Compose should be treated as a later packaging/deployment validation gate rather than a blocker for the Windows desktop fork path.

## Windows Desktop Fork Gate

PROCEED

Evidence: the Windows desktop product path depends on the local backend, local frontend, and Agent API runtime. Those checks passed in this validation run:

- Backend dependency install and Uvicorn startup passed.
- `/health` returned HTTP 200.
- `/api/agent/skill.md` returned HTTP 200.
- `/api/agent/http.md` returned HTTP 200.
- Frontend dependency install and Next.js startup passed.
- Frontend root page returned HTTP 200.
- Backend and frontend processes were stopped after validation.

Docker Compose remains `RETRY AFTER FIX` for container packaging/deployment validation until firmware virtualization is enabled and Docker Desktop Linux engine becomes healthy.
