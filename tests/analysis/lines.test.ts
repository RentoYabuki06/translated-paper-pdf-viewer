import { describe, expect, it } from 'vitest'
import { buildLines } from '../../src/analysis/lines.ts'
import { run } from './helpers.ts'

describe('buildLines', () => {
  it('同じ高さで、すき間が小さいまとまりを 1 行にする', () => {
    const lines = buildLines([run('World', 80, 100), run('Hello', 50, 100)])
    expect(lines).toHaveLength(1)
    expect(lines[0]?.text).toBe('Hello World')
    expect(lines[0]?.x).toBe(50)
  })

  it('すき間が無いまとまりの間には、空白を補わない', () => {
    const lines = buildLines([run('trans', 50, 100), run('lation', 75, 100)])
    expect(lines[0]?.text).toBe('translation')
  })

  it('高さが違うまとまりを別の行にし、上から順に並べる', () => {
    const lines = buildLines([run('second', 50, 112), run('first', 50, 100)])
    expect(lines.map((line) => line.text)).toEqual(['first', 'second'])
  })

  it('段組のように横に離れたまとまりを、別の行にする', () => {
    // すき間は 20 ポイントで、文字の大きさ 10 ポイントの 1.5 倍を超える。
    const lines = buildLines([run('left', 50, 100), run('right', 90, 100)])
    expect(lines.map((line) => line.text)).toEqual(['left', 'right'])
  })

  it('添字を、同じ行に含める', () => {
    const subscript = run('i', 55, 102, { fontSize: 7 })
    const lines = buildLines([run('x', 50, 100), subscript, run('is', 62, 100)])
    expect(lines).toHaveLength(1)
    expect(lines[0]?.text).toBe('xi is')
    expect(lines[0]?.fontSize).toBe(10)
    expect(lines[0]?.baseline).toBe(100)
  })

  it('行の先頭が小さい文字でも、あとの大きい文字で行の範囲を決める', () => {
    const mark = run('1', 50, 96, { fontSize: 7 })
    const lines = buildLines([mark, run('Footnote text', 54, 100), run('next line', 50, 112)])
    expect(lines.map((line) => line.text)).toEqual(['1Footnote text', 'next line'])
  })

  it('回転したまとまりと、空白だけのまとまりを除く', () => {
    const lines = buildLines([run('arXiv', 10, 300, { rotated: true }), run('  ', 50, 100), run('text', 60, 100)])
    expect(lines.map((line) => line.text)).toEqual(['text'])
  })

  it('行の上下に離れて置かれた数式の部品を、もとの行に戻す', () => {
    // 行の中の空き(x が 30 から 42)の下に、小さい数式の文字がある。分数の分母に当たる。
    const denominator = run('dk', 32.5, 106, { fontSize: 7, isMath: true })
    const lines = buildLines([run('factor', 0, 100), run('of the', 42, 100), denominator, run('next line of text', 0, 112)])
    expect(lines.map((line) => line.text)).toEqual(['factor dk of the', 'next line of text'])
    expect(lines[0]?.chars.filter((char) => char.satellite).map((char) => char.text)).toEqual(['d', 'k'])
    // 行の文字の大きさと基準線は、戻した部品に引きずられない。
    expect(lines[0]).toMatchObject({ fontSize: 10, baseline: 100 })
    expect(lines[0]?.spans).toEqual([{ start: 6, end: 8 }])
  })

  it('単語の真下にある小さい文字は、行に戻さない', () => {
    const lines = buildLines([run('factor of the', 0, 100), run('dk', 10, 106, { fontSize: 7, isMath: true })])
    expect(lines).toHaveLength(2)
  })

  it('次の行の短い数式を、前の行に取り込まない', () => {
    const lines = buildLines([run('where', 0, 100), run('x', 40, 100, { isMath: true }), run('=', 35, 112, { isMath: true })])
    expect(lines).toHaveLength(2)
  })

  it('数式の文字が占める割合を計算する', () => {
    const lines = buildLines([run('ab', 50, 100), run('xy', 60, 100, { isMath: true })])
    expect(lines[0]?.mathRatio).toBe(0.5)
  })
})
