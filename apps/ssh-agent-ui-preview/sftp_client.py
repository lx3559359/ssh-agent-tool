from __future__ import annotations

import posixpath
import stat
import zipfile
from pathlib import Path

from ssh_auth import has_auth_material
from ssh_proxy import connect_ssh_client
from ssh_session import HostKeyVerificationError, configure_client_host_key_policy, configure_proxy_jump_host_key_policy, verify_trusted_host_key


TEXT_PREVIEW_MAX_BYTES = 256 * 1024


class SftpTransferCancelled(Exception):
    pass


def build_transfer_callback(cancel_event=None, progress_callback=None):
    if cancel_event is None and progress_callback is None:
        return None

    def callback(transferred, total):
        if cancel_event is not None and cancel_event.is_set():
            raise SftpTransferCancelled("传输任务已取消")
        if progress_callback:
            progress_callback(transferred, total)
        if cancel_event is not None and cancel_event.is_set():
            raise SftpTransferCancelled("传输任务已取消")

    return callback


def is_transfer_cancelled(cancel_event=None) -> bool:
    return bool(cancel_event is not None and cancel_event.is_set())


def list_sftp_directory(server: dict, password: str, remote_path: str, timeout: int = 10, paramiko_module=None, credential_metadata: dict | None = None) -> dict:
    path = normalize_remote_path(remote_path)
    validation = validate_sftp_request(server, password, credential_metadata)
    if validation:
        return {**validation, "path": path, "items": []}

    try:
        client, sftp, proxy_client = open_sftp_client(server, password, timeout, paramiko_module, credential_metadata)
        attrs = sftp.listdir_attr(path)
        items = [attr_to_item(path, item) for item in attrs]
        items.sort(key=lambda item: (item["type"] != "folder", item["name"].lower()))
        return {"ok": True, "path": path, "items": items, "message": "SFTP 目录读取完成。"}
    except HostKeyVerificationError as error:
        return {
            "ok": False,
            "path": path,
            "items": [],
            "message": str(error),
            **error.to_result_fields(),
        }
    except Exception as error:
        return {"ok": False, "path": path, "items": [], "message": f"SFTP 目录读取失败：{error}"}
    finally:
        close_sftp(sftp if "sftp" in locals() else None, client if "client" in locals() else None, proxy_client if "proxy_client" in locals() else None)


def download_sftp_file(server: dict, password: str, remote_path: str, local_path: str, timeout: int = 10, paramiko_module=None, credential_metadata: dict | None = None, overwrite: bool = False, cancel_event=None, progress_callback=None) -> dict:
    validation = validate_sftp_request(server, password, credential_metadata)
    if validation:
        return {**validation, "remotePath": str(remote_path or ""), "localPath": str(local_path or "")}
    if not str(remote_path or "").strip() or not str(local_path or "").strip():
        return {"ok": False, "remotePath": str(remote_path or ""), "localPath": str(local_path or ""), "message": "远程路径或本地保存路径为空。"}

    target = resolve_download_target(remote_path, local_path)
    local_path = target
    target_path = Path(target).expanduser()
    if target_path.exists() and not target_path.is_dir() and not overwrite:
        return {"ok": False, "remotePath": str(remote_path), "localPath": str(local_path), "message": f"本地文件已存在：{local_path}。请先重命名或选择其他保存位置。"}
    try:
        if is_transfer_cancelled(cancel_event):
            raise SftpTransferCancelled("传输任务已取消")
        transfer_callback = build_transfer_callback(cancel_event, progress_callback)
        ensure_local_parent_directory(target)
        client, sftp, proxy_client = open_sftp_client(server, password, timeout, paramiko_module, credential_metadata)
        try:
            remote_stat = sftp.stat(str(remote_path))
        except Exception:
            remote_stat = None
        if remote_stat is not None and stat.S_ISDIR(int(getattr(remote_stat, "st_mode", 0) or 0)):
            target = resolve_directory_zip_target(remote_path, target)
            local_path = target
            target_path = Path(target).expanduser()
            if target_path.exists() and not overwrite:
                return {"ok": False, "remotePath": str(remote_path), "localPath": str(local_path), "message": f"本地文件已存在：{local_path}。请先重命名或选择其他保存位置。"}
            ensure_local_parent_directory(target)
            if is_transfer_cancelled(cancel_event):
                raise SftpTransferCancelled("传输任务已取消")
            download_sftp_directory_as_zip(sftp, str(remote_path), target)
            return {"ok": True, "remotePath": str(remote_path), "localPath": str(local_path), "message": "SFTP 目录下载完成。"}

        if transfer_callback:
            sftp.get(str(remote_path), target, callback=transfer_callback)
        else:
            sftp.get(str(remote_path), target)
        return {"ok": True, "remotePath": str(remote_path), "localPath": str(local_path), "message": "SFTP 文件下载完成。"}
    except SftpTransferCancelled as error:
        return {"ok": False, "cancelled": True, "remotePath": str(remote_path), "localPath": str(local_path), "message": str(error)}
    except HostKeyVerificationError as error:
        return sftp_host_key_error(error, remotePath=str(remote_path), localPath=str(local_path))
    except Exception as error:
        return {"ok": False, "remotePath": str(remote_path), "localPath": str(local_path), "message": f"SFTP 文件下载失败：{error}"}
    finally:
        close_sftp(sftp if "sftp" in locals() else None, client if "client" in locals() else None, proxy_client if "proxy_client" in locals() else None)


def read_sftp_text_file(
    server: dict,
    password: str,
    remote_path: str,
    timeout: int = 10,
    paramiko_module=None,
    credential_metadata: dict | None = None,
    max_bytes: int = TEXT_PREVIEW_MAX_BYTES,
) -> dict:
    path = normalize_remote_path(remote_path)
    validation = validate_sftp_request(server, password, credential_metadata)
    if validation:
        return {**validation, "remotePath": path, "content": ""}
    if not path.strip() or path == "/":
        return {"ok": False, "remotePath": path, "content": "", "message": "远端文件路径为空或为根目录，无法预览。"}

    try:
        client, sftp, proxy_client = open_sftp_client(server, password, timeout, paramiko_module, credential_metadata)
        try:
            size = int(getattr(sftp.stat(path), "st_size", 0) or 0)
        except Exception:
            size = 0
        if size > max_bytes:
            return {
                "ok": False,
                "remotePath": path,
                "content": "",
                "size": size,
                "maxBytes": max_bytes,
                "message": f"文件超过 {human_size(max_bytes)}，请下载后查看。",
            }

        handle = sftp.open(path, "rb")
        try:
            raw_content = handle.read(max_bytes + 1)
        finally:
            close_sftp(handle)

        if isinstance(raw_content, str):
            raw = raw_content.encode("utf-8")
        else:
            raw = bytes(raw_content or b"")
        if len(raw) > max_bytes:
            return {
                "ok": False,
                "remotePath": path,
                "content": "",
                "size": len(raw),
                "maxBytes": max_bytes,
                "message": f"文件超过 {human_size(max_bytes)}，请下载后查看。",
            }
        if b"\x00" in raw[:4096] and not has_text_bom(raw):
            decoded = decode_utf16_without_bom_preview(raw)
            if not decoded:
                return {"ok": False, "remotePath": path, "content": "", "size": len(raw), "message": "该文件看起来不是文本文件，已阻止预览。"}
        else:
            decoded = decode_text_preview(raw)
        if not decoded:
            return {"ok": False, "remotePath": path, "content": "", "size": len(raw), "message": "暂不支持该文件编码，请下载后查看。"}
        content, encoding = decoded
        return {
            "ok": True,
            "remotePath": path,
            "content": content,
            "encoding": encoding,
            "size": len(raw),
            "message": "SFTP 文本文件预览完成。",
        }
    except HostKeyVerificationError as error:
        return sftp_host_key_error(error, remotePath=path, content="")
    except Exception as error:
        return {"ok": False, "remotePath": path, "content": "", "message": f"SFTP 文本文件预览失败：{error}"}
    finally:
        close_sftp(sftp if "sftp" in locals() else None, client if "client" in locals() else None, proxy_client if "proxy_client" in locals() else None)


def write_sftp_text_file(
    server: dict,
    password: str,
    remote_path: str,
    content: str,
    timeout: int = 10,
    paramiko_module=None,
    credential_metadata: dict | None = None,
    encoding: str = "utf-8",
) -> dict:
    path = normalize_remote_path(remote_path)
    validation = validate_sftp_request(server, password, credential_metadata)
    if validation:
        return {**validation, "remotePath": path}
    if not path.strip() or path == "/":
        return {"ok": False, "remotePath": path, "message": "远端文件路径为空或为根目录，无法保存。"}

    safe_encoding = str(encoding or "utf-8").strip() or "utf-8"
    try:
        raw = str(content or "").encode(safe_encoding)
    except (LookupError, UnicodeEncodeError) as error:
        return {"ok": False, "remotePath": path, "encoding": safe_encoding, "message": f"文本编码失败：{error}"}

    try:
        client, sftp, proxy_client = open_sftp_client(server, password, timeout, paramiko_module, credential_metadata)
        handle = sftp.open(path, "wb")
        try:
            handle.write(raw)
        finally:
            close_sftp(handle)
        return {
            "ok": True,
            "remotePath": path,
            "encoding": safe_encoding,
            "bytes": len(raw),
            "message": "SFTP 文本文件保存完成。",
        }
    except HostKeyVerificationError as error:
        return sftp_host_key_error(error, remotePath=path)
    except Exception as error:
        return {"ok": False, "remotePath": path, "encoding": safe_encoding, "message": f"SFTP 文本文件保存失败：{error}"}
    finally:
        close_sftp(sftp if "sftp" in locals() else None, client if "client" in locals() else None, proxy_client if "proxy_client" in locals() else None)


def upload_sftp_file(server: dict, password: str, local_path: str, remote_path: str, timeout: int = 10, paramiko_module=None, credential_metadata: dict | None = None, overwrite: bool = False, cancel_event=None, progress_callback=None) -> dict:
    validation = validate_sftp_request(server, password, credential_metadata)
    if validation:
        return {**validation, "remotePath": str(remote_path or ""), "localPath": str(local_path or "")}
    if not str(local_path or "").strip() or not str(remote_path or "").strip():
        return {"ok": False, "remotePath": str(remote_path or ""), "localPath": str(local_path or ""), "message": "本地文件或远程路径为空。"}
    local_file = Path(local_path)
    if not local_file.exists():
        return {"ok": False, "remotePath": str(remote_path), "localPath": str(local_path), "message": "本地文件不存在，无法上传。"}

    target = resolve_upload_target(local_path, remote_path)
    try:
        if is_transfer_cancelled(cancel_event):
            raise SftpTransferCancelled("传输任务已取消")
        transfer_callback = build_transfer_callback(cancel_event, progress_callback)
        client, sftp, proxy_client = open_sftp_client(server, password, timeout, paramiko_module, credential_metadata)
        if local_file.is_dir():
            if is_transfer_cancelled(cancel_event):
                raise SftpTransferCancelled("传输任务已取消")
            upload_sftp_directory(sftp, local_file, target, overwrite=overwrite)
            return {"ok": True, "remotePath": target, "localPath": str(local_path), "message": "SFTP 目录上传完成。"}

        if not overwrite:
            try:
                sftp.stat(target)
                return {"ok": False, "remotePath": target, "localPath": str(local_path), "message": f"目标文件已存在：{target}。请先重命名或删除远端文件后再上传。"}
            except FileNotFoundError:
                pass
        if transfer_callback:
            sftp.put(str(local_path), target, callback=transfer_callback)
        else:
            sftp.put(str(local_path), target)
        return {"ok": True, "remotePath": target, "localPath": str(local_path), "message": "SFTP 文件上传完成。"}
    except SftpTransferCancelled as error:
        return {"ok": False, "cancelled": True, "remotePath": target, "localPath": str(local_path), "message": str(error)}
    except HostKeyVerificationError as error:
        return sftp_host_key_error(error, remotePath=target, localPath=str(local_path))
    except Exception as error:
        return {"ok": False, "remotePath": target, "localPath": str(local_path), "message": f"SFTP 文件上传失败：{error}"}
    finally:
        close_sftp(sftp if "sftp" in locals() else None, client if "client" in locals() else None, proxy_client if "proxy_client" in locals() else None)


def upload_sftp_directory(sftp, local_dir: Path, remote_root: str, overwrite: bool = False) -> None:
    ensure_remote_directory(sftp, remote_root)
    for local_item in sorted(local_dir.rglob("*")):
        relative = local_item.relative_to(local_dir).as_posix()
        remote_item = posixpath.join(remote_root.rstrip("/") or "/", relative)
        if local_item.is_dir():
            ensure_remote_directory(sftp, remote_item)
            continue
        if not overwrite:
            try:
                sftp.stat(remote_item)
                raise RuntimeError(f"目标文件已存在：{remote_item}。请先重命名或删除远端文件后再上传。")
            except FileNotFoundError:
                pass
        sftp.put(str(local_item), remote_item)


def ensure_remote_directory(sftp, remote_path: str) -> None:
    try:
        attrs = sftp.stat(remote_path)
        if stat.S_ISDIR(int(getattr(attrs, "st_mode", 0) or 0)):
            return
        raise RuntimeError(f"远端路径已存在但不是目录：{remote_path}")
    except FileNotFoundError:
        sftp.mkdir(remote_path)


def create_sftp_directory(server: dict, password: str, parent_path: str, directory_name: str, timeout: int = 10, paramiko_module=None, credential_metadata: dict | None = None) -> dict:
    validation = validate_sftp_request(server, password, credential_metadata)
    target = resolve_child_path(parent_path, directory_name)
    if validation:
        return {**validation, "remotePath": target}
    if not target:
        return {"ok": False, "remotePath": "", "message": "目录名称为空，无法创建。"}

    try:
        client, sftp, proxy_client = open_sftp_client(server, password, timeout, paramiko_module, credential_metadata)
        sftp.mkdir(target)
        return {"ok": True, "remotePath": target, "message": "SFTP 目录创建完成。"}
    except HostKeyVerificationError as error:
        return sftp_host_key_error(error, remotePath=target)
    except Exception as error:
        return {"ok": False, "remotePath": target, "message": f"SFTP 目录创建失败：{error}"}
    finally:
        close_sftp(sftp if "sftp" in locals() else None, client if "client" in locals() else None, proxy_client if "proxy_client" in locals() else None)


def create_sftp_file(server: dict, password: str, parent_path: str, file_name: str, timeout: int = 10, paramiko_module=None, credential_metadata: dict | None = None) -> dict:
    validation = validate_sftp_request(server, password, credential_metadata)
    target = resolve_child_path(parent_path, file_name)
    if validation:
        return {**validation, "remotePath": target}
    if not target:
        return {"ok": False, "remotePath": "", "message": "文件名称为空，无法创建。"}

    try:
        client, sftp, proxy_client = open_sftp_client(server, password, timeout, paramiko_module, credential_metadata)
        handle = sftp.open(target, "wx")
        close_sftp(handle)
        return {"ok": True, "remotePath": target, "message": "SFTP 文件创建完成。"}
    except HostKeyVerificationError as error:
        return sftp_host_key_error(error, remotePath=target)
    except Exception as error:
        return {"ok": False, "remotePath": target, "message": f"SFTP 文件创建失败：{error}"}
    finally:
        close_sftp(sftp if "sftp" in locals() else None, client if "client" in locals() else None, proxy_client if "proxy_client" in locals() else None)


def rename_sftp_path(server: dict, password: str, remote_path: str, new_name: str, timeout: int = 10, paramiko_module=None, credential_metadata: dict | None = None) -> dict:
    source = normalize_remote_path(remote_path)
    target = resolve_sibling_path(source, new_name)
    validation = validate_sftp_request(server, password, credential_metadata)
    if validation:
        return {**validation, "remotePath": source, "newPath": target}
    if not source.strip() or not target:
        return {"ok": False, "remotePath": source, "newPath": target, "message": "远程路径或新名称为空，无法重命名。"}

    try:
        client, sftp, proxy_client = open_sftp_client(server, password, timeout, paramiko_module, credential_metadata)
        if target != source:
            try:
                sftp.stat(target)
                return {"ok": False, "remotePath": source, "newPath": target, "message": f"目标文件已存在：{target}。请先选择其他名称。"}
            except FileNotFoundError:
                pass
        sftp.rename(source, target)
        return {"ok": True, "remotePath": source, "newPath": target, "message": "SFTP 重命名完成。"}
    except HostKeyVerificationError as error:
        return sftp_host_key_error(error, remotePath=source, newPath=target)
    except Exception as error:
        return {"ok": False, "remotePath": source, "newPath": target, "message": f"SFTP 重命名失败：{error}"}
    finally:
        close_sftp(sftp if "sftp" in locals() else None, client if "client" in locals() else None, proxy_client if "proxy_client" in locals() else None)


def delete_sftp_path(server: dict, password: str, remote_path: str, item_type: str = "file", timeout: int = 10, paramiko_module=None, credential_metadata: dict | None = None) -> dict:
    target = normalize_remote_path(remote_path)
    validation = validate_sftp_request(server, password, credential_metadata)
    if validation:
        return {**validation, "remotePath": target}
    if not target.strip() or target == "/":
        return {"ok": False, "remotePath": target, "message": "远程路径为空或为根目录，已阻止删除。"}

    try:
        client, sftp, proxy_client = open_sftp_client(server, password, timeout, paramiko_module, credential_metadata)
        if str(item_type or "").lower() == "folder":
            sftp.rmdir(target)
        else:
            sftp.remove(target)
        return {"ok": True, "remotePath": target, "message": "SFTP 删除完成。"}
    except HostKeyVerificationError as error:
        return sftp_host_key_error(error, remotePath=target)
    except Exception as error:
        return {"ok": False, "remotePath": target, "message": f"SFTP 删除失败：{error}"}
    finally:
        close_sftp(sftp if "sftp" in locals() else None, client if "client" in locals() else None, proxy_client if "proxy_client" in locals() else None)


def open_sftp_client(server: dict, password: str, timeout: int = 10, paramiko_module=None, credential_metadata: dict | None = None):
    target = parse_server(server)
    paramiko = paramiko_module or load_paramiko()
    client = paramiko.SSHClient()
    configure_client_host_key_policy(paramiko, client, server)
    proxy_client = None
    try:
        proxy_client = connect_ssh_client(
            paramiko,
            client,
            server,
            password,
            credential_metadata or {},
            timeout,
            configure_proxy_host_key_policy=lambda proxy_client, proxy_jump: configure_proxy_jump_host_key_policy(paramiko, proxy_client, proxy_jump),
        )
        verify_trusted_host_key(client, server)
        return client, client.open_sftp(), proxy_client
    except Exception:
        close_sftp(client, proxy_client)
        raise


def validate_sftp_request(server: dict, password: str, credential_metadata: dict | None = None) -> dict | None:
    if not has_auth_material(password, credential_metadata or {}):
        return {"ok": False, "message": "缺少凭据：请先在连接配置中保存密码或密钥口令。"}
    if not parse_server(server)["host"]:
        return {"ok": False, "message": "服务器地址为空，无法建立 SFTP 会话。"}
    return None


def sftp_host_key_error(error: HostKeyVerificationError, **fields) -> dict:
    return {
        "ok": False,
        "message": str(error),
        **fields,
        **error.to_result_fields(),
    }


def attr_to_item(parent_path: str, item) -> dict:
    item_type = "folder" if stat.S_ISDIR(item.st_mode) else "file"
    size = int(getattr(item, "st_size", 0) or 0)
    return {
        "type": item_type,
        "name": str(item.filename),
        "path": posixpath.join(parent_path.rstrip("/") or "/", str(item.filename)),
        "size": size,
        "modified": int(getattr(item, "st_mtime", 0) or 0),
        "meta": "目录" if item_type == "folder" else human_size(size),
    }


def normalize_remote_path(remote_path: str) -> str:
    path = str(remote_path or "").strip() or "."
    return path.replace("\\", "/")


def resolve_upload_target(local_path: str, remote_path: str) -> str:
    target = normalize_remote_path(remote_path)
    if target.endswith("/"):
        directory = target.rstrip("/") or "/"
        return posixpath.join(directory, Path(local_path).name)
    return target


def resolve_download_target(remote_path: str, local_path: str) -> str:
    raw_target = str(local_path)
    target = Path(raw_target).expanduser()
    if target.exists() and target.is_dir() or raw_target.endswith(("/", "\\")):
        remote_name = posixpath.basename(normalize_remote_path(remote_path).rstrip("/"))
        if remote_name:
            return str(target / remote_name)
    return str(local_path)


def resolve_directory_zip_target(remote_path: str, local_path: str) -> str:
    target = Path(str(local_path)).expanduser()
    if target.suffix.lower() == ".zip":
        return str(target)
    return str(Path(str(target) + ".zip"))


def download_sftp_directory_as_zip(sftp, remote_path: str, local_path: str) -> None:
    root = normalize_remote_path(remote_path).rstrip("/") or "/"
    root_name = posixpath.basename(root) or "sftp-download"
    with zipfile.ZipFile(Path(local_path).expanduser(), "w", compression=zipfile.ZIP_DEFLATED) as archive:
        write_sftp_directory_to_zip(sftp, root, root_name, archive)


def write_sftp_directory_to_zip(sftp, remote_path: str, archive_prefix: str, archive) -> None:
    for item in sftp.listdir_attr(remote_path):
        item_name = sanitize_remote_name(str(item.filename))
        if not item_name:
            continue
        child_remote_path = posixpath.join(remote_path.rstrip("/") or "/", item_name)
        child_archive_path = posixpath.join(archive_prefix, item_name)
        if stat.S_ISDIR(int(getattr(item, "st_mode", 0) or 0)):
            write_sftp_directory_to_zip(sftp, child_remote_path, child_archive_path, archive)
            continue

        handle = sftp.open(child_remote_path, "rb")
        try:
            content = handle.read()
        finally:
            close_sftp(handle)
        if isinstance(content, str):
            content = content.encode("utf-8")
        archive.writestr(child_archive_path, bytes(content or b""))


def resolve_child_path(parent_path: str, child_name: str) -> str:
    name = sanitize_remote_name(child_name)
    if not name:
        return ""
    return posixpath.join((normalize_remote_path(parent_path).rstrip("/") or "/"), name)


def resolve_sibling_path(remote_path: str, new_name: str) -> str:
    name = sanitize_remote_name(new_name)
    if not name:
        return ""
    source = normalize_remote_path(remote_path)
    parent = posixpath.dirname(source.rstrip("/")) or "/"
    return posixpath.join(parent, name)


def sanitize_remote_name(name: str) -> str:
    value = str(name or "").strip()
    if not value or value in {".", ".."}:
        return ""
    if "/" in value or "\\" in value:
        return ""
    return value


def parse_server(server: dict) -> dict:
    try:
        port = int(str(server.get("port") or "22").strip())
    except ValueError:
        port = 22
    return {
        "host": str(server.get("ip") or server.get("host") or "").strip(),
        "port": port,
        "user": str(server.get("user") or "root").strip() or "root",
    }


def close_sftp(*items):
    for item in items:
        if not item:
            continue
        try:
            item.close()
        except Exception:
            pass


def ensure_local_parent_directory(local_path: str) -> None:
    parent = Path(local_path).expanduser().parent
    if str(parent) and not parent.exists():
        parent.mkdir(parents=True, exist_ok=True)


def decode_text_preview(raw: bytes) -> tuple[str, str] | None:
    encodings = ["utf-8-sig"]
    if has_utf16_bom(raw):
        encodings.append("utf-16")
    encodings.append("gb18030")
    for encoding in encodings:
        try:
            content = raw.decode(encoding)
        except UnicodeDecodeError:
            continue
        if is_safe_text_preview_content(content):
            return content, "utf-8" if encoding == "utf-8-sig" else encoding
    return None


def decode_utf16_without_bom_preview(raw: bytes) -> tuple[str, str] | None:
    even_nulls = raw[0::2].count(0)
    odd_nulls = raw[1::2].count(0)
    encodings = ["utf-16-le", "utf-16-be"] if odd_nulls >= even_nulls else ["utf-16-be", "utf-16-le"]
    for encoding in encodings:
        try:
            content = raw.decode(encoding)
        except UnicodeDecodeError:
            continue
        if is_safe_text_preview_content(content):
            return content, encoding
    return None


def is_safe_text_preview_content(content: str) -> bool:
    if "\x00" in content:
        return False
    if not content:
        return True
    invalid = 0
    for char in content:
        code = ord(char)
        if char in "\r\n\t":
            continue
        if code < 32 or 0x7F <= code < 0xA0:
            invalid += 1
    return invalid / max(len(content), 1) <= 0.02


def has_text_bom(raw: bytes) -> bool:
    return raw.startswith((b"\xef\xbb\xbf", b"\xff\xfe", b"\xfe\xff"))


def has_utf16_bom(raw: bytes) -> bool:
    return raw.startswith((b"\xff\xfe", b"\xfe\xff"))


def human_size(size: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{size} B"


def load_paramiko():
    try:
        import paramiko
    except ImportError as error:
        raise RuntimeError("当前运行环境缺少 Paramiko，无法建立真实 SFTP 会话。") from error
    return paramiko
