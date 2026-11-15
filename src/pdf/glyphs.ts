/**
 * 描画命令の一覧から、1 文字ずつの位置を取り出す。
 *
 * PDF.js の getTextContent は、続けて書かれた文字を 1 つのまとまりにして返し、まとまりの中の文字の位置を返さない。
 * 文中の数式を文字の単位で切り出すには、1 文字ずつの位置が要る。
 * そのため、PDF.js が canvas へ文字を描くときと同じ計算で、文字の位置を求める。
 */

import { normalizeUnicode, OPS } from 'pdfjs-dist'
import { isRestoreOp, isSaveOp, MatrixTracker } from './graphicsState.ts'
import { applyToPoint, IDENTITY, multiply, toMatrix } from './matrix.ts'
import type { Matrix } from './matrix.ts'

/** 文字の位置の計算に使う、フォントの情報。 */
export interface GlyphFont {
  /** 文字の幅の単位を、文字の大きさ 1 に対する割合に直す係数。多くのフォントで 0.001。 */
  widthScale: number
  /** 縦書き用のフォントなら true。 */
  vertical: boolean
}

export interface Glyph {
  /** 文字。合字(fi など)は、もとの文字の並びに直してある。対応する文字が分からない場合は空文字列。 */
  text: string
  /** PDF.js が読み込んだフォントの中で、この字形を指す文字。字形の大きさを測るときに使う。 */
  fontChar: string
  /** PDF.js が付けたフォントの名前(例: "g_d0_f1")。 */
  fontId: string
  /** 字形の原点の位置。ページの左上を原点とするポイント。 */
  x: number
  baseline: number
  /** 字形の送り幅(ポイント)。字間や語間の調整は含まない。 */
  width: number
  /** 文字の大きさ(ポイント)。 */
  fontSize: number
  /** 横書きの向きから回転している場合に true。 */
  rotated: boolean
}

export interface OperatorList {
  fnArray: ArrayLike<number>
  argsArray: ArrayLike<unknown>
}

/** 回転とみなす角度の下限(ラジアン)。 */
const ROTATION_LIMIT = 0.02

/** 文字を描くときの状態。PDF の「テキストの状態」に当たる。 */
interface TextState {
  fontId: string | null
  fontSize: number
  /** 文字の大きさが負で指定された場合は -1。文字の進む向きが逆になる。 */
  fontDirection: 1 | -1
  charSpacing: number
  wordSpacing: number
  hScale: number
  leading: number
  rise: number
  textMatrix: Matrix
  x: number
  y: number
  lineX: number
  lineY: number
}

/** 描画命令の中の、字形 1 つ分の情報。PDF.js の Glyph の一部。 */
interface OperatorGlyph {
  unicode?: unknown
  fontChar?: unknown
  width?: unknown
  isSpace?: unknown
}

function numberAt(args: unknown, index: number): number {
  const value = (args as ArrayLike<unknown> | null | undefined)?.[index]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function cleanText(unicode: unknown): string {
  if (typeof unicode !== 'string') return ''
  // 合字などを、もとの文字の並びに直す。行末の分割に使われるソフトハイフンは、ハイフンとして扱う。
  return normalizeUnicode(unicode).replace(/­/g, '-').replace(/\0/g, '')
}

/**
 * 1 文字ずつの位置を取り出す。
 *
 * baseTransform には、PDF のページの座標を、ページの左上を原点とするポイントに直す変換を渡す
 * (PDF.js の viewport.transform を、倍率 1 で取得したもの)。
 */
export function extractGlyphs(
  operatorList: OperatorList,
  getFont: (fontId: string) => GlyphFont | undefined,
  baseTransform: Matrix,
): Glyph[] {
  const glyphs: Glyph[] = []
  const tracker = new MatrixTracker()
  const stack: TextState[] = []
  let state: TextState = {
    fontId: null,
    fontSize: 0,
    fontDirection: 1,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
    textMatrix: IDENTITY,
    x: 0,
    y: 0,
    lineX: 0,
    lineY: 0,
  }

  function moveText(x: number, y: number): void {
    state.lineX += x
    state.lineY += y
    state.x = state.lineX
    state.y = state.lineY
  }

  function showText(items: ArrayLike<unknown>): void {
    const fontId = state.fontId
    if (fontId === null) return
    const font = getFont(fontId)
    const widthScale = font?.widthScale ?? 0.001
    const vertical = font?.vertical ?? false
    const { fontSize, fontDirection, charSpacing, wordSpacing } = state
    const hScale = state.hScale * fontDirection
    const matrix = multiply(baseTransform, multiply(tracker.ctm, state.textMatrix))
    const size = fontSize * Math.hypot(matrix[2], matrix[3])
    const rotated = Math.abs(Math.atan2(matrix[1] * hScale, matrix[0] * hScale)) > ROTATION_LIMIT
    const y = state.y + state.rise

    let advance = 0
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      if (typeof item === 'number') {
        // 字間の調整。単位は、文字の大きさの 1/1000。
        advance += ((vertical ? 1 : -1) * item * fontSize) / 1000
        continue
      }
      if (item === null || typeof item !== 'object') continue
      const glyph = item as OperatorGlyph
      const width = typeof glyph.width === 'number' ? glyph.width * fontSize * widthScale : 0
      const spacing = (glyph.isSpace === true ? wordSpacing : 0) + charSpacing

      if (vertical) {
        // 縦書きの文字は、位置を進めるだけで、取り出さない。
        advance += width - spacing * fontDirection
        continue
      }
      const [startX, startY] = applyToPoint(matrix, state.x + advance * hScale, y)
      const [endX, endY] = applyToPoint(matrix, state.x + (advance + width) * hScale, y)
      glyphs.push({
        text: cleanText(glyph.unicode),
        fontChar: typeof glyph.fontChar === 'string' ? glyph.fontChar : '',
        fontId,
        x: Math.min(startX, endX),
        baseline: startY,
        width: Math.hypot(endX - startX, endY - startY),
        fontSize: size,
        rotated,
      })
      advance += width + spacing * fontDirection
    }

    if (vertical) state.y -= advance
    else state.x += advance * hScale
  }

  const { fnArray, argsArray } = operatorList
  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index] as number
    const args = argsArray[index]

    if (isSaveOp(fn)) stack.push({ ...state })
    else if (isRestoreOp(fn)) state = stack.pop() ?? state
    tracker.handle(fn, args)

    switch (fn) {
      case OPS.beginText:
        state.textMatrix = IDENTITY
        state.x = state.y = state.lineX = state.lineY = 0
        break
      case OPS.setFont: {
        const fontId = (args as ArrayLike<unknown> | null)?.[0]
        const size = numberAt(args, 1)
        state.fontId = typeof fontId === 'string' ? fontId : null
        state.fontSize = Math.abs(size)
        state.fontDirection = size < 0 ? -1 : 1
        break
      }
      case OPS.setCharSpacing:
        state.charSpacing = numberAt(args, 0)
        break
      case OPS.setWordSpacing:
        state.wordSpacing = numberAt(args, 0)
        break
      case OPS.setHScale:
        state.hScale = numberAt(args, 0) / 100
        break
      case OPS.setLeading:
        // PDF.js と同じく、符号を反転して持つ。
        state.leading = -numberAt(args, 0)
        break
      case OPS.setTextRise:
        state.rise = numberAt(args, 0)
        break
      case OPS.moveText:
        moveText(numberAt(args, 0), numberAt(args, 1))
        break
      case OPS.setLeadingMoveText:
        state.leading = numberAt(args, 1)
        moveText(numberAt(args, 0), numberAt(args, 1))
        break
      case OPS.nextLine:
        moveText(0, state.leading)
        break
      case OPS.setTextMatrix: {
        // 行列は、配列 1 つにまとめて渡される版と、6 つの数値で渡される版がある。
        const matrix = toMatrix((args as ArrayLike<unknown> | null)?.[0]) ?? toMatrix(args)
        if (matrix) {
          state.textMatrix = matrix
          state.x = state.y = state.lineX = state.lineY = 0
        }
        break
      }
      case OPS.showText: {
        const items = (args as ArrayLike<unknown> | null)?.[0]
        if (items !== null && typeof items === 'object') showText(items as ArrayLike<unknown>)
        break
      }
      default:
        break
    }
  }
  return glyphs
}
