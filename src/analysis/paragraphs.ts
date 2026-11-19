/**
 * 行を、段落にまとめる。
 *
 * 行は、真上にある段落の最後の行と、行間・文字の大きさ・左端の位置が合うときに、その段落へ足す。
 * 段落の切れ目は、行間の広がり、文字の大きさの変化、字下げで判定する。
 * 左右の段は横に重ならないため、段組は特別に扱わなくても分かれる。
 */

import { unionRect } from './types.ts'
import type { Line, Paragraph } from './types.ts'

/** 同じ段落とみなす文字の大きさの差の上限(割合)。 */
const FONT_SIZE_TOLERANCE = 0.08
/** 行送り(基準線の間隔)がまだ分からないときの上限。文字の大きさに対する倍率。 */
const MAX_FIRST_PITCH_EM = 1.75
/** 行送りが分かっているときの、広がりの許容(倍率)。 */
const PITCH_TOLERANCE = 1.25
/** 字下げとみなす左端のずれの下限。文字の大きさに対する倍率。 */
const INDENT_EM = 0.7
/**
 * 中央ぞろえとみなす、行の中心のずれの上限。文字の大きさに対する倍率。
 * 幅いっぱいの行の次に、1 文字分だけ字下げされた幅いっぱいの行が来ると、中心は 0.5 文字分ずれる。
 * これを中央ぞろえと誤らないよう、0.5 より十分に小さい値にしている。
 */
const CENTER_EM = 0.25
/** 真上の行とみなす横の重なりの下限。狭いほうの幅に対する割合。 */
const MIN_HORIZONTAL_OVERLAP = 0.5
/**
 * 見出しとみなす、文字の大きさの差の下限(割合)。
 * 1 行目だけがフォントも大きさも違うとき、その行は見出しとして、本文の段落に入れない。
 * 本文とほぼ同じ大きさ(差が FONT_SIZE_TOLERANCE 以内)で、別のフォントの見出しを分けるためのもの。
 */
const HEADING_SIZE_DIFFERENCE = 0.02

interface ParagraphBuilder {
  lines: Line[]
  /** 2 行目以降の左端のうち最も左。1 行だけのときは undefined。 */
  bodyLeft: number | undefined
  /** 行送り。1 行だけのときは undefined。 */
  pitch: number | undefined
}

function horizontalOverlap(a: Line, b: Line): number {
  const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const narrower = Math.min(a.width, b.width)
  return narrower > 0 ? overlap / narrower : 0
}

function isCentered(a: Line, b: Line, em: number): boolean {
  const centerA = a.x + a.width / 2
  const centerB = b.x + b.width / 2
  const leftDiffers = Math.abs(a.x - b.x) > INDENT_EM * em
  return leftDiffers && Math.abs(centerA - centerB) <= CENTER_EM * em
}

/** 行の中で、文字数が最も多いフォントの名前。フォントの名前が分からない行は、空文字列。 */
function dominantFont(line: Line): string {
  const counts = new Map<string, number>()
  let best = ''
  let bestCount = 0
  for (const run of line.runs) {
    const count = (counts.get(run.fontName) ?? 0) + run.text.length
    counts.set(run.fontName, count)
    if (count > bestCount) {
      best = run.fontName
      bestCount = count
    }
  }
  return best
}

function continues(builder: ParagraphBuilder, line: Line): boolean {
  const last = builder.lines.at(-1) as Line
  const em = last.fontSize

  if (Math.abs(line.fontSize - last.fontSize) > FONT_SIZE_TOLERANCE * em) return false
  if (builder.lines.length === 1 && Math.abs(line.fontSize - last.fontSize) > HEADING_SIZE_DIFFERENCE * em) {
    const lastFont = dominantFont(last)
    const lineFont = dominantFont(line)
    if (lastFont !== '' && lineFont !== '' && lastFont !== lineFont) return false
  }
  if (horizontalOverlap(last, line) < MIN_HORIZONTAL_OVERLAP) return false

  const pitch = line.baseline - last.baseline
  if (pitch <= 0) return false
  const maxPitch = builder.pitch === undefined ? MAX_FIRST_PITCH_EM * em : PITCH_TOLERANCE * builder.pitch
  if (pitch > maxPitch) return false

  if (isCentered(last, line, em)) return true

  // 字下げされた行は、新しい段落の 1 行目とみなす。
  // 基準にする左端は、2 行目以降の左端(分からなければ 1 行目の左端)。
  const bodyLeft = builder.bodyLeft ?? last.x
  if (line.x - bodyLeft > INDENT_EM * em) return false

  return true
}

function finish(builder: ParagraphBuilder): Paragraph {
  const lines = builder.lines
  const first = lines[0] as Line
  const total = lines.reduce((sum, line) => sum + line.text.length, 0)
  const math = lines.reduce((sum, line) => sum + line.mathRatio * line.text.length, 0)
  return {
    ...unionRect(lines),
    lines,
    text: joinLines(lines),
    fontSize: first.fontSize,
    mathRatio: total > 0 ? math / total : 0,
  }
}

/** 行の文章をつなぐ。行末のハイフンで分かれた語は、ハイフンを除いてつなぎ直す。 */
export function joinLines(lines: readonly Line[]): string {
  let text = ''
  for (const line of lines) {
    if (text.length === 0) {
      text = line.text
    } else if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(line.text)) {
      text = text.slice(0, -1) + line.text
    } else {
      text += ` ${line.text}`
    }
  }
  return text
}

/** 段落にまとめる。返す段落は、1 行目の位置で上から下、左から右の順に並ぶ。 */
export function buildParagraphs(lines: readonly Line[]): Paragraph[] {
  const sorted = [...lines].sort((a, b) => a.baseline - b.baseline || a.x - b.x)
  const builders: ParagraphBuilder[] = []

  for (const line of sorted) {
    let target: ParagraphBuilder | undefined
    let targetPitch = Infinity
    for (const builder of builders) {
      if (!continues(builder, line)) continue
      const pitch = line.baseline - (builder.lines.at(-1) as Line).baseline
      if (pitch < targetPitch) {
        target = builder
        targetPitch = pitch
      }
    }
    if (target) {
      target.lines.push(line)
      target.bodyLeft = Math.min(target.bodyLeft ?? Infinity, line.x)
      target.pitch ??= targetPitch
    } else {
      builders.push({ lines: [line], bodyLeft: undefined, pitch: undefined })
    }
  }

  return builders.map(finish).sort((a, b) => a.y - b.y || a.x - b.x)
}
