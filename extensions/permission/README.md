# Permission Extension

Controls tool execution with configurable allow/deny/ask rules. When a tool call is not already resolved by settings, the extension uses an OpenCode-style prompt flow:

- Allow once
- Allow always for this session
- Reject
- Reject with feedback

Session approvals are kept in memory only and are scoped to the active PI session. Switching sessions uses each session's own runtime approvals, and a brand new session starts with none.

## Configuration

Settings file: `permission.settings.json` (3-tier loading):

| Tier    | Path                                                 |
| ------- | ---------------------------------------------------- |
| Global  | `~/<agent-dir>/permission.settings.json`             |
| Project | `<repo-root>/.agents/permission.settings.json`       |
| Local   | `<repo-root>/.agents/permission.settings.local.json` |

### Schema

```json
{
    "defaultMode": "ask",
    "allow": ["read", "bash(git *)"],
    "deny": ["bash(rm -rf *)"],
    "ask": ["write", "edit"],
    "keybindings": {
        "autoAcceptEdits": "ctrl+shift+a"
    }
}
```

### Rule Format

- `"read"` — blanket match on tool name
- `"mcp__playwright__*"` — glob match on tool name
- `"bash(git *)"` — match tool `bash` where command matches `git *`
- `"edit(/tmp/*)"` — match tool `edit` where path matches `/tmp/*`

### Argument Matching

| Tool                    | Matched against                                      |
| ----------------------- | ---------------------------------------------------- |
| `bash`                  | AST-extracted command text from the full shell input |
| `edit`, `write`, `read` | file path                                            |
| `grep`, `find`, `ls`    | path argument                                        |
| `fetch`                 | URL                                                  |

### Evaluation Order

`deny` > session approvals > `ask` > `allow` > `defaultMode` (default: `"ask"`)

### Skill-Derived Rules

Trusted local skills (global + project) can contribute allow rules via YAML frontmatter:

```yaml
---
allowed-tools:
    - "bash(ls *)"
    - "read"
---
```

## Prompt Flow

For askable tools, the extension presents a 4-way choice via `ctx.ui.select(...)`:

- **Allow once** — execute only this tool call
- **Allow always for this session** — derive one or more runtime approval rules, show them in a confirmation step, and store them only for the current session
- **Reject** — block the tool call and abort the active run
- **Reject with feedback** — block the tool call, return corrective text to the model, and let the run continue

For non-bash tools, session approval currently stores a tool-wide runtime rule such as:

- `edit`
- `write`
- `read`
- `fetch`

For bash, the extension mirrors upstream OpenCode more closely:

1. parse the full shell input with Tree-sitter
2. walk AST `command` nodes
3. skip cwd-only commands like `cd`
4. evaluate permissions only against the extracted command texts
5. build session-approval wildcard rules from the extracted command tokens

Examples:

- `git checkout main` → `bash(git checkout *)`
- `npm run dev` → `bash(npm run dev *)`
- `uv run app.py` → `bash(uv *)`
- `cd foo & uv run pytest` → only `uv run pytest` contributes, so the session rule is `bash(uv *)`

If a bash command contains multiple commands, the session approval confirmation shows every derived rule that would be added from the extracted AST command nodes.

If `Reject with feedback` is chosen, the extension asks for a short instruction such as:

- `Do not edit this generated file directly; update the source template instead.`
- `Do not run this command yet; inspect the logs first.`

An empty or cancelled feedback input returns to the permission menu instead of hard-rejecting.

## Bash Permission Behavior

- Bash input is parsed as a full shell program with Tree-sitter instead of being permission-checked by raw string splitting
- Permissions are evaluated against extracted AST `command` nodes, and the strictest mode across those extracted commands wins
- Cwd-only commands like `cd` are skipped for bash permission derivation and evaluation, so `cd foo` alone does not contribute a bash approval rule
- Session approval wildcard rules use upstream-style arity fallback, so unknown command families fall back to the first token, e.g. `uv run pytest` → `bash(uv *)`
- Headless mode (no UI) blocks all `"ask"` calls
- Deny rules still take precedence over session approvals

## Commands

| Command                          | Description                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `/permission-toggle-auto-accept` | Toggle auto-accept for edit/write tools in the current session                             |
| `/permission-settings`           | Show resolved settings, skill-derived rules, session-approved rules, and session overrides |

## Observability

Use `/permission-settings` to inspect:

- persisted settings
- effective settings including runtime session approvals
- skill-derived allow rules and their sources
- session-approved runtime rules
- session mode overrides such as auto-accept edits
