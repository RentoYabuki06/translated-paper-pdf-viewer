import { describe, expect, it } from 'vitest'
import { buildLines } from '../../src/analysis/lines.ts'
import { buildTaggedSource, mathPartOf } from '../../src/analysis/source.ts'
import type { Line } from '../../src/analysis/types.ts'
import { tagIds } from '../../src/math/placeholders.ts'
import { run } from './helpers.ts'

/** 数式用のフォントのまとまりを作る。 */
function math(text: string, x: number, baseline: number) {
  return run(text, x, baseline, { isMath: true, fontName: 'ABCDEF+CMMI10', fontId: 'm1' })
}

function firstLine(runs: Parameters<typeof buildLines>[0]): Line {
  const [line] = buildLines(runs)
  if (!line) throw new Error('行がありません')
  return line
}

describe('buildTaggedSource', () => {
  it('文中の数式を、番号の付いた目印に置き換える', () => {
    // "The function " の次に f、"(" 、x、") is good" と続く。
    const line = firstLine([
      run('The function', 0, 100),
      math('f', 65, 100),
      run('(', 70, 100),
      math('x', 75, 100),
      run(') is good', 80, 100),
    ])
    const source = buildTaggedSource([line])
    expect(source.text).toBe('The function <m1> is good')
    expect(source.slots).toHaveLength(1)
    expect(source.slots[0]).toMatchObject({ id: 1, text: 'f(x)' })
    // 範囲は、f の左端から ")" の右端まで。左右に余白が付く。
    const part = source.slots[0]?.parts[0]
    expect(part?.x).toBeCloseTo(65 - 0.6)
    expect(part?.width).toBeCloseTo(20 + 1.2)
    expect(part?.baseline).toBe(100)
  })

  it('数式の前後の空白と句読点を保つ', () => {
    const line = firstLine([run('if', 0, 100), math('x', 15, 100), run(', then (', 20, 100), math('y', 60, 100), run(').', 65, 100)])
    expect(buildTaggedSource([line]).text).toBe('if <m1>, then <m2>.')
  })

  it('行をつなぎ、行末のハイフンで分かれた語をつなぎ直す', () => {
    const lines = buildLines([run('the trans-', 0, 100), run('lation of', 0, 112), math('x', 50, 112), run('is', 0, 124)])
    expect(buildTaggedSource(lines).text).toBe('the translation of <m1> is')
  })

  it('行の終わりの数式と、次の行の始まりの数式を、1 つの目印にまとめる', () => {
    const lines = buildLines([run('we have', 0, 100), math('a+', 40, 100), math('b', 0, 112), run('here', 10, 112)])
    const source = buildTaggedSource(lines)
    expect(source.text).toBe('we have <m1> here')
    expect(source.slots[0]?.parts).toHaveLength(2)
    expect(source.slots[0]?.parts.map((part) => part.baseline)).toEqual([100, 112])
  })

  it('本文に目印の形の文字列があっても、原文の目印と数式の対応が崩れない', () => {
    const line = firstLine([run('the <m7> tag and', 0, 100), math('x', 85, 100)])
    const source = buildTaggedSource([line])
    expect(tagIds(source.text)).toEqual(source.slots.map((slot) => slot.id))
  })
})

describe('mathPartOf', () => {
  it('字形の実際の範囲が分かる場合は、それを使う', () => {
    const line = firstLine([run('sum', 0, 100), math('S', 20, 100)])
    const span = line.spans[0]
    if (!span) throw new Error('数式がありません')
    // 字形の範囲は、文字の大きさ(10 ポイント)に対する割合で渡す。
    const part = mathPartOf(line, span, () => ({ ascent: 0.2, descent: 0.9, left: 0.1, right: 0.7 }))
    expect(part.x).toBeCloseTo(20 - 1 - 0.6)
    expect(part.width).toBeCloseTo(8 + 1.2)
    expect(part.y).toBeCloseTo(100 - 2 - 0.8)
    expect(part.height).toBeCloseTo(11 + 1.6)
  })
})
