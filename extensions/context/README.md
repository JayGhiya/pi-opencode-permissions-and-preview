# Context Extension

Provides a `/context` command that shows session introspection: model info, context usage breakdown, tools, skills, and session stats.

## Usage

```
/context
```

Opens an editor view with:

- **Context Usage** — current model, tokens used/available, percentage
- **Token Breakdown** — estimated tokens consumed by system prompt, built-in tools, extension tools, MCP tools, messages, and free space
- **Tools** — all active tools with per-tool token estimates
- **Skills** — discovered skills and their file paths
- **Session** — message counts (user/assistant/tool results), cumulative input/output tokens, and cost

## Configuration

None. The extension works out of the box.
