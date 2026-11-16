import { describe, expect, it } from 'vitest'
import type { Paragraph } from '../../src/analysis/types.ts'
import { buildUnits, splitHeadingNumber } from '../../src/analysis/units.ts'
import type { TranslationUnit } from '../../src/analysis/units.ts'
import type { LayoutLabel, LayoutRegion } from '../../src/layout/types.ts'
import { lineWithChars } from './helpers.ts'

/** 行間 12 ポイント、文字の大きさ 10 ポイントの段落を作る。 */
function paragraph(text: string, x: number, y: number, width: number, lineCount = 1, mathRatio = 0): Paragraph {
  // 文章は 1 行目に置き、2 行目以降は「…」とする。
  const lines = Array.from({ length: lineCount }, (_, index) => lineWithChars(index === 0 ? text : '…', x, y + 8 + index * 12, width))
  return { text, x, y, width, height: 10 + (lineCount - 1) * 12, lines, fontSize: 10, mathRatio }
}

function region(label: LayoutLabel, x: number, y: number, width: number, height: number): LayoutRegion {
  return { label, score: 0.9, order: 0, x, y, width, height }
}

/** 段落をちょうど覆う領域を作る。 */
function cover(label: LayoutLabel, target: Paragraph): LayoutRegion {
  return region(label, target.x - 2, target.y - 2, target.width + 4, target.height + 4)
}

/** 名前で翻訳単位を取り出す。名前は「p<ページ番号>-<段落の番号>」。 */
function byId(units: TranslationUnit[], id: string): TranslationUnit {
  const unit = units.find((candidate) => candidate.id === id)
  if (!unit) throw new Error(`翻訳単位 ${id} がありません`)
  return unit
}

describe('buildUnits', () => {
  it('訳す種類の段落だけを、翻訳単位にする', () => {
    const body = paragraph('Body text of the paper.', 50, 100, 200, 3)
    const cell = paragraph('Table cell', 50, 300, 60)
    const stray = paragraph('No region here', 50, 400, 80)
    const units = buildUnits(2, [body, cell, stray], [cover('text', body), cover('table', cell)])
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({
      id: 'p2-0',
      pageNumber: 2,
      index: 0,
      source: 'Body text of the paper. … …',
      math: [],
      kind: 'text',
      linePitch: 12,
    })
    expect(units[0]?.fragments).toHaveLength(1)
    expect(units[0]?.fragments[0]).toMatchObject({ pageNumber: 2, lineCount: 3, rect: { x: 50, y: 100, width: 200, height: 34 } })
  })

  it('数式が大半を占める段落と、英字の語を含まない段落を除く', () => {
    const formula = paragraph('y = F(x) + x', 50, 100, 100, 1, 0.8)
    const number = paragraph('(1) 3.14', 50, 200, 40)
    expect(buildUnits(1, [formula, number], [cover('text', formula), cover('text', number)])).toEqual([])
  })

  it('題名と要旨の間にある段落(著者の欄)を除き、見出しは残す', () => {
    const title = paragraph('A Paper Title', 100, 50, 300)
    const author = paragraph('Some Author, Some University', 150, 100, 200)
    const heading = paragraph('Abstract', 220, 150, 60)
    const abstract = paragraph('We propose a method.', 100, 180, 300, 4)
    const units = buildUnits(
      1,
      [title, author, heading, abstract],
      [cover('doc_title', title), cover('text', author), cover('paragraph_title', heading), cover('abstract', abstract)],
    )
    expect(units.map((unit) => unit.kind)).toEqual(['doc_title', 'paragraph_title', 'abstract'])
  })

  it('下の空きを、真下の要素の手前まで広げる', () => {
    const first = paragraph('First paragraph text.', 50, 100, 200, 2)
    const second = paragraph('Second paragraph text.', 50, 150, 200, 2)
    const other = paragraph('Another column text.', 300, 110, 200, 2)
    const units = buildUnits(1, [first, second, other], [cover('text', first), cover('text', second), cover('text', other)])
    // first の下端は 122、second の上端は 150。すき間 3 ポイントを残す。
    expect(byId(units, 'p1-0').fragments[0]?.maxHeight).toBe(150 - 3 - 100)
    // second の下には何も無いため、ページの中で最も下にある文字の位置まで。
    expect(byId(units, 'p1-1').fragments[0]?.maxHeight).toBe(22)
  })

  it('図の領域を避ける', () => {
    const caption = paragraph('Figure 1. A caption text.', 50, 100, 200)
    const footer = paragraph('Footer text here', 50, 400, 100)
    const units = buildUnits(1, [caption, footer], [cover('figure_title', caption), cover('text', footer), region('image', 50, 130, 200, 100)])
    expect(units[0]?.fragments[0]?.maxHeight).toBe(130 - 3 - 100)
  })

  it('1 行だけの段落は、右の空きも広げる', () => {
    const heading = paragraph('1. Introduction', 50, 100, 80)
    const body = paragraph('Body text of the section.', 50, 120, 230, 3)
    const rightColumn = paragraph('Right column text.', 300, 95, 230, 3)
    const units = buildUnits(1, [heading, body, rightColumn], [cover('paragraph_title', heading), cover('text', body), cover('text', rightColumn)])
    expect(byId(units, 'p1-0').fragments[0]?.maxWidth).toBe(300 - 3 - 50)
    // 複数行の段落は、幅を広げない。
    expect(byId(units, 'p1-1').fragments[0]?.maxWidth).toBe(230)
  })

  it('読む順に並べる。順番は、レイアウト検出の領域の順番で決まる', () => {
    const left = paragraph('Left column text.', 50, 300, 200, 2)
    const rightTop = paragraph('Right column text.', 300, 100, 200, 2)
    const units = buildUnits(1, [rightTop, left], [
      { ...cover('text', left), order: 5 },
      { ...cover('text', rightTop), order: 9 },
    ])
    expect(units.map((unit) => unit.source)).toEqual(['Left column text. …', 'Right column text. …'])
  })

  it('段のいちばん上・いちばん下にあるかどうかを記録する。図や脚注は数えない', () => {
    const top = paragraph('Top paragraph text.', 50, 100, 200, 2)
    const bottomText = paragraph('Bottom paragraph text.', 50, 200, 200, 2)
    const footnote = paragraph('A footnote text.', 50, 300, 200)
    const other = paragraph('Other column text.', 300, 150, 200, 2)
    const units = buildUnits(1, [top, bottomText, footnote, other], [
      cover('text', top),
      cover('text', bottomText),
      cover('footnote', footnote),
      cover('text', other),
      region('image', 300, 50, 200, 80),
    ])
    expect([byId(units, 'p1-0').atColumnTop, byId(units, 'p1-0').atColumnBottom]).toEqual([true, false])
    // 下にあるのは脚注だけなので、段のいちばん下とみなす。
    expect([byId(units, 'p1-1').atColumnTop, byId(units, 'p1-1').atColumnBottom]).toEqual([false, true])
    // 上にあるのは図だけなので、段のいちばん上とみなす。
    expect([byId(units, 'p1-3').atColumnTop, byId(units, 'p1-3').atColumnBottom]).toEqual([true, true])
  })

  it('2 つの段にまたがる題名は、段のいちばん上の判定に数えない', () => {
    // 題名は x が 125 から 425 で、左の段(50 から 250)と右の段(300 から 500)の両方に重なる。
    // 題名の中心(275)は、2 つの段の間にある。
    const title = paragraph('A Title Spanning Both Columns', 125, 40, 300)
    const left = paragraph('Left column first paragraph.', 50, 100, 200, 3)
    const rightTop = paragraph('Right column first paragraph.', 300, 100, 200, 3)
    const units = buildUnits(1, [title, left, rightTop], [cover('doc_title', title), cover('text', left), cover('text', rightTop)])
    expect(byId(units, 'p1-1').atColumnTop).toBe(true)
    expect(byId(units, 'p1-2').atColumnTop).toBe(true)
  })

  it('同じ段の幅の広い段落の下にある短い段落は、段のいちばん上としない', () => {
    const wide = paragraph('A wide paragraph of the column.', 50, 100, 200, 3)
    const shortLine = paragraph('short line', 50, 150, 60)
    const units = buildUnits(1, [wide, shortLine], [cover('text', wide), cover('text', shortLine)])
    expect(byId(units, 'p1-1').atColumnTop).toBe(false)
    expect(byId(units, 'p1-0').atColumnBottom).toBe(false)
  })

  it('最後の行が段の右端まで届いているかどうかを記録する', () => {
    const full = paragraph('A paragraph whose last line is full.', 50, 100, 200, 3)
    const short = paragraph('A paragraph whose last line is short.', 50, 200, 200, 3)
    const lastLine = short.lines.at(-1)
    if (lastLine) lastLine.width = 80
    const units = buildUnits(1, [full, short], [cover('text', full), cover('text', short)])
    expect(byId(units, 'p1-0').lastLineFull).toBe(true)
    expect(byId(units, 'p1-1').lastLineFull).toBe(false)
  })

  it('1 行だけの段落では、同じ段のほかの段落の幅から、行が右端まで届いているかを判定する', () => {
    const body = paragraph('A wide body paragraph of the column.', 50, 100, 200, 3)
    const fullLine = paragraph('one full line at the column bottom', 50, 150, 195)
    const shortLine = paragraph('short line', 50, 180, 60)
    const units = buildUnits(1, [body, fullLine, shortLine], [cover('text', body), cover('text', fullLine), cover('text', shortLine)])
    expect(byId(units, 'p1-1').lastLineFull).toBe(true)
    expect(byId(units, 'p1-2').lastLineFull).toBe(false)
  })

  it('節の見出しの番号を、原文から外して、prefix に入れる', () => {
    const heading = paragraph('6 Results', 50, 100, 60)
    const body = paragraph('3 models are compared here.', 50, 130, 200, 2)
    const units = buildUnits(1, [heading, body], [cover('paragraph_title', heading), cover('text', body)])
    expect(byId(units, 'p1-0')).toMatchObject({ source: 'Results', prefix: '6' })
    // 本文は、数で始まっていても、そのままにする。
    expect(byId(units, 'p1-1')).toMatchObject({ source: '3 models are compared here. …', prefix: '' })
  })

  it('1 行目の字下げを記録する', () => {
    const indented = paragraph('Indented paragraph text here.', 50, 100, 200, 3)
    const firstLine = indented.lines[0]
    if (firstLine) firstLine.x = 65
    const units = buildUnits(1, [indented], [cover('text', indented)])
    expect(units[0]?.fragments[0]?.indented).toBe(true)
  })
})

describe('splitHeadingNumber', () => {
  it.each([
    ['6 Results', '6', 'Results'],
    ['3.2.1 Scaled Dot-Product Attention', '3.2.1', 'Scaled Dot-Product Attention'],
    ['1. Introduction', '1.', 'Introduction'],
    ['A. Object Detection Baselines', 'A.', 'Object Detection Baselines'],
    ['A.1 Training Details', 'A.1', 'Training Details'],
  ])('%s を、番号とそれ以外に分ける', (text, prefix, rest) => {
    expect(splitHeadingNumber(text)).toEqual({ prefix, rest })
  })

  it.each(['Abstract', 'A Method for Translation', 'PASCAL VOC', '2015 in Review of 3 Models', '3.2'])('%s は、分けない', (text) => {
    // "2015 in Review …" は、先頭の数が番号とは限らないが、形の上では番号と区別できない。分けた結果を確かめておく。
    const result = splitHeadingNumber(text)
    if (text.startsWith('2015')) expect(result).toEqual({ prefix: '2015', rest: 'in Review of 3 Models' })
    else expect(result).toEqual({ prefix: '', rest: text })
  })
})
