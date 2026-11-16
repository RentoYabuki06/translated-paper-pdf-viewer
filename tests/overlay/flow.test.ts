import { describe, expect, it } from 'vitest'
import { flowText } from '../../src/overlay/fit.ts'
import type { FlowMeasure } from '../../src/overlay/fit.ts'

/**
 * 訳文の要素を、すべて全角の文字(幅は文字の大きさと同じ)とみなして、高さを返す関数を作る。
 * widths には、各範囲の幅を渡す。
 */
function measurer(widths: number[]): FlowMeasure {
  return (box, start, end, fontSize, lineHeight) => {
    const perLine = Math.floor((widths[box] as number) / fontSize)
    return Math.ceil((end - start) / perLine) * fontSize * lineHeight
  }
}

/** 行送り 12 ポイントで lines 行分の高さの範囲。広げる余地は extra 行分。 */
const box = (lines: number, extra = 0) => ({ height: lines * 12, maxHeight: (lines + extra) * 12 })

const base = { fontSize: 10, linePitch: 12 }

describe('flowText', () => {
  it('前の範囲に収まるだけ詰め、残りを次の範囲に入れる', () => {
    // 幅 200 の範囲には、1 行に 20 文字入る。3 行の範囲には 60 文字。
    const result = flowText({ ...base, boxes: [box(3), box(2)], atomCount: 90 }, measurer([200, 200]))
    expect(result).toEqual({ kind: 'original', fontSize: 10, lineHeight: 1.2, breaks: [60, 90] })
  })

  it('訳文が短ければ、後ろの範囲は空になる', () => {
    const result = flowText({ ...base, boxes: [box(3), box(2)], atomCount: 45 }, measurer([200, 200]))
    expect(result.breaks).toEqual([45, 45])
    expect(result.kind).toBe('original')
  })

  it('範囲ごとの幅の違いを反映する', () => {
    // 1 つ目は 1 行に 10 文字、2 つ目は 1 行に 20 文字。
    const result = flowText({ ...base, boxes: [box(2), box(2)], atomCount: 60 }, measurer([100, 200]))
    expect(result.breaks).toEqual([20, 60])
  })

  it('最後の範囲に収まらなければ、下の空きへ広げる', () => {
    const result = flowText({ ...base, boxes: [box(3), box(2, 1)], atomCount: 120 }, measurer([200, 200]))
    expect(result).toMatchObject({ kind: 'expanded', fontSize: 10, breaks: [60, 120] })
  })

  it('広げても収まらなければ、文字を小さくして、すべての範囲を詰め直す', () => {
    const result = flowText({ ...base, boxes: [box(3), box(2)], atomCount: 110 }, measurer([200, 200]))
    expect(result.kind).toBe('shrunk')
    // 9.5 ポイントでは 1 行に 21 文字。1 つ目に 63 文字が入り、残りの 47 文字は 2 行(42 文字)に収まらない。
    // 9 ポイントでは 1 行に 22 文字。1 つ目に 66 文字が入り、残りの 44 文字が 2 行に収まる。
    expect(result.fontSize).toBe(9)
    expect(result.breaks).toEqual([66, 110])
  })

  it('最小の大きさでも収まらなければ、末尾を隠す', () => {
    const result = flowText({ ...base, boxes: [box(1), box(1)], atomCount: 400 }, measurer([200, 200]))
    expect(result.kind).toBe('clipped')
    expect(result.fontSize).toBeCloseTo(6.7)
    expect(result.breaks.at(-1)).toBe(400)
  })

  it('分けてはいけない位置では、分ける位置を前へずらす', () => {
    // 60 文字目の直前と、59 文字目の直前では分けられない。
    const result = flowText({ ...base, boxes: [box(3), box(2)], atomCount: 90 }, measurer([200, 200]), (index) => index !== 60 && index !== 59)
    expect(result.breaks).toEqual([58, 90])
  })

  it('3 つ以上の範囲にも、順に流し込む', () => {
    const result = flowText({ ...base, boxes: [box(1), box(2), box(3)], atomCount: 100 }, measurer([200, 200, 200]))
    expect(result.breaks).toEqual([20, 60, 100])
    expect(result.kind).toBe('original')
  })

  it('範囲が 1 つなら、全体をその範囲に入れる', () => {
    const result = flowText({ ...base, boxes: [box(3)], atomCount: 50 }, measurer([200]))
    expect(result).toEqual({ kind: 'original', fontSize: 10, lineHeight: 1.2, breaks: [50] })
  })
})
