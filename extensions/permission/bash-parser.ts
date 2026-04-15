import { createRequire } from "node:module"

import { Language, type Node, Parser } from "web-tree-sitter"

const require = createRequire(import.meta.url)

// Mirrors the upstream OpenCode bash tool extraction flow in
// /tmp/pi-github-repos/anomalyco/opencode/packages/opencode/src/tool/bash.ts
// for bash-only permission parsing.
const CWD = new Set(["cd"])

export interface ExtractedBashCommand {
    text: string
    tokens: string[]
}

type Part = {
    type: string
    text: string
}

let parserPromise: Promise<Parser> | undefined

function parser() {
    if (!parserPromise) {
        parserPromise = createParser()
    }
    return parserPromise
}

async function createParser(): Promise<Parser> {
    await Parser.init({
        locateFile() {
            return require.resolve("web-tree-sitter/web-tree-sitter.wasm")
        },
    })

    const language = await Language.load(require.resolve("tree-sitter-bash/tree-sitter-bash.wasm"))
    const parser = new Parser()
    parser.setLanguage(language)
    return parser
}

function parts(node: Node) {
    const out: Part[] = []
    for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (!child) continue
        if (child.type === "command_elements") {
            for (let j = 0; j < child.childCount; j++) {
                const item = child.child(j)
                if (!item || item.type === "command_argument_sep" || item.type === "redirection") continue
                out.push({ type: item.type, text: item.text })
            }
            continue
        }
        if (
            child.type !== "command_name" &&
            child.type !== "command_name_expr" &&
            child.type !== "word" &&
            child.type !== "string" &&
            child.type !== "raw_string" &&
            child.type !== "concatenation"
        ) {
            continue
        }
        out.push({ type: child.type, text: child.text })
    }
    return out
}

function source(node: Node) {
    return (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()
}

function commands(node: Node) {
    return node.descendantsOfType("command").filter((child): child is Node => Boolean(child))
}

export async function extractBashCommands(command: string): Promise<ExtractedBashCommand[]> {
    const tree = (await parser()).parse(command)
    if (!tree) return []

    const extracted: ExtractedBashCommand[] = []

    for (const node of commands(tree.rootNode)) {
        const command = parts(node)
        const tokens = command.map((item) => item.text)
        const cmd = tokens[0]

        if (!tokens.length || (cmd && CWD.has(cmd))) {
            continue
        }

        extracted.push({
            text: source(node),
            tokens,
        })
    }

    return extracted
}
