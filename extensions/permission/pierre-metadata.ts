import {
    getFiletypeFromFileName,
    parseDiffFromFile,
    setLanguageOverride,
    type FileContents,
    type FileDiffMetadata,
} from "@pierre/diffs"

import type { PermissionDiffSnapshot, PermissionDiffSummary } from "./pierre-types.js"

export function buildDiffMetadata(snapshot: PermissionDiffSnapshot): FileDiffMetadata {
    const oldFile: FileContents = {
        name: snapshot.path,
        contents: snapshot.oldContent,
    }
    const newFile: FileContents = {
        name: snapshot.path,
        contents: snapshot.newContent,
    }

    const metadata = parseDiffFromFile(oldFile, newFile, undefined, true)
    return normalizeDiffMetadataLanguage(metadata, snapshot.path)
}

export function summarizeDiffMetadata(metadata: FileDiffMetadata): PermissionDiffSummary {
    let addedLines = 0
    let removedLines = 0

    for (const hunk of metadata.hunks) {
        addedLines += hunk.additionLines
        removedLines += hunk.deletionLines
    }

    const firstHunk = metadata.hunks[0]
    const candidates: number[] = []
    if (firstHunk) {
        if (firstHunk.additionCount > 0) candidates.push(firstHunk.additionStart)
        if (firstHunk.deletionCount > 0) candidates.push(firstHunk.deletionStart)
    }

    return {
        firstChangedLine: candidates.length > 0 ? Math.min(...candidates) : undefined,
        addedLines,
        removedLines,
    }
}

function normalizeDiffMetadataLanguage(metadata: FileDiffMetadata, path: string): FileDiffMetadata {
    const language = metadata.lang ?? getFiletypeFromFileName(path)
    return language ? setLanguageOverride(metadata, language) : metadata
}
