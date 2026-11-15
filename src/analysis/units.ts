/**
 * 翻訳単位(1 回の翻訳の依頼で訳す範囲)を組み立てる。
 *
 * いまは、1 段落を 1 つの翻訳単位にする。段組やページをまたぐ段落の結合は、まだ行っていない。
 * 文中の数式は、番号の付いた目印に置き換える(source.ts)。
 */

import { actionFor, assignKind } from '../layout/assign.ts'
import type { ParagraphKind } from '../layout/assign.ts'
import type { LayoutLabel, LayoutRegion } from '../layout/types.ts'
import type { GlyphInkMeasurer } from '../pdf/glyphInk.ts'
import { buildTaggedSource } from './source.ts'
import type { MathSlot } from './source.ts'
import type { Paragraph, Rect } from './types.ts'

export interface TranslationUnit {
  /** 文書の中で一意な名前。 */
  id: string
  pageNumber: number
  /** ページの中での順番(0 始まり)。 */
  index: number
  /** 原文が占める範囲。 */
  rect: Rect
  /** 訳す原文。文中の数式は、目印(<m1> など)に置き換えてある。 */
  source: string
  /** 文中の数式。目印の番号の順に並ぶ。 */
  math: MathSlot[]
  kind: ParagraphKind
  /** 原文の文字の大きさ(ポイント)。 */
  fontSize: number
  /** 原文の行送り(ポイント)。 */
  linePitch: number
  lineCount: number
  /** 原文の 1 行目が字下げされている場合に true。 */
  indented: boolean
  /** 訳文の箱を広げてよい幅と高さの上限(ポイント)。rect の幅と高さ以上。 */
  maxWidth: number
  maxHeight: number
}

/** 行送りが分からない(1 行だけの)段落で使う、文字の大きさに対する行送りの倍率。 */
const DEFAULT_PITCH_EM = 1.2
/** 字下げとみなす、1 行目の左端のずれの下限。文字の大きさに対する倍率。 */
const INDENT_EM = 0.7
/** 訳文の箱と、隣の要素の間に残すすき間(ポイント)。 */
const GAP = 3

/** 訳文の箱を広げるときに、避ける領域の種類。文字を持たない図や、枠で囲まれた要素。 */
const BLOCK_LABELS: ReadonlySet<LayoutLabel> = new Set<LayoutLabel>([
  'image',
  'chart',
  'table',
  'display_formula',
  'algorithm',
  'header_image',
  'footer_image',
  'seal',
])

function right(rect: Rect): number {
  return rect.x + rect.width
}

function bottom(rect: Rect): number {
  return rect.y + rect.height
}

function overlapsHorizontally(a: Rect, b: Rect): boolean {
  return Math.min(right(a), right(b)) - Math.max(a.x, b.x) > 0
}

function overlapsVertically(a: Rect, b: Rect): boolean {
  return Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y) > 0
}

/**
 * 第 1 ページの、題名と要旨の間にある段落(著者の名前と所属)かどうか。
 * 節の見出し("Abstract" など)は含めない。
 */
function isBetweenTitleAndAbstract(paragraph: Rect, kind: ParagraphKind, regions: readonly LayoutRegion[]): boolean {
  if (kind === 'doc_title' || kind === 'abstract' || kind === 'paragraph_title') return false
  const title = regions.find((region) => region.label === 'doc_title')
  const abstract = regions.find((region) => region.label === 'abstract')
  if (!title || !abstract) return false
  const center = paragraph.y + paragraph.height / 2
  return center > bottom(title) && center < abstract.y
}

/**
 * 1 ページ分の翻訳単位を組み立てる。
 *
 * 訳さない段落: 訳さない種類の段落、種類が分からない段落、
 * 数式を除くと英字の語が残らない段落、題名と要旨の間にある段落。
 */
export function buildUnits(
  pageNumber: number,
  paragraphs: readonly Paragraph[],
  regions: readonly LayoutRegion[],
  measureInk?: GlyphInkMeasurer,
): TranslationUnit[] {
  const kinds = paragraphs.map((paragraph) => assignKind(paragraph, regions).kind)
  const blocks = regions.filter((region) => BLOCK_LABELS.has(region.label))
  // 訳文の箱は、ページの中で文字が置かれている範囲の外へは広げない。
  const contentRight = Math.max(...paragraphs.map(right))
  const contentBottom = Math.max(...paragraphs.map(bottom))

  const units: TranslationUnit[] = []
  paragraphs.forEach((paragraph, index) => {
    const kind = kinds[index] as ParagraphKind
    if (actionFor(kind) === 'keep') return
    if (isBetweenTitleAndAbstract(paragraph, kind, regions)) return
    const lines = paragraph.lines
    const source = buildTaggedSource(lines, measureInk)
    // 数式を除くと、2 文字以上続く英字が残らない段落は、訳すものが無い。
    if (!/[A-Za-z]{2}/.test(source.text.replace(/<m\d+>/g, ''))) return

    const obstacles: Rect[] = [...paragraphs.filter((_, other) => other !== index), ...blocks]

    // 下の空き: 真下にある最も近い要素まで。
    let limitBottom = contentBottom
    for (const obstacle of obstacles) {
      if (obstacle.y >= bottom(paragraph) - 1 && overlapsHorizontally(obstacle, paragraph)) {
        limitBottom = Math.min(limitBottom, obstacle.y - GAP)
      }
    }

    // 右の空き: 1 行だけの段落(見出しなど)に限り、右にある最も近い要素まで広げてよい。
    let limitRight = right(paragraph)
    if (lines.length === 1) {
      limitRight = contentRight
      for (const obstacle of obstacles) {
        if (obstacle.x >= right(paragraph) - 1 && overlapsVertically(obstacle, paragraph)) {
          limitRight = Math.min(limitRight, obstacle.x - GAP)
        }
      }
    }

    const first = lines[0]
    const last = lines.at(-1)
    const linePitch =
      first && last && lines.length > 1
        ? (last.baseline - first.baseline) / (lines.length - 1)
        : paragraph.fontSize * DEFAULT_PITCH_EM
    const second = lines[1]

    units.push({
      id: `p${pageNumber}-${index}`,
      pageNumber,
      index,
      rect: { x: paragraph.x, y: paragraph.y, width: paragraph.width, height: paragraph.height },
      source: source.text,
      math: source.slots,
      kind,
      fontSize: paragraph.fontSize,
      linePitch,
      lineCount: lines.length,
      indented: first !== undefined && second !== undefined && first.x - second.x > INDENT_EM * paragraph.fontSize,
      maxWidth: Math.max(paragraph.width, limitRight - paragraph.x),
      maxHeight: Math.max(paragraph.height, limitBottom - paragraph.y),
    })
  })
  return units
}
