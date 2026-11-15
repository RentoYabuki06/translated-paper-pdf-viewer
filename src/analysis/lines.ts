/**
 * 文字のまとまり(TextRun)を、行にまとめる。
 *
 * 2 つのまとまりは、縦の範囲が重なり、横のすき間が小さいときに同じ行とする。
 * 段組の間のすき間は文字の大きさより広いため、左右の段の行は別の行になる。
 */

import { unionRect } from './types.ts'
import type { Line, TextRun } from './types.ts'

/** 同じ行とみなす横のすき間の上限。行の文字の大きさに対する倍率。 */
const MAX_GAP_EM = 1.5
/** 同じ行とみなす縦の重なりの下限。低いほうの高さに対する割合。 */
const MIN_VERTICAL_OVERLAP = 0.5
/** 単語の区切りとして空白を補う横のすき間の下限。文字の大きさに対する倍率。 */
const SPACE_GAP_EM = 0.18
/** 行の縦の範囲を決めるときに、添字とみなさない文字の大きさの下限。行で最大の大きさに対する割合。 */
const BAND_SIZE_RATIO = 0.9

interface LineBuilder {
  runs: TextRun[]
  /** 行の縦の範囲。添字より大きい文字だけで決める。 */
  bandTop: number
  bandBottom: number
  maxFontSize: number
  right: number
}

function verticalOverlap(run: TextRun, builder: LineBuilder): number {
  const overlap = Math.min(run.y + run.height, builder.bandBottom) - Math.max(run.y, builder.bandTop)
  const smaller = Math.min(run.height, builder.bandBottom - builder.bandTop)
  return smaller > 0 ? overlap / smaller : 0
}

function addRun(builder: LineBuilder, run: TextRun): void {
  builder.runs.push(run)
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

function joinText(runs: readonly TextRun[]): string {
  let text = ''
  let previous: TextRun | undefined
  for (const run of runs) {
    if (previous) {
      const gap = run.x - (previous.x + previous.width)
      const limit = SPACE_GAP_EM * Math.max(previous.fontSize, run.fontSize)
      if (gap > limit && !/\s$/.test(text) && !/^\s/.test(run.text)) text += ' '
    }
    text += run.text
    previous = run
  }
  return text.replace(/\s+/g, ' ').trim()
}

function finish(builder: LineBuilder): Line {
  const runs = builder.runs
  const fontSize = dominant(runs, (run) => Math.round(run.fontSize * 10) / 10)
  const mainRuns = runs.filter((run) => Math.abs(run.fontSize - fontSize) < 0.1)
  const baseline = dominant(mainRuns.length > 0 ? mainRuns : runs, (run) => Math.round(run.baseline * 10) / 10)
  const total = runs.reduce((sum, run) => sum + run.text.trim().length, 0)
  const math = runs.reduce((sum, run) => sum + (run.isMath ? run.text.trim().length : 0), 0)
  return {
    ...unionRect(runs),
    runs,
    text: joinText(runs),
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
        bandTop: run.y,
        bandBottom: run.y + run.height,
        maxFontSize: run.fontSize,
        right: run.x + run.width,
      })
    }
  }

  return builders.map(finish).sort((a, b) => a.y - b.y || a.x - b.x)
}
