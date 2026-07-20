export const shellpilotEnglishHelpItems = Object.freeze([
  {
    key: 'start',
    labelKey: 'shellpilotHelpStart',
    intro: 'Use this order for a safe first-time setup.',
    steps: [
      'Click New, then enter the server address, SSH port, account, and authentication details.',
      'Test the connection before saving it.',
      'Open the SSH session and begin with read-only commands such as uptime or df -h.',
      'Use SFTP for files and the AI Assistant for guided troubleshooting.',
      'Back up important data before changes and prefer operations with preview, confirmation, and recovery.'
    ],
    warning: 'Verify the host fingerprint on first connection and never save production passwords on a public computer.'
  },
  {
    key: 'servers',
    labelKey: 'shellpilotHelpServers',
    intro: 'New and Servers let you create, group, and reuse SSH connections.',
    tips: [
      'Use a recognizable name; the host can be an IP address or domain, and SSH commonly uses port 22.',
      'Double-click a saved server to connect, or use its context menu to edit, copy, or delete it.',
      'Connection Information shows the saved host, port, account, and authentication method.',
      'If a connection fails, check the address, port, firewall, account, authentication, and sshd service.'
    ]
  },
  {
    key: 'auth',
    labelKey: 'shellpilotHelpAuth',
    intro: 'ShellPilot supports passwords, private keys, and SSH Agent authentication.',
    tips: [
      'Prefer key authentication for production systems.',
      'Encrypted private keys also require their passphrase.',
      'Never share private keys through chat, email, or screenshots.',
      'Treat an unexpected host fingerprint change as a security warning until verified.'
    ]
  },
  {
    key: 'terminal',
    labelKey: 'shellpilotHelpTerminal',
    intro: 'Read-only commands run normally; recognized changes use recovery or risk confirmation when available.',
    tips: [
      'Use Ctrl+C to interrupt a command and the configured copy and paste shortcuts for terminal text.',
      'Multiple tabs, split panes, search, session logs, and context-menu actions are supported.',
      'Use tmux, screen, or nohup for long-running work that must survive a network interruption.',
      'AI, quick commands, and manual input all remain subject to the same safety classification.'
    ]
  },
  {
    key: 'terminal-recovery',
    labelKey: 'shellpilotHelpTerminalRecovery',
    intro: 'Before a supported one-line change is sent, ShellPilot can prepare and verify a recovery point.',
    tips: [
      'Only statically understood effects can receive automatic recovery.',
      'Interactive editors, dynamic scripts, aliases, and unknown executables may require risk confirmation without rollback.',
      'A recovery record is bound to the original host, port, account, and session capability.',
      'Automatic recovery does not replace application, database, or cloud snapshots.'
    ]
  },
  {
    key: 'server-status',
    labelKey: 'shellpilotHelpServerStatus',
    intro: 'Server Status runs an on-demand read-only inspection of the connected SSH server.',
    tips: [
      'It summarizes system, resource, service, network, firewall, security, and container information.',
      'Custom platform rules can group internal services without modifying the server.',
      'AI Diagnosis creates a read-only plan that must be reviewed before any remote command runs.',
      'Reports are bounded and redacted, but should still be reviewed before sharing with AI.'
    ]
  },
  {
    key: 'sftp',
    labelKey: 'shellpilotHelpSftp',
    intro: 'SFTP provides local and remote file browsing and transfer controls.',
    tips: [
      'Upload, download, copy, move, rename, permission changes, previews, and deletion are supported.',
      'Supported remote changes create bounded snapshots and verify the result.',
      'Downloads only change the local destination and are not remote rollback operations.',
      'Use Quick Backup before deleting, overwriting, or moving important files.'
    ]
  },
  {
    key: 'safety',
    labelKey: 'shellpilotHelpSafety',
    intro: 'The Safety Center collects running tasks, verified recovery points, history, and legacy records.',
    tips: [
      'Filter by server, source, status, or search text.',
      'Cancelling a task requests command termination; it does not automatically roll back completed effects.',
      'Rollback is allowed only when the original endpoint and recovery binding still match.',
      'Keep an out-of-band console and independent backup for production changes.'
    ],
    warning: 'Network, firewall, SSH port, and routing changes can disconnect the session immediately.'
  },
  {
    key: 'ai-api',
    labelKey: 'shellpilotHelpModelApi',
    intro: 'Model API settings support official providers, local models, and OpenAI-compatible gateways.',
    steps: [
      'Choose a provider template or enter the API address and key.',
      'Fetch the model list, choose a default model, and test the connection.',
      'Save the profile, then select it and its model in the AI Assistant.'
    ]
  },
  {
    key: 'ai',
    labelKey: 'shellpilotHelpAi',
    intro: 'The AI Assistant explains output, analyzes logs, and helps organize troubleshooting steps.',
    tips: [
      'Chat is for questions; Agent mode can use approved terminal, file, Skill, MCP, or CLI context.',
      'Terminal, selection, and file references only include the content you choose.',
      'Generated commands are suggestions and must be reviewed before execution.',
      'Verify critical conclusions against logs, terminal output, and official documentation.'
    ]
  },
  {
    key: 'ai-takeover',
    labelKey: 'shellpilotHelpAiTakeover',
    intro: 'AI Takeover is disabled by default and enabled independently for each verified SSH session.',
    tips: [
      'Read-only checks run first; risky operations still require detailed confirmation.',
      'Stop Now, disconnecting, or restarting revokes the current session authorization.',
      'User-created or imported Skills begin as disabled drafts and must be reviewed before enabling.',
      'Declared Skill permissions never bypass session safety policy or confirmation.'
    ],
    warning: 'Keep independent backups and an out-of-band recovery path for critical production changes.'
  },
  {
    key: 'large-logs',
    labelKey: 'shellpilotHelpLargeLogs',
    intro: 'Search and read large logs in bounded sections instead of sending everything at once.',
    tips: [
      'Focus on the failure time, error code, service, or request ID.',
      'Compressed log archives are supported, but very large archives should be narrowed first.',
      'Remove passwords, tokens, cookies, customer data, and private addresses before sharing.'
    ]
  },
  {
    key: 'commands',
    labelKey: 'shellpilotHelpCommands',
    intro: 'Quick Commands provide guided forms for common maintenance and troubleshooting work.',
    tips: [
      'Review purpose, advanced notes, parameters, and the final command preview.',
      'Read-only queries do not create rollback records.',
      'Change operations show risk and recovery details before execution.',
      'If no recovery point can be created, make an independent backup before proceeding.'
    ]
  },
  {
    key: 'forwarding',
    labelKey: 'shellpilotHelpForwarding',
    intro: 'Port forwarding links local, remote, or SOCKS listeners to an SSH session.',
    tips: [
      'Local forwarding exposes a remote-side service through a local port.',
      'Remote forwarding exposes a local service through the remote server.',
      'Dynamic forwarding creates a SOCKS proxy.',
      'Avoid exposing databases or administration interfaces to public addresses.'
    ]
  },
  {
    key: 'extensions',
    labelKey: 'shellpilotHelpExtensions',
    intro: 'MCP, CLI, and Skills extend Agent workflows and should be enabled only from trusted sources.',
    tips: [
      'Limit accessible directories, commands, and data.',
      'Review parameters before running external tools.',
      'Never send passwords, private keys, or API keys to unknown services.'
    ]
  },
  {
    key: 'sync',
    labelKey: 'shellpilotHelpSync',
    intro: 'Backup & Sync can move client configuration between computers.',
    tips: [
      'Use strong encryption for backups that contain credentials or private-key information.',
      'Back up the current configuration before importing another one.',
      'Never upload an unencrypted backup to public storage, repositories, or chat.',
      'After migration, verify hosts, ports, accounts, key paths, and model API profiles.'
    ]
  },
  {
    key: 'update',
    labelKey: 'shellpilotHelpUpdate',
    intro: 'Check for Updates shows the current version, release notes, download progress, and source.',
    tips: [
      'Automatic selection prefers the regional ModelScope mirror and falls back to GitHub.',
      'Only locally verified and explicitly approved releases are offered as updates.',
      'Save active command and transfer work before restarting to install.'
    ]
  },
  {
    key: 'settings',
    labelKey: 'shellpilotHelpSettings',
    intro: 'Use the top-bar Light/Dark action for a quick switch and Settings for complete appearance controls.',
    tips: [
      'UI fonts and terminal fonts are configured independently.',
      'The SSH terminal background remains black across UI themes.',
      'Check keyboard shortcut conflicts with Windows, input methods, and terminal applications.',
      'Restore the relevant setting to default if a visual configuration becomes unusable.'
    ]
  },
  {
    key: 'logs',
    labelKey: 'shellpilotHelpLogs',
    intro: 'Application logs help diagnose startup, SSH, AI, SFTP, and update problems.',
    steps: [
      'Record the failure time, actions, server type, and complete error message.',
      'Search the log around that time for error, failed, or exception.',
      'Reproduce once while checking the network and server state.',
      'Export diagnostics with the version and reproduction steps when reporting a problem.'
    ]
  }
])
