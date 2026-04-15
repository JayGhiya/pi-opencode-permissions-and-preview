import {
    getHighlighterOptions,
    getSharedHighlighter,
    renderDiffWithHighlighter,
    type FileDiffMetadata,
} from "@pierre/diffs"

import type { HighlightedDiffCode, HighlightedDiffSet, PierreAppearance } from "./pierre-types.js"

const PIERRE_THEME_NAMES = {
    dark: "pierre-dark",
    light: "pierre-light",
} as const

const PIERRE_RENDER_OPTIONS = {
    dark: {
        theme: PIERRE_THEME_NAMES.dark,
        useTokenTransformer: false,
        tokenizeMaxLineLength: 1000,
        lineDiffType: "word-alt" as const,
        maxLineDiffLength: 2000,
    },
    light: {
        theme: PIERRE_THEME_NAMES.light,
        useTokenTransformer: false,
        tokenizeMaxLineLength: 1000,
        lineDiffType: "word-alt" as const,
        maxLineDiffLength: 2000,
    },
} as const

const highlighterOptionsByKey = new Map<string, ReturnType<typeof getHighlighterOptions>>()

export async function loadHighlightedDiff(metadata: FileDiffMetadata): Promise<HighlightedDiffSet> {
    const [dark, light] = await Promise.all([
        loadHighlightedDiffForAppearance(metadata, "dark"),
        loadHighlightedDiffForAppearance(metadata, "light"),
    ])

    return { dark, light }
}

async function loadHighlightedDiffForAppearance(
    metadata: FileDiffMetadata,
    appearance: PierreAppearance,
): Promise<HighlightedDiffCode> {
    try {
        const language = metadata.lang ?? "text"
        const cacheKey = `${appearance}:${language}`

        const highlighterOptions =
            highlighterOptionsByKey.get(cacheKey) ??
            getHighlighterOptions(language, {
                theme: PIERRE_THEME_NAMES[appearance],
            })

        if (!highlighterOptionsByKey.has(cacheKey)) {
            highlighterOptionsByKey.set(cacheKey, highlighterOptions)
        }

        const highlighter = await getSharedHighlighter({
            ...highlighterOptions,
            preferredHighlighter: "shiki-js",
        })

        const highlighted = renderDiffWithHighlighter(metadata, highlighter, PIERRE_RENDER_OPTIONS[appearance])

        return {
            deletionLines: highlighted.code.deletionLines as HighlightedDiffCode["deletionLines"],
            additionLines: highlighted.code.additionLines as HighlightedDiffCode["additionLines"],
        }
    } catch {
        return {
            deletionLines: [],
            additionLines: [],
        }
    }
}
