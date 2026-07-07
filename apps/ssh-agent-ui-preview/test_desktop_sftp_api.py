from pathlib import Path
import time
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch

from desktop_app import DesktopApi


class DesktopSftpApiTests(unittest.TestCase):
    def test_pick_upload_files_returns_multiple_selected_paths(self):
        class FakeWindow:
            def __init__(self):
                self.allow_multiple = None

            def create_file_dialog(self, dialog_type, allow_multiple=False):
                self.allow_multiple = allow_multiple
                return ("C:/tmp/app.log", "C:/tmp/nginx.conf")

        fake_window = FakeWindow()

        with patch.dict("sys.modules", {"webview": type("FakeWebview", (), {"windows": [fake_window], "OPEN_DIALOG": "open"})}):
            result = DesktopApi().pick_upload_files()

        self.assertEqual(result, ["C:/tmp/app.log", "C:/tmp/nginx.conf"])
        self.assertTrue(fake_window.allow_multiple)

    def test_pick_upload_directory_returns_selected_folder_path(self):
        class FakeWindow:
            def __init__(self):
                self.dialog_type = None

            def create_file_dialog(self, dialog_type):
                self.dialog_type = dialog_type
                return ("C:/tmp/release",)

        fake_window = FakeWindow()

        with patch.dict("sys.modules", {"webview": type("FakeWebview", (), {"windows": [fake_window], "FOLDER_DIALOG": "folder"})}):
            result = DesktopApi().pick_upload_directory()

        self.assertEqual(result, "C:/tmp/release")
        self.assertEqual(fake_window.dialog_type, "folder")

    def test_create_sftp_directory_uses_saved_credential(self):
        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.create_sftp_directory") as create_directory:
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {"authType": "password"}
            create_directory.return_value = {"ok": True, "remotePath": "/var/www/app/logs"}

            result = DesktopApi().create_sftp_directory({"ip": "10.0.1.23"}, "cred-1", "/var/www/app", "logs")

        self.assertTrue(result["ok"])
        create_directory.assert_called_once_with({"ip": "10.0.1.23"}, "secret", "/var/www/app", "logs", timeout=10, credential_metadata={"authType": "password"})

    def test_create_sftp_directory_accepts_frontend_full_path(self):
        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.create_sftp_directory") as create_directory:
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {"authType": "password"}
            create_directory.return_value = {"ok": True, "remotePath": "/var/www/app/logs"}

            result = DesktopApi().create_sftp_directory({"ip": "10.0.1.23"}, "cred-1", "/var/www/app/logs")

        self.assertTrue(result["ok"])
        create_directory.assert_called_once_with({"ip": "10.0.1.23"}, "secret", "/var/www/app", "logs", timeout=10, credential_metadata={"authType": "password"})

    def test_create_sftp_file_uses_saved_credential(self):
        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.create_sftp_file") as create_file:
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {"authType": "password"}
            create_file.return_value = {"ok": True, "remotePath": "/var/www/app/README.md"}

            result = DesktopApi().create_sftp_file({"ip": "10.0.1.23"}, "cred-1", "/var/www/app", "README.md")

        self.assertTrue(result["ok"])
        create_file.assert_called_once_with({"ip": "10.0.1.23"}, "secret", "/var/www/app", "README.md", timeout=10, credential_metadata={"authType": "password"})

    def test_create_sftp_file_accepts_frontend_full_path(self):
        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.create_sftp_file") as create_file:
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {"authType": "password"}
            create_file.return_value = {"ok": True, "remotePath": "/var/www/app/README.md"}

            result = DesktopApi().create_sftp_file({"ip": "10.0.1.23"}, "cred-1", "/var/www/app/README.md")

        self.assertTrue(result["ok"])
        create_file.assert_called_once_with({"ip": "10.0.1.23"}, "secret", "/var/www/app", "README.md", timeout=10, credential_metadata={"authType": "password"})

    def test_rename_sftp_path_uses_saved_credential(self):
        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.rename_sftp_path") as rename_path:
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {}
            rename_path.return_value = {"ok": True, "newPath": "/var/www/app/app.old.log"}

            result = DesktopApi().rename_sftp_path({"ip": "10.0.1.23"}, "cred-1", "/var/www/app/app.log", "app.old.log")

        self.assertTrue(result["ok"])
        rename_path.assert_called_once_with({"ip": "10.0.1.23"}, "secret", "/var/www/app/app.log", "app.old.log", timeout=10, credential_metadata={})

    def test_rename_sftp_item_accepts_frontend_target_path(self):
        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.rename_sftp_path") as rename_path:
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {}
            rename_path.return_value = {"ok": True, "newPath": "/var/www/app/app.old.log"}

            result = DesktopApi().rename_sftp_item({"ip": "10.0.1.23"}, "cred-1", "/var/www/app/app.log", "/var/www/app/app.old.log")

        self.assertTrue(result["ok"])
        rename_path.assert_called_once_with({"ip": "10.0.1.23"}, "secret", "/var/www/app/app.log", "app.old.log", timeout=10, credential_metadata={})

    def test_delete_sftp_path_uses_saved_credential(self):
        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.delete_sftp_path") as delete_path:
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {}
            delete_path.return_value = {"ok": True, "remotePath": "/var/www/app/app.log"}

            result = DesktopApi().delete_sftp_path({"ip": "10.0.1.23"}, "cred-1", "/var/www/app/app.log", "file")

        self.assertTrue(result["ok"])
        delete_path.assert_called_once_with({"ip": "10.0.1.23"}, "secret", "/var/www/app/app.log", "file", timeout=10, credential_metadata={})

    def test_delete_sftp_item_accepts_frontend_folder_flag(self):
        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.delete_sftp_path") as delete_path:
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {}
            delete_path.return_value = {"ok": True, "remotePath": "/var/www/app/releases"}

            result = DesktopApi().delete_sftp_item({"ip": "10.0.1.23"}, "cred-1", "/var/www/app/releases", True)

        self.assertTrue(result["ok"])
        delete_path.assert_called_once_with({"ip": "10.0.1.23"}, "secret", "/var/www/app/releases", "folder", timeout=10, credential_metadata={})

    def test_read_sftp_text_file_uses_saved_credential(self):
        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.read_sftp_text_file") as read_file:
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {"authType": "password"}
            read_file.return_value = {"ok": True, "remotePath": "/etc/nginx/nginx.conf", "content": "user nginx;"}

            result = DesktopApi().read_sftp_text_file({"ip": "10.0.1.23"}, "cred-1", "/etc/nginx/nginx.conf")

        self.assertTrue(result["ok"])
        read_file.assert_called_once_with({"ip": "10.0.1.23"}, "secret", "/etc/nginx/nginx.conf", timeout=10, credential_metadata={"authType": "password"})

    def test_preview_sftp_file_uses_text_preview_bridge(self):
        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.read_sftp_text_file") as read_file:
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {"authType": "password"}
            read_file.return_value = {"ok": True, "remotePath": "/etc/nginx/nginx.conf", "content": "user nginx;"}

            result = DesktopApi().preview_sftp_file({"ip": "10.0.1.23"}, "cred-1", "/etc/nginx/nginx.conf")

        self.assertTrue(result["ok"])
        read_file.assert_called_once_with({"ip": "10.0.1.23"}, "secret", "/etc/nginx/nginx.conf", timeout=10, credential_metadata={"authType": "password"})

    def test_write_sftp_text_file_uses_saved_credential(self):
        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.write_sftp_text_file") as write_file:
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {"authType": "password"}
            write_file.return_value = {"ok": True, "remotePath": "/etc/nginx/nginx.conf", "bytes": 18}

            result = DesktopApi().write_sftp_text_file({"ip": "10.0.1.23"}, "cred-1", "/etc/nginx/nginx.conf", "worker_processes 2;", "utf-8")

        self.assertTrue(result["ok"])
        write_file.assert_called_once_with(
            {"ip": "10.0.1.23"},
            "secret",
            "/etc/nginx/nginx.conf",
            "worker_processes 2;",
            timeout=10,
            credential_metadata={"authType": "password"},
            encoding="utf-8",
        )

    def test_download_sftp_file_prompts_for_target_when_frontend_omits_local_path(self):
        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.download_sftp_file") as download_file:
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {"authType": "password"}
            download_file.return_value = {"ok": True, "remotePath": "/var/log/app.log", "localPath": "C:/Users/me/app.log"}

            with patch.object(DesktopApi, "pick_download_target", return_value="C:/Users/me/app.log") as pick_target:
                result = DesktopApi().download_sftp_file({"ip": "10.0.1.23"}, "cred-1", "/var/log/app.log")

        self.assertTrue(result["ok"])
        pick_target.assert_called_once_with("app.log")
        download_file.assert_called_once_with({"ip": "10.0.1.23"}, "secret", "/var/log/app.log", "C:/Users/me/app.log", timeout=10, credential_metadata={"authType": "password"}, overwrite=False)

    def test_download_sftp_file_passes_explicit_overwrite_choice(self):
        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.download_sftp_file") as download_file:
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {"authType": "password"}
            download_file.return_value = {"ok": True, "remotePath": "/var/log/app.log", "localPath": "C:/Users/me/app.log"}

            result = DesktopApi().download_sftp_file({"ip": "10.0.1.23"}, "cred-1", "/var/log/app.log", "C:/Users/me/app.log", True)

        self.assertTrue(result["ok"])
        download_file.assert_called_once_with({"ip": "10.0.1.23"}, "secret", "/var/log/app.log", "C:/Users/me/app.log", timeout=10, credential_metadata={"authType": "password"}, overwrite=True)

    def test_upload_sftp_file_passes_explicit_overwrite_choice(self):
        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.upload_sftp_file") as upload_file:
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {"authType": "password"}
            upload_file.return_value = {"ok": True, "remotePath": "/var/www/app/app.log", "localPath": "C:/tmp/app.log"}

            result = DesktopApi().upload_sftp_file({"ip": "10.0.1.23"}, "cred-1", "C:/tmp/app.log", "/var/www/app/app.log", True)

        self.assertTrue(result["ok"])
        upload_file.assert_called_once_with({"ip": "10.0.1.23"}, "secret", "C:/tmp/app.log", "/var/www/app/app.log", timeout=10, credential_metadata={"authType": "password"}, overwrite=True)

    def test_cancelled_sftp_download_target_is_logged_for_diagnostics(self):
        with TemporaryDirectory() as temp_dir:
            with patch("desktop_app.tool_log_path", return_value=temp_dir), patch.object(DesktopApi, "pick_download_target", return_value=""):
                result = DesktopApi().download_sftp_file({"name": "prod-web-01", "ip": "10.0.1.23"}, "cred-1", "/var/log/app.log")

            self.assertFalse(result["ok"])
            self.assertEqual(result["state"], "cancelled")
            self.assertEqual(result["remotePath"], "/var/log/app.log")
            log_text = "\n".join(path.read_text(encoding="utf-8") for path in Path(temp_dir).iterdir())
            self.assertIn('"component":"sftp"', log_text)
            self.assertIn('"action":"download_file"', log_text)
            self.assertIn('"state":"cancelled"', log_text)
            self.assertIn('"remotePath":"/var/log/app.log"', log_text)
            self.assertIn('"serverName":"prod-web-01"', log_text)

    def test_start_sftp_download_job_can_be_cancelled(self):
        api = DesktopApi()
        seen = {}

        def fake_download(server, password, remote_path, local_path, **kwargs):
            seen["cancel_event"] = kwargs.get("cancel_event")
            seen["progress_callback"] = kwargs.get("progress_callback")
            for _ in range(100):
                if seen["cancel_event"].is_set():
                    return {
                        "ok": False,
                        "cancelled": True,
                        "remotePath": remote_path,
                        "localPath": local_path,
                        "message": "传输任务已取消",
                    }
                time.sleep(0.01)
            return {"ok": True, "remotePath": remote_path, "localPath": local_path, "message": "下载完成"}

        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.download_sftp_file", side_effect=fake_download):
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {"authType": "password"}

            started = api.start_sftp_download_job(
                {"name": "prod-web-01", "ip": "10.0.1.23"},
                "cred-1",
                "/var/log/app.log",
                "C:/Users/me/app.log",
            )

            self.assertEqual(started["status"], "running")
            self.assertIn("id", started)
            self.assertIsNotNone(seen.get("cancel_event"))
            self.assertTrue(callable(seen.get("progress_callback")))

            cancelled = api.cancel_sftp_transfer_job(started["id"])

        self.assertEqual(cancelled["status"], "canceled")
        self.assertTrue(seen["cancel_event"].is_set())

    def test_cancel_sftp_transfer_job_writes_tool_log_for_diagnostics(self):
        with TemporaryDirectory() as temp_dir:
            api = DesktopApi()
            seen = {}

            def fake_download(server, password, remote_path, local_path, **kwargs):
                seen["cancel_event"] = kwargs.get("cancel_event")
                for _ in range(100):
                    if seen["cancel_event"].is_set():
                        return {
                            "ok": False,
                            "cancelled": True,
                            "remotePath": remote_path,
                            "localPath": local_path,
                            "message": "传输任务已取消",
                        }
                    time.sleep(0.01)
                return {"ok": True, "remotePath": remote_path, "localPath": local_path, "message": "下载完成"}

            with patch("desktop_app.tool_log_path", return_value=temp_dir), patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.download_sftp_file", side_effect=fake_download):
                store_class.return_value.read_secret.return_value = "secret"
                store_class.return_value.read_metadata.return_value = {"authType": "password"}

                started = api.start_sftp_download_job(
                    {"name": "prod-web-01", "ip": "10.0.1.23"},
                    "cred-1",
                    "/var/log/app.log",
                    "C:/Users/me/app.log",
                )
                cancelled = api.cancel_sftp_transfer_job(started["id"])

            self.assertEqual(cancelled["status"], "canceled")
            self.assertTrue(seen["cancel_event"].is_set())
            log_text = "\n".join(path.read_text(encoding="utf-8") for path in Path(temp_dir).iterdir())
            self.assertIn('"component":"sftp"', log_text)
            self.assertIn('"action":"cancel_transfer_job"', log_text)
            self.assertIn(f'"jobId":"{started["id"]}"', log_text)
            self.assertIn('"direction":"download"', log_text)
            self.assertIn('"remotePath":"/var/log/app.log"', log_text)
            self.assertIn('"localPath":"C:/Users/me/app.log"', log_text)

    def test_start_sftp_upload_job_can_be_cancelled(self):
        api = DesktopApi()
        seen = {}

        def fake_upload(server, password, local_path, remote_path, **kwargs):
            seen["cancel_event"] = kwargs.get("cancel_event")
            seen["progress_callback"] = kwargs.get("progress_callback")
            for _ in range(100):
                if seen["cancel_event"].is_set():
                    return {
                        "ok": False,
                        "cancelled": True,
                        "remotePath": remote_path,
                        "localPath": local_path,
                        "message": "传输任务已取消",
                    }
                time.sleep(0.01)
            return {"ok": True, "remotePath": remote_path, "localPath": local_path, "message": "上传完成"}

        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.upload_sftp_file", side_effect=fake_upload):
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {"authType": "password"}

            started = api.start_sftp_upload_job(
                {"name": "prod-web-01", "ip": "10.0.1.23"},
                "cred-1",
                "C:/Users/me/app.log",
                "/var/www/app",
            )

            self.assertEqual(started["status"], "running")
            self.assertIn("id", started)
            self.assertEqual(started["direction"], "upload")
            self.assertEqual(started["localPath"], "C:/Users/me/app.log")
            self.assertEqual(started["remotePath"], "/var/www/app")
            self.assertIsNotNone(seen.get("cancel_event"))
            self.assertTrue(callable(seen.get("progress_callback")))

            cancelled = api.cancel_sftp_transfer_job(started["id"])

        self.assertEqual(cancelled["status"], "canceled")
        self.assertTrue(seen["cancel_event"].is_set())

    def test_get_sftp_transfer_job_returns_latest_job_state(self):
        api = DesktopApi()

        with patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.download_sftp_file") as download_file:
            store_class.return_value.read_secret.return_value = "secret"
            store_class.return_value.read_metadata.return_value = {}
            download_file.return_value = {
                "ok": True,
                "remotePath": "/var/log/app.log",
                "localPath": "C:/Users/me/app.log",
                "message": "下载完成",
            }

            started = api.start_sftp_download_job(
                {"name": "prod-web-01", "ip": "10.0.1.23"},
                "cred-1",
                "/var/log/app.log",
                "C:/Users/me/app.log",
            )

            for _ in range(100):
                current = api.get_sftp_transfer_job(started["id"])
                if current["status"] == "success":
                    break
                time.sleep(0.01)

        self.assertEqual(current["status"], "success")
        self.assertTrue(current["done"])
        self.assertEqual(current["result"]["remotePath"], "/var/log/app.log")

    def test_sftp_bridge_exception_returns_failure_and_writes_tool_log(self):
        with TemporaryDirectory() as temp_dir:
            with patch("desktop_app.tool_log_path", return_value=temp_dir), patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.list_sftp_directory") as list_directory:
                store_class.return_value.read_secret.return_value = "secret"
                store_class.return_value.read_metadata.return_value = {"authType": "password"}
                list_directory.side_effect = RuntimeError("SFTP socket closed token=secret-token")

                result = DesktopApi().list_sftp_directory({"name": "prod-web-01", "ip": "10.0.1.23"}, "cred-1", "/var/www/app")

            self.assertFalse(result["ok"])
            self.assertIn("SFTP", result["message"])
            self.assertIn("日志", result["message"])
            log_text = "\n".join(path.read_text(encoding="utf-8") for path in Path(temp_dir).iterdir())
            self.assertIn("list_directory", log_text)
            self.assertIn("prod-web-01", log_text)
            self.assertNotIn("secret-token", log_text)

    def test_sftp_credential_exception_returns_failure_and_writes_tool_log(self):
        with TemporaryDirectory() as temp_dir:
            with patch("desktop_app.tool_log_path", return_value=temp_dir), patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.download_sftp_file") as download_file:
                store_class.return_value.read_secret.side_effect = FileNotFoundError("credential missing password=secret-token")

                result = DesktopApi().download_sftp_file({"name": "prod-web-01", "ip": "10.0.1.23"}, "cred-1", "/var/log/app.log", "C:/tmp/app.log")

            self.assertFalse(result["ok"])
            self.assertIn("SFTP", result["message"])
            self.assertIn("日志", result["message"])
            download_file.assert_not_called()
            log_text = "\n".join(path.read_text(encoding="utf-8") for path in Path(temp_dir).iterdir())
            self.assertIn("download_file", log_text)
            self.assertIn("prod-web-01", log_text)
            self.assertNotIn("secret-token", log_text)

    def test_sftp_tool_log_context_uses_safe_connection_fields_without_credential_refs(self):
        with TemporaryDirectory() as temp_dir:
            with patch("desktop_app.tool_log_path", return_value=temp_dir), patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.upload_sftp_file") as upload_file:
                store_class.return_value.read_secret.return_value = "ServerPassword!123"
                store_class.return_value.read_metadata.return_value = {"authType": "password"}
                upload_file.side_effect = RuntimeError("SFTP upload failed token=secret-token")

                result = DesktopApi().upload_sftp_file(
                    {
                        "name": "prod-web-01",
                        "ip": "10.0.1.23",
                        "port": "2222",
                        "user": "root",
                        "authType": "password",
                        "timeoutSeconds": 24,
                        "keepaliveSeconds": 45,
                        "retryCount": 2,
                        "proxyJump": "jump@bastion:22",
                        "credentialRef": "sshcred-prod",
                    },
                    "sshcred-prod",
                    "C:/tmp/app.log",
                    "/var/www/app/app.log",
                )

            self.assertFalse(result["ok"])
            log_text = "\n".join(path.read_text(encoding="utf-8") for path in Path(temp_dir).iterdir())
            self.assertIn('"serverName":"prod-web-01"', log_text)
            self.assertIn('"host":"10.0.1.23"', log_text)
            self.assertIn('"port":2222', log_text)
            self.assertIn('"user":"root"', log_text)
            self.assertIn('"authType":"password"', log_text)
            self.assertIn('"timeoutSeconds":24', log_text)
            self.assertIn('"keepaliveSeconds":45', log_text)
            self.assertIn('"retryCount":2', log_text)
            self.assertIn('"proxyJump":"jump@bastion:22"', log_text)
            self.assertIn('"remotePath":"/var/www/app/app.log"', log_text)
            self.assertNotIn("ServerPassword!123", log_text)
            self.assertNotIn("secret-token", log_text)
            self.assertNotIn("sshcred-prod", log_text)
            self.assertNotIn("credentialRef", log_text)

    def test_sftp_text_save_failure_returns_action_specific_diagnostics(self):
        with TemporaryDirectory() as temp_dir:
            with patch("desktop_app.tool_log_path", return_value=temp_dir), patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.write_sftp_text_file") as write_file:
                store_class.return_value.read_secret.return_value = "ServerPassword!123"
                store_class.return_value.read_metadata.return_value = {"authType": "password"}
                write_file.side_effect = RuntimeError("write failed token=secret-token")

                result = DesktopApi().write_sftp_text_file(
                    {"name": "prod-web-01", "ip": "10.0.1.23"},
                    "sshcred-prod",
                    "/etc/nginx/nginx.conf",
                    "worker_processes 2;",
                    "utf-8",
                )

            self.assertFalse(result["ok"])
            self.assertIn("SFTP 文件保存失败", result["message"])
            self.assertEqual(result["remotePath"], "/etc/nginx/nginx.conf")
            self.assertEqual(result["encoding"], "utf-8")
            self.assertEqual(result["contentLength"], len("worker_processes 2;"))

            log_text = "\n".join(path.read_text(encoding="utf-8") for path in Path(temp_dir).iterdir())
            self.assertIn("write_text_file", log_text)
            self.assertIn('"encoding":"utf-8"', log_text)
            self.assertIn('"contentLength":19', log_text)
            self.assertNotIn("worker_processes 2", log_text)
            self.assertNotIn("ServerPassword!123", log_text)
            self.assertNotIn("secret-token", log_text)

    def test_sftp_create_file_failure_returns_action_specific_diagnostics(self):
        with TemporaryDirectory() as temp_dir:
            with patch("desktop_app.tool_log_path", return_value=temp_dir), patch("desktop_app.CredentialStore") as store_class, patch("desktop_app.create_sftp_file") as create_file:
                store_class.return_value.read_secret.return_value = "ServerPassword!123"
                store_class.return_value.read_metadata.return_value = {"authType": "password"}
                create_file.side_effect = RuntimeError("create failed token=secret-token")

                result = DesktopApi().create_sftp_file(
                    {"name": "prod-web-01", "ip": "10.0.1.23"},
                    "sshcred-prod",
                    "/var/www/app",
                    "README.md",
                )

            self.assertFalse(result["ok"])
            self.assertIn("SFTP 文件创建失败", result["message"])
            self.assertEqual(result["parentPath"], "/var/www/app")
            self.assertEqual(result["fileName"], "README.md")

            log_text = "\n".join(path.read_text(encoding="utf-8") for path in Path(temp_dir).iterdir())
            self.assertIn("create_file", log_text)
            self.assertIn('"parentPath":"/var/www/app"', log_text)
            self.assertIn('"fileName":"README.md"', log_text)
            self.assertNotIn("ServerPassword!123", log_text)
            self.assertNotIn("secret-token", log_text)


if __name__ == "__main__":
    unittest.main()
