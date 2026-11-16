/**
 * 段落の行から、翻訳に送る原文を作る。
 *
 * 文中の数式は、番号の付いた目印に置き換える。
 * あわせて、それぞれの数式がページの上で占める範囲を記録する。訳文を表示するときに、この範囲を切り抜いて使う。
 */

import { escapeTagLike, mathTag } from '../math/placeholders.ts'
import type { GlyphInkMeasurer } from '../pdf/glyphInk.ts'
import { isSpaceGap } from './spacing.ts'
import type { Line, LineChar, MathSpan, Rect } from './types.ts'

/** 数式の一部がページの上で占める範囲。数式が行をまたぐ場合は、行ごとに 1 つずつできる。 */
export interface MathPart extends Rect {
  /** この部分があるページの番号。訳文が段やページをまたぐと、数式は、もとのページとは別のページに表示されることがある。 */
  pageNumber: number
  /** その行の本文の基準線の y 座標。訳文の中に置くときに、訳文の基準線と合わせる。 */
  baseline: number
}

export interface MathSlot {
  /** 目印の番号。1 から始まる。 */
  id: number
  parts: MathPart[]
  /** PDF から読み取った、数式の文字。確認用。 */
  text: string
}

export interface TaggedSource {
  /** 数式を目印に置き換えた原文。 */
  text: string
  slots: MathSlot[]
}

/** 切り抜く範囲に足す余白(ポイント)。字形の端のにじみと、根号や分数の線を含めるため。 */
const PAD_X = 0.6
const PAD_Y = 0.8

/**
 * 数式が行の上で占める範囲を求める。
 * measureInk を渡すと、字形の実際の範囲を使う。渡さない場合や測れない字形では、フォントの情報から決めた範囲を使う。
 */
export function mathPartOf(line: Line, span: MathSpan, measureInk?: GlyphInkMeasurer, pageNumber = 0): MathPart {
  let left = Infinity
  let right = -Infinity
  let top = Infinity
  let bottom = -Infinity
  for (const char of line.chars.slice(span.start, span.end)) {
    const ink = measureInk?.(char.fontId, char.fontChar) ?? null
    if (ink) {
      const size = char.fontSize
      left = Math.min(left, char.x - ink.left * size)
      right = Math.max(right, char.x + Math.max(ink.right * size, char.width))
      top = Math.min(top, char.baseline - ink.ascent * size)
      bottom = Math.max(bottom, char.baseline + ink.descent * size)
    } else {
      left = Math.min(left, char.x)
      right = Math.max(right, char.x + char.width)
      top = Math.min(top, char.top)
      bottom = Math.max(bottom, char.bottom)
    }
  }
  return {
    pageNumber,
    x: left - PAD_X,
    y: top - PAD_Y,
    width: right - left + 2 * PAD_X,
    height: bottom - top + 2 * PAD_Y,
    baseline: line.baseline,
  }
}

/** 行の中の 1 つの部分。文章か、数式。 */
type Piece = { type: 'text'; text: string } | { type: 'math'; span: MathSpan }

interface LinePieces {
  pieces: Piece[]
  /** 各部分の前に、空白が要るかどうか。 */
  spaceBefore: boolean[]
}

function piecesOf(line: Line): LinePieces {
  const pieces: Piece[] = []
  const spaceBefore: boolean[] = []
  const spanAt = new Map(line.spans.map((span) => [span.start, span]))
  let right = -Infinity
  let previousSize = 0
  let index = 0
  while (index < line.chars.length) {
    const char = line.chars[index] as LineChar
    const space = pieces.length > 0 && isSpaceGap(char.x - right, Math.max(previousSize, char.fontSize))
    const span = spanAt.get(index)
    if (span) {
      pieces.push({ type: 'math', span })
      spaceBefore.push(space)
      for (const inner of line.chars.slice(span.start, span.end)) {
        right = Math.max(right, inner.x + inner.width)
        previousSize = inner.fontSize
      }
      index = span.end
      continue
    }
    const last = pieces.at(-1)
    if (last?.type === 'text' && !space) {
      last.text += char.text
    } else if (last?.type === 'text') {
      last.text += ` ${char.text}`
    } else {
      pieces.push({ type: 'text', text: char.text })
      spaceBefore.push(space)
    }
    right = Math.max(right, char.x + char.width)
    previousSize = char.fontSize
    index += 1
  }
  return { pieces, spaceBefore }
}

/**
 * 段落の行から、目印を埋め込んだ原文を作る。
 *
 * 行と行は、空白 1 つでつなぐ。行末のハイフンで分かれた語は、ハイフンを除いてつなぎ直す。
 * 行の終わりの数式と、次の行の始まりの数式は、行をまたいだ 1 つの数式として、1 つの目印にまとめる。
 */
export function buildTaggedSource(lines: readonly Line[], measureInk?: GlyphInkMeasurer, pageNumber = 0): TaggedSource {
  const slots: MathSlot[] = []
  let text = ''
  /** 直前に出力したものが数式なら、その数式。行をまたぐ数式をまとめるために覚えておく。 */
  let trailing: MathSlot | undefined

  for (const line of lines) {
    const { pieces, spaceBefore } = piecesOf(line)
    pieces.forEach((piece, index) => {
      const lineStart = index === 0
      if (piece.type === 'math') {
        const part = mathPartOf(line, piece.span, measureInk, pageNumber)
        const mathText = line.chars
          .slice(piece.span.start, piece.span.end)
          .map((char) => char.text)
          .join('')
        if (lineStart && trailing) {
          trailing.parts.push(part)
          trailing.text += ` ${mathText}`
          return
        }
        const slot: MathSlot = { id: slots.length + 1, parts: [part], text: mathText }
        slots.push(slot)
        if (text.length > 0 && (lineStart || spaceBefore[index])) text += ' '
        text += mathTag(slot.id)
        trailing = slot
        return
      }

      const words = escapeTagLike(piece.text)
      if (lineStart && text.length > 0) {
        if (!trailing && /[A-Za-z]-$/.test(text) && /^[a-z]/.test(words)) text = text.slice(0, -1)
        else text += ' '
      } else if (spaceBefore[index]) {
        text += ' '
      }
      text += words
      trailing = undefined
    })
  }
  // 斜体の文字の右には小さな空きがあり、空白と判定されることがある。目印と句読点の間の空白は取り除く。
  return { text: text.replace(/(<m\d+>) ([.,;:!?])/g, '$1$2'), slots }
}
