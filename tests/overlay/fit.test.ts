import { describe, expect, it } from 'vitest'
import { fitText, TIGHT_LINE_HEIGHT } from '../../src/overlay/fit.ts'

/** 幅 200 ポイントの箱に、全角の文字を count 個並べたときの高さを返す関数を作る。 */
function measurer(count: number, width = 200) {
  return (fontSize: number, lineHeight: number) => Math.ceil(count / Math.floor(width / fontSize)) * fontSize * lineHeight
}

const base = { fontSize: 10, linePitch: 13, height: 39, maxHeight: 39 }

describe('fitText', () => {
  it('元の大きさで収まる場合は、そのまま使う', () => {
    // 60 文字は 3 行で、高さは 39。
    expect(fitText(base, measurer(60))).toEqual({ kind: 'original', fontSize: 10, lineHeight: 1.3 })
  })

  it('収まらない場合は、まず下の空きへ広げる', () => {
    expect(fitText({ ...base, maxHeight: 52 }, measurer(80))).toMatchObject({ kind: 'expanded', fontSize: 10 })
  })

  it('空きが無い場合は、行送りを詰める', () => {
    // 4 行を行送り 1.2 で組むと高さ 48。
    expect(fitText({ ...base, maxHeight: 48 }, measurer(80))).toEqual({
      kind: 'tight',
      fontSize: 10,
      lineHeight: TIGHT_LINE_HEIGHT,
    })
  })

  it('それでも収まらない場合は、文字を小さくする', () => {
    const result = fitText(base, measurer(80))
    expect(result.kind).toBe('shrunk')
    expect(result.fontSize).toBeLessThan(10)
    expect(measurer(80)(result.fontSize, result.lineHeight)).toBeLessThanOrEqual(39.5)
  })

  it('最小の大きさでも収まらない場合は、末尾を隠す', () => {
    expect(fitText(base, measurer(400))).toEqual({ kind: 'clipped', fontSize: 6.7, lineHeight: TIGHT_LINE_HEIGHT })
  })

  it('文字を 6 ポイント未満にはしない', () => {
    const result = fitText({ fontSize: 7, linePitch: 8.4, height: 8, maxHeight: 8 }, measurer(400))
    expect(result).toMatchObject({ kind: 'clipped', fontSize: 6 })
  })

  it('原文の行送りが広すぎる場合は、上限に抑える', () => {
    const result = fitText({ fontSize: 10, linePitch: 30, height: 100, maxHeight: 100 }, measurer(20))
    expect(result.lineHeight).toBe(1.7)
  })
})
