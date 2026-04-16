import { cleanLastNewline, type FileDiffMetadata } from "@pierre/diffs"
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui"

import type {
    DiffSpan,
    HastNode,
    HighlightedDiffCode,
    SplitDiffCell,
    SplitDiffRow,
    UnifiedDiffRow,
} from "./pierre-types.js"
import type { PierreTerminalPalette } from "./pierre-theme.js"

const ANSI_RESET = "\u001b[22m\u001b[39m\u001b[49m"

interface RenderSegment {
    text: string
    fg?: string
    bg?: string
    bold?: boolean
}

interface RenderStyle {
    fg?: string
    bg?: string
    bold?: boolean
}

interface RenderedSplitCell {
    lines: string[]
    sourceLineKey?: string
}

export interface PreviewDisplayLine {
    text: string
    sourceLineKeys: string[]
}

export function renderUnifiedDiffLines({
    metadata,
    highlighted,
    palette,
    width,
}: {
    metadata: FileDiffMetadata
    highlighted: HighlightedDiffCode
    palette: PierreTerminalPalette
    width: number
}): PreviewDisplayLine[] {
    const rows = buildUnifiedRows(metadata, highlighted, palette)
    const lineNumberWidth = lineNumberWidthFor(metadata)

    return rows.flatMap((row) => renderUnifiedRow(row, width, lineNumberWidth, palette))
}

export function renderSplitDiffLines({
    metadata,
    highlighted,
    palette,
    width,
}: {
    metadata: FileDiffMetadata
    highlighted: HighlightedDiffCode
    palette: PierreTerminalPalette
    width: number
}): PreviewDisplayLine[] {
    const separator = renderSegments(
        [{ text: " │ ", fg: palette.metadataFg, bg: palette.metadataBg }],
        { fg: palette.metadataFg, bg: palette.metadataBg },
    )
    const separatorWidth = visibleWidth(" │ ")
    const columnWidth = Math.max(20, Math.floor((width - separatorWidth) / 2))
    const lineNumberWidth = lineNumberWidthFor(metadata)

    const rows = buildSplitRows(metadata, highlighted, palette)
    const lines: PreviewDisplayLine[] = [{ text: renderSplitHeader(columnWidth, separator, palette), sourceLineKeys: [] }]

    for (const row of rows) {
        if (row.kind !== "line") {
            const metadataStyle = { fg: palette.metadataFg, bg: palette.metadataBg }
            const cells = renderContentCell(` ${row.text}`, columnWidth, metadataStyle, true)
            for (const cell of cells) {
                lines.push({ text: `${cell}${separator}${cell}`, sourceLineKeys: [] })
            }
            continue
        }

        const leftCells = renderSplitCell(row.left, columnWidth, lineNumberWidth, palette)
        const rightCells = renderSplitCell(row.right, columnWidth, lineNumberWidth, palette)
        const leftStyle = getLineStyle(row.left.lineType === "empty" ? "context" : row.left.lineType, palette)
        const rightStyle = getLineStyle(row.right.lineType === "empty" ? "context" : row.right.lineType, palette)
        const rowHeight = Math.max(leftCells.lines.length, rightCells.lines.length)

        for (let index = 0; index < rowHeight; index += 1) {
            const left = leftCells.lines[index] ?? padRenderedLine("", columnWidth, leftStyle)
            const right = rightCells.lines[index] ?? padRenderedLine("", columnWidth, rightStyle)
            lines.push({
                text: `${left}${separator}${right}`,
                sourceLineKeys: uniqueSourceLineKeys([
                    index < leftCells.lines.length ? leftCells.sourceLineKey : undefined,
                    index < rightCells.lines.length ? rightCells.sourceLineKey : undefined,
                ]),
            })
        }
    }

    return lines
}

function buildUnifiedRows(
    metadata: FileDiffMetadata,
    highlighted: HighlightedDiffCode,
    palette: PierreTerminalPalette,
): UnifiedDiffRow[] {
    const rows: UnifiedDiffRow[] = []

    for (const hunk of metadata.hunks) {
        if (hunk.collapsedBefore > 0) {
            rows.push({ kind: "collapsed", text: "..." })
        }

        let deletionLineIndex = hunk.deletionLineIndex
        let additionLineIndex = hunk.additionLineIndex
        let deletionLineNumber = hunk.deletionStart
        let additionLineNumber = hunk.additionStart

        for (const content of hunk.hunkContent) {
            if (content.type === "context") {
                for (let offset = 0; offset < content.lines; offset += 1) {
                    rows.push({
                        kind: "line",
                        lineType: "context",
                        lineNumber: additionLineNumber + offset,
                        spans: flattenHighlightedLine(
                            highlighted.additionLines[additionLineIndex + offset],
                            palette,
                            palette.contextRowBg,
                            cleanDiffLine(metadata.additionLines[additionLineIndex + offset]),
                        ),
                    })
                }

                deletionLineIndex += content.lines
                additionLineIndex += content.lines
                deletionLineNumber += content.lines
                additionLineNumber += content.lines
                continue
            }

            for (let offset = 0; offset < content.deletions; offset += 1) {
                rows.push({
                    kind: "line",
                    lineType: "deletion",
                    lineNumber: deletionLineNumber + offset,
                    spans: flattenHighlightedLine(
                        highlighted.deletionLines[deletionLineIndex + offset],
                        palette,
                        palette.deletionRowBg,
                        cleanDiffLine(metadata.deletionLines[deletionLineIndex + offset]),
                    ),
                })
            }

            for (let offset = 0; offset < content.additions; offset += 1) {
                rows.push({
                    kind: "line",
                    lineType: "addition",
                    lineNumber: additionLineNumber + offset,
                    spans: flattenHighlightedLine(
                        highlighted.additionLines[additionLineIndex + offset],
                        palette,
                        palette.additionRowBg,
                        cleanDiffLine(metadata.additionLines[additionLineIndex + offset]),
                    ),
                })
            }

            deletionLineIndex += content.deletions
            additionLineIndex += content.additions
            deletionLineNumber += content.deletions
            additionLineNumber += content.additions
        }

        if (hunk.noEOFCRDeletions || hunk.noEOFCRAdditions) {
            rows.push({
                kind: "metadata",
                text: "\\ No newline at end of file",
            })
        }
    }

    const trailing = trailingCollapsedLines(metadata)
    if (trailing > 0) {
        rows.push({ kind: "collapsed", text: "..." })
    }

    return rows
}

function buildSplitRows(
    metadata: FileDiffMetadata,
    highlighted: HighlightedDiffCode,
    palette: PierreTerminalPalette,
): SplitDiffRow[] {
    const rows: SplitDiffRow[] = []

    for (const hunk of metadata.hunks) {
        if (hunk.collapsedBefore > 0) {
            rows.push({ kind: "collapsed", text: "..." })
        }

        let deletionLineIndex = hunk.deletionLineIndex
        let additionLineIndex = hunk.additionLineIndex
        let deletionLineNumber = hunk.deletionStart
        let additionLineNumber = hunk.additionStart

        for (const content of hunk.hunkContent) {
            if (content.type === "context") {
                for (let offset = 0; offset < content.lines; offset += 1) {
                    rows.push({
                        kind: "line",
                        left: {
                            lineType: "context",
                            lineNumber: deletionLineNumber + offset,
                            spans: flattenHighlightedLine(
                                highlighted.deletionLines[deletionLineIndex + offset],
                                palette,
                                palette.contextRowBg,
                                cleanDiffLine(metadata.deletionLines[deletionLineIndex + offset]),
                            ),
                        },
                        right: {
                            lineType: "context",
                            lineNumber: additionLineNumber + offset,
                            spans: flattenHighlightedLine(
                                highlighted.additionLines[additionLineIndex + offset],
                                palette,
                                palette.contextRowBg,
                                cleanDiffLine(metadata.additionLines[additionLineIndex + offset]),
                            ),
                        },
                    })
                }

                deletionLineIndex += content.lines
                additionLineIndex += content.lines
                deletionLineNumber += content.lines
                additionLineNumber += content.lines
                continue
            }

            const pairCount = Math.max(content.deletions, content.additions)
            for (let offset = 0; offset < pairCount; offset += 1) {
                const hasDeletion = offset < content.deletions
                const hasAddition = offset < content.additions

                rows.push({
                    kind: "line",
                    left: hasDeletion
                        ? {
                              lineType: "deletion",
                              lineNumber: deletionLineNumber + offset,
                              spans: flattenHighlightedLine(
                                  highlighted.deletionLines[deletionLineIndex + offset],
                                  palette,
                                  palette.deletionRowBg,
                                  cleanDiffLine(metadata.deletionLines[deletionLineIndex + offset]),
                              ),
                          }
                        : {
                              lineType: "empty",
                              lineNumber: undefined,
                              spans: [],
                          },
                    right: hasAddition
                        ? {
                              lineType: "addition",
                              lineNumber: additionLineNumber + offset,
                              spans: flattenHighlightedLine(
                                  highlighted.additionLines[additionLineIndex + offset],
                                  palette,
                                  palette.additionRowBg,
                                  cleanDiffLine(metadata.additionLines[additionLineIndex + offset]),
                              ),
                          }
                        : {
                              lineType: "empty",
                              lineNumber: undefined,
                              spans: [],
                          },
                })
            }

            deletionLineIndex += content.deletions
            additionLineIndex += content.additions
            deletionLineNumber += content.deletions
            additionLineNumber += content.additions
        }

        if (hunk.noEOFCRDeletions || hunk.noEOFCRAdditions) {
            rows.push({
                kind: "metadata",
                text: "\\ No newline at end of file",
            })
        }
    }

    const trailing = trailingCollapsedLines(metadata)
    if (trailing > 0) {
        rows.push({ kind: "collapsed", text: "..." })
    }

    return rows
}

function renderUnifiedRow(
    row: UnifiedDiffRow,
    width: number,
    lineNumberWidth: number,
    palette: PierreTerminalPalette,
): PreviewDisplayLine[] {
    if (row.kind !== "line") {
        return renderContentCell(` ${row.text}`, width, { fg: palette.metadataFg, bg: palette.metadataBg }, true).map((text) => ({
            text,
            sourceLineKeys: [],
        }))
    }

    const style = getLineStyle(row.lineType, palette)
    const prefixText = `${lineMarker(row.lineType)}${formatLineNumber(row.lineNumber, lineNumberWidth)} `
    const prefixWidth = visibleWidth(prefixText)
    const contentWidth = Math.max(8, width - prefixWidth)

    const prefix = renderSegments(
        [
            { text: lineMarker(row.lineType), fg: style.fg, bg: style.bg },
            { text: formatLineNumber(row.lineNumber, lineNumberWidth), fg: palette.lineNumberFg, bg: style.bg },
            { text: " ", fg: palette.lineNumberFg, bg: style.bg },
        ],
        { fg: style.fg, bg: style.bg },
    )

    const continuationPrefix = renderSegments(
        [{ text: " ".repeat(prefixWidth), fg: style.fg, bg: style.bg }],
        { fg: style.fg, bg: style.bg },
    )

    const content = renderSegments(row.spans.length > 0 ? row.spans : [{ text: " " }], { fg: style.fg, bg: style.bg })
    const wrapped = wrapTextWithAnsi(content, contentWidth)
    const sourceLineKey = getUnifiedSourceLineKey(row)
    if (wrapped.length === 0) {
        return [{ text: padRenderedLine(`${prefix}`, width, style), sourceLineKeys: [sourceLineKey] }]
    }

    return wrapped.map((segment, index) => ({
        text: padRenderedLine(`${index === 0 ? prefix : continuationPrefix}${segment}`, width, style),
        sourceLineKeys: [sourceLineKey],
    }))
}

function renderSplitCell(
    cell: SplitDiffCell,
    width: number,
    lineNumberWidth: number,
    palette: PierreTerminalPalette,
): RenderedSplitCell {
    const style = getLineStyle(cell.lineType === "empty" ? "context" : cell.lineType, palette)

    if (cell.lineType === "empty") {
        return { lines: [padRenderedLine("", width, style)] }
    }

    const prefixText = `${lineMarker(cell.lineType)}${formatLineNumber(cell.lineNumber, lineNumberWidth)} `
    const prefixWidth = visibleWidth(prefixText)
    const contentWidth = Math.max(6, width - prefixWidth)

    const prefix = renderSegments(
        [
            { text: lineMarker(cell.lineType), fg: style.fg, bg: style.bg },
            { text: formatLineNumber(cell.lineNumber, lineNumberWidth), fg: palette.lineNumberFg, bg: style.bg },
            { text: " ", fg: palette.lineNumberFg, bg: style.bg },
        ],
        { fg: style.fg, bg: style.bg },
    )

    const continuationPrefix = renderSegments(
        [{ text: " ".repeat(prefixWidth), fg: style.fg, bg: style.bg }],
        { fg: style.fg, bg: style.bg },
    )

    const content = renderSegments(cell.spans.length > 0 ? cell.spans : [{ text: " " }], { fg: style.fg, bg: style.bg })
    const wrapped = wrapTextWithAnsi(content, contentWidth)
    const sourceLineKey = getSplitCellSourceLineKey(cell)
    if (wrapped.length === 0) {
        return { lines: [padRenderedLine(`${prefix}`, width, style)], sourceLineKey }
    }

    return {
        lines: wrapped.map((segment, index) =>
            padRenderedLine(`${index === 0 ? prefix : continuationPrefix}${segment}`, width, style),
        ),
        sourceLineKey,
    }
}

function renderSplitHeader(columnWidth: number, separator: string, palette: PierreTerminalPalette): string {
    const left = renderContentCell(" before", columnWidth, { fg: palette.splitHeaderFg, bg: palette.splitHeaderBg }, false)[0]
    const right = renderContentCell(" after", columnWidth, { fg: palette.splitHeaderFg, bg: palette.splitHeaderBg }, false)[0]
    return `${left}${separator}${right}`
}

function renderContentCell(text: string, width: number, style: RenderStyle, wrap: boolean): string[] {
    const content = renderSegments([{ text }], style)

    if (!wrap) {
        return [padRenderedLine(content, width, style)]
    }

    const wrapped = wrapTextWithAnsi(content, width)
    if (wrapped.length === 0) {
        return [padRenderedLine("", width, style)]
    }

    return wrapped.map((line) => padRenderedLine(line, width, style))
}

function flattenHighlightedLine(
    node: HastNode | undefined,
    palette: PierreTerminalPalette,
    emphasisBg: string,
    fallbackText: string,
): DiffSpan[] {
    const spans: DiffSpan[] = []
    const colorVariable = palette.appearance === "light" ? "--diffs-token-light" : "--diffs-token-dark"

    const visit = (current: HastNode | undefined, inherited: Pick<DiffSpan, "fg" | "bg">) => {
        if (!current) {
            return
        }

        if (current.type === "text") {
            mergeSpan(spans, {
                text: tabify(cleanLastNewline(current.value).replace(/\r/g, "")),
                fg: inherited.fg,
                bg: inherited.bg,
            })
            return
        }

        const properties = current.properties ?? {}
        const styles = parseStyleValue(properties.style)
        const nextStyle: Pick<DiffSpan, "fg" | "bg"> = {
            fg: styles.get(colorVariable) ?? styles.get("color") ?? inherited.fg,
            bg: Object.prototype.hasOwnProperty.call(properties, "data-diff-span") ? emphasisBg : inherited.bg,
        }

        for (const child of current.children ?? []) {
            visit(child, nextStyle)
        }
    }

    visit(node, {})

    if (spans.length > 0) {
        return spans
    }

    return fallbackText.length > 0 ? [{ text: fallbackText }] : []
}

function parseStyleValue(styleValue: unknown) {
    const styles = new Map<string, string>()
    if (typeof styleValue !== "string") {
        return styles
    }

    for (const segment of styleValue.split(";")) {
        const separator = segment.indexOf(":")
        if (separator <= 0) {
            continue
        }

        const key = segment.slice(0, separator).trim()
        const value = segment.slice(separator + 1).trim()
        if (key && value) {
            styles.set(key, value)
        }
    }

    return styles
}

function cleanDiffLine(line: string | undefined) {
    return tabify(cleanLastNewline(line ?? "").replace(/\r/g, ""))
}

function trailingCollapsedLines(metadata: FileDiffMetadata) {
    const lastHunk = metadata.hunks.length > 0 ? metadata.hunks[metadata.hunks.length - 1] : undefined
    if (!lastHunk || metadata.isPartial) {
        return 0
    }

    const additionRemaining = metadata.additionLines.length - (lastHunk.additionLineIndex + lastHunk.additionCount)
    const deletionRemaining = metadata.deletionLines.length - (lastHunk.deletionLineIndex + lastHunk.deletionCount)

    if (additionRemaining !== deletionRemaining) {
        return 0
    }

    return Math.max(additionRemaining, 0)
}

function getUnifiedSourceLineKey(row: Extract<UnifiedDiffRow, { kind: "line" }>): string {
    return `${row.lineType}:${row.lineNumber}`
}

function getSplitCellSourceLineKey(cell: SplitDiffCell): string | undefined {
    if (cell.lineType === "empty" || cell.lineNumber === undefined) {
        return undefined
    }

    return `${cell.lineType === "context" ? "context" : cell.lineType}:${cell.lineNumber}`
}

function uniqueSourceLineKeys(keys: Array<string | undefined>): string[] {
    return [...new Set(keys.filter((key): key is string => key !== undefined))]
}

function lineNumberWidthFor(metadata: FileDiffMetadata): number {
    return Math.max(3, String(Math.max(metadata.deletionLines.length, metadata.additionLines.length, 1)).length)
}

function lineMarker(type: "context" | "addition" | "deletion"): string {
    return type === "addition" ? "+" : type === "deletion" ? "-" : " "
}

function formatLineNumber(lineNumber: number | undefined, width: number): string {
    return lineNumber === undefined ? " ".repeat(width) : String(lineNumber).padStart(width, " ")
}

function getLineStyle(
    lineType: "context" | "addition" | "deletion",
    palette: PierreTerminalPalette,
): { fg: string; bg: string } {
    if (lineType === "addition") {
        return { fg: palette.additionFg, bg: palette.additionRowBg }
    }

    if (lineType === "deletion") {
        return { fg: palette.deletionFg, bg: palette.deletionRowBg }
    }

    return { fg: palette.contextFg, bg: palette.contextRowBg }
}

function renderSegments(segments: DiffSpan[] | RenderSegment[], base: RenderStyle): string {
    let output = openAnsi(base)

    for (const segment of segments) {
        output += openAnsi({
            fg: segment.fg ?? base.fg,
            bg: segment.bg ?? base.bg,
            bold: "bold" in segment ? segment.bold ?? base.bold : base.bold,
        })
        output += segment.text
    }

    output += openAnsi(base)
    return output
}

function openAnsi(style: RenderStyle): string {
    const codes: string[] = []
    codes.push(style.bold ? "1" : "22")

    const fg = toRgb(style.fg)
    if (fg) {
        codes.push(`38;2;${fg.r};${fg.g};${fg.b}`)
    } else {
        codes.push("39")
    }

    const bg = toRgb(style.bg)
    if (bg) {
        codes.push(`48;2;${bg.r};${bg.g};${bg.b}`)
    } else {
        codes.push("49")
    }

    return `\u001b[${codes.join(";")}m`
}

function toRgb(color: string | undefined): { r: number; g: number; b: number } | undefined {
    const normalized = color?.trim()
    if (!normalized) {
        return undefined
    }

    const fullHex = normalized.match(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
    if (fullHex) {
        const hex = fullHex[1].slice(0, 6)
        return {
            r: Number.parseInt(hex.slice(0, 2), 16),
            g: Number.parseInt(hex.slice(2, 4), 16),
            b: Number.parseInt(hex.slice(4, 6), 16),
        }
    }

    return undefined
}

function padRenderedLine(line: string, width: number, base: RenderStyle): string {
    const truncated = truncateToWidth(line, width, "…", true)
    const padding = Math.max(0, width - visibleWidth(truncated))
    return `${truncated}${openAnsi(base)}${" ".repeat(padding)}${ANSI_RESET}`
}

function tabify(text: string): string {
    return text.replace(/\t/g, "    ")
}

function mergeSpan(target: DiffSpan[], next: DiffSpan) {
    if (next.text.length === 0) {
        return
    }

    const previous = target[target.length - 1]
    if (previous && previous.fg === next.fg && previous.bg === next.bg) {
        previous.text += next.text
        return
    }

    target.push(next)
}
