import unittest
from unittest.mock import patch

import desktop_app
from desktop_app import DesktopApi


class FakeCredentialStore:
    def read_secret(self, credential_ref):
        return "secret"

    def read_metadata(self, credential_ref):
        return {"authType": "password"}


class FakeSshSessions:
    def __init__(self):
        self.opened = []
        self.results = [{"ok": True, "sessionId": "session-1"}]

    def open_session(self, server, password, timeout=10, credential_metadata=None):
        self.opened.append((server, password, timeout, credential_metadata))
        return self.results[min(len(self.opened) - 1, len(self.results) - 1)]


class DesktopConnectionTimeoutTests(unittest.TestCase):
    def test_run_ssh_readonly_command_uses_server_timeout(self):
        with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeCredentialStore()):
            with patch.object(desktop_app, "run_readonly_command") as run_command:
                run_command.return_value = {"ok": True}

                result = DesktopApi().run_ssh_readonly_command(
                    {"ip": "10.0.1.23", "timeoutSeconds": "25"},
                    "cred-1",
                    "whoami",
                )

        self.assertTrue(result["ok"])
        run_command.assert_called_once_with(
            {"ip": "10.0.1.23", "timeoutSeconds": "25", "retryCount": 0},
            "secret",
            "whoami",
            timeout=25,
            credential_metadata={"authType": "password"},
        )

    def test_open_ssh_session_uses_clamped_server_timeout(self):
        sessions = FakeSshSessions()
        with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeCredentialStore()):
            api = DesktopApi()
            api._ssh_sessions = sessions

            result = api.open_ssh_session({"ip": "10.0.1.23", "timeoutSeconds": "120"}, "cred-1")

        self.assertTrue(result["ok"])
        self.assertEqual(sessions.opened[0][2], 60)

    def test_open_ssh_session_uses_identity_file_without_saved_credential(self):
        sessions = FakeSshSessions()
        with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeCredentialStore()):
            api = DesktopApi()
            api._ssh_sessions = sessions

            result = api.open_ssh_session({"ip": "10.0.1.23", "identityFile": "~/.ssh/prod"}, "")

        self.assertTrue(result["ok"])
        self.assertEqual(sessions.opened[0][1], "")
        self.assertEqual(sessions.opened[0][3]["authType"], "私钥")
        self.assertEqual(sessions.opened[0][3]["identityFile"], "~/.ssh/prod")

    def test_open_ssh_session_uses_ssh_agent_without_saved_credential(self):
        sessions = FakeSshSessions()
        with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeCredentialStore()):
            api = DesktopApi()
            api._ssh_sessions = sessions

            result = api.open_ssh_session({"ip": "10.0.1.23", "authType": "SSH Agent"}, "")

        self.assertTrue(result["ok"])
        self.assertEqual(sessions.opened[0][1], "")
        self.assertEqual(sessions.opened[0][3]["authType"], "SSH Agent")

    def test_run_ssh_readonly_command_retries_failed_results(self):
        with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeCredentialStore()):
            with patch.object(desktop_app, "run_readonly_command") as run_command:
                run_command.side_effect = [{"ok": False, "message": "timed out"}, {"ok": True, "stdout": "root\n"}]

                result = DesktopApi().run_ssh_readonly_command(
                    {"ip": "10.0.1.23", "retryCount": "1"},
                    "cred-1",
                    "whoami",
                )

        self.assertTrue(result["ok"])
        self.assertEqual(run_command.call_count, 2)
        self.assertEqual([call.args[0].get("retryCount") for call in run_command.call_args_list], [0, 0])

    def test_open_ssh_session_retries_failed_results(self):
        sessions = FakeSshSessions()
        sessions.results = [{"ok": False, "message": "timed out"}, {"ok": True, "sessionId": "session-1"}]
        with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeCredentialStore()):
            api = DesktopApi()
            api._ssh_sessions = sessions

            result = api.open_ssh_session({"ip": "10.0.1.23", "retryCount": "9"}, "cred-1")

        self.assertTrue(result["ok"])
        self.assertEqual(len(sessions.opened), 2)
        self.assertEqual([entry[0].get("retryCount") for entry in sessions.opened], [0, 0])


if __name__ == "__main__":
    unittest.main()
