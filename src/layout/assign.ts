/**
 * 段落に、領域の種類を割り当てる。
 *
 * 段落の矩形は文字の位置から作ったもので、レイアウト検出の領域より正確である。
 * そのため、検出の結果は矩形としては使わず、段落と重なる領域の種類だけを使う。
 */

import type { Rect } from '../analysis/types.ts'
import type { LayoutLabel, LayoutRegion } from './types.ts'

/** 段落の種類。どの領域とも十分に重ならない段落は 'unknown'。 */
export type ParagraphKind = LayoutLabel | 'unknown'

/** 訳すかどうか。 */
export type ParagraphAction = 'translate' | 'keep'

/** 段落の面積のうち、領域と重なる割合の下限。これ未満の領域は、その段落の種類にしない。 */
const MIN_COVERAGE = 0.5
/** 重なる割合の差がこの値以内の領域は、同じ程度に重なっているとみなす。 */
const COVERAGE_TIE = 0.05

/**
 * 訳す種類。ここに無い種類(図、表、独立した数式、参考文献、ページ番号など)と、'unknown' は訳さない。
 * 迷う段落を訳さない理由は、誤って訳すと元の情報が消えるためである。
 */
const TRANSLATED_LABELS: ReadonlySet<ParagraphKind> = new Set<ParagraphKind>([
  'text',
  'abstract',
  'doc_title',
  'paragraph_title',
  'figure_title',
  'footnote',
  'vision_footnote',
])

/**
 * 段落の種類の候補にしない種類。
 * inline_formula は文中の数式を囲む小さな領域で、段落の種類を表さない。
 */
const IGNORED_LABELS: ReadonlySet<LayoutLabel> = new Set<LayoutLabel>(['inline_formula'])

function area(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

function intersectionArea(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

export interface Assignment {
  kind: ParagraphKind
  /** 種類のもとになった領域。'unknown' の場合は undefined。 */
  region: LayoutRegion | undefined
}

/**
 * 段落と最もよく重なる領域を選ぶ。
 * 同じ程度に重なる領域が複数ある場合は、小さい領域を選ぶ。
 * 図の領域の中に、図の説明文の領域が入っているような場合に、内側の種類を採るためである。
 */
export function assignKind(paragraph: Rect, regions: readonly LayoutRegion[]): Assignment {
  const paragraphArea = area(paragraph)
  if (paragraphArea === 0) return { kind: 'unknown', region: undefined }

  let best: LayoutRegion | undefined
  let bestCoverage = 0
  for (const region of regions) {
    if (IGNORED_LABELS.has(region.label)) continue
    const coverage = intersectionArea(paragraph, region) / paragraphArea
    if (coverage < MIN_COVERAGE) continue
    const clearlyBetter = coverage > bestCoverage + COVERAGE_TIE
    const tied = Math.abs(coverage - bestCoverage) <= COVERAGE_TIE
    if (!best || clearlyBetter || (tied && area(region) < area(best))) {
      best = region
      bestCoverage = Math.max(bestCoverage, coverage)
    }
  }
  return best ? { kind: best.label, region: best } : { kind: 'unknown', region: undefined }
}

export function actionFor(kind: ParagraphKind): ParagraphAction {
  return TRANSLATED_LABELS.has(kind) ? 'translate' : 'keep'
}
