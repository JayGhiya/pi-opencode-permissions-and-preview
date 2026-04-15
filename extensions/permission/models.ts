export type Mode = "allow" | "ask" | "deny"

export interface PermissionSettings {
    defaultMode?: Mode
    allow?: string[]
    deny?: string[]
    ask?: string[]
    keybindings?: {
        autoAcceptEdits?: string
    }
}

export interface ParsedRule {
    toolPattern: string
    argPattern?: string
}

export interface SkillAllowSource {
    skill: string
    location: string
    path: string
    rules: string[]
}

export interface DerivedSkillAllowState {
    cacheKey: string
    rules: string[]
    sources: SkillAllowSource[]
}

export interface RuntimeSessionState {
    modeOverrides: Map<string, Mode>
    approvalRules: Set<string>
}
