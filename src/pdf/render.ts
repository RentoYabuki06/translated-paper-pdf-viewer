/**
 * ページを canvas に描画する。通常の描画と、文字を描かない描画の 2 通りがある。
 */

import { OPS } from 'pdfjs-dist'
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist'

/** 文字を描く命令。 */
const TEXT_OPS: ReadonlySet<number> = new Set([
  OPS.showText,
  OPS.showSpacedText,
  OPS.nextLineShowText,
  OPS.nextLineSetSpacingShowText,
])

export interface RenderOptions {
  /** 表示の倍率。1 のとき、PDF の 1 ポイントが CSS の 1 ピクセルになる。 */
  scale: number
  /** true のとき、文字を描く命令を飛ばす。図、罫線、背景の色は描かれる。 */
  withoutText?: boolean
}

/**
 * ページを描画する。canvas の画素数は、画面の解像度(devicePixelRatio)に合わせる。
 * 表示上の大きさ(CSS)は、呼び出し側で決める。
 */
export function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement, options: RenderOptions): RenderTask {
  const outputScale = globalThis.devicePixelRatio || 1
  const viewport = page.getViewport({ scale: options.scale * outputScale })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  return page.render({
    canvas,
    viewport,
    ...(options.withoutText
      ? { operationsFilter: (index, operatorList) => !TEXT_OPS.has(operatorList.fnArray[index] as number) }
      : {}),
  })
}
