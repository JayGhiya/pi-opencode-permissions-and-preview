import {
    getLanguageFromPath,
    highlightCode,
    keyHint,
    rawKeyHint,
    renderDiff,
    type ExtensionContext,
    type KeybindingsManager,
    type Theme,
} from "@mariozechner/pi-coding-agent"
import type { Component, OverlayOptions, TUI } from "@mariozechner/pi-tui"
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui"

import { PERMISSION_CHOICES, type PermissionPromptChoice } from "./constants.js"
import type { PermissionDiffPreview, PermissionNewFilePreview, PermissionReviewPreview } from "./review-preview.js"

const COMPACT_MAX_HEIGHT = 24
const COMPACT_MAX_WIDTH = 110
const FULLSCREEN_SPLIT_WIDTH = 140
const FULLSCREEN_MIN_HEIGHT = 18
const HORIZONTAL_PADDING = 3

export async function showPermissionReviewDialog(
    ctx: ExtensionContext,
    preview: PermissionReviewPreview,
): Promise<PermissionPromptChoice | undefined> {
    let dialog: PermissionReviewDialog | undefined

    return ctx.ui.custom<PermissionPromptChoice | undefined>(
        (
            tui: TUI,
            theme: Theme,
            keybindings: KeybindingsManager,
            done: (result: PermissionPromptChoice | undefined) => void,
        ) => {
            dialog = new PermissionReviewDialog(tui, theme, keybindings, preview, done)
            return dialog
        },
        {
            overlay: true,
            overlayOptions: () => dialog?.getOverlayOptions() ?? { anchor: "center", width: 80, maxHeight: 20 },
        },
    )
}

class PermissionReviewDialog implements Component {
    private selectedIndex = 0
    private fullscreen = false
    private scrollOffset = 0

    constructor(
        private readonly tui: TUI,
        private readonly theme: Theme,
        private readonly keybindings: KeybindingsManager,
        private readonly preview: PermissionReviewPreview,
        private readonly done: (result: PermissionPromptChoice | undefined) => void,
    ) {}

    getOverlayOptions(): OverlayOptions {
        const columns = this.tui.terminal.columns
        const rows = this.tui.terminal.rows

        return {
            anchor: "center",
            width: this.fullscreen
                ? Math.max(70, Math.min(columns - 2, 160))
                : Math.max(60, Math.min(columns - 6, COMPACT_MAX_WIDTH)),
            maxHeight: this.fullscreen
                ? Math.max(FULLSCREEN_MIN_HEIGHT, Math.min(rows - 2, rows))
                : Math.max(16, Math.min(rows - 6, COMPACT_MAX_HEIGHT)),
        }
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

        if (matchesCtrlF(data)) {
            this.fullscreen = !this.fullscreen
            this.scrollOffset = 0
            this.requestRender(true)
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

        const maxHeight = this.getOverlayOptions().maxHeight
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

    private getTitle(): string {
        const action = this.preview.toolName === "edit" ? "Edit" : this.preview.kind === "new-file" ? "Create" : "Write"
        const path = formatDisplayPath(this.preview.path)
        const mode = this.fullscreen ? this.theme.fg("accent", "fullscreen") : this.theme.fg("muted", "compact")
        return `${this.theme.fg("accent", this.theme.bold(`${action} ${path}`))} ${this.theme.fg("muted", `(${mode})`)}`
    }

    private getMeta(): string {
        if (this.preview.kind === "diff") {
            const mode = this.fullscreen && this.useSplitDiffView() ? "split diff" : "unified diff"
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
        const scrollHint = rawKeyHint("PgUp/PgDn", "scroll")
        const fullscreenHint = rawKeyHint("Ctrl+F", this.fullscreen ? "compact" : "fullscreen")
        return [
            rawKeyHint("↑↓", "choose"),
            keyHint("tui.select.confirm", "select"),
            fullscreenHint,
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
        const lines: string[] = []

        if (showTopIndicator) {
            lines.push(
                truncateToWidth(
                    this.theme.fg("muted", `↑ ${clampedOffset} line${clampedOffset === 1 ? "" : "s"} above`),
                    width,
                    "…",
                    true,
                ),
            )
        }

        for (const line of visibleLines) {
            lines.push(truncateToWidth(line, width, "…", true))
        }

        if (showBottomIndicator) {
            const remaining = allLines.length - clampedOffset - contentHeight
            lines.push(
                truncateToWidth(
                    this.theme.fg("muted", `↓ ${remaining} more line${remaining === 1 ? "" : "s"}`),
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

    private buildPreviewLines(width: number): string[] {
        switch (this.preview.kind) {
            case "diff":
                return this.fullscreen && this.useSplitDiffView()
                    ? this.renderSplitDiff(this.preview, width)
                    : this.renderUnifiedDiff(this.preview, width)
            case "new-file":
                return this.renderNewFile(this.preview, width)
            case "error":
                return wrapSection(this.theme.fg("error", this.preview.error), width, this.theme)
        }
    }

    private renderUnifiedDiff(preview: PermissionDiffPreview, width: number): string[] {
        if (!preview.diff) {
            return [this.theme.fg("muted", "No textual changes detected.")]
        }

        const diffText = renderDiff(preview.diff, { filePath: preview.path })
        const baseLines = diffText.split("\n")
        if (!this.fullscreen) {
            return baseLines.map((line) => truncateToWidth(line, width, "…", true))
        }

        return baseLines.flatMap((line: string) => {
            const wrapped = wrapTextWithAnsi(line, width)
            return wrapped.length > 0 ? wrapped : [""]
        })
    }

    private renderSplitDiff(preview: PermissionDiffPreview, width: number): string[] {
        if (!preview.diff) {
            return [this.theme.fg("muted", "No textual changes detected.")]
        }

        const separator = this.theme.fg("border", " │ ")
        const columnWidth = Math.max(10, Math.floor((width - visibleWidth(separator)) / 2))
        const rows = [
            this.joinSplitColumns(
                this.theme.fg("muted", this.theme.bold("before")),
                this.theme.fg("muted", this.theme.bold("after")),
                columnWidth,
                separator,
            ),
        ]

        const entries = preview.diff.split("\n").map((line) => parseDiffEntry(line, this.theme))

        for (let index = 0; index < entries.length; ) {
            const entry = entries[index]
            if (entry.kind === "remove" || entry.kind === "add") {
                const removed: string[] = []
                const added: string[] = []

                while (entries[index]?.kind === "remove") {
                    removed.push(entries[index].formatted)
                    index += 1
                }

                while (entries[index]?.kind === "add") {
                    added.push(entries[index].formatted)
                    index += 1
                }

                const pairCount = Math.max(removed.length, added.length)
                for (let rowIndex = 0; rowIndex < pairCount; rowIndex += 1) {
                    rows.push(this.joinSplitColumns(removed[rowIndex] ?? "", added[rowIndex] ?? "", columnWidth, separator))
                }
                continue
            }

            rows.push(this.joinSplitColumns(entry.formatted, entry.formatted, columnWidth, separator))
            index += 1
        }

        return rows
    }

    private renderNewFile(preview: PermissionNewFilePreview, width: number): string[] {
        const language = getLanguageFromPath(preview.path)
        const rawLines = preview.content.length === 0 ? [""] : preview.content.split("\n")
        const highlighted = language ? highlightCode(preview.content, language) : undefined
        const lineNumberWidth = String(Math.max(1, rawLines.length)).length

        return rawLines.flatMap((line: string, index: number) => {
            const content = highlighted?.[index] ?? this.theme.fg("toolOutput", line)
            const numbered = `${this.theme.fg("muted", String(index + 1).padStart(lineNumberWidth, " "))} ${content}`
            if (!this.fullscreen) {
                return [truncateToWidth(numbered, width, "…", true)]
            }
            const wrapped = wrapTextWithAnsi(numbered, width)
            return wrapped.length > 0 ? wrapped : [""]
        })
    }

    private joinSplitColumns(left: string, right: string, columnWidth: number, separator: string): string {
        return `${truncateToWidth(left, columnWidth, "…", true)}${separator}${truncateToWidth(right, columnWidth, "…", true)}`
    }

    private useSplitDiffView(): boolean {
        return this.tui.terminal.columns >= FULLSCREEN_SPLIT_WIDTH
    }

    private getScrollPageSize(): number {
        return this.fullscreen ? Math.max(8, Math.floor(this.tui.terminal.rows * 0.4)) : 8
    }

    private renderBodyLine(width: number, content: string): string {
        const bodyWidth = Math.max(1, width - 4)
        return `${this.theme.fg("border", "│")} ${truncateToWidth(content, bodyWidth, "…", true)} ${this.theme.fg("border", "│")}`
    }

    private renderBorder(width: number, kind: "top" | "middle" | "bottom"): string {
        const innerWidth = Math.max(1, width - 2)

        if (kind === "top") {
            return `${this.theme.fg("border", "┌")}${this.theme.fg("border", "─".repeat(innerWidth))}${this.theme.fg("border", "┐")}`
        }

        if (kind === "bottom") {
            return `${this.theme.fg("border", "└")}${this.theme.fg("border", "─".repeat(innerWidth))}${this.theme.fg("border", "┘")}`
        }

        return `${this.theme.fg("border", "├")}${this.theme.fg("border", "─".repeat(innerWidth))}${this.theme.fg("border", "┤")}`
    }
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

function parseDiffEntry(line: string, theme: Theme): ParsedDiffEntry {
    if (line.startsWith("+")) {
        return { kind: "add", formatted: theme.fg("toolDiffAdded", line) }
    }
    if (line.startsWith("-")) {
        return { kind: "remove", formatted: theme.fg("toolDiffRemoved", line) }
    }
    if (line.includes("...")) {
        return { kind: "ellipsis", formatted: theme.fg("muted", line) }
    }
    return { kind: "context", formatted: theme.fg("toolDiffContext", line) }
}

interface ParsedDiffEntry {
    kind: "add" | "remove" | "context" | "ellipsis"
    formatted: string
}

