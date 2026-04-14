export const STATUS_REJECTED = "[rejected]"
export const FEEDBACK_PLACEHOLDER = "Tell the agent what to do instead"

export const PERMISSION_PROMPT_ALLOW_ONCE = "Allow once"
export const PERMISSION_PROMPT_ALLOW_ALWAYS_FOR_SESSION = "Allow always for this session"
export const PERMISSION_PROMPT_REJECT = "Reject"
export const PERMISSION_PROMPT_REJECT_WITH_FEEDBACK = "Reject with feedback"

export const PERMISSION_CHOICES = [
    PERMISSION_PROMPT_ALLOW_ONCE,
    PERMISSION_PROMPT_ALLOW_ALWAYS_FOR_SESSION,
    PERMISSION_PROMPT_REJECT,
    PERMISSION_PROMPT_REJECT_WITH_FEEDBACK,
] as const

export type PermissionPromptChoice = (typeof PERMISSION_CHOICES)[number]

export const SESSION_APPROVAL_CONFIRM_APPROVE = "Approve session rules"
export const SESSION_APPROVAL_CONFIRM_BACK = "Back"
export const SESSION_APPROVAL_CONFIRM_REJECT = "Reject"

export const SESSION_APPROVAL_CONFIRM_CHOICES = [
    SESSION_APPROVAL_CONFIRM_APPROVE,
    SESSION_APPROVAL_CONFIRM_BACK,
    SESSION_APPROVAL_CONFIRM_REJECT,
] as const

export type SessionApprovalConfirmChoice = (typeof SESSION_APPROVAL_CONFIRM_CHOICES)[number]
