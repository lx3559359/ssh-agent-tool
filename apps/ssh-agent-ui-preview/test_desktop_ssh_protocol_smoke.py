import socket
import threading
import time
import unittest

import paramiko

from ssh_session import format_host_key_fingerprint
from ssh_interactive import SshSessionManager


class _PasswordShellServer(paramiko.ServerInterface):
    def __init__(self, username: str, password: str):
        self.username = username
        self.password = password
        self.shell_requested = threading.Event()
        self.pty_requested = threading.Event()

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

    def check_channel_pty_request(self, _channel, _term, _width, _height, _pixelwidth, _pixelheight, _modes):
        self.pty_requested.set()
        return True

    def check_channel_shell_request(self, _channel):
        self.shell_requested.set()
        return True


class _LocalSshServer:
    def __init__(self, username="tester", password="secret"):
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
            raise RuntimeError("local SSH server did not start")
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

    def _run(self):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(("127.0.0.1", 0))
                sock.listen(5)
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
                    self._handle_client(client)
        except Exception as error:
            self.error = error
            self._ready.set()

    def _handle_client(self, client):
        transport = paramiko.Transport(client)
        try:
            transport.add_server_key(self._host_key)
            server = _PasswordShellServer(self.username, self.password)
            transport.start_server(server=server)
            channel = transport.accept(10)
            if channel is None:
                return
            if not server.shell_requested.wait(10):
                return
            self._serve_shell(channel)
        finally:
            try:
                transport.close()
            except Exception:
                pass

    def _serve_shell(self, channel):
        channel.settimeout(0.2)
        buffer = ""
        sleeping = False
        channel.send("SSH Agent Tool test shell\r\n$ ")
        while not self._stop.is_set():
            try:
                data = channel.recv(1024)
            except socket.timeout:
                continue
            except Exception:
                break
            if not data:
                break
            text = data.decode("utf-8", errors="replace")
            if "\x03" in text:
                sleeping = False
                buffer = ""
                channel.send("^C\r\n$ ")
                continue
            buffer += text.replace("\r", "\n")
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                command = line.strip()
                if not command:
                    channel.send("$ ")
                elif command == "echo ssh-agent-smoke-ok":
                    channel.send("ssh-agent-smoke-ok\r\n$ ")
                elif command == "sleep 30":
                    sleeping = True
                elif command == "exit":
                    channel.send("logout\r\n")
                    channel.close()
                    return
                else:
                    channel.send(f"unknown command: {command}\r\n$ ")
            if sleeping:
                time.sleep(0.02)


class SshProtocolSmokeTests(unittest.TestCase):
    def test_interactive_session_supports_enter_output_interrupt_health_and_close(self):
        with _LocalSshServer() as sshd:
            manager = SshSessionManager()
            opened = manager.open_session(
                {
                    "name": "local-smoke",
                    "ip": "127.0.0.1",
                    "port": sshd.port,
                    "user": sshd.username,
                    "authType": "password",
                    "keepaliveSeconds": 10,
                    "trustedHostKey": sshd.trusted_host_key(),
                },
                sshd.password,
                timeout=5,
                credential_metadata={"authType": "password"},
                terminal_size={"cols": 100, "rows": 30},
            )

            self.assertTrue(opened["ok"], opened)
            session_id = opened["sessionId"]
            try:
                health = manager.check_session_health(session_id)
                self.assertTrue(health["ok"], health)
                self.assertTrue(health["active"])

                echoed = manager.send_input(session_id, "echo ssh-agent-smoke-ok", submit=True)
                self.assertTrue(echoed["ok"], echoed)
                self.assertIn("ssh-agent-smoke-ok", echoed.get("output", ""))

                sleeping = manager.send_input(session_id, "sleep 30", submit=True)
                self.assertTrue(sleeping["ok"], sleeping)

                interrupted = manager.interrupt_command(session_id)
                self.assertTrue(interrupted["ok"], interrupted)
                self.assertIn("^C", interrupted.get("output", ""))

                output = manager.read_output(session_id)
                self.assertTrue(output["ok"], output)
            finally:
                closed = manager.close_session(session_id)

            self.assertTrue(closed["ok"], closed)
            self.assertNotIn(session_id, manager.sessions)


if __name__ == "__main__":
    unittest.main()
