/**
 * PDF.js から、ページの文字のまとまりと、その位置・フォントの名前を取り出す。
 */

import { Util } from 'pdfjs-dist'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { TextRun } from '../analysis/types.ts'

/** フォントが高さの情報を持たないときに使う値。文字の大きさに対する割合。 */
const DEFAULT_ASCENT = 0.8
const DEFAULT_DESCENT = -0.2

/** 回転とみなす角度の下限(ラジアン)。 */
const ROTATION_LIMIT = 0.02

export type RawRun = Omit<TextRun, 'isMath'>

function clampOr(value: number | undefined, min: number, max: number, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

/**
 * ページの文字のまとまりを取り出す。
 *
 * フォントの名前は、PDF.js がフォントを読み込んだあとでないと分からない。
 * そのため、先に描画の命令の一覧を取得して、フォントの読み込みを済ませる。
 */
export async function extractRuns(page: PDFPageProxy): Promise<RawRun[]> {
  const viewport = page.getViewport({ scale: 1 })
  const [content] = await Promise.all([page.getTextContent(), page.getOperatorList()])

  const fontNames = new Map<string, string>()
  function realFontName(id: string): string {
    let name = fontNames.get(id)
    if (name === undefined) {
      const font: unknown = page.commonObjs.has(id) ? page.commonObjs.get(id) : undefined
      const candidate = (font as { name?: unknown } | undefined)?.name
      name = typeof candidate === 'string' ? candidate : ''
      fontNames.set(id, name)
    }
    return name
  }

  const runs: RawRun[] = []
  for (const item of content.items) {
    if (!('str' in item) || item.str.length === 0) continue
    const matrix = Util.transform(viewport.transform, item.transform) as number[]
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = matrix
    const fontSize = Math.hypot(c, d)
    if (fontSize === 0) continue

    // 高さの情報がおかしいフォント(大きな括弧用のフォントなど)は、既定の値で代える。
    const style = content.styles[item.fontName]
    const ascent = clampOr(style?.ascent, 0.5, 1.0, DEFAULT_ASCENT)
    const descent = clampOr(style?.descent, -0.35, 0, DEFAULT_DESCENT)

    runs.push({
      text: item.str,
      x: e,
      y: f - ascent * fontSize,
      width: item.width,
      height: (ascent - descent) * fontSize,
      fontSize,
      fontName: realFontName(item.fontName),
      baseline: f,
      rotated: Math.abs(Math.atan2(b, a)) > ROTATION_LIMIT,
    })
  }
  return runs
}
