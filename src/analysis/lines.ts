/**
 * 文字のまとまり(TextRun)を、行にまとめる。
 *
 * 2 つのまとまりは、縦の範囲が重なり、横のすき間が小さいときに同じ行とする。
 * 段組の間のすき間は文字の大きさより広いため、左右の段の行は別の行になる。
 *
 * 分数の分母や根号の中身のように、行の上下に離れて置かれた数式の部品は、縦の範囲が重ならない。
 * これらは、いったん別の行になったあとで、もとの行に戻す。
 */

import { isMathSymbols } from '../math/detect.ts'
import { findMathSpans } from '../math/spans.ts'
import { isSpaceGap } from './spacing.ts'
import { unionRect } from './types.ts'
import type { Line, LineChar, TextRun } from './types.ts'

/** 同じ行とみなす横のすき間の上限。行の文字の大きさに対する倍率。 */
const MAX_GAP_EM = 1.5
/** 同じ行とみなす縦の重なりの下限。低いほうの高さに対する割合。 */
const MIN_VERTICAL_OVERLAP = 0.5
/** 行の縦の範囲を決めるときに、添字とみなさない文字の大きさの下限。行で最大の大きさに対する割合。 */
const BAND_SIZE_RATIO = 0.9

/** 離れた数式の部品を探す範囲。行の縦の範囲を、上下にこの分だけ広げる。行の文字の大きさに対する倍率。 */
const SATELLITE_REACH_EM = 0.6
/** 離れた数式の部品とみなす条件: 部品の高さのうち、上の範囲に入る割合の下限。 */
const SATELLITE_MIN_INSIDE = 0.6
/** 離れた数式の部品が、行の単語と横に重なってよい幅の上限。行の文字の大きさに対する倍率。 */
const SATELLITE_WORD_OVERLAP_EM = 0.2
/** 数字、括弧、演算子、句読点だけでできた文字列。数式の部品になりうる。 */
const NEUTRAL_TEXT = /^[\d\s+\-−=()[\]{}.,/*|:;!<>′']+$/u

interface LineBuilder {
  runs: TextRun[]
  /** 行の上下に離れて置かれた数式の部品として、あとから足したまとまり。 */
  satellites: Set<TextRun>
  /** 行の縦の範囲。添字より大きい文字だけで決める。 */
  bandTop: number
  bandBottom: number
  maxFontSize: number
  left: number
  right: number
}

function verticalOverlap(run: TextRun, builder: LineBuilder): number {
  const overlap = Math.min(run.y + run.height, builder.bandBottom) - Math.max(run.y, builder.bandTop)
  const smaller = Math.min(run.height, builder.bandBottom - builder.bandTop)
  return smaller > 0 ? overlap / smaller : 0
}

function addRun(builder: LineBuilder, run: TextRun): void {
  builder.runs.push(run)
  builder.left = Math.min(builder.left, run.x)
  builder.right = Math.max(builder.right, run.x + run.width)
  if (run.fontSize > builder.maxFontSize / BAND_SIZE_RATIO) {
    // これまでより明らかに大きい文字が来たら、それまでの文字は添字だったとみなす。
    builder.maxFontSize = run.fontSize
    builder.bandTop = run.y
    builder.bandBottom = run.y + run.height
  } else if (run.fontSize >= builder.maxFontSize * BAND_SIZE_RATIO) {
    builder.maxFontSize = Math.max(builder.maxFontSize, run.fontSize)
    builder.bandTop = Math.min(builder.bandTop, run.y)
    builder.bandBottom = Math.max(builder.bandBottom, run.y + run.height)
  }
}

/** 文字数で重みを付けて、最も多く使われている値を返す。 */
function dominant<T>(runs: readonly TextRun[], key: (run: TextRun) => T): T {
  const weights = new Map<T, number>()
  let best: T = key(runs[0] as TextRun)
  let bestWeight = 0
  for (const run of runs) {
    const value = key(run)
    const weight = (weights.get(value) ?? 0) + run.text.length
    weights.set(value, weight)
    if (weight > bestWeight) {
      best = value
      bestWeight = weight
    }
  }
  return best
}

/** 数式の部品になりうるまとまりかどうか。数式の文字か、数字・括弧・演算子だけでできている。 */
function isMathLike(run: TextRun): boolean {
  return run.isMath || NEUTRAL_TEXT.test(run.text)
}

/**
 * 行の上下に離れて置かれた数式の部品を、もとの行に戻す。
 *
 * 部品とみなす条件は次のとおり。
 *   - 数式の文字か、数字・括弧・演算子だけでできている
 *   - 横の範囲が、もとの行の横の範囲に入っている
 *   - 縦の範囲の大半が、もとの行の縦の範囲を上下に少し広げた中に入っている
 *   - もとの行の単語と、横に重ならない(行の中の、数式が置かれた空きの上下にある)
 * 次の行は、行送りの分だけ下にあるため、縦の条件に当てはまらない。
 */
function mergeSatellites(builders: LineBuilder[]): LineBuilder[] {
  const removed = new Set<LineBuilder>()
  // 小さいものから順に見る。部品が戻る先の行が、さらに別の行の部品になることがあるため。
  const candidates = builders.filter((builder) => builder.runs.every(isMathLike)).sort((a, b) => a.right - a.left - (b.right - b.left))

  for (const part of candidates) {
    const partHeight = part.bandBottom - part.bandTop
    if (partHeight <= 0) continue
    let host: LineBuilder | undefined
    let hostInside = 0

    for (const builder of builders) {
      if (builder === part || removed.has(builder)) continue
      const em = builder.maxFontSize
      if (part.maxFontSize > em || part.right - part.left >= builder.right - builder.left) continue
      if (part.left < builder.left - 0.5 * em || part.right > builder.right + 0.5 * em) continue

      const reach = SATELLITE_REACH_EM * em
      const inside =
        (Math.min(part.bandBottom, builder.bandBottom + reach) - Math.max(part.bandTop, builder.bandTop - reach)) / partHeight
      if (inside < SATELLITE_MIN_INSIDE || inside <= hostInside) continue

      const overlapsWord = builder.runs.some((run) => {
        if (isMathLike(run)) return false
        const overlap = Math.min(run.x + run.width, part.right) - Math.max(run.x, part.left)
        return overlap > SATELLITE_WORD_OVERLAP_EM * em
      })
      if (overlapsWord) continue
      host = builder
      hostInside = inside
    }

    if (host) {
      for (const run of part.runs) {
        host.runs.push(run)
        host.satellites.add(run)
      }
      for (const run of part.satellites) host.satellites.add(run)
      removed.add(part)
    }
  }
  return builders.filter((builder) => !removed.has(builder))
}

/** 文字の並びから、文章を作る。文字の間のすき間が空白に当たる箇所には、空白を補う。 */
export function textOfChars(chars: readonly LineChar[]): string {
  let text = ''
  let right = -Infinity
  let previousSize = 0
  for (const char of chars) {
    if (text.length > 0 && isSpaceGap(char.x - right, Math.max(previousSize, char.fontSize))) text += ' '
    text += char.text
    right = Math.max(right, char.x + char.width)
    previousSize = char.fontSize
  }
  return text
}

function finish(builder: LineBuilder): Line {
  const runs = [...builder.runs].sort((a, b) => a.x - b.x)
  // 行の文字の大きさと基準線は、あとから足した数式の部品を除いて決める。
  const own = runs.filter((run) => !builder.satellites.has(run))
  const fontSize = dominant(own, (run) => Math.round(run.fontSize * 10) / 10)
  const mainRuns = own.filter((run) => Math.abs(run.fontSize - fontSize) < 0.1)
  const baseline = dominant(mainRuns.length > 0 ? mainRuns : own, (run) => Math.round(run.baseline * 10) / 10)

  // 文字は、まとまりの単位で左から右に並べる。まとまりの中の文字の順は変えない。
  // 上付きと下付きのように横に重なるまとまりでも、それぞれの文字が続いて並ぶ。
  const chars: LineChar[] = runs.flatMap((run) =>
    run.chars.map((char) => ({
      ...char,
      baseline: run.baseline,
      fontSize: run.fontSize,
      fontName: run.fontName,
      fontId: run.fontId,
      top: run.y,
      bottom: run.y + run.height,
      math: run.isMath || isMathSymbols(char.text),
      satellite: builder.satellites.has(run),
    })),
  )

  const spans = findMathSpans(chars, fontSize, baseline)
  const total = chars.reduce((sum, char) => sum + char.text.length, 0)
  const math = spans.reduce(
    (sum, span) => sum + chars.slice(span.start, span.end).reduce((inner, char) => inner + char.text.length, 0),
    0,
  )

  return {
    ...unionRect(runs),
    runs,
    chars,
    spans,
    text: textOfChars(chars),
    fontSize,
    baseline,
    mathRatio: total > 0 ? math / total : 0,
  }
}

/** 行にまとめる。返す行は、上から下、左から右の順に並ぶ。回転した文字と空白だけのまとまりは除く。 */
export function buildLines(runs: readonly TextRun[]): Line[] {
  const sorted = runs
    .filter((run) => !run.rotated && run.text.trim().length > 0 && run.height > 0)
    .sort((a, b) => a.x - b.x || a.y - b.y)

  const builders: LineBuilder[] = []
  for (const run of sorted) {
    let target: LineBuilder | undefined
    let targetOverlap = 0
    for (const builder of builders) {
      const gap = run.x - builder.right
      if (gap > MAX_GAP_EM * Math.max(builder.maxFontSize, run.fontSize)) continue
      const overlap = verticalOverlap(run, builder)
      if (overlap >= MIN_VERTICAL_OVERLAP && overlap > targetOverlap) {
        target = builder
        targetOverlap = overlap
      }
    }
    if (target) {
      addRun(target, run)
    } else {
      builders.push({
        runs: [run],
        satellites: new Set(),
        bandTop: run.y,
        bandBottom: run.y + run.height,
        maxFontSize: run.fontSize,
        left: run.x,
        right: run.x + run.width,
      })
    }
  }

  return mergeSatellites(builders)
    .map(finish)
    .sort((a, b) => a.y - b.y || a.x - b.x)
}
