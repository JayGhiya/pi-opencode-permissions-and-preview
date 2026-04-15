# agentic-af

My [pi](https://pi.dev) setup for coding agent workflows.

> [!IMPORTANT]
> This setup is built for [pi.nvim](https://github.com/alex35mil/pi.nvim). Some extensions (notably [permission](./extensions/permission/)) rely on the Neovim plugin for UI interactions like edit reviews. Using this package with the pi TUI will most likely require adjustments.

## Extensions

- [**context**](extensions/context/) — `/context` command for session introspection
- [**fetch**](extensions/fetch/) — `fetch` tool for retrieving URLs as markdown
- [**mcp**](extensions/mcp/) — MCP server integration
- [**permission**](extensions/permission/) — tool execution control with allow/deny/ask rules
- [**rules**](extensions/rules/) — rule files injected into system prompt
- [**web-search**](extensions/web-search/) — `web_search` tool via Brave Search API
