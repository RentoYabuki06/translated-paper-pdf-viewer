import { describe, expect, it } from 'vitest'
import { excerptAround, firstDifference } from '../../scripts/lib/compare.ts'

describe('firstDifference', () => {
  it('同じ文字列では null を返す', () => {
    expect(firstDifference('学習率を下げる。', '学習率を下げる。')).toBeNull()
    expect(firstDifference('', '')).toBeNull()
  })

  it('最初に違う位置を、0 始まりで返す', () => {
    expect(firstDifference('L-smooth な関数', 'L-平滑な関数')).toBe(2)
    expect(firstDifference('abc', 'xbc')).toBe(0)
  })

  it('片方がもう片方の先頭の部分である場合は、短いほうの長さを返す', () => {
    expect(firstDifference('モデルを学習させる', 'モデルを学習させる。')).toBe(9)
    expect(firstDifference('abc', '')).toBe(0)
  })
})

describe('excerptAround', () => {
  const text = '0123456789abcdefghij'

  it('指定した位置の前後を切り出し、端に届いていない側に「…」を付ける', () => {
    expect(excerptAround(text, 10, 3, 4)).toBe('…789abcd…')
  })

  it('文字列の先頭に届いた側には「…」を付けない', () => {
    expect(excerptAround(text, 2, 5, 3)).toBe('01234…')
  })

  it('文字列の末尾に届いた側には「…」を付けない', () => {
    expect(excerptAround(text, 18, 2, 10)).toBe('…ghij')
  })

  it('文字列の全体が入る場合は、そのまま返す', () => {
    expect(excerptAround('短い文', 1)).toBe('短い文')
  })
})
