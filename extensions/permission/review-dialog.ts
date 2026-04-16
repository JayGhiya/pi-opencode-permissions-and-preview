import {
    getLanguageFromPath,
    highlightCode,
    keyHint,
    rawKeyHint,
    type ExtensionContext,
    type KeybindingsManager,
    type Theme,
} from "@mariozechner/pi-coding-agent"
import type { Component, OverlayOptions, TUI } from "@mariozechner/pi-tui"
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui"

import { PERMISSION_CHOICES, type PermissionPromptChoice } from "./constants.js"
import { renderSplitDiffLines, renderUnifiedDiffLines, type PreviewDisplayLine } from "./pierre-rows.js"
import { getPierreAppearance, getPierrePalette } from "./pierre-theme.js"
import type { PermissionDiffPreview, PermissionNewFilePreview, PermissionReviewPreview } from "./review-preview.js"

const COMPACT_MAX_HEIGHT = 24
const COMPACT_MAX_WIDTH = 110
const FULLSCREEN_MIN_HEIGHT = 18
const FULLSCREEN_HORIZONTAL_INSET = 4
const FULLSCREEN_TOP_OFFSET = 1
const FULLSCREEN_LEFT_OFFSET = 2
const HORIZONTAL_PADDING = 3

type PermissionReviewDialogResult = PermissionPromptChoice | undefined | PermissionReviewDialogToggle

interface PermissionReviewDialogToggle {
    kind: "toggle-fullscreen"
    state: PermissionReviewDialogState
}

type FullscreenDiffStyle = "unified" | "split"

interface PermissionReviewDialogState {
    fullscreen: boolean
    selectedIndex: number
    scrollOffset: number
    fullscreenDiffStyle: FullscreenDiffStyle
}

export async function showPermissionReviewDialog(
    ctx: ExtensionContext,
    preview: PermissionReviewPreview,
): Promise<PermissionPromptChoice | undefined> {
    let state: PermissionReviewDialogState = {
        fullscreen: false,
        selectedIndex: 0,
        scrollOffset: 0,
        fullscreenDiffStyle: "unified",
    }

    while (true) {
        const result = await ctx.ui.custom<PermissionReviewDialogResult>(
            (
                tui: TUI,
                theme: Theme,
                keybindings: KeybindingsManager,
                done: (value: PermissionReviewDialogResult) => void,
            ) => new PermissionReviewDialog(tui, theme, keybindings, preview, state, done),
            {
                overlay: true,
                overlayOptions: getOverlayOptions(state, process.stdout.columns ?? 80, process.stdout.rows ?? 24),
            },
        )

        if (isToggleResult(result)) {
            state = result.state
            continue
        }

        return result
    }
}

class PermissionReviewDialog implements Component {
    private selectedIndex: number
    private fullscreen: boolean
    private scrollOffset: number
    private fullscreenDiffStyle: FullscreenDiffStyle

    constructor(
        private readonly tui: TUI,
        private readonly theme: Theme,
        private readonly keybindings: KeybindingsManager,
        private readonly preview: PermissionReviewPreview,
        initialState: PermissionReviewDialogState,
        private readonly done: (result: PermissionReviewDialogResult) => void,
    ) {
        this.selectedIndex = initialState.selectedIndex
        this.fullscreen = initialState.fullscreen
        this.scrollOffset = initialState.scrollOffset
        this.fullscreenDiffStyle = initialState.fullscreenDiffStyle
    }

    invalidate(): void {}

    handleInput(data: string): void {
        if (this.keybindings.matches(data, "tui.select.up") || data === "k") {
            this.selectedIndex = Math.max(0, this.selectedIndex - 1)
            this.requestRender()
            return
        }

        if (this.keybindings.matches(data, "tui.select.down") || data === "j") {
            this.selectedIndex = Math.min(PERMISSION_CHOICES.length - 1, this.selectedIndex + 1)
            this.requestRender()
            return
        }

        if (this.keybindings.matches(data, "tui.select.pageUp")) {
            this.scrollOffset = Math.max(0, this.scrollOffset - this.getScrollPageSize())
            this.requestRender()
            return
        }

        if (this.keybindings.matches(data, "tui.select.pageDown")) {
            this.scrollOffset += this.getScrollPageSize()
            this.requestRender()
            return
        }

        if (this.fullscreen && this.preview.kind === "diff" && matchesUnifiedLayoutShortcut(data)) {
            this.fullscreenDiffStyle = "unified"
            this.scrollOffset = 0
            this.requestRender()
            return
        }

        if (this.fullscreen && this.preview.kind === "diff" && matchesSplitLayoutShortcut(data)) {
            this.fullscreenDiffStyle = "split"
            this.scrollOffset = 0
            this.requestRender()
            return
        }

        if (matchesCtrlF(data)) {
            this.done({
                kind: "toggle-fullscreen",
                state: {
                    fullscreen: !this.fullscreen,
                    selectedIndex: this.selectedIndex,
                    scrollOffset: 0,
                    fullscreenDiffStyle: this.fullscreenDiffStyle,
                },
            })
            return
        }

        if (this.keybindings.matches(data, "tui.select.confirm") || data === "\n") {
            this.done(PERMISSION_CHOICES[this.selectedIndex])
            return
        }

        if (this.keybindings.matches(data, "tui.select.cancel")) {
            this.done(undefined)
        }
    }

    render(width: number): string[] {
        const innerWidth = Math.max(20, width - HORIZONTAL_PADDING)
        const frameWidth = innerWidth - 2
        const titleLines = wrapSection(this.getTitle(), frameWidth, this.theme)
        const metaLines = wrapSection(this.getMeta(), frameWidth, this.theme)
        const actionLines = this.getActionLines(frameWidth)
        const hintLines = wrapSection(this.getHintText(), frameWidth, this.theme)

        const maxHeight = getOverlayOptions(this.getState(), this.tui.terminal.columns, this.tui.terminal.rows).maxHeight
        const availableHeight = typeof maxHeight === "number" ? maxHeight : this.tui.terminal.rows - 2
        const previewHeight = Math.max(
            4,
            availableHeight - titleLines.length - metaLines.length - actionLines.length - hintLines.length - 5,
        )

        const previewLines = this.getVisiblePreviewLines(frameWidth, previewHeight)
        const lines = [
            this.renderBorder(width, "top"),
            ...titleLines.map((line) => this.renderBodyLine(width, line)),
            ...metaLines.map((line) => this.renderBodyLine(width, line)),
            this.renderBorder(width, "middle"),
            ...previewLines.map((line) => this.renderBodyLine(width, line)),
            this.renderBorder(width, "middle"),
            ...actionLines.map((line) => this.renderBodyLine(width, line)),
            this.renderBorder(width, "middle"),
            ...hintLines.map((line) => this.renderBodyLine(width, line)),
            this.renderBorder(width, "bottom"),
        ]

        return lines
    }

    private requestRender(force = false): void {
        this.tui.requestRender(force)
    }

    private getState(): PermissionReviewDialogState {
        return {
            fullscreen: this.fullscreen,
            selectedIndex: this.selectedIndex,
            scrollOffset: this.scrollOffset,
            fullscreenDiffStyle: this.fullscreenDiffStyle,
        }
    }

    private getTitle(): string {
        const action = this.preview.toolName === "edit" ? "Edit" : this.preview.kind === "new-file" ? "Create" : "Write"
        const path = formatDisplayPath(this.preview.path)
        const mode = this.fullscreen ? this.theme.fg("accent", "fullscreen") : this.theme.fg("muted", "compact")
        return `${this.theme.fg("accent", this.theme.bold(`${action} ${path}`))} ${this.theme.fg("muted", `(${mode})`)}`
    }

    private getMeta(): string {
        if (this.preview.kind === "diff") {
            const mode = this.fullscreen
                ? this.fullscreenDiffStyle === "split"
                    ? "split diff"
                    : "stacked diff"
                : "stacked diff"
            const stats = `${this.theme.fg("success", `+${this.preview.addedLines}`)} ${this.theme.fg("error", `-${this.preview.removedLines}`)}`
            const changed =
                this.preview.firstChangedLine === undefined
                    ? this.theme.fg("muted", "no textual changes")
                    : this.theme.fg("muted", `first change at line ${this.preview.firstChangedLine}`)
            return `${this.theme.fg("muted", `${mode} preview`)} • ${stats} • ${changed}`
        }

        if (this.preview.kind === "new-file") {
            const summary = `${this.preview.lineCount} line${this.preview.lineCount === 1 ? "" : "s"} • ${this.preview.byteLength} bytes`
            return `${this.theme.fg("muted", "new file preview")} • ${this.theme.fg("text", summary)}`
        }

        return `${this.theme.fg("warning", "preview unavailable")} • ${this.theme.fg("muted", this.preview.error)}`
    }

    private getActionLines(width: number): string[] {
        return PERMISSION_CHOICES.map((choice, index) => {
            const isSelected = index === this.selectedIndex
            const prefix = isSelected ? this.theme.fg("accent", "→") : this.theme.fg("muted", " ")
            const label = isSelected ? this.theme.fg("accent", choice) : this.theme.fg("text", choice)
            return truncateToWidth(`${prefix} ${label}`, width, "…", true)
        })
    }

    private getHintText(): string {
        const scrollHint = rawKeyHint(getScrollHintLabel(), "scroll")
        const fullscreenHint = rawKeyHint("Ctrl+F", this.fullscreen ? "compact" : "fullscreen")
        const layoutHints =
            this.preview.kind === "diff" && this.fullscreen
                ? [rawKeyHint("u", "stacked"), rawKeyHint("s", "split")]
                : []

        return [
            rawKeyHint("↑↓", "choose"),
            keyHint("tui.select.confirm", "select"),
            fullscreenHint,
            ...layoutHints,
            scrollHint,
            keyHint("tui.select.cancel", "cancel"),
        ].join("  ")
    }

    private getVisiblePreviewLines(width: number, height: number): string[] {
        const allLines = this.buildPreviewLines(width)
        if (allLines.length === 0) {
            return [truncateToWidth(this.theme.fg("muted", "Nothing to preview."), width, "…", true)]
        }

        const safeHeight = Math.max(1, height)
        const clampedOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, allLines.length - safeHeight)))
        this.scrollOffset = clampedOffset

        const showTopIndicator = clampedOffset > 0
        const showBottomIndicator = clampedOffset + safeHeight < allLines.length
        const indicatorSlots = Number(showTopIndicator) + Number(showBottomIndicator)
        const contentHeight = Math.max(1, safeHeight - indicatorSlots)
        const visibleLines = allLines.slice(clampedOffset, clampedOffset + contentHeight)
        const hiddenTopSourceLines = countSourceLines(allLines.slice(0, clampedOffset))
        const hiddenBottomSourceLines = countSourceLines(allLines.slice(clampedOffset + contentHeight))
        const lines: string[] = []

        if (showTopIndicator) {
            lines.push(
                truncateToWidth(
                    this.theme.fg("muted", `↑ ${hiddenTopSourceLines} line${hiddenTopSourceLines === 1 ? "" : "s"} above`),
                    width,
                    "…",
                    true,
                ),
            )
        }

        for (const line of visibleLines) {
            lines.push(truncateToWidth(line.text, width, "…", true))
        }

        if (showBottomIndicator) {
            lines.push(
                truncateToWidth(
                    this.theme.fg("muted", `↓ ${hiddenBottomSourceLines} more line${hiddenBottomSourceLines === 1 ? "" : "s"}`),
                    width,
                    "…",
                    true,
                ),
            )
        }

        while (lines.length < safeHeight) {
            lines.push(" ".repeat(width))
        }

        return lines
    }

    private buildPreviewLines(width: number): PreviewDisplayLine[] {
        switch (this.preview.kind) {
            case "diff":
                return this.fullscreen && this.fullscreenDiffStyle === "split"
                    ? this.renderSplitDiff(this.preview, width)
                    : this.renderUnifiedDiff(this.preview, width)
            case "new-file":
                return this.renderNewFile(this.preview, width)
            case "error":
                return wrapSection(this.theme.fg("error", this.preview.error), width, this.theme).map((text) => ({
                    text,
                    sourceLineKeys: [],
                }))
        }
    }

    private renderUnifiedDiff(preview: PermissionDiffPreview, width: number): PreviewDisplayLine[] {
        if (preview.addedLines === 0 && preview.removedLines === 0) {
            return [{ text: this.theme.fg("muted", "No textual changes detected."), sourceLineKeys: [] }]
        }

        const palette = getPierrePalette(this.theme)
        const appearance = getPierreAppearance(this.theme)

        return renderUnifiedDiffLines({
            metadata: preview.metadata,
            highlighted: preview.highlighted[appearance],
            palette,
            width,
        })
    }

    private renderSplitDiff(preview: PermissionDiffPreview, width: number): PreviewDisplayLine[] {
        if (preview.addedLines === 0 && preview.removedLines === 0) {
            return [{ text: this.theme.fg("muted", "No textual changes detected."), sourceLineKeys: [] }]
        }

        const palette = getPierrePalette(this.theme)
        const appearance = getPierreAppearance(this.theme)

        return renderSplitDiffLines({
            metadata: preview.metadata,
            highlighted: preview.highlighted[appearance],
            palette,
            width,
        })
    }

    private renderNewFile(preview: PermissionNewFilePreview, width: number): PreviewDisplayLine[] {
        const language = getLanguageFromPath(preview.path)
        const rawLines = preview.content.length === 0 ? [""] : preview.content.split("\n")
        const highlighted = language ? highlightCode(preview.content, language) : undefined
        const lineNumberWidth = String(Math.max(1, rawLines.length)).length

        return rawLines.flatMap((line: string, index: number) => {
            const content = highlighted?.[index] ?? this.theme.fg("toolOutput", line)
            const lineNumberText = String(index + 1).padStart(lineNumberWidth, " ")
            const prefixText = `${lineNumberText} `
            const prefixWidth = visibleWidth(prefixText)
            const contentWidth = Math.max(1, width - prefixWidth)
            const prefix = `${this.theme.fg("muted", lineNumberText)} `
            const continuationPrefix = `${this.theme.fg("muted", " ".repeat(lineNumberWidth))} `
            const wrapped = wrapTextWithAnsi(content, contentWidth)

            if (wrapped.length === 0) {
                return [{ text: prefix, sourceLineKeys: [`new-file:${index}`] }]
            }

            return wrapped.map((segment, wrappedIndex) => ({
                text: `${wrappedIndex === 0 ? prefix : continuationPrefix}${segment}`,
                sourceLineKeys: [`new-file:${index}`],
            }))
        })
    }

    private getScrollPageSize(): number {
        return this.fullscreen ? Math.max(8, Math.floor(this.tui.terminal.rows * 0.4)) : 8
    }

    private renderBodyLine(width: number, content: string): string {
        if (this.fullscreen) {
            const bodyWidth = Math.max(1, width - 2)
            return this.renderFullscreenLine(content, bodyWidth)
        }

        const bodyWidth = Math.max(1, width - 4)
        return `${this.theme.fg("border", "│")} ${truncateToWidth(content, bodyWidth, "…", true)} ${this.theme.fg("border", "│")}`
    }

    private renderBorder(width: number, kind: "top" | "middle" | "bottom"): string {
        if (this.fullscreen) {
            const bodyWidth = Math.max(1, width - 2)
            if (kind === "middle") {
                return this.renderFullscreenLine("", bodyWidth)
            }
            return this.renderFullscreenLine("", bodyWidth)
        }

        const innerWidth = Math.max(1, width - 2)

        if (kind === "top") {
            return `${this.theme.fg("border", "┌")}${this.theme.fg("border", "─".repeat(innerWidth))}${this.theme.fg("border", "┐")}`
        }

        if (kind === "bottom") {
            return `${this.theme.fg("border", "└")}${this.theme.fg("border", "─".repeat(innerWidth))}${this.theme.fg("border", "┘")}`
        }

        return `${this.theme.fg("border", "├")}${this.theme.fg("border", "─".repeat(innerWidth))}${this.theme.fg("border", "┤")}`
    }

    private renderFullscreenLine(content: string, width: number): string {
        const prefix = `${this.theme.fg("warning", "┃")} `
        const truncated = truncateToWidth(content, width, "…", true)
        const padding = Math.max(0, width - visibleWidth(truncated))
        return `${prefix}${truncated}${" ".repeat(padding)}`
    }
}

function countSourceLines(lines: PreviewDisplayLine[]): number {
    const sourceLineKeys = new Set<string>()

    for (const line of lines) {
        for (const sourceLineKey of line.sourceLineKeys) {
            sourceLineKeys.add(sourceLineKey)
        }
    }

    return sourceLineKeys.size
}

function getOverlayOptions(state: PermissionReviewDialogState, columns: number, rows: number): OverlayOptions {
    if (state.fullscreen) {
        return {
            anchor: "top-left",
            col: FULLSCREEN_LEFT_OFFSET,
            row: FULLSCREEN_TOP_OFFSET,
            width: Math.max(70, columns - FULLSCREEN_HORIZONTAL_INSET),
            maxHeight: Math.max(FULLSCREEN_MIN_HEIGHT, rows - FULLSCREEN_TOP_OFFSET),
        }
    }

    return {
        anchor: "center",
        width: Math.max(60, Math.min(columns - 6, COMPACT_MAX_WIDTH)),
        maxHeight: Math.max(16, Math.min(rows - 6, COMPACT_MAX_HEIGHT)),
    }
}

function isToggleResult(result: PermissionReviewDialogResult): result is PermissionReviewDialogToggle {
    return typeof result === "object" && result !== null && result.kind === "toggle-fullscreen"
}

function getScrollHintLabel(): string {
    return process.platform === "darwin" ? "Fn+↑/Fn+↓" : "PgUp/PgDn"
}

function wrapSection(text: string, width: number, theme: Theme): string[] {
    if (!text) return [" ".repeat(width)]

    const lines = text
        .split("\n")
        .flatMap((line: string) => {
            const wrapped = wrapTextWithAnsi(line, width)
            return wrapped.length > 0 ? wrapped : [theme.fg("muted", "")]
        })

    return lines.map((line: string) => truncateToWidth(line, width, "…", true))
}

function formatDisplayPath(filePath: string): string {
    if (!filePath) return "(unknown path)"

    const home = process.env.HOME
    if (home && filePath.startsWith(home)) {
        return `~${filePath.slice(home.length)}`
    }

    return filePath
}

function matchesCtrlF(data: string): boolean {
    return data === "\u0006" || data === "\u001b[102;5u" || data === "\u001b[102:102;5u"
}

function matchesUnifiedLayoutShortcut(data: string): boolean {
    return data === "u" || data === "U"
}

function matchesSplitLayoutShortcut(data: string): boolean {
    return data === "s" || data === "S"
}

