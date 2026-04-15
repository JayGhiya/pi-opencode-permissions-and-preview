# Permission Extension

A Pi extension for controlling tool execution with configurable `allow`, `deny`, and `ask` rules.

It adds a permission layer in front of tool calls such as `bash`, `read`, `write`, `edit`, `grep`, `find`, `ls`, and `fetch`, and gives you a better review experience for file edits before they run.

## What it does

- blocks, allows, or prompts for tool calls using simple rules
- supports one-off approval or session-only approval
- adds a richer review UI for `edit` and `write`
- previews overwrites and new files before execution
- parses bash with Tree-sitter so permission checks work on extracted shell commands instead of naive string splitting
- lets trusted local skills contribute extra allow rules via frontmatter

## Install in Pi

This extension is bundled in the `agentic-af` Pi package.

### Install globally from git

```bash
pi install git:github.com/JayGhiya/agentic-af
```

### Install for just the current project

```bash
pi install -l git:github.com/JayGhiya/agentic-af
```

### Install from a local checkout while developing

```bash
pi install /absolute/path/to/agentic-af
```

After installing, use `pi config` if you want to enable or disable specific resources from the package.

## Core functionality

The extension evaluates tool calls in this order:

```text
deny > session approvals > ask > allow > defaultMode
```

When a tool call resolves to `ask`, Pi shows one of these outcomes:

- **Allow once**
- **Allow always for this session**
- **Reject**
- **Reject with feedback**

Session approvals are in-memory only and scoped to the current Pi session.

## Configuration

Settings file: `permission.settings.json`

Pi loads and merges 3 tiers:

| Tier    | Path                                                 |
| ------- | ---------------------------------------------------- |
| Global  | `~/<agent-dir>/permission.settings.json`             |
| Project | `<repo-root>/.agents/permission.settings.json`       |
| Local   | `<repo-root>/.agents/permission.settings.local.json` |

### Example

```json
{
  "defaultMode": "ask",
  "allow": ["read", "bash(git status *)"],
  "deny": ["bash(rm -rf *)"],
  "ask": ["edit", "write", "bash(npm publish *)"],
  "keybindings": {
    "autoAcceptEdits": "ctrl+shift+a"
  }
}
```

## Rule format

- `"read"` — match a tool name directly
- `"mcp__playwright__*"` — glob-match tool names
- `"bash(git *)"` — match `bash` when the extracted command matches `git *`
- `"edit(/tmp/*)"` — match `edit` when the path matches `/tmp/*`

### What each tool matches against

| Tool                    | Matched against                                      |
| ----------------------- | ---------------------------------------------------- |
| `bash`                  | AST-extracted command text from the full shell input |
| `edit`, `write`, `read` | file path                                            |
| `grep`, `find`, `ls`    | path argument                                        |
| `fetch`                 | URL                                                  |

## Edit and write preview UI

`edit` and `write` use a custom review dialog instead of a plain selector.

### Compact review

By default, the permission prompt shows a compact preview:

- Pierre-style stacked (unified) diff rows for `edit` and overwrite `write`
- syntax-aware highlighting derived from `@pierre/diffs` metadata + highlighter output
- concise new-file summary for brand-new writes
- the same 4 permission outcomes as every other ask flow

### Full review

Inside the dialog:

- `Ctrl+F` toggles fullscreen review
- `PgUp` / `PgDn` scroll the preview area
- for existing-file diffs in fullscreen:
  - `u` switches to stacked/unified layout
  - `s` switches to split layout
- fullscreen for new files shows the full new file content with line numbers

### Preview behavior

For `edit`, the extension previews changes in memory before execution by:

1. reading the current file
2. stripping a UTF-8 BOM for matching
3. normalizing line endings to LF
4. applying the requested replacements in memory only
5. generating a diff from the original and resulting content

The preview enforces the same basic edit safety expectations:

- `oldText` must not be empty
- exact match is tried first
- fuzzy match is only a fallback for minor formatting differences
- each `oldText` must resolve uniquely
- edits must not overlap
- no-op replacements are rejected

For `write`:

- existing files show a Pierre-backed overwrite diff preview
- brand-new files stay on the dedicated `new-file` preview path instead of forcing an all-additions diff

## Bash permission behavior

Bash is handled more carefully than simple string matching.

The extension:

1. parses the full shell input with Tree-sitter
2. walks extracted AST `command` nodes
3. skips cwd-only commands like `cd`
4. evaluates permission rules against the extracted commands
5. derives session approval patterns from command tokens

Examples:

- `git checkout main` → `bash(git checkout *)`
- `npm run dev` → `bash(npm run dev *)`
- `uv run pytest` → `bash(uv *)`
- `cd foo & uv run pytest` → only `uv run pytest` contributes, so session approval becomes `bash(uv *)`

This avoids many false matches that happen with naive shell splitting.

## Skill-derived allow rules

Trusted local skills can contribute extra allow rules through frontmatter:

```yaml
---
allowed-tools:
  - "read"
  - "bash(git status *)"
---
```

These do **not** bypass permission entirely. They just add more allow rules for tool calls.

## Commands

| Command                          | Description                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `/permission-toggle-auto-accept` | Toggle auto-accept for `edit` / `write` in the current session                            |
| `/permission-settings`           | Show resolved settings, skill-derived rules, session-approved rules, and session overrides |

## Observability

Use `/permission-settings` to inspect:

- merged persisted settings
- effective settings including session approvals
- skill-derived allow rules and their sources
- session-approved runtime rules
- mode overrides such as auto-accept for edits
