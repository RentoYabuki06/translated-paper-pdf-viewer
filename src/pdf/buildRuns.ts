/**
 * 1 文字ずつの位置から、文字のまとまり(同じフォント・同じ大きさ・同じ基準線で続く文字の並び)を作る。
 */

import { isSpaceGap } from '../analysis/spacing.ts'
import type { RunChar, TextRun } from '../analysis/types.ts'
import type { GlyphInkMeasurer } from './glyphInk.ts'
import type { Glyph } from './glyphs.ts'

/** まとまりを作るのに使う、フォントの情報。 */
export interface RunFont {
  /** PDF に書かれたフォントの名前(例: "ABCDEF+CMMI10")。 */
  name: string
  /** 基準線から上端・下端までの高さ。文字の大きさに対する割合。下端は負の値。 */
  ascent: number | undefined
  descent: number | undefined
}

export type RawRun = Omit<TextRun, 'isMath'>

/** フォントが高さの情報を持たないときに使う値。 */
const DEFAULT_ASCENT = 0.8
const DEFAULT_DESCENT = -0.2
/**
 * 字形が基準線からぶら下がる形で作られた文字の扱い。
 *
 * TeX の数式用フォントでは、根号、総和の記号、大きな括弧などの字形が、原点から下へぶら下がる形で作られている。
 * これらは、原点(基準線として読み取る位置)が、行の基準線よりずっと上にある。
 * フォント全体の高さの情報で範囲を決めると、実際より上にずれ、1 つ上の行の文字と判定されてしまう。
 *
 * 字形の範囲を測れる場合は、上端が低く下端が深い字形を「ぶら下がる字形」とし、測った範囲を使う。
 * 測れない場合は、フォント全体の上端が低いフォント(CMEX など)の文字と、根号の記号を、ぶら下がる字形とする。
 */
const HANGING_MAX_ASCENT = 0.3
const HANGING_MIN_DESCENT = 0.55
const HANGING_FONT_ASCENT_LIMIT = 0.2
const HANGING_ASCENT = 0.05
const HANGING_DESCENT = -1.0

/** 同じまとまりに入れる、文字の間のすき間の上限と下限。文字の大きさに対する倍率。 */
const MAX_GAP_EM = 1.5
const MIN_GAP_EM = -0.5
/** 同じ大きさ・同じ基準線とみなす差の上限。文字の大きさに対する倍率。 */
const SAME_TOLERANCE_EM = 0.01

function clampOr(value: number | undefined, min: number, max: number, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

/**
 * まとまりの、基準線から上端・下端までの高さを決める。値がおかしいフォントは、既定の値で代える。
 * chars と measureInk を渡すと、ぶら下がる字形の判定に、字形の実際の範囲を使う。
 */
export function verticalExtent(
  font: RunFont | undefined,
  run?: { fontId: string; chars: readonly RunChar[] },
  measureInk?: GlyphInkMeasurer,
): { ascent: number; descent: number } {
  if (run && measureInk) {
    const inks = run.chars.map((char) => measureInk(run.fontId, char.fontChar))
    if (inks.length > 0 && inks.every((ink) => ink !== null)) {
      const ascent = Math.max(...inks.map((ink) => ink.ascent))
      const descent = Math.max(...inks.map((ink) => ink.descent))
      if (ascent < HANGING_MAX_ASCENT && descent > HANGING_MIN_DESCENT) {
        return { ascent: Math.max(ascent, 0.02), descent: -descent }
      }
    }
  }
  const ascent = font?.ascent
  const fontHangs = ascent !== undefined && Number.isFinite(ascent) && ascent < HANGING_FONT_ASCENT_LIMIT
  const radical = run !== undefined && !measureInk && run.chars.length > 0 && run.chars.every((char) => char.text === '√')
  if (fontHangs || radical) return { ascent: HANGING_ASCENT, descent: HANGING_DESCENT }
  return {
    ascent: clampOr(ascent, 0.5, 1.0, DEFAULT_ASCENT),
    descent: clampOr(font?.descent, -0.35, 0, DEFAULT_DESCENT),
  }
}

interface RunBuilder {
  glyph: Glyph
  chars: RunChar[]
  text: string
  right: number
}

function finish(builder: RunBuilder, font: RunFont | undefined, measureInk: GlyphInkMeasurer | undefined): RawRun {
  const { glyph, chars } = builder
  const { ascent, descent } = verticalExtent(font, { fontId: glyph.fontId, chars }, measureInk)
  const x = (chars[0] as RunChar).x
  return {
    text: builder.text,
    chars,
    x,
    y: glyph.baseline - ascent * glyph.fontSize,
    width: builder.right - x,
    height: (ascent - descent) * glyph.fontSize,
    fontSize: glyph.fontSize,
    fontName: font?.name ?? '',
    fontId: glyph.fontId,
    baseline: glyph.baseline,
    rotated: glyph.rotated,
  }
}

/**
 * 文字のまとまりを作る。文字は、PDF に書かれた順に渡す。
 * 空白の文字は、まとまりに含めない。文字の間のすき間が空白に当たる場合は、text に空白を補う。
 */
export function buildRuns(
  glyphs: readonly Glyph[],
  getFont: (fontId: string) => RunFont | undefined,
  measureInk?: GlyphInkMeasurer,
): RawRun[] {
  const runs: RawRun[] = []
  let current: RunBuilder | undefined

  function flush(): void {
    if (current && current.chars.length > 0) runs.push(finish(current, getFont(current.glyph.fontId), measureInk))
    current = undefined
  }

  for (const glyph of glyphs) {
    // 空白の文字や、対応する文字が分からない字形は、すき間として扱う。
    if (glyph.text.trim().length === 0) continue

    if (current) {
      const first = current.glyph
      const tolerance = SAME_TOLERANCE_EM * first.fontSize
      const gap = glyph.x - current.right
      const continues =
        glyph.fontId === first.fontId &&
        glyph.rotated === first.rotated &&
        !glyph.rotated &&
        Math.abs(glyph.fontSize - first.fontSize) <= tolerance &&
        Math.abs(glyph.baseline - first.baseline) <= tolerance &&
        gap <= MAX_GAP_EM * first.fontSize &&
        gap >= MIN_GAP_EM * first.fontSize
      if (continues) {
        if (isSpaceGap(gap, first.fontSize)) current.text += ' '
        current.text += glyph.text
        current.chars.push({ text: glyph.text, x: glyph.x, width: glyph.width, fontChar: glyph.fontChar })
        current.right = Math.max(current.right, glyph.x + glyph.width)
        continue
      }
      flush()
    }
    current = {
      glyph,
      chars: [{ text: glyph.text, x: glyph.x, width: glyph.width, fontChar: glyph.fontChar }],
      text: glyph.text,
      right: glyph.x + glyph.width,
    }
  }
  flush()
  return runs
}
