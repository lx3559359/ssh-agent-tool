# Electerm Agent Migration

Base: Electerm
Imported from: https://github.com/electerm/electerm
Import date: 2026-07-07
Initial upstream snapshot: 2db0c56

## Product Rules

- Preserve upstream SSH, SFTP, terminal, tab, shortcut, and file-transfer behavior.
- Add Agent features beside existing flows instead of rewriting SSH internals.
- Keep product-specific code under `src/app/agent`, `src/client/components/ai-assistant`, and `src/client/store/agent-*`.
- Keep Chinese UI copy in localization files where Electerm already supports localization.
- Use Electerm's MCP bridge and terminal context APIs before introducing new IPC contracts.

## Historical Prototype Lessons

The previous self-built prototype has been removed from the repository. Its role was requirement discovery only; do not reintroduce it as a client base.

Preserve only these product lessons while implementing them on Electerm:

- Chinese layout and copy.
- Model API configuration.
- Server backup/export/import ideas.
- Online update release lessons.
- Agent approval and audit workflow ideas.

Electerm remains the formal SSH terminal base.
