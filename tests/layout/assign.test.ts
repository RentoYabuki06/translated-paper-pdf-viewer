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
