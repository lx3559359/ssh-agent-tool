import tempfile
import unittest
import base64
import hashlib
import zipfile
from pathlib import Path

from sftp_client import create_sftp_directory, create_sftp_file, delete_sftp_path, download_sftp_file, list_sftp_directory, open_sftp_client, read_sftp_text_file, rename_sftp_path, upload_sftp_file, write_sftp_text_file
from ssh_session import HostKeyVerificationError


class FakeAttr:
    def __init__(self, filename, mode, size=0, mtime=0):
        self.filename = filename
        self.st_mode = mode
        self.st_size = size
        self.st_mtime = mtime


class FakeSftp:
    def __init__(self):
        self.downloads = []
        self.uploads = []
        self.created_dirs = []
        self.created_files = []
        self.renames = []
        self.removed_files = []
        self.removed_dirs = []
        self.closed = False
        self.files = {
            "/etc/nginx/nginx.conf": b"user nginx;\nworker_processes auto;\n",
            "/var/log/chinese-gbk.log": "中文日志\n服务正常\n".encode("gb18030"),
            "/var/log/windows-utf16.log": "Windows 日志\r\n服务正常\r\n".encode("utf-16"),
            "/var/log/windows-utf16le-no-bom.log": "Windows 日志\r\n服务正常\r\n".encode("utf-16-le"),
            "/var/log/binary.log": b"ok\x00no",
            "/var/log/control-binary.log": b"\x01\x02\x03\x04not text\x05\x06\x07\x08",
            "/srv/agent-app/app.log": b"app started\n",
            "/srv/agent-app/releases/current.txt": b"2026-07-04\n",
        }
        self.directories = {
            "/srv/agent-app": [
                FakeAttr("app.log", 0o100644, 12, 1710000100),
                FakeAttr("releases", 0o040755, 0, 1710000200),
            ],
            "/srv/agent-app/releases": [
                FakeAttr("current.txt", 0o100644, 11, 1710000300),
            ],
        }

    def listdir_attr(self, path):
        self.listed_path = path
        if path in self.directories:
            return self.directories[path]
        return [
            FakeAttr("logs", 0o040755, 0, 1710000000),
            FakeAttr("app.log", 0o100644, 2048, 1710000100),
        ]

    def get(self, remote_path, local_path):
        self.downloads.append((remote_path, local_path))

    def put(self, local_path, remote_path):
        self.uploads.append((local_path, remote_path))

    def mkdir(self, remote_path):
        self.created_dirs.append(remote_path)

    def rename(self, old_path, new_path):
        self.renames.append((old_path, new_path))

    def remove(self, remote_path):
        self.removed_files.append(remote_path)

    def rmdir(self, remote_path):
        self.removed_dirs.append(remote_path)

    def stat(self, remote_path):
        if remote_path in self.directories:
            return type("FakeStat", (), {"st_mode": 0o040755, "st_size": 0})()
        if remote_path not in self.files:
            raise FileNotFoundError(remote_path)
        return type("FakeStat", (), {"st_mode": 0o100644, "st_size": len(self.files[remote_path])})()

    def open(self, remote_path, mode="rb"):
        if "w" in mode or "x" in mode or "a" in mode:
            self.created_files.append((remote_path, mode))
            handle = FakeRemoteFile(b"", on_write=lambda data: self.files.__setitem__(remote_path, data))
            self.files[remote_path] = b""
            return handle
        return FakeRemoteFile(self.files[remote_path])

    def close(self):
        self.closed = True


class FakeRemoteFile:
    def __init__(self, content, on_write=None):
        self.content = content
        self.on_write = on_write
        self.closed = False

    def read(self, size=-1):
        if size is None or size < 0:
            return self.content
        return self.content[:size]

    def write(self, data):
        self.content = bytes(data or b"")
        if self.on_write:
            self.on_write(self.content)
        return len(self.content)

    def close(self):
        self.closed = True


class FakeClient:
    instances = []

    def __init__(self):
        self.sftp = FakeSftp()
        self.closed = False
        self.transport = FakeTransport()
        FakeClient.instances.append(self)

    def set_missing_host_key_policy(self, _policy):
        self.policy = _policy

    def connect(self, **kwargs):
        if getattr(self, "reject_before_auth", False) and hasattr(getattr(self, "policy", None), "missing_host_key"):
            self.policy.missing_host_key(self, kwargs.get("hostname"), FakeRemoteKey())
        self.connect_kwargs = kwargs

    def open_sftp(self):
        return self.sftp

    def get_transport(self):
        return self.transport

    def close(self):
        self.closed = True


class FakeTransport:
    def __init__(self):
        self.channel = object()
        self.opened = []

    def get_remote_server_key(self):
        return FakeRemoteKey()

    def open_channel(self, kind, destination, source):
        self.opened.append((kind, destination, source))
        return self.channel


class FakeRemoteKey:
    def get_name(self):
        return "ssh-ed25519"

    def asbytes(self):
        return b"server-key"


class ProxyClient(FakeClient):
    def __init__(self):
        super().__init__()
        self.transport = FakeTransport()

    def get_transport(self):
        return self.transport


class FakeParamiko:
    SSHClient = FakeClient

    class Ed25519Key:
        @staticmethod
        def from_private_key_file(path, password=None):
            return f"key:{path}"

    class AutoAddPolicy:
        pass


class CyclingParamiko:
    class AutoAddPolicy:
        pass

    def __init__(self, clients):
        self.clients = list(clients)
        self.index = 0

    def SSHClient(self):
        client = self.clients[self.index]
        self.index += 1
        return client


class SftpClientTests(unittest.TestCase):
    def setUp(self):
        FakeClient.instances = []

    def test_user_visible_messages_are_readable_chinese(self):
        list_result = list_sftp_directory(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/var/www/app",
            paramiko_module=FakeParamiko,
        )
        download_result = download_sftp_file(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/var/log/app.log",
            "",
            paramiko_module=FakeParamiko,
        )
        missing_password = list_sftp_directory({"ip": "10.0.1.23"}, "", "/tmp", paramiko_module=FakeParamiko)
        missing_host = list_sftp_directory({"ip": ""}, "secret", "/tmp", paramiko_module=FakeParamiko)

        messages = [
            list_result["message"],
            download_result["message"],
            missing_password["message"],
            missing_host["message"],
        ]

        self.assertEqual(list_result["message"], "SFTP 目录读取完成。")
        self.assertIn("远程路径或本地保存路径为空", download_result["message"])
        self.assertIn("缺少凭据", missing_password["message"])
        self.assertIn("服务器地址为空", missing_host["message"])
        for message in messages:
            self.assertNotRegex(message, r"[�]|[銆锛绋鐩鍑]")

    def test_lists_remote_directory_with_file_metadata(self):
        result = list_sftp_directory(
            {"ip": "10.0.1.23", "port": "2222", "user": "root"},
            "secret",
            "/var/www/app",
            paramiko_module=FakeParamiko,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["path"], "/var/www/app")
        self.assertEqual(result["items"][0]["type"], "folder")
        self.assertEqual(result["items"][0]["name"], "logs")
        self.assertEqual(result["items"][1]["type"], "file")
        self.assertEqual(result["items"][1]["size"], 2048)
        self.assertEqual(FakeClient.instances[0].connect_kwargs["port"], 2222)
        self.assertTrue(FakeClient.instances[0].closed)
        self.assertTrue(FakeClient.instances[0].sftp.closed)

    def test_lists_remote_directory_with_identity_file_without_password(self):
        result = list_sftp_directory(
            {"ip": "10.0.1.23", "port": "22", "user": "root"},
            "",
            "/var/www/app",
            paramiko_module=FakeParamiko,
            credential_metadata={"authType": "私钥", "identityFile": "C:/keys/prod"},
        )

        self.assertTrue(result["ok"])
        self.assertEqual(FakeClient.instances[0].connect_kwargs["pkey"], "key:C:/keys/prod")
        self.assertNotIn("password", FakeClient.instances[0].connect_kwargs)

    def test_lists_remote_directory_with_ssh_agent_without_password(self):
        result = list_sftp_directory(
            {"ip": "10.0.1.23", "port": "22", "user": "root"},
            "",
            "/var/www/app",
            paramiko_module=FakeParamiko,
            credential_metadata={"authType": "SSH Agent"},
        )

        self.assertTrue(result["ok"])
        self.assertTrue(FakeClient.instances[0].connect_kwargs["allow_agent"])
        self.assertTrue(FakeClient.instances[0].connect_kwargs["look_for_keys"])
        self.assertNotIn("password", FakeClient.instances[0].connect_kwargs)

    def test_lists_remote_directory_through_proxy_jump(self):
        bastion = ProxyClient()
        target = FakeClient()

        result = list_sftp_directory(
            {"ip": "10.0.1.23", "port": "2222", "user": "root", "proxyJump": "jump@bastion.example.com:2200"},
            "secret",
            "/var/www/app",
            paramiko_module=CyclingParamiko([target, bastion]),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(bastion.connect_kwargs["hostname"], "bastion.example.com")
        self.assertEqual(bastion.connect_kwargs["port"], 2200)
        self.assertEqual(bastion.transport.opened[0], ("direct-tcpip", ("10.0.1.23", 2222), ("127.0.0.1", 0)))
        self.assertIs(target.connect_kwargs["sock"], bastion.transport.channel)
        self.assertTrue(target.closed)
        self.assertTrue(bastion.closed)

    def test_rejects_changed_trusted_host_key_before_opening_sftp(self):
        result = list_sftp_directory(
            {
                "ip": "10.0.1.23",
                "port": "22",
                "user": "root",
                "trustedHostKey": {"type": "ssh-ed25519", "sha256": "SHA256:trusted-old"},
            },
            "secret",
            "/var/www/app",
            paramiko_module=FakeParamiko,
        )

        self.assertFalse(result["ok"])
        self.assertIn("主机指纹", result["message"])
        self.assertEqual(
            result["hostKey"],
            {
                "type": "ssh-ed25519",
                "sha256": "SHA256:" + base64.b64encode(hashlib.sha256(b"server-key").digest()).decode("ascii").rstrip("="),
            },
        )
        self.assertEqual(result["trustedHostKey"], {"type": "ssh-ed25519", "sha256": "SHA256:trusted-old"})
        self.assertEqual(result["hostKeyTrust"]["status"], "changed")
        self.assertTrue(FakeClient.instances[0].closed)
        self.assertFalse(FakeClient.instances[0].sftp.closed)

    def test_unknown_host_key_is_reported_before_opening_sftp(self):
        client = FakeClient()
        client.reject_before_auth = True

        with self.assertRaises(HostKeyVerificationError) as raised:
            open_sftp_client(
                {"ip": "10.0.1.23", "port": "22", "user": "root"},
                "secret",
                paramiko_module=CyclingParamiko([client]),
            )

        self.assertIsNone(getattr(client, "connect_kwargs", None))
        self.assertNotIsInstance(client.policy, FakeParamiko.AutoAddPolicy)
        self.assertEqual(raised.exception.host_key_trust["status"], "unknown")
        self.assertEqual(
            raised.exception.host_key,
            {
                "type": "ssh-ed25519",
                "sha256": "SHA256:" + base64.b64encode(hashlib.sha256(b"server-key").digest()).decode("ascii").rstrip("="),
            },
        )
        self.assertTrue(client.closed)

    def test_download_returns_structured_changed_host_key_error(self):
        result = download_sftp_file(
            {
                "ip": "10.0.1.23",
                "port": "22",
                "user": "root",
                "trustedHostKey": {"type": "ssh-ed25519", "sha256": "SHA256:trusted-old"},
            },
            "secret",
            "/var/log/app.log",
            "C:/tmp/app.log",
            paramiko_module=FakeParamiko,
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["hostKeyTrust"]["status"], "changed")
        self.assertEqual(result["trustedHostKey"], {"type": "ssh-ed25519", "sha256": "SHA256:trusted-old"})
        self.assertTrue(FakeClient.instances[0].closed)

    def test_downloads_remote_file_to_local_path(self):
        result = download_sftp_file(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/var/log/app.log",
            "C:/tmp/app.log",
            paramiko_module=FakeParamiko,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(FakeClient.instances[0].sftp.downloads, [("/var/log/app.log", "C:/tmp/app.log")])

    def test_download_creates_missing_local_parent_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_path = Path(temp_dir) / "logs" / "nginx" / "app.log"

            result = download_sftp_file(
                {"ip": "10.0.1.23", "user": "root"},
                "secret",
                "/var/log/app.log",
                str(local_path),
                paramiko_module=FakeParamiko,
            )

            self.assertTrue(result["ok"])
            self.assertTrue(local_path.parent.exists())
            self.assertEqual(FakeClient.instances[0].sftp.downloads, [("/var/log/app.log", str(local_path))])

    def test_download_to_existing_local_directory_uses_remote_file_name(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            result = download_sftp_file(
                {"ip": "10.0.1.23", "user": "root"},
                "secret",
                "/var/log/nginx/app.log",
                temp_dir,
                paramiko_module=FakeParamiko,
            )

            expected_path = str(Path(temp_dir) / "app.log")

        self.assertTrue(result["ok"])
        self.assertEqual(result["localPath"], expected_path)
        self.assertEqual(FakeClient.instances[0].sftp.downloads, [("/var/log/nginx/app.log", expected_path)])

    def test_download_rejects_existing_local_file_without_overwriting(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_path = Path(temp_dir) / "app.log"
            local_path.write_text("keep local content", encoding="utf-8")

            result = download_sftp_file(
                {"ip": "10.0.1.23", "user": "root"},
                "secret",
                "/var/log/nginx/app.log",
                str(local_path),
                paramiko_module=FakeParamiko,
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["localPath"], str(local_path))
        self.assertIn("已存在", result["message"])
        self.assertEqual(FakeClient.instances, [])

    def test_download_allows_explicit_local_overwrite(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_path = Path(temp_dir) / "app.log"
            local_path.write_text("replace me", encoding="utf-8")

            result = download_sftp_file(
                {"ip": "10.0.1.23", "user": "root"},
                "secret",
                "/var/log/nginx/app.log",
                str(local_path),
                overwrite=True,
                paramiko_module=FakeParamiko,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["localPath"], str(local_path))
        self.assertEqual(FakeClient.instances[0].sftp.downloads, [("/var/log/nginx/app.log", str(local_path))])

    def test_download_to_trailing_separator_directory_creates_directory_and_uses_remote_file_name(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_dir = Path(temp_dir) / "downloads"
            local_path = str(local_dir) + "\\"

            result = download_sftp_file(
                {"ip": "10.0.1.23", "user": "root"},
                "secret",
                "/var/log/nginx/error.log",
                local_path,
                paramiko_module=FakeParamiko,
            )

            expected_path = str(local_dir / "error.log")
            directory_exists = local_dir.exists()

        self.assertTrue(result["ok"])
        self.assertEqual(result["localPath"], expected_path)
        self.assertTrue(directory_exists)
        self.assertEqual(FakeClient.instances[0].sftp.downloads, [("/var/log/nginx/error.log", expected_path)])

    def test_download_remote_directory_as_zip_when_target_is_local_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            result = download_sftp_file(
                {"ip": "10.0.1.23", "user": "root"},
                "secret",
                "/srv/agent-app",
                temp_dir,
                paramiko_module=FakeParamiko,
            )

            expected_path = str(Path(temp_dir) / "agent-app.zip")
            with zipfile.ZipFile(expected_path, "r") as archive:
                names = sorted(archive.namelist())
                app_log = archive.read("agent-app/app.log")
                current = archive.read("agent-app/releases/current.txt")

        self.assertTrue(result["ok"])
        self.assertEqual(result["localPath"], expected_path)
        self.assertEqual(result["message"], "SFTP 目录下载完成。")
        self.assertEqual(names, ["agent-app/app.log", "agent-app/releases/current.txt"])
        self.assertEqual(app_log, b"app started\n")
        self.assertEqual(current, b"2026-07-04\n")
        self.assertEqual(FakeClient.instances[0].sftp.downloads, [])

    def test_reads_remote_text_file_preview(self):
        result = read_sftp_text_file(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/etc/nginx/nginx.conf",
            paramiko_module=FakeParamiko,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["remotePath"], "/etc/nginx/nginx.conf")
        self.assertEqual(result["content"], "user nginx;\nworker_processes auto;\n")
        self.assertEqual(result["encoding"], "utf-8")
        self.assertEqual(result["size"], 35)

    def test_writes_remote_text_file_with_utf8_encoding(self):
        expected_raw = b"user nginx;\nworker_processes 2;\n"
        result = write_sftp_text_file(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/etc/nginx/nginx.conf",
            expected_raw.decode("utf-8"),
            encoding="utf-8",
            paramiko_module=FakeParamiko,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["remotePath"], "/etc/nginx/nginx.conf")
        self.assertEqual(result["encoding"], "utf-8")
        self.assertEqual(result["bytes"], len(expected_raw))
        self.assertEqual(FakeClient.instances[0].sftp.created_files, [("/etc/nginx/nginx.conf", "wb")])
        self.assertEqual(FakeClient.instances[0].sftp.files["/etc/nginx/nginx.conf"], expected_raw)

    def test_reads_gb18030_remote_text_file_preview(self):
        result = read_sftp_text_file(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/var/log/chinese-gbk.log",
            paramiko_module=FakeParamiko,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["remotePath"], "/var/log/chinese-gbk.log")
        self.assertEqual(result["content"], "中文日志\n服务正常\n")
        self.assertEqual(result["encoding"], "gb18030")

    def test_reads_utf16_remote_text_file_preview_without_binary_false_positive(self):
        result = read_sftp_text_file(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/var/log/windows-utf16.log",
            paramiko_module=FakeParamiko,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["remotePath"], "/var/log/windows-utf16.log")
        self.assertEqual(result["content"], "Windows 日志\r\n服务正常\r\n")
        self.assertEqual(result["encoding"], "utf-16")

    def test_reads_utf16le_without_bom_remote_text_file_preview(self):
        result = read_sftp_text_file(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/var/log/windows-utf16le-no-bom.log",
            paramiko_module=FakeParamiko,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["remotePath"], "/var/log/windows-utf16le-no-bom.log")
        self.assertEqual(result["content"], "Windows 日志\r\n服务正常\r\n")
        self.assertEqual(result["encoding"], "utf-16-le")

    def test_rejects_binary_remote_text_preview(self):
        result = read_sftp_text_file(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/var/log/binary.log",
            paramiko_module=FakeParamiko,
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["remotePath"], "/var/log/binary.log")
        self.assertEqual(result["content"], "")

    def test_rejects_control_character_binary_remote_text_preview(self):
        result = read_sftp_text_file(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/var/log/control-binary.log",
            paramiko_module=FakeParamiko,
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["remotePath"], "/var/log/control-binary.log")
        self.assertEqual(result["content"], "")

    def test_uploads_local_file_to_remote_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_path = Path(temp_dir) / "deploy.sh"
            local_path.write_text("echo ok", encoding="utf-8")

            result = upload_sftp_file(
                {"ip": "10.0.1.23", "user": "root"},
                "secret",
                str(local_path),
                "/opt/scripts/",
                paramiko_module=FakeParamiko,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(FakeClient.instances[0].sftp.uploads[0][1], "/opt/scripts/deploy.sh")

    def test_upload_to_remote_root_directory_keeps_absolute_target(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_path = Path(temp_dir) / "deploy.sh"
            local_path.write_text("echo ok", encoding="utf-8")

            result = upload_sftp_file(
                {"ip": "10.0.1.23", "user": "root"},
                "secret",
                str(local_path),
                "/",
                paramiko_module=FakeParamiko,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["remotePath"], "/deploy.sh")
        self.assertEqual(FakeClient.instances[0].sftp.uploads[0][1], "/deploy.sh")

    def test_upload_rejects_existing_remote_file_without_overwriting(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_path = Path(temp_dir) / "nginx.conf"
            local_path.write_text("server {}", encoding="utf-8")

            result = upload_sftp_file(
                {"ip": "10.0.1.23", "user": "root"},
                "secret",
                str(local_path),
                "/etc/nginx/",
                paramiko_module=FakeParamiko,
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["remotePath"], "/etc/nginx/nginx.conf")
        self.assertIn("目标文件已存在", result["message"])
        self.assertEqual(FakeClient.instances[0].sftp.uploads, [])

    def test_upload_allows_explicit_remote_overwrite(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_path = Path(temp_dir) / "nginx.conf"
            local_path.write_text("server {}", encoding="utf-8")

            result = upload_sftp_file(
                {"ip": "10.0.1.23", "user": "root"},
                "secret",
                str(local_path),
                "/etc/nginx/",
                overwrite=True,
                paramiko_module=FakeParamiko,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["remotePath"], "/etc/nginx/nginx.conf")
        self.assertEqual(FakeClient.instances[0].sftp.uploads, [(str(local_path), "/etc/nginx/nginx.conf")])

    def test_uploads_local_directory_recursively_to_remote_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_dir = Path(temp_dir) / "release"
            nested_dir = local_dir / "config"
            nested_dir.mkdir(parents=True)
            (local_dir / "README.md").write_text("release notes", encoding="utf-8")
            (nested_dir / "app.conf").write_text("port=8080", encoding="utf-8")

            result = upload_sftp_file(
                {"ip": "10.0.1.23", "user": "root"},
                "secret",
                str(local_dir),
                "/opt/scripts/",
                paramiko_module=FakeParamiko,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["remotePath"], "/opt/scripts/release")
        self.assertEqual(result["message"], "SFTP 目录上传完成。")
        self.assertEqual(FakeClient.instances[0].sftp.created_dirs, ["/opt/scripts/release", "/opt/scripts/release/config"])
        self.assertEqual(
            sorted((Path(local).name, remote) for local, remote in FakeClient.instances[0].sftp.uploads),
            [
                ("README.md", "/opt/scripts/release/README.md"),
                ("app.conf", "/opt/scripts/release/config/app.conf"),
            ],
        )

    def test_creates_remote_directory(self):
        result = create_sftp_directory(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/var/www/app",
            "logs",
            paramiko_module=FakeParamiko,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["remotePath"], "/var/www/app/logs")
        self.assertEqual(FakeClient.instances[0].sftp.created_dirs, ["/var/www/app/logs"])

    def test_creates_empty_remote_file_without_overwriting(self):
        result = create_sftp_file(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/var/www/app",
            "README.md",
            paramiko_module=FakeParamiko,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["remotePath"], "/var/www/app/README.md")
        self.assertEqual(FakeClient.instances[0].sftp.created_files, [("/var/www/app/README.md", "wx")])

    def test_rejects_sftp_directory_name_path_traversal_before_connecting(self):
        result = create_sftp_directory(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/var/www/app",
            "../logs",
            paramiko_module=FakeParamiko,
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["remotePath"], "")
        self.assertEqual(FakeClient.instances, [])

    def test_renames_remote_path_in_same_directory(self):
        result = rename_sftp_path(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/var/www/app/app.log",
            "app.old.log",
            paramiko_module=FakeParamiko,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["newPath"], "/var/www/app/app.old.log")
        self.assertEqual(FakeClient.instances[0].sftp.renames, [("/var/www/app/app.log", "/var/www/app/app.old.log")])

    def test_rename_rejects_existing_remote_target_without_overwriting(self):
        result = rename_sftp_path(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/etc/nginx/old.conf",
            "nginx.conf",
            paramiko_module=FakeParamiko,
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["newPath"], "/etc/nginx/nginx.conf")
        self.assertIn("目标文件已存在", result["message"])
        self.assertEqual(FakeClient.instances[0].sftp.renames, [])

    def test_rejects_sftp_rename_name_with_path_separator_before_connecting(self):
        result = rename_sftp_path(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/var/www/app/app.log",
            "../app.old.log",
            paramiko_module=FakeParamiko,
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["newPath"], "")
        self.assertEqual(FakeClient.instances, [])

    def test_deletes_file_or_empty_directory(self):
        file_result = delete_sftp_path(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/var/www/app/app.log",
            "file",
            paramiko_module=FakeParamiko,
        )
        folder_result = delete_sftp_path(
            {"ip": "10.0.1.23", "user": "root"},
            "secret",
            "/var/www/app/logs",
            "folder",
            paramiko_module=FakeParamiko,
        )

        self.assertTrue(file_result["ok"])
        self.assertTrue(folder_result["ok"])
        self.assertEqual(FakeClient.instances[0].sftp.removed_files, ["/var/www/app/app.log"])
        self.assertEqual(FakeClient.instances[1].sftp.removed_dirs, ["/var/www/app/logs"])

    def test_requires_password_and_host(self):
        missing_password = list_sftp_directory({"ip": "10.0.1.23"}, "", "/tmp", paramiko_module=FakeParamiko)
        missing_host = list_sftp_directory({"ip": ""}, "secret", "/tmp", paramiko_module=FakeParamiko)

        self.assertFalse(missing_password["ok"])
        self.assertIn("缺少凭据", missing_password["message"])
        self.assertFalse(missing_host["ok"])
        self.assertIn("服务器地址为空", missing_host["message"])


if __name__ == "__main__":
    unittest.main()
