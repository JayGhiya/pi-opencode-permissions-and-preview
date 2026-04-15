import * as Diff from "diff"
import { constants } from "node:fs"
import { access, readFile } from "node:fs/promises"
import * as os from "node:os"
import { isAbsolute, resolve as resolvePath } from "node:path"


export interface PermissionEditPreviewInput {
    path: string
    edits: PermissionEditReplacement[]
}

export interface PermissionEditReplacement {
    oldText: string
    newText: string
}

export interface PermissionWritePreviewInput {
    path: string
    content: string
}

export type PermissionReviewPreview = PermissionDiffPreview | PermissionNewFilePreview | PermissionReviewErrorPreview

export interface PermissionDiffPreview {
    kind: "diff"
    toolName: "edit" | "write"
    path: string
    diff: string
    firstChangedLine: number | undefined
    addedLines: number
    removedLines: number
}

export interface PermissionNewFilePreview {
    kind: "new-file"
    toolName: "write"
    path: string
    content: string
    byteLength: number
    lineCount: number
}

export interface PermissionReviewErrorPreview {
    kind: "error"
    toolName: "edit" | "write"
    path: string
    error: string
}

export async function buildEditPermissionPreview(
    input: PermissionEditPreviewInput,
    cwd: string,
): Promise<PermissionReviewPreview> {
    const absolutePath = resolveToCwd(input.path, cwd)

    try {
        await access(absolutePath, constants.R_OK)
    } catch {
        return {
            kind: "error",
            toolName: "edit",
            path: input.path,
            error: `File not found: ${input.path}`,
        }
    }

    try {
        const rawContent = await readFile(absolutePath, "utf-8")
        const { text: content } = stripBom(rawContent)
        const normalizedContent = normalizeToLF(content)
        const { baseContent, newContent } = applyEditsToNormalizedContent(normalizedContent, input.edits, input.path)
        const { diff, firstChangedLine } = generateDiffString(baseContent, newContent)
        const stats = summarizeDiff(diff)

        return {
            kind: "diff",
            toolName: "edit",
            path: input.path,
            diff,
            firstChangedLine,
            addedLines: stats.addedLines,
            removedLines: stats.removedLines,
        }
    } catch (error) {
        return {
            kind: "error",
            toolName: "edit",
            path: input.path,
            error: error instanceof Error ? error.message : String(error),
        }
    }
}

export async function buildWritePermissionPreview(
    input: PermissionWritePreviewInput,
    cwd: string,
): Promise<PermissionReviewPreview> {
    const absolutePath = resolveToCwd(input.path, cwd)
    const exists = await fileExists(absolutePath)

    if (!exists) {
        return {
            kind: "new-file",
            toolName: "write",
            path: input.path,
            content: normalizeToLF(input.content),
            byteLength: Buffer.byteLength(input.content, "utf-8"),
            lineCount: countLines(input.content),
        }
    }

    try {
        const existingContent = normalizeToLF(await readFile(absolutePath, "utf-8"))
        const nextContent = normalizeToLF(input.content)
        const { diff, firstChangedLine } = generateDiffString(existingContent, nextContent)
        const stats = summarizeDiff(diff)

        return {
            kind: "diff",
            toolName: "write",
            path: input.path,
            diff,
            firstChangedLine,
            addedLines: stats.addedLines,
            removedLines: stats.removedLines,
        }
    } catch (error) {
        return {
            kind: "error",
            toolName: "write",
            path: input.path,
            error: error instanceof Error ? error.message : String(error),
        }
    }
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path, constants.F_OK)
        return true
    } catch {
        return false
    }
}

function countLines(text: string): number {
    if (text.length === 0) return 0
    return normalizeToLF(text).split("\n").length
}

function summarizeDiff(diff: string): { addedLines: number; removedLines: number } {
    if (!diff) {
        return { addedLines: 0, removedLines: 0 }
    }

    let addedLines = 0
    let removedLines = 0

    for (const line of diff.split("\n")) {
        if (line.startsWith("+")) addedLines += 1
        if (line.startsWith("-")) removedLines += 1
    }

    return { addedLines, removedLines }
}

function normalizeAtPrefix(filePath: string): string {
    return filePath.startsWith("@") ? filePath.slice(1) : filePath
}

function expandPath(filePath: string): string {
    const normalized = normalizeAtPrefix(filePath)
    if (normalized === "~") return os.homedir()
    if (normalized.startsWith("~/")) return `${os.homedir()}${normalized.slice(1)}`
    return normalized
}

function resolveToCwd(filePath: string, cwd: string): string {
    const expanded = expandPath(filePath)
    if (isAbsolute(expanded)) return expanded
    return resolvePath(cwd, expanded)
}

// Ported from Pi's internal edit diff helpers so permission review can preview
// edit proposals before execution without relying on non-exported APIs.
function normalizeToLF(text: string): string {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function normalizeForFuzzyMatch(text: string): string {
    return text
        .normalize("NFKC")
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
        .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")
}

function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
    const exactIndex = content.indexOf(oldText)
    if (exactIndex !== -1) {
        return {
            found: true,
            index: exactIndex,
            matchLength: oldText.length,
            usedFuzzyMatch: false,
        }
    }

    const fuzzyContent = normalizeForFuzzyMatch(content)
    const fuzzyOldText = normalizeForFuzzyMatch(oldText)
    const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText)

    if (fuzzyIndex === -1) {
        return {
            found: false,
            index: -1,
            matchLength: 0,
            usedFuzzyMatch: false,
        }
    }

    return {
        found: true,
        index: fuzzyIndex,
        matchLength: fuzzyOldText.length,
        usedFuzzyMatch: true,
    }
}

function stripBom(content: string): { bom: string; text: string } {
    return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content }
}

function countOccurrences(content: string, oldText: string): number {
    const fuzzyContent = normalizeForFuzzyMatch(content)
    const fuzzyOldText = normalizeForFuzzyMatch(oldText)
    return fuzzyContent.split(fuzzyOldText).length - 1
}

function getNotFoundError(path: string, editIndex: number, totalEdits: number): Error {
    if (totalEdits === 1) {
        return new Error(
            `Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`,
        )
    }

    return new Error(
        `Could not find edits[${editIndex}] in ${path}. The oldText must match exactly including all whitespace and newlines.`,
    )
}

function getDuplicateError(path: string, editIndex: number, totalEdits: number, occurrences: number): Error {
    if (totalEdits === 1) {
        return new Error(
            `Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
        )
    }

    return new Error(
        `Found ${occurrences} occurrences of edits[${editIndex}] in ${path}. Each oldText must be unique. Please provide more context to make it unique.`,
    )
}

function getEmptyOldTextError(path: string, editIndex: number, totalEdits: number): Error {
    if (totalEdits === 1) {
        return new Error(`oldText must not be empty in ${path}.`)
    }
    return new Error(`edits[${editIndex}].oldText must not be empty in ${path}.`)
}

function getNoChangeError(path: string, totalEdits: number): Error {
    if (totalEdits === 1) {
        return new Error(
            `No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
        )
    }
    return new Error(`No changes made to ${path}. The replacements produced identical content.`)
}

interface MatchedEdit {
    editIndex: number
    matchIndex: number
    matchLength: number
    newText: string
}

function applyEditsToNormalizedContent(
    normalizedContent: string,
    edits: PermissionEditPreviewInput["edits"],
    path: string,
): { baseContent: string; newContent: string } {
    const normalizedEdits = edits.map((edit: PermissionEditReplacement) => ({
        oldText: normalizeToLF(edit.oldText),
        newText: normalizeToLF(edit.newText),
    }))

    for (let index = 0; index < normalizedEdits.length; index += 1) {
        if (normalizedEdits[index].oldText.length === 0) {
            throw getEmptyOldTextError(path, index, normalizedEdits.length)
        }
    }

    const initialMatches = normalizedEdits.map((edit: PermissionEditReplacement) =>
        fuzzyFindText(normalizedContent, edit.oldText),
    )
    const baseContent = initialMatches.some((match) => match.usedFuzzyMatch)
        ? normalizeForFuzzyMatch(normalizedContent)
        : normalizedContent

    const matchedEdits = normalizedEdits.map((edit: PermissionEditReplacement, index: number) => {
        const matchResult = fuzzyFindText(baseContent, edit.oldText)
        if (!matchResult.found) {
            throw getNotFoundError(path, index, normalizedEdits.length)
        }

        const occurrences = countOccurrences(baseContent, edit.oldText)
        if (occurrences > 1) {
            throw getDuplicateError(path, index, normalizedEdits.length, occurrences)
        }

        return {
            editIndex: index,
            matchIndex: matchResult.index,
            matchLength: matchResult.matchLength,
            newText: edit.newText,
        }
    })

    matchedEdits.sort((left: MatchedEdit, right: MatchedEdit) => left.matchIndex - right.matchIndex)

    for (let index = 1; index < matchedEdits.length; index += 1) {
        const previous = matchedEdits[index - 1]
        const current = matchedEdits[index]
        if (previous.matchIndex + previous.matchLength > current.matchIndex) {
            throw new Error(
                `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`,
            )
        }
    }

    let newContent = baseContent
    for (let index = matchedEdits.length - 1; index >= 0; index -= 1) {
        const edit = matchedEdits[index]
        newContent =
            newContent.substring(0, edit.matchIndex) +
            edit.newText +
            newContent.substring(edit.matchIndex + edit.matchLength)
    }

    if (baseContent === newContent) {
        throw getNoChangeError(path, normalizedEdits.length)
    }

    return { baseContent, newContent }
}

function generateDiffString(
    oldContent: string,
    newContent: string,
    contextLines = 4,
): { diff: string; firstChangedLine: number | undefined } {
    const parts = Diff.diffLines(oldContent, newContent)
    const output: string[] = []
    const oldLines = oldContent.split("\n")
    const newLines = newContent.split("\n")
    const maxLineNum = Math.max(oldLines.length, newLines.length)
    const lineNumWidth = String(maxLineNum).length

    let oldLineNum = 1
    let newLineNum = 1
    let lastWasChange = false
    let firstChangedLine: number | undefined

    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index]
        const raw = part.value.split("\n")
        if (raw[raw.length - 1] === "") raw.pop()

        if (part.added || part.removed) {
            if (firstChangedLine === undefined) {
                firstChangedLine = newLineNum
            }

            for (const line of raw) {
                if (part.added) {
                    output.push(`+${String(newLineNum).padStart(lineNumWidth, " ")} ${line}`)
                    newLineNum += 1
                } else {
                    output.push(`-${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`)
                    oldLineNum += 1
                }
            }

            lastWasChange = true
            continue
        }

        const nextPartIsChange = index < parts.length - 1 && Boolean(parts[index + 1].added || parts[index + 1].removed)
        const hasLeadingChange = lastWasChange
        const hasTrailingChange = nextPartIsChange

        if (hasLeadingChange && hasTrailingChange) {
            if (raw.length <= contextLines * 2) {
                for (const line of raw) {
                    output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`)
                    oldLineNum += 1
                    newLineNum += 1
                }
            } else {
                const leadingLines = raw.slice(0, contextLines)
                const trailingLines = raw.slice(raw.length - contextLines)
                const skippedLines = raw.length - leadingLines.length - trailingLines.length

                for (const line of leadingLines) {
                    output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`)
                    oldLineNum += 1
                    newLineNum += 1
                }

                output.push(` ${"".padStart(lineNumWidth, " ")} ...`)
                oldLineNum += skippedLines
                newLineNum += skippedLines

                for (const line of trailingLines) {
                    output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`)
                    oldLineNum += 1
                    newLineNum += 1
                }
            }
        } else if (hasLeadingChange) {
            const shownLines = raw.slice(0, contextLines)
            const skippedLines = raw.length - shownLines.length

            for (const line of shownLines) {
                output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`)
                oldLineNum += 1
                newLineNum += 1
            }

            if (skippedLines > 0) {
                output.push(` ${"".padStart(lineNumWidth, " ")} ...`)
                oldLineNum += skippedLines
                newLineNum += skippedLines
            }
        } else if (hasTrailingChange) {
            const skippedLines = Math.max(0, raw.length - contextLines)
            if (skippedLines > 0) {
                output.push(` ${"".padStart(lineNumWidth, " ")} ...`)
                oldLineNum += skippedLines
                newLineNum += skippedLines
            }

            for (const line of raw.slice(skippedLines)) {
                output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`)
                oldLineNum += 1
                newLineNum += 1
            }
        } else {
            oldLineNum += raw.length
            newLineNum += raw.length
        }

        lastWasChange = false
    }

    return { diff: output.join("\n"), firstChangedLine }
}

interface FuzzyMatchResult {
    found: boolean
    index: number
    matchLength: number
    usedFuzzyMatch: boolean
}
