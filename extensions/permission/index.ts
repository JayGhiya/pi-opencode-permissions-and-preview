/**
 * Permission Extension
 *
 * Controls tool execution via settings files:
 *   ~/<agent-dir>/permission.settings.json             (global)
 *   <repo-root>/.agents/permission.settings.json       (project, committed)
 *   <repo-root>/.agents/permission.settings.local.json (project, gitignored)
 *
 * Schema:
 * {
 *   "defaultMode": "ask" | "allow" | "deny",
 *   "allow": ["toolPattern", "tool(argPattern)", ...],
 *   "deny":  ["toolPattern", "tool(argPattern)", ...],
 *   "ask":   ["toolPattern", "tool(argPattern)", ...]
 * }
 *
 * Trusted local skills (global + project) may also contribute runtime allow rules
 * via SKILL frontmatter: allowed_tools / allowed-tools.
 *
 * Rule format:
 *   "read"                — blanket match on tool name
 *   "mcp__playwright__*"  — glob match on tool name
 *   "bash(git *)"         — match tool "bash" where command matches "git *"
 *   "edit(/tmp/*)"        — match tool "edit" where path matches "/tmp/*"
 *
 * Evaluation order: deny > session approvals > ask > allow > defaultMode (default: "ask")
 *
 * Argument matching depends on the tool:
 *   bash  — matched against AST-extracted command text
 *   edit/write/read — matched against file path
 *   grep/find/ls — matched against path argument
 */

import * as fs from "node:fs"

import {
    parseFrontmatter,
    type ExtensionAPI,
    type ExtensionContext,
    type SlashCommandInfo,
} from "@mariozechner/pi-coding-agent"

import * as project from "../__lib/project.js"
import {
    PERMISSION_CHOICES,
    PERMISSION_PROMPT_ALLOW_ALWAYS_FOR_SESSION,
    PERMISSION_PROMPT_ALLOW_ONCE,
    PERMISSION_PROMPT_REJECT,
    PERMISSION_PROMPT_REJECT_WITH_FEEDBACK,
    SESSION_APPROVAL_CONFIRM_APPROVE,
    SESSION_APPROVAL_CONFIRM_BACK,
    SESSION_APPROVAL_CONFIRM_CHOICES,
    SESSION_APPROVAL_CONFIRM_REJECT,
    STATUS_REJECTED,
    type PermissionPromptChoice,
    type SessionApprovalConfirmChoice,
} from "./constants.js"
import type {
    DerivedSkillAllowState,
    Mode,
    ParsedRule,
    PermissionSettings,
    RuntimeSessionState,
} from "./models.js"
import { BashArity } from "./bash-arity.js"
import { extractBashCommands } from "./bash-parser.js"
import { resolvePermissionRejection } from "./rejection.js"
import { showPermissionReviewDialog } from "./review-dialog.js"
import {
    buildEditPermissionPreview,
    buildWritePermissionPreview,
    type PermissionEditPreviewInput,
    type PermissionWritePreviewInput,
    type PermissionReviewPreview,
} from "./review-preview.js"

const EXTENSION = "permission"

// Runtime session state keyed by the active PI session id.
const SessionStates = new Map<string, RuntimeSessionState>()

type LocalSkillScope = SlashCommandInfo["sourceInfo"]["scope"]
type LocalSkillCommandInfo = SlashCommandInfo & { source: "skill" }

const LOCAL_SKILL_SCOPES = new Set<LocalSkillScope>(["user", "project"])

let cachedDerivedSkillAllowState: DerivedSkillAllowState | undefined

export default function (pi: ExtensionAPI) {
    const initSettings = loadSettings(process.cwd())
    const keybindings = initSettings.keybindings ?? {}

    if (keybindings.autoAcceptEdits) {
        pi.registerShortcut(keybindings.autoAcceptEdits as any, {
            description: "Toggle auto-accept edits",
            handler: toggleAutoAcceptEdits,
        })
    }

    pi.registerCommand("permission-toggle-auto-accept", {
        description: "Toggle auto-accept edits",
        handler: async (_args, ctx) => toggleAutoAcceptEdits(ctx),
    })

    pi.registerCommand("permission-settings", {
        description: "Show resolved permission settings",
        handler: async (_args, ctx) => {
            const sessionState = getSessionState(ctx)
            const derivedSkillAllowState = getDerivedSkillAllowState(pi)
            const persistedSettings = mergeSkillAllowRules(loadSettings(ctx.cwd), derivedSkillAllowState.rules)
            const overrides = Object.fromEntries(sessionState.modeOverrides)
            const sessionApprovedRules = Array.from(sessionState.approvalRules)
            const effectiveSettings = mergeSessionApprovalRules(persistedSettings, sessionApprovedRules)
            const output = JSON.stringify(
                {
                    settings: persistedSettings,
                    effectiveSettings,
                    derivedSkillAllowRules: derivedSkillAllowState.rules,
                    skillRuleSources: derivedSkillAllowState.sources,
                    sessionApprovedRules,
                    sessionOverrides: overrides,
                },
                null,
                2,
            )
            await ctx.ui.editor("Resolved permission settings", output)
        },
    })

    pi.on("session_start", async (_event, ctx) => {
        syncSessionStatus(ctx)
    })

    pi.on("tool_call", async (event, ctx) => {
        const sessionState = getSessionState(ctx)
        const derivedSkillAllowState = getDerivedSkillAllowState(pi)
        const persistedSettings = mergeSkillAllowRules(loadSettings(ctx.cwd), derivedSkillAllowState.rules)
        const argValue = getMatchValue(event.toolName, event.input as Record<string, unknown>)
        const mode = await resolveMode(persistedSettings, event.toolName, argValue ?? "", sessionState)

        switch (mode) {
            case "allow": {
                return undefined
            }

            case "deny": {
                ctx.abort()
                return {
                    block: true,
                    reason: `${STATUS_REJECTED} Denied by permission settings (${event.toolName})`,
                }
            }

            case "ask": {
                if (!ctx.hasUI) {
                    return {
                        block: true,
                        reason: `${STATUS_REJECTED} Blocked (no UI for confirmation): ${event.toolName}`,
                    }
                }

                while (true) {
                    const promptResult = await promptForPermission(
                        event.toolName,
                        event.input as Record<string, unknown>,
                        argValue,
                        ctx,
                    )

                    if (isAutomaticFeedbackRejection(promptResult)) {
                        return {
                            block: true,
                            reason: promptResult.reason,
                        }
                    }

                    const choice = promptResult

                    if (choice === PERMISSION_PROMPT_ALLOW_ONCE) {
                        return undefined
                    }

                    if (choice === PERMISSION_PROMPT_ALLOW_ALWAYS_FOR_SESSION) {
                        const sessionRules = await getSessionApprovalRules(event.toolName, argValue)
                        const confirmation = await confirmSessionApprovalRules(ctx, event.toolName, sessionRules)

                        if (confirmation === "approved") {
                            for (const rule of sessionRules) {
                                sessionState.approvalRules.add(rule)
                            }
                            ctx.ui.notify(
                                `Added session approval rule${sessionRules.length === 1 ? "" : "s"}: ${sessionRules.join(", ")}`,
                                "info",
                            )
                            return undefined
                        }

                        if (confirmation === "back") {
                            continue
                        }

                        if (confirmation === "reject") {
                            const rejection = await resolvePermissionRejection(
                                ctx,
                                PERMISSION_PROMPT_REJECT,
                                event.toolName,
                                argValue,
                            )
                            if (rejection.kind === "back") {
                                continue
                            }
                            ctx.abort()
                            return {
                                block: true,
                                reason: rejection.reason,
                            }
                        }
                    }

                    const rejection = await resolvePermissionRejection(ctx, choice, event.toolName, argValue)
                    if (rejection.kind === "back") {
                        continue
                    }
                    if (rejection.kind === "hard") {
                        ctx.abort()
                    }
                    return {
                        block: true,
                        reason: rejection.reason,
                    }
                }
            }
        }
    })
}

function mergePermissions(
    base: Partial<PermissionSettings>,
    override: Partial<PermissionSettings>,
): Partial<PermissionSettings> {
    return {
        defaultMode: override.defaultMode ?? base.defaultMode,
        allow: [...(base.allow ?? []), ...(override.allow ?? [])],
        deny: [...(base.deny ?? []), ...(override.deny ?? [])],
        ask: [...(base.ask ?? []), ...(override.ask ?? [])],
        keybindings: { ...base.keybindings, ...override.keybindings },
    }
}

function loadSettings(cwd: string) {
    return project.loadExtensionSettings<PermissionSettings>(EXTENSION, cwd, mergePermissions)
}

function getSessionState(ctx: ExtensionContext): RuntimeSessionState {
    const sessionId = ctx.sessionManager.getSessionId()
    const existing = SessionStates.get(sessionId)
    if (existing) return existing

    const state: RuntimeSessionState = {
        modeOverrides: new Map<string, Mode>(),
        approvalRules: new Set<string>(),
    }
    SessionStates.set(sessionId, state)
    return state
}

function syncSessionStatus(ctx: ExtensionContext) {
    const sessionState = getSessionState(ctx)
    const autoAcceptEnabled =
        sessionState.modeOverrides.get("edit") === "allow" && sessionState.modeOverrides.get("write") === "allow"

    ctx.ui.setStatus("permission", autoAcceptEnabled ? "▶︎ Auto-accept edits" : undefined)
}

function toggleAutoAcceptEdits(ctx: ExtensionContext) {
    const sessionState = getSessionState(ctx)
    const editCurrent = sessionState.modeOverrides.get("edit")
    const writeCurrent = sessionState.modeOverrides.get("write")

    if (editCurrent === "allow" && writeCurrent === "allow") {
        sessionState.modeOverrides.delete("edit")
        sessionState.modeOverrides.delete("write")
    } else {
        sessionState.modeOverrides.set("edit", "allow")
        sessionState.modeOverrides.set("write", "allow")
    }

    syncSessionStatus(ctx)
}

function parseRuleList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
    }

    if (typeof value === "string") {
        const trimmed = value.trim()
        return trimmed ? [trimmed] : []
    }

    return []
}

function getSkillAllowedRules(skillPath: string): string[] {
    try {
        const content = fs.readFileSync(skillPath, "utf-8")
        const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content)
        return [...parseRuleList(frontmatter.allowed_tools), ...parseRuleList(frontmatter["allowed-tools"])]
    } catch {
        return []
    }
}

function buildSkillAllowCacheKey(skills: LocalSkillCommandInfo[]): string {
    return skills
        .map((skill) => {
            const skillPath = skill.sourceInfo.path
            let stamp = "missing"

            if (skillPath) {
                try {
                    const stat = fs.statSync(skillPath)
                    stamp = `${stat.mtimeMs}:${stat.size}`
                } catch {
                    stamp = "missing"
                }
            }

            return `${skill.sourceInfo.scope}:${skillPath}:${stamp}`
        })
        .sort()
        .join("\n")
}

function isLocalSkillCommand(command: SlashCommandInfo): command is LocalSkillCommandInfo {
    return command.source === "skill" && LOCAL_SKILL_SCOPES.has(command.sourceInfo.scope)
}

function getDerivedSkillAllowState(pi: ExtensionAPI): DerivedSkillAllowState {
    const skills = pi
        .getCommands()
        .filter(isLocalSkillCommand)
        .sort((a, b) => a.sourceInfo.path.localeCompare(b.sourceInfo.path))

    const cacheKey = buildSkillAllowCacheKey(skills)
    if (cachedDerivedSkillAllowState && cachedDerivedSkillAllowState.cacheKey === cacheKey) {
        return cachedDerivedSkillAllowState
    }

    const sources = skills
        .map((skill) => {
            const rules = getSkillAllowedRules(skill.sourceInfo.path)
            return {
                skill: skill.name.replace(/^skill:/, ""),
                location: skill.sourceInfo.scope,
                path: skill.sourceInfo.path,
                rules,
            }
        })
        .filter((skill) => skill.rules.length > 0)

    cachedDerivedSkillAllowState = {
        cacheKey,
        rules: [...new Set(sources.flatMap((skill) => skill.rules))],
        sources,
    }
    return cachedDerivedSkillAllowState
}

function mergeSkillAllowRules(settings: PermissionSettings, skillRules: string[]): PermissionSettings {
    if (skillRules.length === 0) return settings

    return {
        ...settings,
        allow: [...new Set([...(settings.allow ?? []), ...skillRules])],
    }
}

function mergeSessionApprovalRules(settings: PermissionSettings, sessionRules: string[]): PermissionSettings {
    if (sessionRules.length === 0) return settings

    return {
        ...settings,
        allow: [...new Set([...(settings.allow ?? []), ...sessionRules])],
    }
}

function parseRule(rule: string): ParsedRule {
    const match = rule.match(/^([^(]+)\((.+)\)$/)
    if (match) {
        return { toolPattern: match[1], argPattern: match[2] }
    }
    return { toolPattern: rule }
}

function matchPattern(pattern: string, value: string): boolean {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
    // Make trailing " .*" optional so "cmd *" also matches bare "cmd"
    const adjusted = escaped.replace(/ \.\*$/, "( .*)?")
    return new RegExp(`^${adjusted}$`).test(value)
}

function matchesAnyRule(rules: string[], toolName: string, argValue: string): boolean {
    return rules.some((rule) => {
        const parsed = parseRule(rule)
        if (!matchPattern(parsed.toolPattern, toolName)) return false
        if (parsed.argPattern) return matchPattern(parsed.argPattern, argValue)
        return true
    })
}

function getMatchValue(tool: string, input: Record<string, unknown>): string | undefined {
    switch (tool) {
        case "bash":
            return input.command as string | undefined
        case "edit":
        case "write":
        case "read":
            return input.path as string | undefined
        case "fetch":
            return input.url as string | undefined
        case "grep":
        case "find":
        case "ls":
            return (input.path as string | undefined) ?? ""
        default:
            return undefined
    }
}

function resolveSingleMode(
    settings: PermissionSettings,
    toolName: string,
    argValue: string,
    sessionState: RuntimeSessionState,
): Mode {
    const override = sessionState.modeOverrides.get(toolName)
    if (override) return override

    if (matchesAnyRule(settings.deny ?? [], toolName, argValue)) return "deny"
    if (matchesAnyRule(Array.from(sessionState.approvalRules), toolName, argValue)) return "allow"
    if (matchesAnyRule(settings.ask ?? [], toolName, argValue)) return "ask"
    if (matchesAnyRule(settings.allow ?? [], toolName, argValue)) return "allow"

    return settings.defaultMode ?? "ask"
}

/**
 * Resolve the permission mode for a tool call.
 * For bash commands, parse the full shell text with Tree-sitter, walk AST
 * command nodes, skip cwd-only commands, and evaluate only the extracted
 * command texts. The strictest mode wins: deny > ask > allow.
 */
async function resolveMode(
    settings: PermissionSettings,
    toolName: string,
    argValue: string,
    sessionState: RuntimeSessionState,
): Promise<Mode> {
    if (toolName !== "bash" || !argValue) {
        return resolveSingleMode(settings, toolName, argValue, sessionState)
    }

    const commands = await extractBashCommands(argValue)
    if (commands.length === 0) return "allow"

    let worst: Mode = "allow"

    for (const command of commands) {
        const mode = resolveSingleMode(settings, toolName, command.text, sessionState)
        if (mode === "deny") return "deny"
        if (mode === "ask") worst = "ask"
    }

    return worst
}

type PermissionPromptResult = PermissionPromptChoice | undefined | AutomaticFeedbackRejection

type AutomaticFeedbackRejection = {
    kind: "automatic-feedback-rejection"
    reason: string
}

async function promptForPermission(
    toolName: string,
    input: Record<string, unknown>,
    argValue: string | undefined,
    ctx: ExtensionContext,
): Promise<PermissionPromptResult> {
    if (toolName === "edit") {
        const preview = await buildEditPermissionPreview(asEditToolInput(input), ctx.cwd)
        return asPromptResult(preview) ?? showPermissionReviewDialog(ctx, preview)
    }

    if (toolName === "write") {
        const preview = await buildWritePermissionPreview(asWriteToolInput(input), ctx.cwd)
        return asPromptResult(preview) ?? showPermissionReviewDialog(ctx, preview)
    }

    const title = buildPromptTitle(toolName, input, argValue)
    const choice = await ctx.ui.select(title, [...PERMISSION_CHOICES])
    return isPermissionPromptChoice(choice) ? choice : undefined
}

async function confirmSessionApprovalRules(
    ctx: ExtensionContext,
    toolName: string,
    rules: string[],
): Promise<"approved" | "back" | "reject"> {
    if (rules.length === 0) {
        ctx.ui.notify(`Could not derive a session approval rule for ${toolName}`, "error")
        return "back"
    }

    const suffix = rules.length === 1 ? "rule" : "rules"
    const message = `Allow always for this session will add the following ${suffix}:\n\n${rules
        .map((rule) => `- ${rule}`)
        .join("\n")}`

    const choice = await ctx.ui.select(message, [...SESSION_APPROVAL_CONFIRM_CHOICES])
    if (choice === SESSION_APPROVAL_CONFIRM_APPROVE) return "approved"
    if (choice === SESSION_APPROVAL_CONFIRM_BACK) return "back"
    if (choice === SESSION_APPROVAL_CONFIRM_REJECT) return "reject"
    return "reject"
}

function buildPromptTitle(toolName: string, input: Record<string, unknown>, argValue: string | undefined): string {
    const details = argValue ?? JSON.stringify(input, null, 2)
    return `${toolName}\n\n${details}\n\nChoose permission:`
}

async function getSessionApprovalRules(toolName: string, argValue: string | undefined): Promise<string[]> {
    switch (toolName) {
        case "bash": {
            if (!argValue) return []
            const commands = await extractBashCommands(argValue)
            return [
                ...new Set(
                    commands
                        .map((command) => getBashAlwaysPattern(command.tokens))
                        .filter((rule): rule is string => Boolean(rule)),
                ),
            ]
        }
        case "edit":
        case "write":
        case "read":
        case "fetch":
        case "grep":
        case "find":
        case "ls":
            return [toolName]
        default:
            return [toolName]
    }
}

function getBashAlwaysPattern(tokens: string[]): string | undefined {
    const prefix = BashArity.prefix(tokens)
    if (prefix.length === 0) return undefined
    return `bash(${prefix.join(" ")} *)`
}

function asEditToolInput(input: Record<string, unknown>): PermissionEditPreviewInput {
    return {
        path: typeof input.path === "string" ? input.path : "",
        edits: Array.isArray(input.edits)
            ? input.edits
                  .filter(
                      (edit): edit is { oldText: string; newText: string } =>
                          typeof edit === "object" &&
                          edit !== null &&
                          typeof edit.oldText === "string" &&
                          typeof edit.newText === "string",
                  )
                  .map((edit) => ({ oldText: edit.oldText, newText: edit.newText }))
            : [],
    }
}

function asWriteToolInput(input: Record<string, unknown>): PermissionWritePreviewInput {
    return {
        path: typeof input.path === "string" ? input.path : "",
        content: typeof input.content === "string" ? input.content : "",
    }
}

function asPromptResult(preview: PermissionReviewPreview): AutomaticFeedbackRejection | undefined {
    if (preview.kind !== "error") return undefined

    return {
        kind: "automatic-feedback-rejection",
        reason: preview.error,
    }
}

function isAutomaticFeedbackRejection(value: PermissionPromptResult): value is AutomaticFeedbackRejection {
    return typeof value === "object" && value !== null && value.kind === "automatic-feedback-rejection"
}

function isPermissionPromptChoice(value: string | undefined): value is PermissionPromptChoice {
    return (
        value === PERMISSION_PROMPT_ALLOW_ONCE ||
        value === PERMISSION_PROMPT_ALLOW_ALWAYS_FOR_SESSION ||
        value === PERMISSION_PROMPT_REJECT ||
        value === PERMISSION_PROMPT_REJECT_WITH_FEEDBACK
    )
}
