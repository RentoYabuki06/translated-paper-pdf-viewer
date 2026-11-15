import { describe, expect, it } from 'vitest'
import { parseRegions } from '../../src/layout/parse.ts'
import { LAYOUT_LABELS } from '../../src/layout/types.ts'

const TEXT = LAYOUT_LABELS.indexOf('text')
const TABLE = LAYOUT_LABELS.indexOf('table')

describe('parseRegions', () => {
  it('画像の画素の座標を、ページの座標に換算する', () => {
    const regions = parseRegions({
      rows: [TEXT, 0.9, 80, 100, 400, 200, 0],
      inputSize: 800,
      pageWidth: 600,
      pageHeight: 800,
    })
    expect(regions).toEqual([{ label: 'text', score: 0.9, order: 0, x: 60, y: 100, width: 240, height: 100 }])
  })

  it('確からしさが下限に満たない領域を除く', () => {
    const regions = parseRegions({
      rows: [TEXT, 0.49, 0, 0, 100, 100, 0, TABLE, 0.5, 0, 0, 100, 100, 1],
      inputSize: 800,
      pageWidth: 800,
      pageHeight: 800,
    })
    expect(regions.map((region) => region.label)).toEqual(['table'])
  })

  it('読む順番で並べる', () => {
    const regions = parseRegions({
      rows: [TEXT, 0.9, 0, 200, 100, 300, 2, TABLE, 0.9, 0, 0, 100, 100, 1],
      inputSize: 800,
      pageWidth: 800,
      pageHeight: 800,
    })
    expect(regions.map((region) => region.label)).toEqual(['table', 'text'])
  })

  it('ページの外にはみ出た座標を、ページの範囲に収める', () => {
    const [region] = parseRegions({
      rows: [TEXT, 0.9, -10, -5, 820, 400, 0],
      inputSize: 800,
      pageWidth: 800,
      pageHeight: 800,
    })
    expect(region).toMatchObject({ x: 0, y: 0, width: 800, height: 400 })
  })

  it('種類の番号が範囲の外の行、大きさが無い行、端数の行を除く', () => {
    const regions = parseRegions({
      rows: [99, 0.9, 0, 0, 100, 100, 0, TEXT, 0.9, 50, 50, 50, 80, 1, TEXT, 0.9, 0],
      inputSize: 800,
      pageWidth: 800,
      pageHeight: 800,
    })
    expect(regions).toEqual([])
  })
})
