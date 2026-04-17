# Opencode style permissions and preview

A Pi package for agentic coding workflows, with a focus on stronger tool permissions, better edit/write review, and practical extensions for everyday use.

## Install in Pi

### Global install from git

```bash
pi install git:github.com/JayGhiya/pi-opencode-permissions-and-preview
```

## Included extension highlight: permission

The `permission` extension adds a configurable permission layer on top of Pi tool calls.

### Brief functionality

- `allow` / `deny` / `ask` rules for tool calls
- session-only and persisted approvals
- AST-aware bash permission matching
- custom preview and review UI for `edit` and `write`
- pierre diff preview for overwrites and edits
- full-content preview for brand-new writes
- reject with feedback flow

For `edit` and `write`, the permission prompt includes a compact preview and a larger review mode with `Ctrl+F`, plus scrolling with `PgUp` / `PgDn`.

Read more in [extensions/permission/README.md](./extensions/permission/README.md).

### Credits

- [Opencode](https://github.com/anomalyco/opencode)
- [pierre diffs](https://diffs.com)
- [pi tutorial](https://github.com/earendil-works/pi-tutorial)
- [original_permission_extension](https://github.com/alex35mil/agentic-af)
