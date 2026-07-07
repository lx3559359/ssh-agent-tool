import os
import posixpath
import socket
import tempfile
import threading
import time
import unittest
import logging
from pathlib import Path

import paramiko
from paramiko import SFTPAttributes, SFTPHandle, SFTP_OK, SFTPServer, SFTPServerInterface

from sftp_client import (
    create_sftp_directory,
    delete_sftp_path,
    download_sftp_file,
    list_sftp_directory,
    read_sftp_text_file,
    rename_sftp_path,
    upload_sftp_file,
    write_sftp_text_file,
)
from ssh_session import format_host_key_fingerprint


logging.getLogger("paramiko.transport").setLevel(logging.CRITICAL)


class _PasswordSftpServer(paramiko.ServerInterface):
    def __init__(self, username: str, password: str):
        self.username = username
        self.password = password

    def check_auth_password(self, username, password):
        if username == self.username and password == self.password:
            return paramiko.AUTH_SUCCESSFUL
        return paramiko.AUTH_FAILED

    def get_allowed_auths(self, _username):
        return "password"

    def check_channel_request(self, kind, _chanid):
        if kind == "session":
            return paramiko.OPEN_SUCCEEDED
        return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED


class _RootedSftpInterface(SFTPServerInterface):
    def __init__(self, server, *args, root: str, **kwargs):
        super().__init__(server, *args, **kwargs)
        self.root = Path(root).resolve()

    def _local_path(self, remote_path: str) -> Path:
        normalized = posixpath.normpath("/" + str(remote_path or "").replace("\\", "/")).lstrip("/")
        local = (self.root / normalized).resolve()
        if local != self.root and self.root not in local.parents:
            raise OSError("path escapes SFTP test root")
        return local

    def _attrs(self, local: Path, filename: str = ""):
        attrs = SFTPAttributes.from_stat(local.stat())
        attrs.filename = filename or local.name
        return attrs

    def list_folder(self, path):
        try:
            local = self._local_path(path)
            return [self._attrs(child, child.name) for child in sorted(local.iterdir(), key=lambda item: item.name.lower())]
        except OSError as error:
            return SFTPServer.convert_errno(getattr(error, "errno", None) or 2)

    def stat(self, path):
        try:
            return self._attrs(self._local_path(path))
        except OSError as error:
            return SFTPServer.convert_errno(getattr(error, "errno", None) or 2)

    def lstat(self, path):
        return self.stat(path)

    def open(self, path, flags, attr):
        try:
            local = self._local_path(path)
            local.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(local, flags, 0o666)
            if flags & os.O_RDWR:
                mode = "r+b"
            elif flags & os.O_WRONLY:
                mode = "wb"
            else:
                mode = "rb"
            file_obj = os.fdopen(fd, mode)
            handle = SFTPHandle(flags)
            if flags & (os.O_WRONLY | os.O_RDWR):
                handle.writefile = file_obj
            if not flags & os.O_WRONLY or flags & os.O_RDWR:
                handle.readfile = file_obj
            return handle
        except OSError as error:
            return SFTPServer.convert_errno(getattr(error, "errno", None) or 5)

    def remove(self, path):
        try:
            self._local_path(path).unlink()
            return SFTP_OK
        except OSError as error:
            return SFTPServer.convert_errno(getattr(error, "errno", None) or 2)

    def rename(self, oldpath, newpath):
        try:
            old_local = self._local_path(oldpath)
            new_local = self._local_path(newpath)
            if new_local.exists():
                return SFTPServer.convert_errno(17)
            old_local.rename(new_local)
            return SFTP_OK
        except OSError as error:
            return SFTPServer.convert_errno(getattr(error, "errno", None) or 5)

    def mkdir(self, path, attr):
        try:
            self._local_path(path).mkdir()
            return SFTP_OK
        except OSError as error:
            return SFTPServer.convert_errno(getattr(error, "errno", None) or 5)

    def rmdir(self, path):
        try:
            self._local_path(path).rmdir()
            return SFTP_OK
        except OSError as error:
            return SFTPServer.convert_errno(getattr(error, "errno", None) or 5)


class _LocalSftpServer:
    def __init__(self, root: Path, username="tester", password="secret"):
        self.root = Path(root)
        self.username = username
        self.password = password
        self._host_key = paramiko.RSAKey.generate(1024)
        self._ready = threading.Event()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self.port = 0
        self.error = None

    def __enter__(self):
        self._thread.start()
        if not self._ready.wait(5):
            raise RuntimeError("local SFTP server did not start")
        if self.error:
            raise self.error
        return self

    def __exit__(self, _exc_type, _exc, _tb):
        self._stop.set()
        try:
            with socket.create_connection(("127.0.0.1", self.port), timeout=1):
                pass
        except OSError:
            pass
        self._thread.join(timeout=5)

    def trusted_host_key(self):
        return format_host_key_fingerprint(self._host_key)

    def server_config(self):
        return {
            "name": "local-sftp-smoke",
            "ip": "127.0.0.1",
            "port": self.port,
            "user": self.username,
            "authType": "password",
            "trustedHostKey": self.trusted_host_key(),
        }

    def _run(self):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(("127.0.0.1", 0))
                sock.listen(10)
                self.port = sock.getsockname()[1]
                self._ready.set()
                while not self._stop.is_set():
                    try:
                        client, _addr = sock.accept()
                    except OSError:
                        break
                    if self._stop.is_set():
                        client.close()
                        break
                    threading.Thread(target=self._handle_client, args=(client,), daemon=True).start()
        except Exception as error:
            self.error = error
            self._ready.set()

    def _handle_client(self, client):
        transport = paramiko.Transport(client)
        try:
            transport.add_server_key(self._host_key)
            transport.set_subsystem_handler("sftp", SFTPServer, _RootedSftpInterface, root=str(self.root))
            transport.start_server(server=_PasswordSftpServer(self.username, self.password))
            channel = transport.accept(10)
            if channel is None:
                return
            idle_deadline = time.monotonic() + 30
            while not self._stop.is_set() and not channel.closed and time.monotonic() < idle_deadline:
                time.sleep(0.05)
        finally:
            try:
                transport.close()
            except Exception:
                pass


class SftpProtocolSmokeTests(unittest.TestCase):
    def test_sftp_file_workflow_uses_real_protocol_operations(self):
        with tempfile.TemporaryDirectory() as remote_dir, tempfile.TemporaryDirectory() as local_dir:
            remote_root = Path(remote_dir)
            local_root = Path(local_dir)
            (remote_root / "seed.txt").write_text("seed-content", encoding="utf-8")
            local_upload = local_root / "upload.txt"
            local_download = local_root / "downloaded.txt"
            local_upload.write_text("upload-content", encoding="utf-8")

            with _LocalSftpServer(remote_root) as sftpd:
                server = sftpd.server_config()
                password = sftpd.password
                credential_metadata = {"authType": "password"}

                listed = list_sftp_directory(server, password, "/", timeout=5, credential_metadata=credential_metadata)
                self.assertTrue(listed["ok"], listed)
                self.assertIn("seed.txt", [item["name"] for item in listed["items"]])

                written = write_sftp_text_file(server, password, "/notes.txt", "hello-sftp", timeout=5, credential_metadata=credential_metadata)
                self.assertTrue(written["ok"], written)

                preview = read_sftp_text_file(server, password, "/notes.txt", timeout=5, credential_metadata=credential_metadata)
                self.assertTrue(preview["ok"], preview)
                self.assertEqual(preview["content"], "hello-sftp")

                uploaded = upload_sftp_file(server, password, str(local_upload), "/upload.txt", timeout=5, credential_metadata=credential_metadata)
                self.assertTrue(uploaded["ok"], uploaded)

                renamed = rename_sftp_path(server, password, "/upload.txt", "renamed.txt", timeout=5, credential_metadata=credential_metadata)
                self.assertTrue(renamed["ok"], renamed)
                self.assertTrue((remote_root / "renamed.txt").exists())

                downloaded = download_sftp_file(server, password, "/renamed.txt", str(local_download), timeout=5, credential_metadata=credential_metadata)
                self.assertTrue(downloaded["ok"], downloaded)
                self.assertEqual(local_download.read_text(encoding="utf-8"), "upload-content")

                deleted_file = delete_sftp_path(server, password, "/renamed.txt", "file", timeout=5, credential_metadata=credential_metadata)
                self.assertTrue(deleted_file["ok"], deleted_file)
                self.assertFalse((remote_root / "renamed.txt").exists())

                created_dir = create_sftp_directory(server, password, "/", "empty-dir", timeout=5, credential_metadata=credential_metadata)
                self.assertTrue(created_dir["ok"], created_dir)

                deleted_dir = delete_sftp_path(server, password, "/empty-dir", "folder", timeout=5, credential_metadata=credential_metadata)
                self.assertTrue(deleted_dir["ok"], deleted_dir)
                self.assertFalse((remote_root / "empty-dir").exists())


if __name__ == "__main__":
    unittest.main()
