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

  it('段の間が狭くても、段の左端から始まるまとまりは、左の段の行につなげない', () => {
    // 左の段の行は 50 から 290 まで。右の段は 303 から始まり、すき間は 13 ポイント(文字の大きさの 1.3 倍)。
    const left = 'a'.repeat(48)
    const runs = [0, 1, 2, 3, 4, 5].flatMap((row) => [run(left, 50, 100 + row * 12), run('right column', 303, 100 + row * 12)])
    const lines = buildLines(runs)
    expect(lines).toHaveLength(12)
    expect(lines.filter((line) => line.text === 'right column')).toHaveLength(6)
  })

  it('段の左端から少し左へはみ出して始まるまとまりも、左の段の行につなげない', () => {
    const left = 'a'.repeat(48)
    const runs = [0, 1, 2, 3, 4, 5].flatMap((row) => [run(left, 50, 100 + row * 12), run('right column', 303, 100 + row * 12)])
    // 7 行目だけ、右の段の行が 1.4 ポイント左から始まる。
    runs.push(run(left, 50, 172), run('(hanging) line', 301.6, 172))
    const lines = buildLines(runs)
    expect(lines).toHaveLength(14)
    expect(lines.some((line) => line.text === '(hanging) line')).toBe(true)
  })

  it('本文のすぐ横の、4 行の説明文も、本文の行につなげない', () => {
    // 本文の行は 50 から 290 まで。説明文は 298 から始まり、すき間は 8 ポイント(文字の大きさの 0.8 倍)。
    const left = 'a'.repeat(48)
    const runs = [0, 1, 2, 3].flatMap((row) => [run(left, 50, 100 + row * 12), run('caption', 298, 100 + row * 12)])
    expect(buildLines(runs)).toHaveLength(8)
  })

  it('段の左端から始まっていても、すき間が単語の間ほどなら、同じ行にする', () => {
    // 箇条書きの番号と本文のように、すき間が文字の大きさの半分の場合。
    const runs = [0, 1, 2, 3, 4].flatMap((row) => [run(`${row + 1}.`, 50, 100 + row * 12), run('item text', 65, 100 + row * 12)])
    const lines = buildLines(runs)
    expect(lines).toHaveLength(5)
    expect(lines[0]?.text).toBe('1. item text')
  })

  it('同じ位置から始まるまとまりが少ないときは、これまでどおり、すき間の上限まで 1 行にする', () => {
    const left = 'a'.repeat(48)
    const lines = buildLines([run(left, 50, 100), run('same line', 303, 100)])
    expect(lines).toHaveLength(1)
  })

  it('まわりより大きく離れた大きさの文字は、縦の範囲が重なっていても、別の行にする', () => {
    // 32 ポイントの記号の縦の範囲は、見出しの行と、本文の 1 行目の両方に重なる。
    const mark = run('■', 50, 104, { fontSize: 32 })
    const lines = buildLines([mark, run('HEADING', 68, 96, { fontSize: 10.5 }), run('Body text of the section', 50, 110)])
    expect(lines.map((line) => line.text).sort()).toEqual(['Body text of the section', 'HEADING', '■'])
  })

  it('大きな文字の右にある、別の段の行を巻き込まない', () => {
    const mark = run('■', 50, 104, { fontSize: 32 })
    const lines = buildLines([mark, run('a'.repeat(48), 50, 110), run('right column', 314, 108)])
    expect(lines.map((line) => line.text)).toContain('right column')
    expect(lines).toHaveLength(3)
  })

  it('数式の文字が占める割合を計算する', () => {
    const lines = buildLines([run('ab', 50, 100), run('xy', 60, 100, { isMath: true })])
    expect(lines[0]?.mathRatio).toBe(0.5)
  })
})
