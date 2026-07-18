# ShellPilot

ShellPilot is a Windows-first SSH, SFTP, and AI-assisted operations client. It combines a mature terminal experience with server inspection, safe changes, backups, rollback records, and configurable model APIs.

## Main Features

- SSH terminal sessions with passwords, private keys, certificates, jump hosts, port forwarding, tabs, search, and common terminal shortcuts.
- SFTP file management with upload, download, preview, drag and drop, collision-safe backups, and restore records.
- AI assistant with multiple API profiles and models, persistent conversation context, attachments, SFTP references, MCP, and CLI integrations.
- Single-server and fleet status views for services, processes, ports, firewall, network interfaces, CPU, memory, disks, and installed platforms.
- Read-only diagnosis plans, cancellable tasks, operation audit records, automatic pre-change backups, and one-click rollback.
- Approved online updates with user-selectable sources and automatic fallback between domestic and GitHub release sources.

## Quick Start

1. Download the latest Windows installer from [ShellPilot Releases](https://github.com/lx3559359/ssh-agent-tool/releases).
2. Create or import an SSH connection and verify the host fingerprint before connecting.
3. Configure an AI API only when AI analysis is needed. SSH and SFTP remain usable without an AI configuration.
4. Review generated commands and rollback information before approving any change to a server.

The complete Chinese user guide is available in [docs/USER_GUIDE_ZH.md](docs/USER_GUIDE_ZH.md).

## Development

Requirements: Node.js and npm on Windows.

```bash
npm install
npm run dev
```

Common verification commands:

```bash
npm run lint
npm run test-unit-ci
npm run build
```

## Releases and Updates

Client updates are visible only after a release has been explicitly approved and published. Release notes use the following sections:

- `[Added]`
- `[Fixed]`
- `[Changed]`

Users can choose an update source. Automatic mode tries the configured domestic source first and falls back to GitHub when the candidate is unavailable or invalid.

## Security

- Credentials and API keys are stored locally and are never included in exported diagnostic reports by default.
- Read-only checks do not create rollback records.
- Risky operations require confirmation, create a backup when possible, and expose a rollback entry in the Safety Center.
- Keep an independent console or cloud control channel available before changing network, firewall, SSH, or privilege settings.

Report product issues through [GitHub Issues](https://github.com/lx3559359/ssh-agent-tool/issues).

## License

See [LICENSE](LICENSE). Required third-party license notices and historical copyright attribution are retained in their legal files.
