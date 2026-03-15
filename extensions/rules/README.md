# Rules Extension

Discovers rule files and delivers them to the agent. Rules are Markdown files that guide the agent's behavior for specific files or the entire project.

## Rule Locations

| Scope | Directory |
|-------|-----------|
| Global | `~/<agent-dir>/rules/` |
| Project | `<repo-root>/.agents/rules/` |

All `.md` files in these directories (including subdirectories) are discovered.

## Rule Types

### Always-on Rules

No frontmatter `paths` field. Body injected into the system prompt on every turn.

```markdown
# coding-style.md

Use 2-space indentation. Prefer const over let.
```

### Path-Scoped Rules

Have a `paths` glob list in YAML frontmatter. Delivered via read tool results when the agent reads a matching file.

```markdown
---
paths:
  - "src/components/**"
  - "*.test.ts"
---

# component-rules.md

Always use functional components with hooks.
```

### Glob Syntax

Supports `*`, `**`, `?`, and brace expansion (`{a,b}`). Paths are matched relative to the repo root.

## How It Works

### System Prompt

- Always-on rules are injected with their full body.
- If path-scoped rules exist, a note is added telling the agent to always read files before editing (rules load automatically on read).
- Path-scoped rule bodies are **not** included in the system prompt — they are delivered only via tool results to avoid context pollution.

### Rule Delivery (tool_result on read)

When the agent reads a file matching a path-scoped rule:

- **First matching read**: full reminder appended to the tool result — includes the rule body and glob patterns so the agent understands what files the rule covers.
- **Subsequent matching reads**: compact reminder — just the patterns, telling the agent to follow the rule it saw earlier. Saves tokens while keeping the association visible.

### Edit Blocking (tool_call on edit/write)

If the agent tries to edit or write a file matching a path-scoped rule it hasn't seen yet, the tool call is blocked. The agent must read a matching file first to load the rule.

### Compaction

On compaction, both `loadedRuleIds` and `visibleRuleIds` are cleared and an empty `rules-state` entry is persisted. This means:

- The edit blocker re-engages — the agent must read matching files again before editing.
- The next matching read delivers a full reminder (not compact), since the rule is treated as new.
- The empty entry ensures that `restoreLoadedRuleIds` (which scans the full branch including pre-compaction entries) picks up the reset state.

### Session Replay (--continue/--resume)

Rule loading state is persisted in the session branch via custom `rules-state` entries. On replay, the last entry is restored so:

- The edit blocker knows which rules the agent has already seen.
- Already-loaded rules get compact reminders on subsequent reads instead of full ones.

## Commands

| Command | Description |
|---------|-------------|
| `/rules` | Show discovered rules and current activation state |
