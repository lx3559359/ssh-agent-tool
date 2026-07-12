#!/usr/bin/env python3
import json
import os
import re
import sys
from pathlib import Path

from modelscope_hub import HubApi


TOKEN_PATTERN = re.compile(r"ms-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def redact(value):
    return TOKEN_PATTERN.sub("[REDACTED]", str(value))


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
        print(f"Uploading {name} to {repo_id} ...", flush=True)
        api.upload_file(
            repo_id,
            repo_type,
            str(local_path),
            name,
            commit_message=f"Mirror ShellPilot {version} update asset",
            disable_tqdm=True,
        )
        uploaded.append(name)

    print(f"ModelScope ShellPilot {version} update assets synced via Hub API.")
    for name in uploaded:
        print(f"- {name}")
    return uploaded


def main():
    try:
        upload_assets()
        return 0
    except Exception as exc:
        print(redact(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
