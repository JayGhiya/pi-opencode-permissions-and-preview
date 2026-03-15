# MCP Extension

Connects to [Model Context Protocol](https://modelcontextprotocol.io/) servers and registers their tools with pi.

## Configuration

Settings file: `mcp.settings.json` (3-tier loading):

| Tier | Path |
|------|------|
| Global | `~/<agent-dir>/mcp.settings.json` |
| Project | `<repo-root>/.agents/mcp.settings.json` |
| Local | `<repo-root>/.agents/mcp.settings.local.json` |

### Schema

```json
{
  "servers": {
    "<name>": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"],
      "env": { "KEY": "value" }
    }
  }
}
```

Each server entry spawns a stdio-based MCP client. All tools exposed by the server are registered as `mcp__<server-name>__<tool-name>`.

## Behavior

- Servers are connected on extension load (in parallel)
- Failed connections are logged to stderr; successful ones show a widget with tool counts
- On session shutdown, all MCP clients are closed gracefully

## Dependencies

- `@modelcontextprotocol/sdk` — MCP client implementation
