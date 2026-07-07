import stat
import inspect
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.api import ssh_routes
from backend.api.ws_agent import AgentWSHandler
from backend.ssh.file_transfer import SSHFileExistsError, SSHFileTransfer, SSHFileTransferError
from backend.ssh.models import SSHConnection
from backend.ssh.transfer_jobs import TransferJobManager


class FakeClient:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class FakeSftp:
    def __init__(self):
        self.listdir_calls = []
        self.removed_files = []
        self.removed_dirs = []
        self.closed = False

    def stat(self, remote_path):
        if remote_path == "/var/www/app/releases":
            return SimpleNamespace(st_mode=stat.S_IFDIR | 0o755)
        if remote_path == "/var/www/app/releases/app.log":
            return SimpleNamespace(st_mode=stat.S_IFREG | 0o644)
        raise FileNotFoundError(remote_path)

    def normalize(self, remote_path):
        return "/" if remote_path == "." else remote_path

    def listdir_attr(self, remote_path):
        self.listdir_calls.append(remote_path)
        return [SimpleNamespace(filename="app.log", st_mode=stat.S_IFREG | 0o644)]

    def remove(self, remote_path):
        self.removed_files.append(remote_path)

    def rmdir(self, remote_path):
        self.removed_dirs.append(remote_path)
        raise OSError("Directory not empty")

    def close(self):
        self.closed = True


def test_delete_paths_does_not_recursively_delete_non_empty_directories(monkeypatch):
    fake_client = FakeClient()
    fake_sftp = FakeSftp()

    monkeypatch.setattr(SSHFileTransfer, "_connect", classmethod(lambda cls, conn: (fake_client, fake_sftp)))

    with pytest.raises(SSHFileTransferError):
        SSHFileTransfer.delete_paths(
            SSHConnection(host="10.0.1.23", username="root", password="secret"),
            ["/var/www/app/releases"],
        )

    assert fake_sftp.listdir_calls == []
    assert fake_sftp.removed_files == []
    assert fake_sftp.removed_dirs == ["/var/www/app/releases"]
    assert fake_sftp.closed is True
    assert fake_client.closed is True


def test_download_to_local_file_refuses_existing_local_target_before_connecting(monkeypatch):
    local_dir = Path(__file__).resolve().parents[1] / ".tmp" / "file-transfer-safety"
    local_dir.mkdir(parents=True, exist_ok=True)
    local_file = local_dir / f"{uuid.uuid4().hex}-app.log"
    local_file.write_text("existing", encoding="utf-8")

    def fail_connect(cls, conn):
        raise AssertionError("download should not open SFTP before local overwrite is approved")

    monkeypatch.setattr(SSHFileTransfer, "_connect", classmethod(fail_connect))

    with pytest.raises(SSHFileExistsError):
        SSHFileTransfer.download_to_local_file(
            SSHConnection(host="10.0.1.23", username="root", password="secret"),
            "/var/log/app.log",
            str(local_file),
        )

    try:
        assert local_file.read_text(encoding="utf-8") == "existing"
    finally:
        local_file.unlink(missing_ok=True)


def test_ws_agent_upload_passes_overwrite_as_keyword_argument():
    source = inspect.getsource(AgentWSHandler._m_ssh_upload)

    assert "overwrite=bool(p.get(\"overwrite\", False))" in source


def test_transfer_job_manager_can_cancel_running_job():
    with TransferJobManager._lock:
        TransferJobManager._jobs.clear()

    job = TransferJobManager._create_job(
        direction="download",
        file_name="app.log",
        remote_path="/var/log/app.log",
        local_path="C:/Temp/app.log",
    )
    TransferJobManager._update_progress(job.id, 10, 100)

    canceled = TransferJobManager.cancel(job.id)

    assert canceled is not None
    assert canceled["status"] == "canceled"
    assert canceled["done"] is True
    assert TransferJobManager.cancel("missing-job") is None


def test_transfer_job_cancel_state_is_not_overwritten_by_late_callbacks():
    with TransferJobManager._lock:
        TransferJobManager._jobs.clear()

    job = TransferJobManager._create_job(
        direction="upload",
        file_name="app.log",
        remote_path="/var/log/app.log",
        local_path="C:/Temp/app.log",
    )

    TransferJobManager.cancel(job.id)
    TransferJobManager._update_progress(job.id, 90, 100)
    TransferJobManager._mark_success(job.id)
    TransferJobManager._mark_error(job.id, "late error")

    stored = TransferJobManager.get_job(job.id)
    assert stored is not None
    assert stored["status"] == "canceled"
    assert stored["progress"] == 0.0
    assert stored["error"] != "late error"


def test_ssh_routes_expose_transfer_job_cancel_endpoint():
    source = inspect.getsource(ssh_routes)

    assert '@router.delete("/connections/{conn_id}/transfer/jobs/{job_id}")' in source
    assert "TransferJobManager.cancel(job_id)" in source
