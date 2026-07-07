import unittest
import threading
from unittest.mock import patch

from local_cli_runner import normalize_local_cli_command, run_local_cli_command, validate_local_cli_command


class FakeCompleted:
    def __init__(self, returncode=0, stdout="out", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class LocalCliRunnerTests(unittest.TestCase):
    def test_normalizes_local_cli_prefixes(self):
        self.assertEqual(normalize_local_cli_command("local:ssh-ai diagnose --json"), "ssh-ai diagnose --json")
        self.assertEqual(normalize_local_cli_command("cli://local/ssh-ai diagnose"), "ssh-ai diagnose")

    def test_validation_rejects_shell_operators_and_dangerous_launchers(self):
        self.assertFalse(validate_local_cli_command("ssh-ai diagnose; rm -rf /")["ok"])
        self.assertFalse(validate_local_cli_command("powershell -Command Get-Process")["ok"])
        self.assertTrue(validate_local_cli_command("ssh-ai diagnose --json")["ok"])

    def test_runs_without_shell_and_captures_output(self):
        calls = []

        def fake_runner(args, **kwargs):
            calls.append((args, kwargs))
            return FakeCompleted(returncode=0, stdout="ok", stderr="")

        result = run_local_cli_command("local:ssh-ai diagnose --json", runner=fake_runner, timeout=9)

        self.assertTrue(result["ok"])
        self.assertEqual(calls[0][0], ["ssh-ai", "diagnose", "--json"])
        self.assertFalse(calls[0][1]["shell"])
        self.assertEqual(calls[0][1]["timeout"], 9)
        self.assertEqual(result["stdout"], "ok")

    def test_windows_local_cli_runs_without_console_window(self):
        calls = []

        def fake_runner(args, **kwargs):
            calls.append((args, kwargs))
            return FakeCompleted(returncode=0, stdout="ok", stderr="")

        with patch("local_cli_runner.sys.platform", "win32"), patch("local_cli_runner.subprocess.CREATE_NO_WINDOW", 0x08000000, create=True):
            result = run_local_cli_command("local:ssh-ai diagnose --json", runner=fake_runner)

        self.assertTrue(result["ok"])
        self.assertEqual(calls[0][1]["creationflags"], 0x08000000)

    def test_failed_command_returns_stderr_and_return_code(self):
        def fake_runner(args, **kwargs):
            return FakeCompleted(returncode=2, stdout="", stderr="bad")

        result = run_local_cli_command("local:ssh-ai diagnose", runner=fake_runner)

        self.assertFalse(result["ok"])
        self.assertEqual(result["returnCode"], 2)
        self.assertEqual(result["stderr"], "bad")

    def test_cancel_event_terminates_running_process(self):
        class FakeProcess:
            returncode = None

            def __init__(self):
                self.killed = False

            def poll(self):
                return None

            def kill(self):
                self.killed = True
                self.returncode = -9

            def communicate(self, timeout=None):
                return ("partial", "")

        cancel_event = threading.Event()
        cancel_event.set()
        process = FakeProcess()

        result = run_local_cli_command(
            "local:ssh-ai diagnose",
            cancel_event=cancel_event,
            popen_factory=lambda *_args, **_kwargs: process,
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["returnCode"], 130)
        self.assertTrue(process.killed)
        self.assertIn("已取消", result["message"])

    def test_windows_cancellable_local_cli_runs_without_console_window(self):
        class FakeProcess:
            returncode = 0

            def poll(self):
                return 0

            def communicate(self, timeout=None):
                return ("ok", "")

        calls = []

        def fake_popen(args, **kwargs):
            calls.append((args, kwargs))
            return FakeProcess()

        with patch("local_cli_runner.sys.platform", "win32"), patch("local_cli_runner.subprocess.CREATE_NO_WINDOW", 0x08000000, create=True):
            result = run_local_cli_command("local:ssh-ai diagnose", cancel_event=threading.Event(), popen_factory=fake_popen)

        self.assertTrue(result["ok"])
        self.assertEqual(calls[0][1]["creationflags"], 0x08000000)

    def test_builtin_ssh_diagnostic_uses_tcp_probe_without_subprocess(self):
        class FakeSocket:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        calls = []

        def fake_connect(address, timeout):
            calls.append((address, timeout))
            return FakeSocket()

        def fake_runner(args, **kwargs):
            raise AssertionError("built-in SSH diagnostic must not launch subprocess")

        with patch("socket.create_connection", side_effect=fake_connect):
            result = run_local_cli_command(
                "local:ssh-agent-tool diagnose-ssh --host 10.0.1.23 --port 2222 --kind timeout",
                runner=fake_runner,
                timeout=7,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(calls, [(("10.0.1.23", 2222), 7)])
        self.assertIn("SSH TCP 探测成功", result["stdout"])
        self.assertIn("10.0.1.23:2222", result["stdout"])


if __name__ == "__main__":
    unittest.main()
