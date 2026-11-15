import { describe, expect, it } from 'vitest'
import type { Paragraph } from '../../src/analysis/types.ts'
import { buildUnits } from '../../src/analysis/units.ts'
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
      lineCount: 3,
      linePitch: 12,
    })
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
    expect(units[0]?.maxHeight).toBe(150 - 3 - 100)
    // second の下には何も無いため、ページの中で最も下にある文字の位置まで。
    expect(units[1]?.maxHeight).toBe(22)
  })

  it('図の領域を避ける', () => {
    const caption = paragraph('Figure 1. A caption text.', 50, 100, 200)
    const footer = paragraph('Footer text here', 50, 400, 100)
    const units = buildUnits(1, [caption, footer], [cover('figure_title', caption), cover('text', footer), region('image', 50, 130, 200, 100)])
    expect(units[0]?.maxHeight).toBe(130 - 3 - 100)
  })

  it('1 行だけの段落は、右の空きも広げる', () => {
    const heading = paragraph('1. Introduction', 50, 100, 80)
    const body = paragraph('Body text of the section.', 50, 120, 230, 3)
    const rightColumn = paragraph('Right column text.', 300, 95, 230, 3)
    const units = buildUnits(1, [heading, body, rightColumn], [cover('paragraph_title', heading), cover('text', body), cover('text', rightColumn)])
    expect(units[0]?.maxWidth).toBe(300 - 3 - 50)
    // 複数行の段落は、幅を広げない。
    expect(units[1]?.maxWidth).toBe(230)
  })

  it('1 行目の字下げを記録する', () => {
    const indented = paragraph('Indented paragraph text here.', 50, 100, 200, 3)
    const firstLine = indented.lines[0]
    if (firstLine) firstLine.x = 65
    const units = buildUnits(1, [indented], [cover('text', indented)])
    expect(units[0]?.indented).toBe(true)
  })
})
