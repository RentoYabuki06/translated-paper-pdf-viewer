/**
 * PDF.js から、ページの文字のまとまりと、その位置・フォントの名前を取り出す。
 */

import type { PDFPageProxy } from 'pdfjs-dist'
import { buildRuns } from './buildRuns.ts'
import type { RawRun, RunFont } from './buildRuns.ts'
import type { GlyphInkMeasurer } from './glyphInk.ts'
import { extractGlyphs } from './glyphs.ts'
import type { GlyphFont } from './glyphs.ts'
import { toMatrix } from './matrix.ts'
import { OPS } from 'pdfjs-dist'

export type { RawRun } from './buildRuns.ts'

type FontInfo = GlyphFont & RunFont

/** PDF.js のフォントの情報から、使う項目を取り出す。 */
function readFont(font: unknown): FontInfo | undefined {
  if (font === null || typeof font !== 'object') return undefined
  const source = font as {
    name?: unknown
    ascent?: unknown
    descent?: unknown
    vertical?: unknown
    fontMatrix?: ArrayLike<unknown> | null
  }
  const widthScale = source.fontMatrix?.[0]
  return {
    name: typeof source.name === 'string' ? source.name : '',
    ascent: typeof source.ascent === 'number' ? source.ascent : undefined,
    descent: typeof source.descent === 'number' ? source.descent : undefined,
    vertical: source.vertical === true,
    widthScale: typeof widthScale === 'number' && widthScale !== 0 ? widthScale : 0.001,
  }
}

/** フォントの読み込みを待つ時間の上限(ミリ秒)。超えた場合は、フォントの情報なしで進める。 */
const FONT_TIMEOUT = 5000

/** フォントの読み込みが終わるのを待つ。 */
function waitForFont(page: PDFPageProxy, fontId: string): Promise<void> {
  if (page.commonObjs.has(fontId)) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, FONT_TIMEOUT)
    try {
      page.commonObjs.get(fontId, () => {
        clearTimeout(timer)
        resolve()
      })
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}

/**
 * ページの文字のまとまりを取り出す。
 *
 * 文字の位置は、描画命令の一覧から計算する。
 * 描画命令の一覧を取得すると、PDF.js はフォントを読み込むので、フォントの名前もこのときに分かる。
 * フォントの名前を得るには、PDF を読み込むときに fontExtraProperties を指定しておく必要がある(pdfjs.ts)。
 *
 * measureInk を渡すと、字形が基準線からぶら下がる文字(根号など)の縦の範囲を、実際の字形から決める。
 */
export async function extractRuns(page: PDFPageProxy, measureInk?: GlyphInkMeasurer): Promise<RawRun[]> {
  const viewport = page.getViewport({ scale: 1 })
  const baseTransform = toMatrix(viewport.transform)
  if (!baseTransform) throw new Error('ページの座標の変換を取得できません')
  const operatorList = await page.getOperatorList()

  // 描画命令の一覧が届いた時点では、フォントの読み込みが終わっていないことがある。
  // 使われているフォントの読み込みを待ってから、フォントの情報を読む。
  const fontIds = new Set<string>()
  operatorList.fnArray.forEach((fn, index) => {
    const fontId: unknown = fn === OPS.setFont ? (operatorList.argsArray[index] as unknown[] | null)?.[0] : undefined
    if (typeof fontId === 'string') fontIds.add(fontId)
  })
  await Promise.all([...fontIds].map((fontId) => waitForFont(page, fontId)))

  const fonts = new Map<string, FontInfo | undefined>()
  function getFont(fontId: string): FontInfo | undefined {
    if (!fonts.has(fontId)) {
      fonts.set(fontId, page.commonObjs.has(fontId) ? readFont(page.commonObjs.get(fontId)) : undefined)
    }
    return fonts.get(fontId)
  }

  return buildRuns(extractGlyphs(operatorList, getFont, baseTransform), getFont, measureInk)
}
