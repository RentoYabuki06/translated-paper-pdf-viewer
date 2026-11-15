/**
 * ページを canvas に描画する。通常の描画と、文字を描かない描画の 2 通りがある。
 */

import { OPS } from 'pdfjs-dist'
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist'
import type { Rect } from '../analysis/types.ts'
import { MatrixTracker } from './graphicsState.ts'
import { applyToPoint, multiply, toMatrix } from './matrix.ts'

/** 文字を描く命令。 */
const TEXT_OPS: ReadonlySet<number> = new Set([
  OPS.showText,
  OPS.showSpacedText,
  OPS.nextLineShowText,
  OPS.nextLineSetSpacingShowText,
])

/** 図形を塗る、または線を引く命令。図形を作る命令(constructPath)の中で指定される。 */
const PAINT_OPS: ReadonlySet<number> = new Set([
  OPS.stroke,
  OPS.closeStroke,
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
])

/** 罫線とみなす図形の、太さの上限(ポイント)。 */
const MAX_RULE_THICKNESS = 1.2

export interface RenderOptions {
  /** 表示の倍率。1 のとき、PDF の 1 ポイントが CSS の 1 ピクセルになる。 */
  scale: number
  /** true のとき、文字を描く命令を飛ばす。図、罫線、背景の色は描かれる。 */
  withoutText?: boolean
  /**
   * 文字を描かない描画で、この範囲の中にある細い罫線も描かない。
   * 分数の線や根号の上の線は、文字ではなく図形として描かれるため、文字を消しただけでは残る。
   * 訳文を重ねる段落の範囲を渡して、これらの線を消す。座標は、ページの左上を原点とするポイント。
   */
  hideRulesIn?: readonly Rect[]
  /** canvas の画素数を決める倍率。省略すると、画面の解像度(devicePixelRatio)を使う。 */
  outputScale?: number
}

type OperationsFilter = (index: number, operatorList: { fnArray: number[]; argsArray: unknown[] }) => boolean

/**
 * 文字を描かない描画で使う、描画命令の選別の関数を作る。
 *
 * PDF.js は、描画命令を先頭から順に 1 回ずつこの関数に渡す。
 * 罫線の位置を知るには、その時点の座標の変換が要るので、命令を読みながら変換を追う。
 * そのため、この関数は描画 1 回ごとに作り直す。
 */
function createTextlessFilter(page: PDFPageProxy, hideRulesIn: readonly Rect[]): OperationsFilter {
  if (hideRulesIn.length === 0) return (index, operatorList) => !TEXT_OPS.has(operatorList.fnArray[index] as number)

  const base = toMatrix(page.getViewport({ scale: 1 }).transform)
  const tracker = new MatrixTracker()
  /** 直前に、切り抜きの指定があったかどうか。その場合、次の図形は切り抜きの形として使われる。 */
  let clipPending = false

  return (index, operatorList) => {
    const fn = operatorList.fnArray[index] as number
    if (TEXT_OPS.has(fn)) return false
    const args = operatorList.argsArray[index]
    tracker.handle(fn, args)
    if (fn === OPS.clip || fn === OPS.eoClip) {
      clipPending = true
      return true
    }
    if (fn !== OPS.constructPath) return true
    const usedForClip = clipPending
    clipPending = false
    if (usedForClip || !base) return true

    // 引数は、[塗りや線の命令, 図形の座標, 図形を囲む範囲(左, 下, 右, 上)]。
    const [paintOp, , bounds] = args as [unknown, unknown, ArrayLike<number> | null | undefined]
    if (typeof paintOp !== 'number' || !PAINT_OPS.has(paintOp) || !bounds || bounds.length !== 4) return true

    const matrix = multiply(base, tracker.ctm)
    const [x0, y0, x1, y1] = [bounds[0] as number, bounds[1] as number, bounds[2] as number, bounds[3] as number]
    const corners = [applyToPoint(matrix, x0, y0), applyToPoint(matrix, x1, y0), applyToPoint(matrix, x0, y1), applyToPoint(matrix, x1, y1)]
    const left = Math.min(...corners.map((corner) => corner[0]))
    const right = Math.max(...corners.map((corner) => corner[0]))
    const top = Math.min(...corners.map((corner) => corner[1]))
    const bottom = Math.max(...corners.map((corner) => corner[1]))
    if (Math.min(right - left, bottom - top) > MAX_RULE_THICKNESS) return true

    const inside = hideRulesIn.some(
      (rect) => left >= rect.x && right <= rect.x + rect.width && top >= rect.y && bottom <= rect.y + rect.height,
    )
    return !inside
  }
}

/**
 * ページを描画する。canvas の画素数は、画面の解像度(devicePixelRatio)に合わせる。
 * 表示上の大きさ(CSS)は、呼び出し側で決める。
 */
export function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement, options: RenderOptions): RenderTask {
  const outputScale = options.outputScale ?? (globalThis.devicePixelRatio || 1)
  const viewport = page.getViewport({ scale: options.scale * outputScale })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  return page.render({
    canvas,
    viewport,
    ...(options.withoutText ? { operationsFilter: createTextlessFilter(page, options.hideRulesIn ?? []) } : {}),
  })
}
