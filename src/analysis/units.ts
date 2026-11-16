/**
 * 翻訳単位(1 回の翻訳の依頼で訳す範囲)を組み立てる。
 *
 * ここでは、1 ページの 1 段落を、1 つの翻訳単位にする。
 * 段やページをまたいで続く段落は、あとで 1 つの翻訳単位につなぐ(chains.ts)。
 * そのため、翻訳単位は、ページの上の範囲を「断片」として 1 つ以上持つ。
 * 文中の数式は、番号の付いた目印に置き換える(source.ts)。
 */

import { actionFor, assignKind } from '../layout/assign.ts'
import type { ParagraphKind } from '../layout/assign.ts'
import type { LayoutLabel, LayoutRegion } from '../layout/types.ts'
import type { GlyphInkMeasurer } from '../pdf/glyphInk.ts'
import { buildTaggedSource } from './source.ts'
import type { MathSlot } from './source.ts'
import type { Paragraph, Rect } from './types.ts'

/** 翻訳単位が、ページの上で占める範囲の 1 つ。段やページをまたぐ段落は、断片を 2 つ以上持つ。 */
export interface UnitFragment {
  pageNumber: number
  /** 原文が占める範囲。 */
  rect: Rect
  lineCount: number
  /** 原文の 1 行目が字下げされている場合に true。 */
  indented: boolean
  /** 訳文の箱を広げてよい幅と高さの上限(ポイント)。rect の幅と高さ以上。 */
  maxWidth: number
  maxHeight: number
}

export interface TranslationUnit {
  /** 文書の中で一意な名前。 */
  id: string
  /** 最初の断片があるページの番号。 */
  pageNumber: number
  /** ページの中での段落の番号(0 始まり)。 */
  index: number
  /** ページの中での読む順番。小さいほど先。レイアウト検出が出した順番にもとづく。 */
  order: number
  /** 訳す原文。文中の数式は、目印(<m1> など)に置き換えてある。 */
  source: string
  /** 文中の数式。目印の番号の順に並ぶ。 */
  math: MathSlot[]
  kind: ParagraphKind
  /** 原文の文字の大きさ(ポイント)。 */
  fontSize: number
  /** 原文の行送り(ポイント)。 */
  linePitch: number
  /** 原文が占める範囲。読む順に並ぶ。 */
  fragments: UnitFragment[]
  /** 最初の断片が、段のいちばん上にある場合に true。 */
  atColumnTop: boolean
  /** 最後の断片が、段のいちばん下にある場合に true。 */
  atColumnBottom: boolean
  /** 最後の行が、段の右端の近くまで届いている場合に true。 */
  lastLineFull: boolean
}

/** 行送りが分からない(1 行だけの)段落で使う、文字の大きさに対する行送りの倍率。 */
const DEFAULT_PITCH_EM = 1.2
/** 字下げとみなす、1 行目の左端のずれの下限。文字の大きさに対する倍率。 */
const INDENT_EM = 0.7
/** 訳文の箱と、隣の要素の間に残すすき間(ポイント)。 */
const GAP = 3
/** 同じ段とみなす、段落の左端のずれの上限。文字の大きさに対する倍率。 */
const SAME_COLUMN_EM = 2.5
/** 段落の中心が段の中にあるとみなすときの、段の端の許容。文字の大きさに対する倍率。 */
const COLUMN_EDGE_EM = 0.5
/** 最後の行が段の右端まで届いているとみなす、右端との差の上限。文字の大きさに対する倍率。 */
const FULL_LINE_EM = 2

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

/**
 * 本文の流れを作る種類。段のいちばん上・いちばん下かどうかを判定するときに、これらの段落だけを数える。
 * 図、表、脚注、ページ番号などは、本文の流れの外にあるので数えない。
 */
const FLOW_KINDS: ReadonlySet<ParagraphKind> = new Set<ParagraphKind>([
  'text',
  'abstract',
  'doc_title',
  'paragraph_title',
  'display_formula',
  'algorithm',
  'reference',
  'reference_content',
  'content',
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
 * 1 ページ分の翻訳単位を組み立てる。返す翻訳単位は、読む順に並ぶ。
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
  const assignments = paragraphs.map((paragraph) => assignKind(paragraph, regions))
  const kinds = assignments.map((assignment) => assignment.kind)
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
    const source = buildTaggedSource(lines, measureInk, pageNumber)
    // 数式を除くと、2 文字以上続く英字が残らない段落は、訳すものが無い。
    if (!/[A-Za-z]{2}/.test(source.text.replace(/<m\d+>/g, ''))) return

    const others = paragraphs.map((other, otherIndex) => ({ other, otherIndex })).filter(({ otherIndex }) => otherIndex !== index)
    const obstacles: Rect[] = [...others.map(({ other }) => other), ...blocks]

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

    // 段の右端は、左端がほぼ同じ段落(同じ段の段落)の右端のうち、最も右にあるものとする。
    const em = paragraph.fontSize
    const columnRight = Math.max(
      right(paragraph),
      ...others.filter(({ other }) => Math.abs(other.x - paragraph.x) <= SAME_COLUMN_EM * em).map(({ other }) => right(other)),
    )

    // 同じ段の上と下に、本文の流れを作る段落があるかどうか。
    // 同じ段かどうかは、相手の段落の中心が、この段の横の範囲に入っているかで決める。
    // 2 つの段にまたがる題名や要旨は、中心が段の外にあるので、どちらの段にも数えない。
    const flow = others.filter(({ other, otherIndex }) => {
      if (!FLOW_KINDS.has(kinds[otherIndex] as ParagraphKind)) return false
      const center = other.x + other.width / 2
      return center >= paragraph.x - COLUMN_EDGE_EM * em && center <= columnRight + COLUMN_EDGE_EM * em
    })
    const atColumnTop = !flow.some(({ other }) => bottom(other) <= paragraph.y + 1)
    const atColumnBottom = !flow.some(({ other }) => other.y >= bottom(paragraph) - 1)

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
      // 同じ領域に入った段落は、上から順にする。
      order: (assignments[index]?.region?.order ?? 0) * 10_000 + paragraph.y,
      source: source.text,
      math: source.slots,
      kind,
      fontSize: paragraph.fontSize,
      linePitch,
      fragments: [
        {
          pageNumber,
          rect: { x: paragraph.x, y: paragraph.y, width: paragraph.width, height: paragraph.height },
          lineCount: lines.length,
          indented: first !== undefined && second !== undefined && first.x - second.x > INDENT_EM * em,
          maxWidth: Math.max(paragraph.width, limitRight - paragraph.x),
          maxHeight: Math.max(paragraph.height, limitBottom - paragraph.y),
        },
      ],
      atColumnTop,
      atColumnBottom,
      lastLineFull: last !== undefined && right(last) >= columnRight - FULL_LINE_EM * em,
    })
  })
  return units.sort((a, b) => a.order - b.order)
}
