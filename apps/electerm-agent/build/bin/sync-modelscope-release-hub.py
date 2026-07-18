#!/usr/bin/env python3
import json
import os
import re
import sys
import time
from pathlib import Path

from modelscope_hub import HubApi


TOKEN_PATTERN = re.compile(r"ms-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
TOKEN_ENV_NAMES = (
    "MODELSCOPE_TOKEN",
    "MODELSCOPE_API_TOKEN",
    "MODELSCOPE_SDK_TOKEN",
)


def modelscope_secrets():
    return sorted(
        {str(os.environ.get(name) or "") for name in TOKEN_ENV_NAMES} - {""},
        key=len,
        reverse=True,
    )


def redact(value, secrets=None):
    result = TOKEN_PATTERN.sub("[REDACTED]", str(value))
    for secret in modelscope_secrets() if secrets is None else secrets:
        result = result.replace(secret, "[REDACTED]")
    return result


def safe_print(*values, **kwargs):
    print(*(redact(value) for value in values), **kwargs)


def app_root():
    return Path(__file__).resolve().parents[2]


def package_version():
    with open(app_root() / "package.json", "r", encoding="utf-8") as handle:
        return json.load(handle)["version"]


def release_version():
    return str(os.environ.get("AIGSHELL_RELEASE_VERSION") or package_version()).removeprefix("v")


def release_dist_dir():
    return Path(os.environ.get("AIGSHELL_RELEASE_DIST") or (app_root() / "dist")).resolve()


def modelscope_token():
    token = (
        os.environ.get("MODELSCOPE_TOKEN")
        or os.environ.get("MODELSCOPE_API_TOKEN")
        or os.environ.get("MODELSCOPE_SDK_TOKEN")
    )
    if not token:
        raise RuntimeError("MODELSCOPE_TOKEN is required to upload ShellPilot update assets to ModelScope.")
    return token


def required_asset_names(version):
    return [
        f"ShellPilot-{version}-win-x64-installer.exe",
        f"ShellPilot-{version}-win-x64-installer.exe.blockmap",
        "latest.yml",
        "shellpilot-local.yml",
        "aigshell-update.json",
        "shellpilot-update.json",
        "checksums.json",
        "shellpilot-release.json",
    ]


def validated_assets(dist_dir, version):
    missing = []
    empty = []
    assets = []
    for name in required_asset_names(version):
        path = dist_dir / name
        if not path.exists():
            missing.append(name)
            continue
        if path.stat().st_size <= 0:
            empty.append(name)
            continue
        assets.append((name, path))
    if missing or empty:
        details = []
        if missing:
            details.append("missing local release assets: " + ", ".join(missing))
        if empty:
            details.append("empty local release assets: " + ", ".join(empty))
        raise RuntimeError("; ".join(details))
    return assets


def upload_retry_count():
    value = os.environ.get("MODELSCOPE_UPLOAD_RETRIES") or "4"
    try:
        return max(1, int(value))
    except ValueError:
        return 4


def upload_retry_delay(attempt):
    return min(60, 5 * attempt)


def upload_file_with_retry(api, repo_id, repo_type, local_path, path_in_repo, commit_message):
    retries = upload_retry_count()
    for attempt in range(1, retries + 1):
        try:
            return api.upload_file(
                repo_id,
                repo_type,
                str(local_path),
                path_in_repo,
                commit_message=commit_message,
                disable_tqdm=True,
            )
        except Exception as exc:
            if attempt >= retries:
                raise
            delay = upload_retry_delay(attempt)
            safe_print(
                f"Upload {path_in_repo} failed on attempt {attempt}/{retries}: {redact(exc)}. Retrying in {delay}s ...",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(delay)


def upload_assets():
    version = release_version()
    dist_dir = release_dist_dir()
    token = modelscope_token()
    repo_id = os.environ.get("MODELSCOPE_REPO", "lx3559359/ShellPilot-Updates")
    repo_type = os.environ.get("MODELSCOPE_REPO_TYPE", "model")
    endpoint = os.environ.get("MODELSCOPE_ENDPOINT") or "https://modelscope.cn"
    assets = validated_assets(dist_dir, version)
    api = HubApi(token=token, endpoint=endpoint)
    uploaded = []

    for name, local_path in assets:
        safe_print(f"Uploading {name} to {repo_id} ...", flush=True)
        upload_file_with_retry(
            api,
            repo_id,
            repo_type,
            local_path,
            name,
            f"Mirror ShellPilot {version} update asset",
        )
        uploaded.append(name)

    safe_print(f"ModelScope ShellPilot {version} update assets synced via Hub API.")
    for name in uploaded:
        safe_print(f"- {name}")
    return uploaded


def main():
    try:
        upload_assets()
        return 0
    except Exception as exc:
        safe_print(exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
