# AI Tool Configuration Guide

All three AI tools connect to the MCP Context Manager via **stdio transport**
using `docker exec`. The MCP server command is identical across tools:

```
docker exec -i mcp-context-manager node dist/server.js --stdio-only
```

The `--stdio-only` flag skips HTTP server startup; the process communicates
exclusively over stdin/stdout using the MCP protocol.

---

## Kiro

**Config file:** `.kiro/mcp.json` (project root)

Use the provided template:

```bash
cp services/mcp-context-manager/kiro-config.template.json .kiro/mcp.json
```

---

## Cursor

**Config file:** `.cursor/mcp.json` (project root)

Use the provided template:

```bash
cp services/mcp-context-manager/cursor-config.template.json .cursor/mcp.json
```

Cursor reads `.cursor/mcp.json` from the workspace root automatically.

---

## Claude Desktop

The config file location depends on your operating system:

| Platform       | Path                                                                 |
|----------------|----------------------------------------------------------------------|
| macOS          | `~/Library/Application Support/Claude/claude_desktop_config.json`   |
| Windows        | `%APPDATA%\Claude\claude_desktop_config.json`                        |
| Linux          | `~/.config/Claude/claude_desktop_config.json`                        |
| WSL            | Use the Windows path above (Claude Desktop runs on the Windows side) |

Copy the template and place it at the correct path for your OS:

```bash
# macOS example
cp services/mcp-context-manager/claude-desktop-config.template.json \
   ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

If a `claude_desktop_config.json` already exists, merge the `mcpServers` key
into your existing file rather than replacing it.

---

## Verifying the connection

After configuring your tool, start the MCP stack and confirm the container is
healthy:

```bash
./mcp.sh up
./mcp.sh status   # both containers should show "healthy"
```

Then open your AI tool and check that `mcp-context-manager` appears in the
connected MCP servers list.
