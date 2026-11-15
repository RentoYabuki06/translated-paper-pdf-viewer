/**
 * 行の中の文字から、文中の数式の範囲を決める。
 *
 * 出発点は、数式用のフォントの文字と、数学記号である。
 * ただし、数式の中の数字、括弧、等号などは、本文と同じフォントで書かれることが多い。
 * そこで、出発点の文字の左右にある数字・括弧・演算子を、規則に従って数式に含める。
 * 規則は、できるだけ式の全体を 1 つの範囲にし、文章の句読点や単語は含めないように決めている。
 */

import type { MathSpan } from '../analysis/types.ts'

/** 範囲の判定に使う、文字の情報。 */
export interface SpanChar {
  text: string
  x: number
  width: number
  baseline: number
  fontSize: number
  math: boolean
  satellite: boolean
}

/** これ以下のすき間は、前の文字に「くっついている」とみなす。行の文字の大きさに対する倍率。 */
const ATTACH_EM = 0.25
/** 1 つの数式の中で許すすき間の上限。 */
const MAX_INNER_GAP_EM = 1.2
/** 括弧で囲まれた部分を、数式の続きとして含めるときの、直前とのすき間の上限。 */
const GROUP_GAP_EM = 0.6
/** 添字とみなす文字の大きさの上限(行の文字の大きさに対する割合)と、基準線のずれの下限(倍率)。 */
const SCRIPT_SIZE_RATIO = 0.85
const SCRIPT_SHIFT_EM = 0.08

type CharClass = 'open' | 'close' | 'digit' | 'operator' | 'comma' | 'prime' | 'other'

const OPEN = new Set(['(', '[', '{', '⟨'])
const CLOSE = new Set([')', ']', '}', '⟩'])
const OPERATORS = /^[=+\-−×·÷±∓<>≤≥≠≈∼≃≡∈∉⊂⊆⊃⊇∪∩→←↔⇒⇐⇔∗∘⊕⊗|/:*~!^]$/u
/** 上付きの数字や記号。脚注の番号や印に使われる。 */
const NOTE_MARK = /^[\d*∗†‡§¶]+$/u

function classify(text: string): CharClass {
  if (OPEN.has(text)) return 'open'
  if (CLOSE.has(text)) return 'close'
  if (/^\d+$/.test(text)) return 'digit'
  if (text === ',') return 'comma'
  if (text === "'" || text === '′' || text === '″') return 'prime'
  if (OPERATORS.test(text)) return 'operator'
  return 'other'
}

/**
 * 文中の数式の範囲を求める。chars は、行の文字(Line の chars)の順で渡す。
 * lineFontSize と lineBaseline には、行の本文の文字の大きさと基準線を渡す。
 */
export function findMathSpans(chars: readonly SpanChar[], lineFontSize: number, lineBaseline: number): MathSpan[] {
  const count = chars.length
  const classes = chars.map((char) => classify(char.text))

  // 各文字の、左にある文字とのすき間(行の文字の大きさに対する倍率)。添字どうしが重なる場合は負になる。
  const gaps: number[] = []
  let right = -Infinity
  for (const char of chars) {
    gaps.push((char.x - right) / lineFontSize)
    right = Math.max(right, char.x + char.width)
  }

  // 出発点: 数式用のフォントの文字、数学記号、行の上下に離れた数式の部品。
  const seed = chars.map((char) => char.math || char.satellite)

  // 添字: 数式にくっついた添字は、数式の一部とする。上付きの数字や記号(脚注の番号など)も、数式と同じ扱いにする。
  chars.forEach((char, index) => {
    if (seed[index]) return
    const shift = char.baseline - lineBaseline
    const script = char.fontSize <= SCRIPT_SIZE_RATIO * lineFontSize && Math.abs(shift) > SCRIPT_SHIFT_EM * lineFontSize
    if (!script) return
    const attachedToSeed = index > 0 && seed[index - 1] === true && (gaps[index] as number) <= ATTACH_EM
    if (attachedToSeed || (shift < 0 && NOTE_MARK.test(char.text))) seed[index] = true
  })

  const isOperator = (index: number) => classes[index] === 'operator'
  const attached = (index: number) => (gaps[index] as number) <= ATTACH_EM
  const near = (index: number, limit = MAX_INNER_GAP_EM) => index < count && (gaps[index] as number) <= limit

  /** index から右へ続く数字の並び("3.14" や "1,000" を含む)の終わり(その次の位置)を返す。 */
  function digitsEndingAfter(index: number): number {
    let end = index + 1
    while (end < count && !seed[end] && attached(end)) {
      if (classes[end] === 'digit') end += 1
      else if ((chars[end]?.text === '.' || chars[end]?.text === ',') && classes[end + 1] === 'digit' && !seed[end + 1] && attached(end + 1)) end += 2
      else break
    }
    return end
  }

  /** index で終わる数字の並びの始まりを返す。 */
  function digitsStartingBefore(index: number, floor: number): number {
    let start = index
    while (start - 1 >= floor && !seed[start - 1] && attached(start)) {
      if (classes[start - 1] === 'digit') start -= 1
      else if ((chars[start - 1]?.text === '.' || chars[start - 1]?.text === ',') && start - 2 >= floor && classes[start - 2] === 'digit' && !seed[start - 2] && attached(start - 1)) start -= 2
      else break
    }
    return start
  }

  /** 括弧の中に入ってよい文字かどうか。単語や句点があれば、数式の括弧ではないとみなす。 */
  const allowedInGroup = (index: number) => seed[index] === true || classes[index] !== 'other'

  /** index の開き括弧に対応する閉じ括弧の位置を返す。見つからなければ -1。 */
  function matchingClose(index: number): number {
    let depth = 0
    for (let k = index; k < count; k += 1) {
      if (k > index && !near(k)) return -1
      if (!allowedInGroup(k)) return -1
      if (classes[k] === 'open') depth += 1
      else if (classes[k] === 'close') {
        depth -= 1
        if (depth === 0) return k
      }
    }
    return -1
  }

  /** index の閉じ括弧に対応する開き括弧の位置を返す。見つからなければ -1。 */
  function matchingOpen(index: number, floor: number): number {
    let depth = 0
    for (let k = index; k >= floor; k -= 1) {
      if (k < index && !near(k + 1)) return -1
      if (!allowedInGroup(k)) return -1
      if (classes[k] === 'close') depth += 1
      else if (classes[k] === 'open') {
        depth -= 1
        if (depth === 0) return k
      }
    }
    return -1
  }

  /** 範囲の中の、閉じていない開き括弧の数。 */
  function openDepth(start: number, end: number): number {
    let depth = 0
    for (let k = start; k < end; k += 1) {
      if (classes[k] === 'open') depth += 1
      else if (classes[k] === 'close' && depth > 0) depth -= 1
    }
    return depth
  }

  /** 範囲を左へ広げる。floor より左へは広げない。 */
  function extendLeft(start: number, floor: number): number {
    for (;;) {
      const k = start - 1
      if (k < floor || seed[k] || !near(start)) break
      const kind = classes[k]
      // 係数("2x")、または、演算子で始まる式の左の数("3 × 3")。
      if (kind === 'digit' && (attached(start) || isOperator(start))) {
        start = digitsStartingBefore(k, floor)
        continue
      }
      // 演算子で始まる式の左の、括弧で囲まれた部分("(a + b) × c")。
      if (kind === 'close' && isOperator(start)) {
        const open = matchingOpen(k, floor)
        if (open === -1) break
        start = open
        continue
      }
      // 開き括弧("(x, y)")。対応する閉じ括弧が範囲に入らなかった場合は、あとで外す。
      if (kind === 'open' && attached(start)) {
        start = k
        continue
      }
      // 本文と同じフォントの演算子と、その左の数("5 + x")。
      if (kind === 'operator' && k - 1 >= floor && near(k)) {
        if (classes[k - 1] === 'digit' && !seed[k - 1]) {
          start = digitsStartingBefore(k - 1, floor)
          continue
        }
        if (classes[k - 1] === 'close') {
          const open = matchingOpen(k - 1, floor)
          if (open !== -1) {
            start = open
            continue
          }
        }
      }
      break
    }
    return start
  }

  /** 範囲を右へ広げる。 */
  function extendRight(start: number, end: number): number {
    for (;;) {
      const k = end
      if (k >= count || !near(k)) break
      if (seed[k]) {
        end = k + 1
        continue
      }
      const kind = classes[k]
      const afterOperator = isOperator(end - 1) || classes[end - 1] === 'comma'
      if (kind === 'close') {
        if (openDepth(start, end) === 0) break
        end = k + 1
        continue
      }
      if (kind === 'open') {
        const close = matchingClose(k)
        if (close === -1) break
        let containsSeed = false
        for (let inner = k + 1; inner < close; inner += 1) containsSeed ||= seed[inner] === true
        // くっついた括弧("f(x)"、"a[3]")、演算子の次の括弧、数式の文字を含む近くの括弧を含める。
        // 空白をはさんだ "[41]" のように、数字だけを囲んだものは、引用の番号とみなして含めない。
        const include = attached(k) || afterOperator || (containsSeed && near(k, GROUP_GAP_EM))
        if (!include) break
        end = close + 1
        continue
      }
      if (kind === 'digit') {
        if (!attached(k) && !afterOperator) break
        end = digitsEndingAfter(k)
        continue
      }
      if (kind === 'prime') {
        if (!attached(k)) break
        end = k + 1
        continue
      }
      if (kind === 'operator') {
        // 演算子は、その右に式の続きがあるときだけ含める。
        const next = k + 1
        const continues = near(next) && (seed[next] === true || classes[next] === 'digit' || (classes[next] === 'open' && matchingClose(next) !== -1))
        if (!continues) break
        end = k + 1
        continue
      }
      if (kind === 'comma') {
        // 本文と同じフォントのコンマは、括弧の中にあるときだけ含める("f(x, y)")。
        const next = k + 1
        const continues = near(next, GROUP_GAP_EM) && (seed[next] === true || classes[next] === 'digit')
        if (openDepth(start, end) === 0 || !attached(k) || !continues) break
        end = k + 1
        continue
      }
      break
    }
    return end
  }

  const spans: MathSpan[] = []
  let index = 0
  let floor = 0
  while (index < count) {
    if (!seed[index]) {
      index += 1
      continue
    }
    let start = extendLeft(index, floor)
    const end = extendRight(start, index + 1)
    // 対応する閉じ括弧が入らなかった先頭の開き括弧を外す。
    let unmatched = openDepth(start, end)
    while (unmatched > 0 && start < index && classes[start] === 'open' && !seed[start]) {
      start += 1
      unmatched -= 1
    }
    spans.push({ start, end })
    index = end
    floor = end
  }
  return spans
}
