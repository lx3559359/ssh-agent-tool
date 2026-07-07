# Electerm / Tabby Recheck

Date: 2026-07-07

## Reason

The previous self-built SSH client prototype did not meet formal SSH client expectations. It has been removed from the repository and the formal product must be based on a mature open-source SSH client.

## Decision

Primary base: Electerm.

Fallback/reference: Tabby.

## Electerm Evidence

- Repository: https://github.com/electerm/electerm
- License: MIT.
- Local snapshot: `2db0c56`.
- Latest local commit subject: `2026-07-07 16:35:34 +0800 Update logo`.
- Desktop stack: Electron, React, Vite, Ant Design.
- Terminal stack: xterm.js and node-pty.
- SSH/SFTP stack: `@electerm/ssh2`, `ssh2-scp`, SFTP/file-transfer modules.
- Existing MCP bridge evidence:
  - `external/electerm/src/app/widgets/widget-mcp-server.js`
  - `external/electerm/src/client/store/mcp-handler.js`
- Existing MCP bridge includes terminal command send/cancel/output/status, SSH tab creation, bookmark listing, and SFTP list/stat/read/upload/download.

## Tabby Evidence

- Repository: https://github.com/Eugeny/tabby
- License: MIT.
- Local snapshot: `6955c4f`.
- Latest local commit subject: `2026-06-29 00:43:53 +0200 another attempt at tab blanking/flicker`.
- Desktop stack: Electron and Angular monorepo.
- Strength: mature terminal and plugin architecture.
- Reason not first base: less direct fit for SSH+SFTP file-manager-first workflow and a larger integration surface.

## Product Impact

The formal client will be rebuilt from Electerm. Reuse the product lessons from the old prototype only as requirements, then implement them on Electerm's SSH, SFTP, terminal, tab, shortcut, update, and MCP foundations.
