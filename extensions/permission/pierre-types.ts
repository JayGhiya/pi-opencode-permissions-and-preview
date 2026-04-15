import type { FileDiffMetadata } from "@pierre/diffs"

export type PierreAppearance = "dark" | "light"

export interface PermissionDiffSnapshot {
    path: string
    oldContent: string
    newContent: string
}

export interface HastTextNode {
    type: "text"
    value: string
}

export interface HastElementNode {
    type: "element"
    tagName: string
    properties?: Record<string, unknown>
    children?: HastNode[]
}

export type HastNode = HastTextNode | HastElementNode

export interface HighlightedDiffCode {
    deletionLines: Array<HastNode | undefined>
    additionLines: Array<HastNode | undefined>
}

export type HighlightedDiffSet = Record<PierreAppearance, HighlightedDiffCode>

export interface PermissionDiffSummary {
    firstChangedLine: number | undefined
    addedLines: number
    removedLines: number
}

export interface PermissionPierrePayload {
    snapshot: PermissionDiffSnapshot
    metadata: FileDiffMetadata
    highlighted: HighlightedDiffSet
}

export interface DiffSpan {
    text: string
    fg?: string
    bg?: string
}

export type UnifiedDiffRow =
    | {
          kind: "collapsed" | "metadata"
          text: string
      }
    | {
          kind: "line"
          lineType: "context" | "addition" | "deletion"
          lineNumber?: number
          spans: DiffSpan[]
      }

export interface SplitDiffCell {
    lineType: "context" | "addition" | "deletion" | "empty"
    lineNumber?: number
    spans: DiffSpan[]
}

export type SplitDiffRow =
    | {
          kind: "collapsed" | "metadata"
          text: string
      }
    | {
          kind: "line"
          left: SplitDiffCell
          right: SplitDiffCell
      }
