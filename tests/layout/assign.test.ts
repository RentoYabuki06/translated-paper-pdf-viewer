import { describe, expect, it } from 'vitest'
import { actionFor, assignKind } from '../../src/layout/assign.ts'
import type { LayoutLabel, LayoutRegion } from '../../src/layout/types.ts'

function region(label: LayoutLabel, x: number, y: number, width: number, height: number): LayoutRegion {
  return { label, score: 0.9, order: 0, x, y, width, height }
}

describe('assignKind', () => {
  const paragraph = { x: 100, y: 100, width: 200, height: 40 }

  it('段落を覆う領域の種類を割り当てる', () => {
    const text = region('text', 95, 95, 210, 50)
    expect(assignKind(paragraph, [region('table', 100, 300, 200, 100), text])).toEqual({ kind: 'text', region: text })
  })

  it('重なりが半分に満たない場合は unknown にする', () => {
    expect(assignKind(paragraph, [region('text', 100, 125, 200, 100)]).kind).toBe('unknown')
    expect(assignKind(paragraph, []).kind).toBe('unknown')
  })

  it('同じ程度に重なる領域が複数ある場合は、小さい領域を選ぶ', () => {
    const image = region('image', 50, 50, 400, 400)
    const caption = region('figure_title', 98, 98, 204, 44)
    expect(assignKind(paragraph, [image, caption]).kind).toBe('figure_title')
    expect(assignKind(paragraph, [caption, image]).kind).toBe('figure_title')
  })

  it('1 つの段落を、同じ種類の 2 つの領域が半分ずつ覆う場合は、その種類にする', () => {
    // 2 段落の要旨を、文字の位置からは 1 つの段落、レイアウト検出は 2 つの領域と判定した場合。
    const upper = region('abstract', 100, 100, 200, 19)
    const lower = region('abstract', 100, 121, 200, 19)
    expect(assignKind(paragraph, [upper, lower]).kind).toBe('abstract')
  })

  it('違う種類の領域が半分ずつ覆う場合は、合わせて数えない', () => {
    const upper = region('text', 100, 100, 200, 19)
    const lower = region('table', 100, 121, 200, 19)
    expect(assignKind(paragraph, [upper, lower]).kind).toBe('unknown')
  })

  it('図の横を回り込む段落は、行の範囲で重なりを数える', () => {
    // 上の 4 行は図の左の狭い幅、下の 2 行は広い幅。段落を囲む矩形は、図の範囲を含む。
    const lines = [
      ...[0, 1, 2, 3].map((row) => ({ x: 100, y: 100 + row * 12, width: 100, height: 10 })),
      ...[4, 5].map((row) => ({ x: 100, y: 100 + row * 12, width: 300, height: 10 })),
    ]
    const wrapped = { x: 100, y: 100, width: 300, height: 70, lines }
    const narrow = region('text', 98, 98, 104, 48)
    const wide = region('text', 98, 146, 304, 26)
    const figure = region('image', 210, 98, 192, 46)
    expect(assignKind(wrapped, [narrow, wide, figure]).kind).toBe('text')
    // 行の範囲を渡さないと、どの領域も矩形の半分に届かない。
    expect(assignKind({ x: 100, y: 100, width: 300, height: 70 }, [narrow, figure]).kind).toBe('unknown')
  })

  it('重なりが明らかに大きい領域を選ぶ', () => {
    const partial = region('footnote', 100, 100, 120, 40)
    const full = region('text', 0, 0, 600, 800)
    expect(assignKind(paragraph, [partial, full]).kind).toBe('text')
  })

  it('inline_formula の領域は、段落の種類にしない', () => {
    expect(assignKind(paragraph, [region('inline_formula', 100, 100, 200, 40)]).kind).toBe('unknown')
  })
})

describe('actionFor', () => {
  it.each(['text', 'abstract', 'doc_title', 'paragraph_title', 'figure_title', 'footnote', 'vision_footnote'] as const)(
    '%s は訳す',
    (kind) => {
      expect(actionFor(kind)).toBe('translate')
    },
  )

  it.each(['table', 'image', 'chart', 'display_formula', 'formula_number', 'reference_content', 'number', 'header', 'algorithm', 'unknown'] as const)(
    '%s は訳さない',
    (kind) => {
      expect(actionFor(kind)).toBe('keep')
    },
  )
})
