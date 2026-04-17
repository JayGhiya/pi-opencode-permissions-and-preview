export const STATUS_REJECTED = "[rejected]"
export const FEEDBACK_PLACEHOLDER = "Tell the agent what to do instead"

export const PERMISSION_PROMPT_ALLOW_ONCE = "Allow once"
export const PERMISSION_PROMPT_ALLOW_ALWAYS = "Allow always"
export const PERMISSION_PROMPT_ALLOW_ALWAYS_FOR_SESSION = "Allow always for this session"
export const PERMISSION_PROMPT_REJECT = "Reject"
export const PERMISSION_PROMPT_REJECT_WITH_FEEDBACK = "Reject with feedback"

export const PERMISSION_CHOICES = [
    PERMISSION_PROMPT_ALLOW_ONCE,
    PERMISSION_PROMPT_ALLOW_ALWAYS,
    PERMISSION_PROMPT_ALLOW_ALWAYS_FOR_SESSION,
    PERMISSION_PROMPT_REJECT,
    PERMISSION_PROMPT_REJECT_WITH_FEEDBACK,
] as const

export type PermissionPromptChoice = (typeof PERMISSION_CHOICES)[number]

export const APPROVAL_CONFIRM_APPROVE = "Approve rules"
export const APPROVAL_CONFIRM_BACK = "Back"
export const APPROVAL_CONFIRM_REJECT = "Reject"

export const APPROVAL_CONFIRM_CHOICES = [
    APPROVAL_CONFIRM_APPROVE,
    APPROVAL_CONFIRM_BACK,
    APPROVAL_CONFIRM_REJECT,
] as const

export type ApprovalConfirmChoice = (typeof APPROVAL_CONFIRM_CHOICES)[number]
