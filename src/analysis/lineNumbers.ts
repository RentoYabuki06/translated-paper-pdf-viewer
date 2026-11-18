/**
 * 余白に振られた行番号を、文字のまとまりから取り除く。
 *
 * 査読用の原稿などでは、本文の左(または右)の余白に、行ごとの番号が小さい字で書かれている。
 * 番号は本文のすぐ横にあるため、取り除かないと、本文の行の先頭に付いた数字として読まれ、訳文に混ざる。
 *
 * 行番号とみなす条件は、次のすべて。
 *   - 数字だけのまとまりが、縦に 1 列に並んでいる(右端か左端がそろっている)
 *   - 上から下へ、同じ数ずつ増えている(1 ずつ、5 ずつなど)
 *   - 文字の大きさが同じ
 *   - 列の左か右に、ほかの文字が無い(余白にある)
 *   - 次のどれかに当てはまる
 *       - 列が、ページの文字のある範囲の半分以上の高さに渡っている
 *       - 10 個以上ある
 *       - ページのほかのどの文字よりも外側にある
 * 最後の条件は、表の左端にある通し番号の列を、行番号と誤らないためのもの。
 * 表の通し番号は、本文の左端と同じ位置か、それより内側にある。
 */

import type { TextRun } from './types.ts'

type Run = Pick<TextRun, 'text' | 'x' | 'y' | 'width' | 'height' | 'fontSize' | 'baseline' | 'rotated'>

/** 行番号とみなす個数の下限。 */
const MIN_COUNT = 3
/** この個数以上あれば、列の高さの条件を問わない。 */
const SURE_COUNT = 10
/** 列の高さの下限。ページの文字のある範囲の高さに対する割合。 */
const MIN_COVERAGE = 0.5
/** 端がそろっているとみなす差の上限(ポイント)。 */
const EDGE_TOLERANCE = 1
/** 同じ大きさとみなす差の上限(ポイント)。 */
const SIZE_TOLERANCE = 0.05
/** 余白にあるかを確かめるときに、重なりとして許す幅(ポイント)。 */
const MARGIN_TOLERANCE = 0.5

const DIGITS = /^\d{1,5}$/

/** 基準線の順に並んだ候補から、同じ数ずつ増えている、最も長い並びを取り出す。 */
function longestSequence<T extends Run>(column: readonly T[]): T[] {
  let best: T[] = []
  let start = 0
  while (start < column.length) {
    const sequence = [column[start] as T]
    let step: number | undefined
    for (let index = start + 1; index < column.length; index += 1) {
      const previous = sequence.at(-1) as T
      const next = column[index] as T
      const difference = Number(next.text) - Number(previous.text)
      const sameSize = Math.abs(next.fontSize - previous.fontSize) <= SIZE_TOLERANCE
      if (!sameSize || difference < 1 || next.baseline <= previous.baseline) break
      if (step !== undefined && difference !== step) break
      step = difference
      sequence.push(next)
    }
    if (sequence.length > best.length) best = sequence
    start += sequence.length
  }
  return best
}

/** 候補を、端の位置が近いものどうしの列に分ける。 */
function columnsBy<T extends Run>(candidates: readonly T[], edge: (run: T) => number): T[][] {
  const sorted = [...candidates].sort((a, b) => edge(a) - edge(b))
  const columns: T[][] = []
  for (const run of sorted) {
    const current = columns.at(-1)
    if (current && edge(run) - edge(current[0] as T) <= EDGE_TOLERANCE) current.push(run)
    else columns.push([run])
  }
  return columns.map((column) => column.sort((a, b) => a.baseline - b.baseline))
}

export function removeLineNumbers<T extends Run>(runs: readonly T[]): T[] {
  const upright = runs.filter((run) => !run.rotated && run.text.trim().length > 0)
  const candidates = upright.filter((run) => DIGITS.test(run.text.trim()))
  if (candidates.length < MIN_COUNT) return [...runs]

  const textTop = Math.min(...upright.map((run) => run.y))
  const textBottom = Math.max(...upright.map((run) => run.y + run.height))
  const removed = new Set<T>()

  // 行番号は、右端をそろえて書かれることが多い。右端で見つからなかったものを、左端で探す。
  for (const edge of [(run: T) => run.x + run.width, (run: T) => run.x]) {
    const rest = candidates.filter((run) => !removed.has(run))
    for (const column of columnsBy(rest, edge)) {
      const sequence = longestSequence(column)
      if (sequence.length < MIN_COUNT) continue

      const top = Math.min(...sequence.map((run) => run.y))
      const bottom = Math.max(...sequence.map((run) => run.y + run.height))
      const left = Math.min(...sequence.map((run) => run.x))
      const right = Math.max(...sequence.map((run) => run.x + run.width))
      const members = new Set(sequence)
      const others = upright.filter((run) => !members.has(run) && !removed.has(run))
      const isRightOf = (run: T) => run.x >= right - MARGIN_TOLERANCE
      const isLeftOf = (run: T) => run.x + run.width <= left + MARGIN_TOLERANCE

      // 列と同じ高さにある文字が、すべて列の片側にあること。
      const beside = others.filter((run) => run.y < bottom && run.y + run.height > top)
      if (!beside.every(isRightOf) && !beside.every(isLeftOf)) continue

      const covers = bottom - top >= MIN_COVERAGE * (textBottom - textTop)
      const outermost = others.every(isRightOf) || others.every(isLeftOf)
      if (!covers && !outermost && sequence.length < SURE_COUNT) continue

      for (const run of sequence) removed.add(run)
    }
  }
  return removed.size > 0 ? runs.filter((run) => !removed.has(run)) : [...runs]
}
