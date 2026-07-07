# Prototype Instructions

Run the local server yourself and open the preview in the in-app browser. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Confirmed Product Direction

- The first desktop UI direction is SSH-terminal-first: the SSH terminal is the primary workspace.
- AI chat and Agent controls are supporting surfaces, docked on the right side by default.
- The Agent surface must support conversation, plan preview, execution approval, evidence, and report tabs.
- The UI must stay fully Chinese.
- The model layer must allow users to configure major model APIs, OpenAI-compatible APIs, local models, and relay/midpoint APIs.
- The UI should feel like a Windows desktop exe, not a web page: no global browser-like top toolbar, no oversized global search, and no redundant terminal command bar outside the SSH terminal itself.
- The left side should stay compact and focus on server assets plus SFTP file operations.
- The middle is the SSH terminal.
- The right side owns AI conversation, Agent execution, model API settings, policy, evidence, and reports.
- Future UI/code changes should be incremental patches on the current prototype. Avoid full rewrites unless the user explicitly asks for a replacement.
- Agent must be treated as an extensible framework, not a fixed set of hard-coded diagnosis actions. The UI should support adding custom Skills, connecting MCP servers/tools, and registering CLI tools.
- SSH fundamentals must stay first-class: host management, connect/disconnect/reconnect, auth/key management, terminal sessions, SFTP upload/download, file browsing, port forwarding, and command/audit policy.
- SSH server information backup/export must be supported. Sensitive fields such as passwords, private keys, tokens, and passphrases should not be exported in plaintext by default; provide encrypted export with an explicit master password and clear scope selection.
