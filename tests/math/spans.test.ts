import { describe, expect, it } from 'vitest'
import { isMathSymbols } from '../../src/math/detect.ts'
import { findMathSpans } from '../../src/math/spans.ts'
import type { SpanChar } from '../../src/math/spans.ts'

const SIZE = 10
const BASELINE = 100

/**
 * 短い書き方から、行の文字を作る。
 *   {…}   数式用のフォントの文字
 *   ^c    上付きの 1 文字(小さい文字を、基準線より上に置く)
 *   _c    下付きの 1 文字
 *   空白  単語の間の空き(文字の大きさの 0.3 倍)。続けて書くと、その分だけ広くなる
 *   ~c    行の上下に離れて置かれた数式の部品
 * 数学記号(= や × など)は、実物と同じく、フォントによらず数式の文字とする。
 */
function parse(spec: string): SpanChar[] {
  const chars: SpanChar[] = []
  let x = 0
  let math = false
  let script: 'super' | 'sub' | null = null
  let satellite = false
  for (const symbol of spec) {
    if (symbol === '{') math = true
    else if (symbol === '}') math = false
    else if (symbol === '^') script = 'super'
    else if (symbol === '_') script = 'sub'
    else if (symbol === '~') satellite = true
    else if (symbol === ' ') x += 0.3 * SIZE
    else {
      const fontSize = script ? 7 : SIZE
      const width = fontSize * 0.5
      chars.push({
        text: symbol,
        x,
        width,
        fontSize,
        baseline: script === 'super' ? BASELINE - 3.5 : script === 'sub' ? BASELINE + 1.5 : BASELINE,
        math: math || isMathSymbols(symbol),
        satellite,
      })
      x += width
      script = null
      satellite = false
    }
  }
  return chars
}

/** 数式の範囲を ⟦ ⟧ で囲んだ文字列を返す。空白は、もとの書き方のものを残す。 */
function mark(spec: string): string {
  const chars = parse(spec)
  const spans = findMathSpans(chars, SIZE, BASELINE)
  const starts = new Set(spans.map((span) => span.start))
  const ends = new Set(spans.map((span) => span.end))
  let result = ''
  let index = 0
  for (const symbol of spec) {
    if ('{}^_~'.includes(symbol)) continue
    if (symbol === ' ') {
      result += ' '
      continue
    }
    if (starts.has(index)) result += '⟦'
    result += symbol
    index += 1
    if (ends.has(index)) result += '⟧'
  }
  return result
}

describe('findMathSpans', () => {
  it.each([
    // 関数の形: 本文と同じフォントの括弧を含める
    ['the function {f}({x}) is', 'the function ⟦f(x)⟧ is'],
    ['in {O}({n}) time', 'in ⟦O(n)⟧ time'],
    ['{f}({x}, 2) = {y} holds', '⟦f(x, 2) = y⟧ holds'],
    ['{H}({x}) := {F}({x}) + {x}.', '⟦H(x) := F(x) + x⟧.'],
    // 数と演算子
    ['with {x} = 5 layers', 'with ⟦x = 5⟧ layers'],
    ['has 3 {×} 3 filters', 'has ⟦3 × 3⟧ filters'],
    ['where 2{x} + 1 is', 'where ⟦2x + 1⟧ is'],
    ['then 5 + {x} is', 'then ⟦5 + x⟧ is'],
    ['rate {η} = 0.01 and', 'rate ⟦η = 0.01⟧ and'],
    ['is (1 − {x}) here', 'is ⟦(1 − x)⟧ here'],
    // 括弧
    ['points ({x}, {y}) are', 'points ⟦(x, y)⟧ are'],
    ['({x} is the input)', '(⟦x⟧ is the input)'],
    ['(see {x})', '(see ⟦x⟧)'],
    ['nets {x} [41] and', 'nets ⟦x⟧ [41] and'],
    ['array {a}[3] is', 'array ⟦a[3]⟧ is'],
    // 句読点と単語は含めない
    ['value {x}. Then', 'value ⟦x⟧. Then'],
    ['both {x}, and {y}.', 'both ⟦x⟧, and ⟦y⟧.'],
    ['both {x}, {y} and', 'both ⟦x⟧, ⟦y⟧ and'],
    ['an {n}-gram model', 'an ⟦n⟧-gram model'],
    ['the {x}-{y} plane', 'the ⟦x-y⟧ plane'],
    ['a 3-layer net', 'a 3-layer net'],
    ['got 3.57% error', 'got 3.57% error'],
    // 添字
    ['size {d}_m_o_d_e_l is', 'size ⟦dmodel⟧ is'],
    ['matrix {W}^{Q}_{i} {∈} {R} here', 'matrix ⟦WQi ∈ R⟧ here'],
    ['some word^1 next', 'some word⟦1⟧ next'],
    ['the CO_2 gas', 'the CO2 gas'],
    ['the 1^s^t place', 'the 1st place'],
  ])('%s', (spec, expected) => {
    expect(mark(spec)).toBe(expected)
  })

  it('大きく離れた数式は、別の範囲にする', () => {
    expect(mark('{x}     {y}')).toBe('⟦x⟧     ⟦y⟧')
    expect(mark('{x} {y}')).toBe('⟦x y⟧')
  })

  it('行の上下に離れて置かれた部品を、数式に含める', () => {
    expect(mark('factor of ~1~2 here')).toBe('factor of ⟦12⟧ here')
  })

  it('数式の文字が無い行では、範囲を作らない', () => {
    expect(findMathSpans(parse('plain text (with 3 words) here.'), SIZE, BASELINE)).toEqual([])
  })
})
