import type { ExtensionContext } from "@mariozechner/pi-coding-agent"

import {
    FEEDBACK_PLACEHOLDER,
    PERMISSION_PROMPT_REJECT,
    PERMISSION_PROMPT_REJECT_WITH_FEEDBACK,
    STATUS_REJECTED,
    type PermissionPromptChoice,
} from "./constants.js"

export type PermissionRejectionResult =
    | {
          kind: "hard"
          reason: string
      }
    | {
          kind: "feedback"
          reason: string
      }
    | {
          kind: "back"
      }

export async function resolvePermissionRejection(
    ctx: ExtensionContext,
    choice: PermissionPromptChoice | undefined,
    toolName: string,
    argValue: string | undefined,
): Promise<PermissionRejectionResult> {
    if (choice === PERMISSION_PROMPT_REJECT) {
        return {
            kind: "hard",
            reason: buildHardRejectedReason(toolName, argValue),
        }
    }

    if (choice !== PERMISSION_PROMPT_REJECT_WITH_FEEDBACK) {
        return { kind: "back" }
    }

    const feedback = await ctx.ui.input(buildFeedbackPrompt(toolName, argValue), FEEDBACK_PLACEHOLDER)
    const trimmed = feedback?.trim()
    if (!trimmed) {
        return { kind: "back" }
    }

    return {
        kind: "feedback",
        reason: trimmed,
    }
}

function buildHardRejectedReason(toolName: string, argValue: string | undefined): string {
    if (argValue) {
        return `${STATUS_REJECTED} User rejected ${toolName}: ${argValue}`
    }
    return `${STATUS_REJECTED} User rejected ${toolName}`
}

function buildFeedbackPrompt(toolName: string, argValue: string | undefined): string {
    if (argValue) {
        return `Reject ${toolName} with feedback\n\n${argValue}`
    }
    return `Reject ${toolName} with feedback`
}
