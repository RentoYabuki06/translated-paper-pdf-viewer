import { OPS } from 'pdfjs-dist'
import { describe, expect, it } from 'vitest'
import { extractGlyphs } from '../../src/pdf/glyphs.ts'
import type { Glyph, OperatorList } from '../../src/pdf/glyphs.ts'
import type { Matrix } from '../../src/pdf/matrix.ts'

/** 高さ 800 ポイントのページで、左下が原点の座標を、左上が原点の座標に直す変換。 */
const BASE: Matrix = [1, 0, 0, -1, 0, 800]

const FONT = { widthScale: 0.001, vertical: false }

/** 字形 1 つ分の情報を作る。width は、文字の大きさの 1/1000 の単位。 */
function g(unicode: string, width = 500, isSpace = false) {
  return { unicode, fontChar: unicode, width, isSpace }
}

function run(ops: [number, unknown][]): Glyph[] {
  const list: OperatorList = { fnArray: ops.map(([fn]) => fn), argsArray: ops.map(([, args]) => args) }
  return extractGlyphs(list, () => FONT, BASE)
}

/** 位置と幅を、見やすい形にする。 */
function place(glyphs: Glyph[]) {
  return glyphs.map((glyph) => [glyph.text, round(glyph.x), round(glyph.baseline), round(glyph.width)])
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

const begin: [number, unknown][] = [
  [OPS.beginText, null],
  [OPS.setFont, ['f1', 10]],
  [OPS.moveText, [100, 700]],
]

describe('extractGlyphs', () => {
  it('文字の送り幅の分だけ、次の文字を右に置く', () => {
    const glyphs = run([...begin, [OPS.showText, [[g('A', 500), g('B', 600)]]]])
    expect(place(glyphs)).toEqual([
      ['A', 100, 100, 5],
      ['B', 105, 100, 6],
    ])
    expect(glyphs[0]).toMatchObject({ fontId: 'f1', fontSize: 10, rotated: false })
  })

  it('字間の調整(負の値で右に、正の値で左にずらす)を反映する', () => {
    const glyphs = run([...begin, [OPS.showText, [[g('A'), -200, g('B'), 100, g('C')]]]])
    expect(place(glyphs).map((item) => item[1])).toEqual([100, 107, 111])
  })

  it('字間と語間の指定を反映する', () => {
    const glyphs = run([
      ...begin,
      [OPS.setCharSpacing, [1]],
      [OPS.setWordSpacing, [3]],
      [OPS.showText, [[g('A'), g(' ', 250, true), g('B')]]],
    ])
    // A の次は 5 + 1。空白の次は 2.5 + 1 + 3。
    expect(place(glyphs).map((item) => item[1])).toEqual([100, 106, 112.5])
  })

  it('続けて書いた文字列は、前の文字列の終わりから始まる', () => {
    const glyphs = run([...begin, [OPS.showText, [[g('A')]]], [OPS.showText, [[g('B')]]]])
    expect(place(glyphs).map((item) => item[1])).toEqual([100, 105])
  })

  it('テキストの行列による拡大と移動を反映する', () => {
    const glyphs = run([
      [OPS.beginText, null],
      [OPS.setFont, ['f1', 10]],
      [OPS.setTextMatrix, [new Float32Array([2, 0, 0, 2, 50, 600])]],
      [OPS.showText, [[g('A'), g('B')]]],
    ])
    expect(place(glyphs)).toEqual([
      ['A', 50, 200, 10],
      ['B', 60, 200, 10],
    ])
    expect(glyphs[0]?.fontSize).toBe(20)
  })

  it('行の移動は、テキストの行列の中の座標で行う', () => {
    const glyphs = run([
      [OPS.beginText, null],
      [OPS.setFont, ['f1', 10]],
      [OPS.setTextMatrix, [[2, 0, 0, 2, 50, 600]]],
      [OPS.showText, [[g('A')]]],
      [OPS.moveText, [10, -12]],
      [OPS.showText, [[g('B')]]],
      [OPS.setLeading, [12]],
      [OPS.nextLine, null],
      [OPS.showText, [[g('C')]]],
      [OPS.setLeadingMoveText, [0, -6]],
      [OPS.nextLine, null],
      [OPS.showText, [[g('D')]]],
    ])
    expect(place(glyphs).map((item) => [item[1], item[2]])).toEqual([
      [50, 200],
      [70, 224],
      [70, 248],
      [70, 272],
    ])
  })

  it('保存と復元にはさまれた座標の変換は、復元のあとに残らない', () => {
    const glyphs = run([
      [OPS.save, null],
      [OPS.transform, [1, 0, 0, 1, 10, 20]],
      ...begin,
      [OPS.showText, [[g('A')]]],
      [OPS.endText, null],
      [OPS.restore, null],
      ...begin,
      [OPS.showText, [[g('B')]]],
    ])
    expect(place(glyphs)).toEqual([
      ['A', 110, 80, 5],
      ['B', 100, 100, 5],
    ])
  })

  it('フォームの変換を反映し、フォームの終わりで元に戻す', () => {
    const glyphs = run([
      [OPS.beginGroup, [{ matrix: null }]],
      [OPS.paintFormXObjectBegin, [new Float32Array([0.5, 0, 0, 0.5, 200, 300]), null]],
      ...begin,
      [OPS.showText, [[g('A')]]],
      [OPS.endText, null],
      [OPS.paintFormXObjectEnd, []],
      [OPS.endGroup, [{ matrix: null }]],
      ...begin,
      [OPS.showText, [[g('B')]]],
    ])
    expect(place(glyphs)).toEqual([
      ['A', 250, 150, 2.5],
      ['B', 100, 100, 5],
    ])
    expect(glyphs[0]?.fontSize).toBe(5)
  })

  it('フォントの指定は、保存と復元の対象になる', () => {
    const glyphs = run([
      ...begin,
      [OPS.save, null],
      [OPS.setFont, ['f2', 20]],
      [OPS.showText, [[g('A')]]],
      [OPS.restore, null],
      [OPS.showText, [[g('B')]]],
    ])
    expect(glyphs.map((glyph) => [glyph.fontId, glyph.fontSize])).toEqual([
      ['f2', 20],
      ['f1', 10],
    ])
  })

  it('横方向の拡大率と、文字の上げ下げを反映する', () => {
    const glyphs = run([...begin, [OPS.setHScale, [50]], [OPS.setTextRise, [3]], [OPS.showText, [[g('A'), g('B')]]]])
    expect(place(glyphs)).toEqual([
      ['A', 100, 97, 2.5],
      ['B', 102.5, 97, 2.5],
    ])
  })

  it('回転した文字に印を付ける', () => {
    const glyphs = run([
      [OPS.beginText, null],
      [OPS.setFont, ['f1', 10]],
      [OPS.setTextMatrix, [[0, 1, -1, 0, 100, 700]]],
      [OPS.showText, [[g('A')]]],
    ])
    expect(glyphs[0]?.rotated).toBe(true)
  })

  it('合字を、もとの文字の並びに直す', () => {
    const glyphs = run([...begin, [OPS.showText, [[g('ﬁ'), g('­')]]]])
    expect(glyphs.map((glyph) => glyph.text)).toEqual(['fi', '-'])
  })

  it('縦書きのフォントの文字は取り出さない', () => {
    const list: OperatorList = {
      fnArray: begin.map(([fn]) => fn).concat(OPS.showText),
      argsArray: [...begin.map(([, args]) => args), [[g('縦')]]],
    }
    expect(extractGlyphs(list, () => ({ widthScale: 0.001, vertical: true }), BASE)).toEqual([])
  })
})
