/**
 * Web Search Extension
 *
 * Registers a `web_search` tool using Google Custom Search JSON API.
 * 100 free queries/day.
 *
 * Auth: GOOGLE_API_KEY + GOOGLE_CSE_ID from env vars or settings.
 *
 * Settings file: web-search.settings.json (3-tier loading)
 *   ~/<agent-dir>/web-search.settings.json             (global)
 *   <repo-root>/.agents/web-search.settings.json       (project, committed)
 *   <repo-root>/.agents/web-search.settings.local.json (project, gitignored)
 *
 * Schema:
 * {
 *   "apiKey": "...",
 *   "cseId": "..."
 * }
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent"
import { Type } from "@mariozechner/pi-ai"

import * as project from "../__lib/project.js"

const EXTENSION = "web-search"

interface WebSearchSettings {
    apiKey?: string
    cseId?: string
}

interface SearchResultItem {
    title?: string
    link?: string
    snippet?: string
}

interface SearchResponse {
    items?: SearchResultItem[]
    error?: { message?: string }
}

export default async function (pi: ExtensionAPI) {
    const settings = project.loadExtensionSettings<WebSearchSettings>(EXTENSION, process.cwd(), mergeSettings)

    pi.registerTool({
        name: "web_search",
        label: "web_search",
        description:
            "Search the web using Google Custom Search. Returns the top 10 results with title, URL, and snippet.",
        parameters: Type.Object({
            query: Type.String({ description: "The search query" }),
        }),

        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
            const apiKey = process.env.GOOGLE_API_KEY ?? settings.apiKey
            const cseId = process.env.GOOGLE_CSE_ID ?? settings.cseId

            if (!apiKey || !cseId) {
                return {
                    details: undefined,
                    content: [
                        {
                            type: "text" as const,
                            text: "Web search is not configured. Set GOOGLE_API_KEY and GOOGLE_CSE_ID as environment variables, or add them to web-search.settings.json (apiKey, cseId).",
                        },
                    ],
                }
            }

            const query = (params as { query: string }).query
            const url = new URL("https://www.googleapis.com/customsearch/v1")
            url.searchParams.set("key", apiKey)
            url.searchParams.set("cx", cseId)
            url.searchParams.set("q", query)
            url.searchParams.set("num", "10")

            try {
                const response = await fetch(url.toString(), {
                    signal: signal ?? undefined,
                })

                if (!response.ok) {
                    const body = await response.text()
                    return {
                        details: undefined,
                        content: [
                            {
                                type: "text" as const,
                                text: `Google Search API error: HTTP ${response.status}\n${body}`,
                            },
                        ],
                    }
                }

                const data = (await response.json()) as SearchResponse

                if (data.error) {
                    return {
                        details: undefined,
                        content: [
                            {
                                type: "text" as const,
                                text: `Google Search API error: ${data.error.message ?? JSON.stringify(data.error)}`,
                            },
                        ],
                    }
                }

                const items = data.items ?? []

                if (items.length === 0) {
                    return {
                        details: undefined,
                        content: [
                            {
                                type: "text" as const,
                                text: `No results found for: ${query}`,
                            },
                        ],
                    }
                }

                const text = items
                    .map((item, i) => {
                        const title = item.title ?? "(no title)"
                        const link = item.link ?? ""
                        const snippet = item.snippet ?? ""
                        return `${i + 1}. ${title}\n   ${link}\n   ${snippet}`
                    })
                    .join("\n\n")

                return {
                    details: undefined,
                    content: [{ type: "text" as const, text }],
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err)
                return {
                    details: undefined,
                    content: [
                        {
                            type: "text" as const,
                            text: `Web search failed: ${message}`,
                        },
                    ],
                }
            }
        },
    })

    const apiKey = process.env.GOOGLE_API_KEY ?? settings.apiKey
    const cseId = process.env.GOOGLE_CSE_ID ?? settings.cseId
    if (!apiKey || !cseId) {
        const missing: string[] = []
        if (!apiKey) missing.push("GOOGLE_API_KEY")
        if (!cseId) missing.push("GOOGLE_CSE_ID")
        const announceStartup = (ctx: ExtensionContext) => {
            ctx.ui.setWidget(`${EXTENSION}:startup`, [`Missing: ${missing.join(", ")}`])
        }
        pi.on("session_start", async (_event, ctx) => announceStartup(ctx))
        pi.on("session_switch", async (_event, ctx) => announceStartup(ctx))
    }
}

function mergeSettings(
    base: Partial<WebSearchSettings>,
    override: Partial<WebSearchSettings>,
): Partial<WebSearchSettings> {
    return {
        apiKey: override.apiKey ?? base.apiKey,
        cseId: override.cseId ?? base.cseId,
    }
}
