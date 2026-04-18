# Drawcast

Drawcast is a Tauri-based desktop app for authoring Excalidraw diagrams via an MCP-connected CLI (Claude Code, Codex). It is a pnpm + turborepo monorepo of three packages: `@drawcast/core` (pure TS compile pipeline), `@drawcast/mcp-server` (stdio/SSE MCP server that owns scene state), and `@drawcast/app` (Tauri shell with xterm.js terminal and an Excalidraw viewer). See `docs/README.md` for the full specification.
